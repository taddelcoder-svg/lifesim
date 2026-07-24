'use strict';

// server/game.js
// Server-autoritative Spielwelt: Lobby, Bewegung, Alterung, Delta-Erzeugung.
// Der Client bestimmt niemals Position, Geld oder Schaden - er sendet nur
// Eingabeabsichten (Tasten), die hier validiert und angewendet werden.

const crypto = require('crypto');
const path = require('path');
const {
  createPlayer,
  serializePublic,
  serializeMovement,
  WORLD_WIDTH,
  WORLD_HEIGHT,
  STARTING_CASH,
} = require('./player');
const { pickEligibleEvent } = require('./events');
const {
  PROPERTIES,
  COMPANY_FOUNDING_COST,
  COMPANY_INCOME_PER_TICK,
  COMPANY_UPKEEP_PER_TICK,
  PROPERTY_SELL_BACK_RATIO,
  COMPANY_CLOSE_REFUND_RATIO,
  WEALTH_TAX_RATE,
  TRADE_RESPONSE_DURATION_MS,
} = require('./economy');
const {
  STEAL_RANGE,
  STEAL_COOLDOWN_MS,
  STEAL_SUCCESS_CHANCE,
  STEAL_MIN_PERCENT,
  STEAL_MAX_PERCENT,
  STEAL_MAX_AMOUNT,
  STEAL_WANTED_ON_ATTEMPT,
  STEAL_WANTED_ON_SUCCESS_BONUS,
  POLICE_COUNT,
  POLICE_CHASE_SPEED,
  POLICE_PATROL_SPEED,
  POLICE_CATCH_RANGE,
  POLICE_CHASE_RANGE,
  JAIL_DURATION_MS,
  JAIL_POSITION,
  WANTED_DECAY_INTERVAL_MS,
  WANTED_DECAY_AMOUNT,
} = require('./crime');
const { MAX_CHAT_LENGTH, CHAT_HISTORY_LIMIT, LEADERBOARD_LIMIT } = require('./social');
const {
  MARRIAGE_HAPPINESS_BONUS,
  DIVORCE_HAPPINESS_PENALTY,
  CHILD_COST,
  CHILD_HAPPINESS_BONUS,
  CHILD_NAME_MAX_LENGTH,
  DEATH_HEALTH_THRESHOLD,
  INHERITANCE_CHILD_AND_SPOUSE,
  INHERITANCE_CHILD_ONLY,
  INHERITANCE_SPOUSE_ONLY,
} = require('./family');

const MAX_PLAYERS = 20;
const FAST_TICK_MS = 50; // Positionen / Kollision (Phase 4) / Kampf
const SLOW_TICK_MS = 10000; // Alterung / Wirtschaft
const EVENT_TICK_MS = 1000; // Lebensereignisse: Ablauf pruefen, neue anbieten
const COPS_TICK_MS = 200; // Polizei-Bewegung - eigener, fluessigerer Takt als EVENT_TICK
const SNAPSHOT_INTERVAL_MS = 60000;
const SNAPSHOT_PATH = path.join(__dirname, '..', 'world-snapshot.json');

const YEARS_PER_MS = 1 / (60 * 60 * 1000); // 1 Spieljahr pro Realstunde aktiver Verbindung
const RECONNECT_GRACE_MS = 5 * 60 * 1000; // Zeitfenster, in dem ein Reconnect den alten Spieler übernimmt
const PLAYER_SPEED = 200; // px/s - MUSS mit client/net.js übereinstimmen (Prediction)

const MAX_EVENT_QUEUE = 3; // mehr wartende Ereignisse pro Spieler werden nicht angesammelt
const EVENT_ROLL_CHANCE = 0.05; // Chance pro EVENT_TICK, dass ein neues Ereignis in die Warteschlange kommt
const RECENT_EVENT_MEMORY = 5; // so viele zuletzt gesehene Event-IDs werden kurzfristig vermieden

let nextEventInstanceId = 1;

/** Wendet die Effekte einer Event-Wahl auf einen Spieler an, mit sinnvollen Grenzen. */
function applyEffects(player, effects) {
  if (!effects) return;
  const clamp = (v) => Math.max(0, Math.min(100, v));
  if (typeof effects.cash === 'number') player.cash = Math.max(0, player.cash + effects.cash);
  if (typeof effects.health === 'number') player.health = clamp(player.health + effects.health);
  if (typeof effects.happiness === 'number') player.happiness = clamp(player.happiness + effects.happiness);
  if (typeof effects.smarts === 'number') player.smarts = clamp(player.smarts + effects.smarts);
  if (typeof effects.looks === 'number') player.looks = clamp(player.looks + effects.looks);
  if (typeof effects.wanted === 'number') player.wanted = Math.max(0, player.wanted + effects.wanted);
}

class GameWorld {
  constructor() {
    this.players = new Map(); // id -> player
    this.tokenIndex = new Map(); // token -> id
    this.lastBroadcastMovement = new Map(); // id -> zuletzt gesendeter Bewegungs-State

    // Immobilien: feste, begrenzte Liste - Objekte werden NIE neu erzeugt,
    // dadurch entsteht echte Konkurrenz zwischen Spielern um wenige Objekte.
    this.properties = new Map();
    for (const def of PROPERTIES) {
      this.properties.set(def.id, { ...def, ownerId: null });
    }

    this.companies = new Map(); // id -> { id, ownerId, name }
    this.nextCompanyId = 1;

    this.trades = new Map(); // id -> Handelsangebot zwischen zwei Spielern
    this.nextTradeId = 1;

    // Polizei-NPCs: keine echten Spieler, einfache Verfolgungs-KI serverseitig.
    this.cops = [];
    for (let i = 0; i < POLICE_COUNT; i++) {
      this.cops.push({
        id: 'cop_' + i,
        position: { x: 200 + i * 600, y: 1000 },
        velocity: { x: 0, y: 0 },
        targetPlayerId: null,
        patrolChangeAt: 0,
      });
    }

    this.chatLog = []; // {id, playerId, name, text, timestamp} - begrenzt auf CHAT_HISTORY_LIMIT
    this.nextChatId = 1;

    this.friendRequests = new Map(); // id -> { id, fromPlayerId, toPlayerId }
    this.nextFriendRequestId = 1;

    this.marriageRequests = new Map(); // id -> { id, fromPlayerId, toPlayerId }
    this.nextMarriageRequestId = 1;

    this.children = new Map(); // id -> { id, name, parentIds:[p1,p2], bornAt, inheritedCash, claimed }
    this.nextChildId = 1;
  }

  get playerCount() {
    return this.players.size;
  }

  isFull() {
    return this.playerCount >= MAX_PLAYERS;
  }

  /**
   * Spieler beitreten lassen. Mit gültigem Token innerhalb der Grace-Period
   * wird der bestehende Spieler reaktiviert (Reconnect), sonst neu erstellt.
   */
  joinPlayer(name, token, ws) {
    if (token && this.tokenIndex.has(token)) {
      const existingId = this.tokenIndex.get(token);
      const existing = this.players.get(existingId);
      if (existing && Date.now() - existing.lastSeen <= RECONNECT_GRACE_MS) {
        existing.connected = true;
        existing.ws = ws;
        existing.lastSeen = Date.now();
        existing.velocity.x = 0;
        existing.velocity.y = 0;
        if (existing.activeEvent) {
          // Event-Timer lief waehrend der Trennung nicht weiter - jetzt mit der
          // gemerkten Restzeit fortsetzen, damit niemand fuer's Offline-sein bestraft wird.
          const remaining = existing.activeEvent.remainingMs ?? existing.activeEvent.responseDurationMs;
          existing.activeEvent.expiresAt = Date.now() + remaining;
        }
        return { player: existing, reconnected: true };
      }
    }

    if (this.isFull()) {
      return { error: 'lobby_full' };
    }

    const newToken = token || crypto.randomBytes(16).toString('hex');
    const player = createPlayer(name, newToken);
    player.ws = ws;
    this.players.set(player.id, player);
    this.tokenIndex.set(newToken, player.id);
    return { player, reconnected: false };
  }

  disconnectPlayer(id) {
    const player = this.players.get(id);
    if (!player) return;
    player.connected = false;
    player.ws = null;
    player.velocity.x = 0;
    player.velocity.y = 0;
    player.lastSeen = Date.now();
    if (player.activeEvent) {
      player.activeEvent.remainingMs = Math.max(0, player.activeEvent.expiresAt - Date.now());
    }
  }

  /** Entfernt Spieler, die die Reconnect-Grace-Period überschritten haben. */
  removeStalePlayers() {
    const now = Date.now();
    for (const [id, player] of this.players) {
      if (!player.connected && now - player.lastSeen > RECONNECT_GRACE_MS) {
        this.players.delete(id);
        this.tokenIndex.delete(player.token);
        this.lastBroadcastMovement.delete(id);
      }
    }
  }

  /**
   * Wendet eine Client-Eingabe an. Der Client sendet nur gedrückte Tasten,
   * niemals eine Position - die Bewegung wird ausschließlich hier berechnet.
   */
  applyInput(id, input) {
    const player = this.players.get(id);
    if (!player || !player.connected) return;
    if (this.isJailed(player)) return; // Gefaengnisinsassen koennen sich nicht bewegen
    if (this.isAwaitingReincarnation(player)) return; // Verstorbene warten auf die Weiterleben-Aktion

    let dx = 0;
    let dy = 0;
    const keys = input.keys || {};
    if (keys.w) dy -= 1;
    if (keys.s) dy += 1;
    if (keys.a) dx -= 1;
    if (keys.d) dx += 1;

    const len = Math.hypot(dx, dy);
    if (len > 0) {
      dx /= len;
      dy /= len;
    }

    player.velocity.x = dx * PLAYER_SPEED;
    player.velocity.y = dy * PLAYER_SPEED;

    if (typeof input.seq === 'number') {
      player.lastProcessedInput = input.seq;
    }
    player.lastSeen = Date.now();
  }

  /** fastTick: bewegt alle verbundenen Spieler und begrenzt sie auf die Weltgrenzen. */
  stepPositions(dtMs) {
    const dtSec = dtMs / 1000;
    for (const player of this.players.values()) {
      if (!player.connected) continue;
      if (this.isJailed(player)) {
        // Fest an der Gefaengnis-Position halten, falls die Bewegung mitten im
        // Verhaften noch einen Rest-Impuls hatte.
        player.position.x = JAIL_POSITION.x;
        player.position.y = JAIL_POSITION.y;
        player.velocity.x = 0;
        player.velocity.y = 0;
        continue;
      }
      if (this.isAwaitingReincarnation(player)) {
        player.velocity.x = 0;
        player.velocity.y = 0;
        continue;
      }
      player.position.x += player.velocity.x * dtSec;
      player.position.y += player.velocity.y * dtSec;
      player.position.x = Math.max(0, Math.min(WORLD_WIDTH, player.position.x));
      player.position.y = Math.max(0, Math.min(WORLD_HEIGHT, player.position.y));
    }
  }

  /** slowTick: erhöht die individuelle Lebensuhr nur für aktiv verbundene Spieler. */
  ageConnectedPlayers(dtMs) {
    for (const player of this.players.values()) {
      if (!player.connected) continue;
      player.ageProgress += dtMs * YEARS_PER_MS;
      while (player.ageProgress >= 1) {
        player.ageProgress -= 1;
        player.age += 1;
      }
    }
  }

  /**
   * Baut die Liste der Bewegungs-Deltas für den fastTick-Broadcast.
   * Enthält NUR Spieler, deren Position/Geschwindigkeit sich seit dem
   * letzten Broadcast verändert hat - kein Full-State über die schnelle Loop.
   */
  buildMovementDeltas() {
    const deltas = [];
    for (const [id, player] of this.players) {
      const current = serializeMovement(player);
      const last = this.lastBroadcastMovement.get(id);
      if (
        !last ||
        last.x !== current.x ||
        last.y !== current.y ||
        last.vx !== current.vx ||
        last.vy !== current.vy
      ) {
        deltas.push({ ...current, lastProcessedInput: player.lastProcessedInput });
        this.lastBroadcastMovement.set(id, current);
      }
    }
    return deltas;
  }

  /** Voller öffentlicher State aller Spieler (für Join und slowTick-Statupdates). */
  buildFullPublicState() {
    const list = [];
    for (const player of this.players.values()) {
      list.push(serializePublic(player));
    }
    return list;
  }

  /** Merkt sich ein aufgelöstes Event, um kurzfristige Wiederholungen zu vermeiden. */
  rememberEvent(player, eventId) {
    player.recentEventIds.push(eventId);
    if (player.recentEventIds.length > RECENT_EVENT_MEMORY) {
      player.recentEventIds.shift();
    }
  }

  /** Baut aus einer Event-Definition eine konkrete, eindeutige Instanz mit Ablaufzeit. */
  buildEventInstance(def) {
    return {
      instanceId: nextEventInstanceId++,
      eventId: def.id,
      title: def.title,
      text: def.text,
      choices: def.choices.map((c, i) => ({ index: i, label: c.label })),
      effectsByChoice: def.choices.map((c) => c.effects || {}),
      defaultChoiceIndex: def.defaultChoiceIndex || 0,
      responseDurationMs: def.responseDurationMs,
      expiresAt: Date.now() + def.responseDurationMs,
    };
  }

  /**
   * EVENT_TICK: würfelt für verbundene Spieler ohne volle Warteschlange
   * mit kleiner Wahrscheinlichkeit ein neues, altersgerechtes Ereignis.
   */
  rollEventsForConnectedPlayers() {
    for (const player of this.players.values()) {
      if (!player.connected) continue;
      if (player.eventQueue.length >= MAX_EVENT_QUEUE) continue;
      if (Math.random() >= EVENT_ROLL_CHANCE) continue;

      const def = pickEligibleEvent(player, player.recentEventIds);
      if (def) player.eventQueue.push(def);
    }
  }

  /**
   * Rückt für Spieler ohne aktives Event das nächste aus der Warteschlange nach.
   * @returns {Array<{player: object, instance: object}>} neu aktivierte Events
   */
  promoteQueuedEvents() {
    const promoted = [];
    for (const player of this.players.values()) {
      if (!player.connected) continue;
      if (!player.activeEvent && player.eventQueue.length > 0) {
        const def = player.eventQueue.shift();
        const instance = this.buildEventInstance(def);
        player.activeEvent = instance;
        promoted.push({ player, instance });
      }
    }
    return promoted;
  }

  /**
   * EVENT_TICK: prüft, ob aktive Events die Antwortzeit überschritten haben,
   * und wendet in diesem Fall serverseitig die hinterlegte Standardwahl an.
   * @returns {Array} aufgelöste Events (fuer Benachrichtigung des Clients)
   */
  checkExpiredEvents() {
    const now = Date.now();
    const resolved = [];
    for (const player of this.players.values()) {
      if (!player.connected || !player.activeEvent) continue;
      if (player.activeEvent.expiresAt > now) continue;

      const instance = player.activeEvent;
      const idx = instance.defaultChoiceIndex;
      const effects = instance.effectsByChoice[idx] || {};
      applyEffects(player, effects);
      this.rememberEvent(player, instance.eventId);
      player.activeEvent = null;
      resolved.push({
        player,
        instance,
        choiceIndex: idx,
        effects,
        choiceLabel: instance.choices[idx]?.label,
        timedOut: true,
      });
    }
    return resolved;
  }

  /**
   * Wendet eine vom Client gesendete Event-Wahl an. Validiert, dass das
   * Event noch aktiv und die Instanz-ID aktuell ist - der Client kann
   * niemals ein fremdes oder bereits aufgelöstes Event beeinflussen.
   */
  applyEventChoice(playerId, instanceId, choiceIndex) {
    const player = this.players.get(playerId);
    if (!player || !player.activeEvent) return { ok: false, reason: 'no_active_event' };
    if (player.activeEvent.instanceId !== instanceId) return { ok: false, reason: 'stale_event' };

    const instance = player.activeEvent;
    if (
      typeof choiceIndex !== 'number' ||
      choiceIndex < 0 ||
      choiceIndex >= instance.effectsByChoice.length
    ) {
      return { ok: false, reason: 'invalid_choice' };
    }

    const effects = instance.effectsByChoice[choiceIndex];
    applyEffects(player, effects);
    this.rememberEvent(player, instance.eventId);
    player.activeEvent = null;

    return {
      ok: true,
      instanceId,
      effects,
      choiceLabel: instance.choices[choiceIndex]?.label,
      timedOut: false,
    };
  }

  // ---------------------------------------------------------------------
  // WIRTSCHAFT: Immobilien, Firmen, Handel zwischen Spielern
  // ---------------------------------------------------------------------

  buildPropertiesState() {
    return [...this.properties.values()];
  }

  buildCompaniesState() {
    return [...this.companies.values()];
  }

  /** Kauft eine unbebaute/unbesetzte Immobilie direkt von der Bank. */
  buyProperty(playerId, propertyId) {
    const player = this.players.get(playerId);
    const property = this.properties.get(propertyId);
    if (!player || !property) return { ok: false, reason: 'not_found' };
    if (property.ownerId) return { ok: false, reason: 'already_owned' };
    if (player.cash < property.price) return { ok: false, reason: 'insufficient_funds' };

    player.cash -= property.price;
    property.ownerId = playerId;
    return { ok: true, property };
  }

  /** Verkauft eine eigene Immobilie zurueck an die Bank (reduzierter Preis, kein Arbitrage-Exploit). */
  sellPropertyToBank(playerId, propertyId) {
    const player = this.players.get(playerId);
    const property = this.properties.get(propertyId);
    if (!player || !property) return { ok: false, reason: 'not_found' };
    if (property.ownerId !== playerId) return { ok: false, reason: 'not_owner' };

    const refund = Math.round(property.price * PROPERTY_SELL_BACK_RATIO);
    player.cash += refund;
    property.ownerId = null;
    return { ok: true, refund, property };
  }

  /** Gründet eine neue Firma fuer den Spieler. Kein Limit an der Gesamtzahl - anders als Immobilien. */
  foundCompany(playerId, name) {
    const player = this.players.get(playerId);
    if (!player) return { ok: false, reason: 'not_found' };
    if (player.cash < COMPANY_FOUNDING_COST) return { ok: false, reason: 'insufficient_funds' };

    player.cash -= COMPANY_FOUNDING_COST;
    const company = {
      id: this.nextCompanyId++,
      ownerId: playerId,
      name: name && String(name).trim() ? String(name).trim().slice(0, 30) : 'Neue Firma',
    };
    this.companies.set(company.id, company);
    return { ok: true, company };
  }

  /** Schliesst eine eigene Firma, mit Teilrueckerstattung. */
  closeCompany(playerId, companyId) {
    const player = this.players.get(playerId);
    const company = this.companies.get(companyId);
    if (!player || !company) return { ok: false, reason: 'not_found' };
    if (company.ownerId !== playerId) return { ok: false, reason: 'not_owner' };

    const refund = Math.round(COMPANY_FOUNDING_COST * COMPANY_CLOSE_REFUND_RATIO);
    player.cash += refund;
    this.companies.delete(companyId);
    return { ok: true, refund };
  }

  /**
   * Wird im slowTick aufgerufen: zieht Einnahmen minus Instandhaltung fuer alle
   * Immobilien und Firmen ein. Das ist die Geld-SENKE, die verhindert, dass
   * Vermoegen unbegrenzt waechst. Kann sich ein Spieler die Instandhaltung nicht
   * mehr leisten, wird die Immobilie zwangsversteigert (zurueck an die Bank, kein
   * Erloes) statt den Spieler ins Minus rutschen zu lassen.
   */
  collectEconomyIncome() {
    const repossessed = [];

    for (const property of this.properties.values()) {
      if (!property.ownerId) continue;
      const owner = this.players.get(property.ownerId);
      if (!owner) {
        property.ownerId = null; // Besitzer existiert nicht mehr (sollte selten vorkommen)
        continue;
      }
      const net = property.incomePerTick - property.maintenancePerTick;
      if (owner.cash + net < 0) {
        property.ownerId = null;
        repossessed.push({ type: 'property', asset: property, player: owner });
        continue;
      }
      owner.cash += net;
    }

    for (const company of this.companies.values()) {
      const owner = this.players.get(company.ownerId);
      if (!owner) continue; // Firma bleibt bestehen, falls Besitzer (noch) nicht online
      const net = COMPANY_INCOME_PER_TICK - COMPANY_UPKEEP_PER_TICK;
      owner.cash = Math.max(0, owner.cash + net);
    }

    return repossessed;
  }

  /**
   * Die eigentliche Geld-SENKE: kleine Steuer auf das Barvermoegen selbst,
   * unabhaengig von Immobilien-/Firmenbesitz. Ohne das wuerde Vermoegen bei
   * Besitz von profitablen Immobilien/Firmen unbegrenzt wachsen.
   */
  applyWealthTax() {
    for (const player of this.players.values()) {
      if (!player.connected || player.cash <= 0) continue;
      player.cash = Math.max(0, Math.round(player.cash * (1 - WEALTH_TAX_RATE)));
    }
  }

  // ---------------------------------------------------------------------
  // HANDEL: ein Spieler bietet einem anderen eine eigene Immobilie zum Kauf an
  // ---------------------------------------------------------------------

  /** Bietet einem anderen Spieler eine eigene Immobilie zu einem Preis an. */
  proposeTrade(fromPlayerId, toPlayerId, propertyId, price) {
    const fromPlayer = this.players.get(fromPlayerId);
    const toPlayer = this.players.get(toPlayerId);
    const property = this.properties.get(propertyId);
    if (!fromPlayer || !toPlayer || !property) return { ok: false, reason: 'not_found' };
    if (property.ownerId !== fromPlayerId) return { ok: false, reason: 'not_owner' };
    if (fromPlayerId === toPlayerId) return { ok: false, reason: 'self_trade' };
    if (typeof price !== 'number' || price < 0) return { ok: false, reason: 'invalid_price' };

    const trade = {
      id: this.nextTradeId++,
      fromPlayerId,
      toPlayerId,
      propertyId,
      price: Math.round(price),
      expiresAt: Date.now() + TRADE_RESPONSE_DURATION_MS,
    };
    this.trades.set(trade.id, trade);
    return { ok: true, trade };
  }

  /** Empfaenger nimmt an oder lehnt ab. Bei Annahme wird serverseitig alles geprueft und uebertragen. */
  respondTrade(playerId, tradeId, accept) {
    const trade = this.trades.get(tradeId);
    if (!trade) return { ok: false, reason: 'not_found' };
    if (trade.toPlayerId !== playerId) return { ok: false, reason: 'not_recipient' };

    this.trades.delete(tradeId);

    if (!accept) {
      return { ok: true, accepted: false, trade };
    }

    const buyer = this.players.get(trade.toPlayerId);
    const seller = this.players.get(trade.fromPlayerId);
    const property = this.properties.get(trade.propertyId);
    if (!buyer || !seller || !property) return { ok: false, reason: 'not_found' };
    if (property.ownerId !== trade.fromPlayerId) return { ok: false, reason: 'no_longer_owned' };
    if (buyer.cash < trade.price) return { ok: false, reason: 'insufficient_funds' };

    buyer.cash -= trade.price;
    seller.cash += trade.price;
    property.ownerId = buyer.id;

    return { ok: true, accepted: true, trade, property };
  }

  /** Handelsangebote, die niemand rechtzeitig beantwortet hat, verfallen automatisch. */
  checkExpiredTrades() {
    const now = Date.now();
    const expired = [];
    for (const [id, trade] of this.trades) {
      if (trade.expiresAt <= now) {
        this.trades.delete(id);
        expired.push(trade);
      }
    }
    return expired;
  }

  // ---------------------------------------------------------------------
  // KRIMINALITÄT: Diebstahl, Polizei-KI, Gefängnis, Fahndungslevel
  // ---------------------------------------------------------------------

  isJailed(player) {
    return player.jailedUntil != null && player.jailedUntil > Date.now();
  }

  isAwaitingReincarnation(player) {
    return player.pendingReincarnation != null;
  }

  buildCopsState() {
    return this.cops.map((cop) => ({ id: cop.id, x: cop.position.x, y: cop.position.y }));
  }

  /**
   * Versucht, einem anderen Spieler in Reichweite Bargeld zu stehlen.
   * Server prueft ALLES selbst - Entfernung, Cooldown, Erfolgschance - der
   * Client kann hier nichts vortaeuschen.
   */
  attemptSteal(thiefId, victimId) {
    const thief = this.players.get(thiefId);
    const victim = this.players.get(victimId);
    if (!thief || !victim || thiefId === victimId) return { ok: false, reason: 'not_found' };
    if (this.isJailed(thief)) return { ok: false, reason: 'jailed' };
    if (this.isJailed(victim)) return { ok: false, reason: 'victim_jailed' };

    const now = Date.now();
    if (now - thief.lastStealAttemptAt < STEAL_COOLDOWN_MS) {
      return { ok: false, reason: 'cooldown' };
    }

    const dist = Math.hypot(thief.position.x - victim.position.x, thief.position.y - victim.position.y);
    if (dist > STEAL_RANGE) return { ok: false, reason: 'too_far' };

    thief.lastStealAttemptAt = now;
    thief.lastCrimeAt = now;
    thief.wanted += STEAL_WANTED_ON_ATTEMPT;

    const success = Math.random() < STEAL_SUCCESS_CHANCE;
    if (!success) {
      return { ok: true, success: false, thief, victim };
    }

    const percent = STEAL_MIN_PERCENT + Math.random() * (STEAL_MAX_PERCENT - STEAL_MIN_PERCENT);
    const amount = Math.min(STEAL_MAX_AMOUNT, Math.round(victim.cash * percent));
    victim.cash = Math.max(0, victim.cash - amount);
    thief.cash += amount;
    thief.wanted += STEAL_WANTED_ON_SUCCESS_BONUS;

    return { ok: true, success: true, amount, thief, victim };
  }

  /**
   * EVENT_TICK: bewegt Polizei-NPCs. Gesuchte Spieler in Sichtweite werden
   * verfolgt, sonst patrouilliert die Polizei ziellos. Wird ein gesuchter
   * Spieler eingeholt, geht es direkt ins Gefaengnis.
   * @returns {Array} frisch verhaftete Spieler, fuer Benachrichtigungen
   */
  updateCops(dtMs) {
    const dtSec = dtMs / 1000;
    const now = Date.now();
    const arrests = [];

    const wantedPlayers = [...this.players.values()].filter(
      (p) => p.connected && p.wanted > 0 && !this.isJailed(p)
    );

    for (const cop of this.cops) {
      let target = null;
      let bestDist = Infinity;
      for (const player of wantedPlayers) {
        const dist = Math.hypot(cop.position.x - player.position.x, cop.position.y - player.position.y);
        if (dist <= POLICE_CHASE_RANGE && dist < bestDist) {
          bestDist = dist;
          target = player;
        }
      }

      if (target) {
        cop.targetPlayerId = target.id;
        const dx = target.position.x - cop.position.x;
        const dy = target.position.y - cop.position.y;
        const len = Math.hypot(dx, dy) || 1;
        cop.velocity.x = (dx / len) * POLICE_CHASE_SPEED;
        cop.velocity.y = (dy / len) * POLICE_CHASE_SPEED;

        if (bestDist <= POLICE_CATCH_RANGE) {
          target.jailedUntil = now + JAIL_DURATION_MS;
          target.wanted = 0;
          target.position.x = JAIL_POSITION.x;
          target.position.y = JAIL_POSITION.y;
          target.velocity.x = 0;
          target.velocity.y = 0;
          cop.targetPlayerId = null;
          cop.velocity.x = 0;
          cop.velocity.y = 0;
          arrests.push(target);
        }
      } else {
        cop.targetPlayerId = null;
        if (now > cop.patrolChangeAt) {
          const angle = Math.random() * Math.PI * 2;
          cop.velocity.x = Math.cos(angle) * POLICE_PATROL_SPEED;
          cop.velocity.y = Math.sin(angle) * POLICE_PATROL_SPEED;
          cop.patrolChangeAt = now + 2000 + Math.random() * 3000;
        }
      }

      cop.position.x = Math.max(0, Math.min(WORLD_WIDTH, cop.position.x + cop.velocity.x * dtSec));
      cop.position.y = Math.max(0, Math.min(WORLD_HEIGHT, cop.position.y + cop.velocity.y * dtSec));
    }

    return arrests;
  }

  /** Entlaesst Spieler, deren Haftzeit abgelaufen ist. */
  checkJailReleases() {
    const now = Date.now();
    const released = [];
    for (const player of this.players.values()) {
      if (player.jailedUntil != null && player.jailedUntil <= now) {
        player.jailedUntil = null;
        player.position.x = WORLD_WIDTH / 2;
        player.position.y = WORLD_HEIGHT / 2;
        released.push(player);
      }
    }
    return released;
  }

  /** Fahndungslevel sinkt langsam, wenn eine Weile keine neue Straftat begangen wurde. */
  decayWanted() {
    const now = Date.now();
    for (const player of this.players.values()) {
      if (!player.connected || player.wanted <= 0) continue;
      if (now - player.lastCrimeAt >= WANTED_DECAY_INTERVAL_MS) {
        player.wanted = Math.max(0, player.wanted - WANTED_DECAY_AMOUNT);
        player.lastCrimeAt = now; // Timer neu starten fuer die naechste Abklingstufe
      }
    }
  }

  // ---------------------------------------------------------------------
  // SOZIALES: Chat, Freundschaften, Ranglisten
  // ---------------------------------------------------------------------

  /** Sendet eine Chat-Nachricht. Text wird serverseitig gekuerzt/geprueft - der Client bestimmt hier nichts. */
  sendChatMessage(playerId, text) {
    const player = this.players.get(playerId);
    if (!player) return { ok: false, reason: 'not_found' };

    const trimmed = typeof text === 'string' ? text.trim() : '';
    if (!trimmed) return { ok: false, reason: 'empty' };

    const message = {
      id: this.nextChatId++,
      playerId,
      name: player.name,
      text: trimmed.slice(0, MAX_CHAT_LENGTH),
      timestamp: Date.now(),
    };
    this.chatLog.push(message);
    if (this.chatLog.length > CHAT_HISTORY_LIMIT) this.chatLog.shift();
    return { ok: true, message };
  }

  buildChatHistory() {
    return [...this.chatLog];
  }

  /** Schickt einem anderen Spieler eine Freundschaftsanfrage. */
  proposeFriendship(fromPlayerId, toPlayerId) {
    const fromPlayer = this.players.get(fromPlayerId);
    const toPlayer = this.players.get(toPlayerId);
    if (!fromPlayer || !toPlayer) return { ok: false, reason: 'not_found' };
    if (fromPlayerId === toPlayerId) return { ok: false, reason: 'self_request' };
    if (fromPlayer.friends.includes(toPlayerId)) return { ok: false, reason: 'already_friends' };

    const alreadyPending = [...this.friendRequests.values()].some(
      (r) => r.fromPlayerId === fromPlayerId && r.toPlayerId === toPlayerId
    );
    if (alreadyPending) return { ok: false, reason: 'already_pending' };

    const request = { id: this.nextFriendRequestId++, fromPlayerId, toPlayerId };
    this.friendRequests.set(request.id, request);
    return { ok: true, request };
  }

  /** Empfaenger nimmt eine Freundschaftsanfrage an oder lehnt sie ab. */
  respondFriendRequest(playerId, requestId, accept) {
    const request = this.friendRequests.get(requestId);
    if (!request) return { ok: false, reason: 'not_found' };
    if (request.toPlayerId !== playerId) return { ok: false, reason: 'not_recipient' };

    this.friendRequests.delete(requestId);
    if (!accept) return { ok: true, accepted: false, request };

    const fromPlayer = this.players.get(request.fromPlayerId);
    const toPlayer = this.players.get(request.toPlayerId);
    if (!fromPlayer || !toPlayer) return { ok: false, reason: 'not_found' };

    if (!fromPlayer.friends.includes(toPlayer.id)) fromPlayer.friends.push(toPlayer.id);
    if (!toPlayer.friends.includes(fromPlayer.id)) toPlayer.friends.push(fromPlayer.id);

    return { ok: true, accepted: true, request };
  }

  /** Top-Listen nach Vermoegen und Fahndungslevel - rein aus dem bestehenden Spielerstate abgeleitet. */
  buildLeaderboards() {
    const all = [...this.players.values()].filter((p) => p.connected);

    const richest = [...all]
      .sort((a, b) => b.cash - a.cash)
      .slice(0, LEADERBOARD_LIMIT)
      .map((p) => ({ id: p.id, name: p.name, value: p.cash }));

    const mostWanted = [...all]
      .filter((p) => p.wanted > 0)
      .sort((a, b) => b.wanted - a.wanted)
      .slice(0, LEADERBOARD_LIMIT)
      .map((p) => ({ id: p.id, name: p.name, value: p.wanted }));

    return { richest, mostWanted };
  }

  // ---------------------------------------------------------------------
  // FAMILIE: Ehe, Kinder, Tod und Vererbung
  // ---------------------------------------------------------------------

  /** Schickt einem anderen Spieler einen Heiratsantrag. */
  proposeMarriage(fromPlayerId, toPlayerId) {
    const fromPlayer = this.players.get(fromPlayerId);
    const toPlayer = this.players.get(toPlayerId);
    if (!fromPlayer || !toPlayer) return { ok: false, reason: 'not_found' };
    if (fromPlayerId === toPlayerId) return { ok: false, reason: 'self_request' };
    if (fromPlayer.spouseId != null) return { ok: false, reason: 'already_married' };
    if (toPlayer.spouseId != null) return { ok: false, reason: 'target_already_married' };

    const alreadyPending = [...this.marriageRequests.values()].some(
      (r) => r.fromPlayerId === fromPlayerId && r.toPlayerId === toPlayerId
    );
    if (alreadyPending) return { ok: false, reason: 'already_pending' };

    const request = { id: this.nextMarriageRequestId++, fromPlayerId, toPlayerId };
    this.marriageRequests.set(request.id, request);
    return { ok: true, request };
  }

  /** Empfaenger nimmt einen Heiratsantrag an oder lehnt ab. */
  respondMarriageRequest(playerId, requestId, accept) {
    const request = this.marriageRequests.get(requestId);
    if (!request) return { ok: false, reason: 'not_found' };
    if (request.toPlayerId !== playerId) return { ok: false, reason: 'not_recipient' };

    this.marriageRequests.delete(requestId);
    if (!accept) return { ok: true, accepted: false, request };

    const fromPlayer = this.players.get(request.fromPlayerId);
    const toPlayer = this.players.get(request.toPlayerId);
    if (!fromPlayer || !toPlayer) return { ok: false, reason: 'not_found' };
    if (fromPlayer.spouseId != null || toPlayer.spouseId != null) {
      return { ok: false, reason: 'already_married' };
    }

    fromPlayer.spouseId = toPlayer.id;
    toPlayer.spouseId = fromPlayer.id;
    fromPlayer.happiness = Math.min(100, fromPlayer.happiness + MARRIAGE_HAPPINESS_BONUS);
    toPlayer.happiness = Math.min(100, toPlayer.happiness + MARRIAGE_HAPPINESS_BONUS);

    return { ok: true, accepted: true, request };
  }

  /** Beendet die Ehe. Kann von jedem der beiden Partner ausgeloest werden. */
  divorce(playerId) {
    const player = this.players.get(playerId);
    if (!player) return { ok: false, reason: 'not_found' };
    if (player.spouseId == null) return { ok: false, reason: 'not_married' };

    const spouse = this.players.get(player.spouseId);
    const exSpouseId = player.spouseId;
    player.spouseId = null;
    player.happiness = Math.max(0, player.happiness - DIVORCE_HAPPINESS_PENALTY);
    if (spouse) {
      spouse.spouseId = null;
      spouse.happiness = Math.max(0, spouse.happiness - DIVORCE_HAPPINESS_PENALTY);
    }
    return { ok: true, exSpouseId };
  }

  /** Ein verheiratetes Paar bekommt ein Kind. Kosten traegt der handelnde Spieler. */
  haveChild(playerId, name) {
    const player = this.players.get(playerId);
    if (!player) return { ok: false, reason: 'not_found' };
    if (player.spouseId == null) return { ok: false, reason: 'not_married' };
    if (player.cash < CHILD_COST) return { ok: false, reason: 'insufficient_funds' };

    const spouse = this.players.get(player.spouseId);
    player.cash -= CHILD_COST;

    const child = {
      id: this.nextChildId++,
      name: name && String(name).trim() ? String(name).trim().slice(0, CHILD_NAME_MAX_LENGTH) : 'Kind',
      parentIds: spouse ? [player.id, spouse.id] : [player.id],
      bornAt: Date.now(),
      inheritedCash: 0,
      claimed: false,
    };
    this.children.set(child.id, child);

    player.happiness = Math.min(100, player.happiness + CHILD_HAPPINESS_BONUS);
    if (spouse) spouse.happiness = Math.min(100, spouse.happiness + CHILD_HAPPINESS_BONUS);

    return { ok: true, child };
  }

  /** Alle (noch nicht als Erbe beanspruchten) Kinder eines Spielers. */
  buildChildrenForPlayer(playerId) {
    return [...this.children.values()].filter((c) => c.parentIds.includes(playerId));
  }

  /** Sucht ein noch nicht beanspruchtes Kind, das dieser Spieler als Erbe antreten koennte. */
  findUnclaimedHeirChild(playerId) {
    const candidates = [...this.children.values()].filter(
      (c) => c.parentIds.includes(playerId) && !c.claimed
    );
    if (candidates.length === 0) return null;
    // Juengstes Kind zuerst - narrativ das naheliegendste Erbe
    candidates.sort((a, b) => b.bornAt - a.bornAt);
    return candidates[0];
  }

  /**
   * EVENT_TICK: prueft, ob ein Spieler durch Gesundheit <= 0 gestorben ist.
   * Verteilt das Erbe und markiert den Spieler als wartend auf Wiedergeburt.
   * @returns {Array} Informationen ueber frisch Verstorbene, fuer Benachrichtigungen
   */
  checkDeaths() {
    const deaths = [];
    for (const player of this.players.values()) {
      if (!player.connected) continue;
      if (this.isAwaitingReincarnation(player)) continue; // schon verarbeitet
      if (player.health > DEATH_HEALTH_THRESHOLD) continue;

      deaths.push(this.processDeath(player));
    }
    return deaths;
  }

  /** Verteilt das Erbe eines verstorbenen Spielers und setzt ihn auf "wartet auf Wiedergeburt". */
  processDeath(player) {
    const spouse = player.spouseId != null ? this.players.get(player.spouseId) : null;
    const heirChild = this.findUnclaimedHeirChild(player.id);
    const estate = player.cash;

    let ratios = null;
    if (heirChild && spouse) ratios = INHERITANCE_CHILD_AND_SPOUSE;
    else if (heirChild) ratios = INHERITANCE_CHILD_ONLY;
    else if (spouse) ratios = INHERITANCE_SPOUSE_ONLY;

    if (heirChild && ratios && ratios.child) {
      heirChild.inheritedCash += Math.round(estate * ratios.child);
    }
    if (spouse && ratios && ratios.spouse) {
      spouse.cash += Math.round(estate * ratios.spouse);
    }

    player.cash = 0;
    player.pendingReincarnation = { heirChildId: heirChild ? heirChild.id : null };

    if (spouse) {
      spouse.spouseId = null; // verwitwet - die Ehe endet mit dem Tod
    }

    return {
      player,
      spouse,
      heirChild,
      estate,
    };
  }

  /**
   * Der Spieler entscheidet sich weiterzuleben: entweder als das Erbkind (falls vorhanden)
   * oder als komplett neues Leben. Bleibt dieselbe Verbindung/ID - kein erneuter Beitritt noetig.
   */
  reincarnate(playerId) {
    const player = this.players.get(playerId);
    if (!player) return { ok: false, reason: 'not_found' };
    if (!this.isAwaitingReincarnation(player)) return { ok: false, reason: 'not_pending' };

    const heirChildId = player.pendingReincarnation.heirChildId;
    const child = heirChildId ? this.children.get(heirChildId) : null;

    player.name = child ? child.name : player.name;
    player.age = 18;
    player.ageProgress = 0;
    player.health = 100;
    player.happiness = 70;
    player.smarts = 50;
    player.looks = 50;
    player.cash = child ? child.inheritedCash : STARTING_CASH;
    player.bank = 0;
    player.debt = 0;
    player.wanted = 0;
    player.jailedUntil = null;
    player.criminalRecord = [];
    player.spouseId = null;
    player.activeEvent = null;
    player.eventQueue = [];
    player.recentEventIds = [];
    player.pendingReincarnation = null;
    player.position = { x: WORLD_WIDTH / 2, y: WORLD_HEIGHT / 2 };
    player.velocity = { x: 0, y: 0 };

    if (child) this.children.delete(heirChildId); // als Erbe "aufgebraucht"

    return { ok: true, player, becameChild: !!child };
  }
}

module.exports = {
  GameWorld,
  MAX_PLAYERS,
  FAST_TICK_MS,
  SLOW_TICK_MS,
  EVENT_TICK_MS,
  COPS_TICK_MS,
  SNAPSHOT_INTERVAL_MS,
  SNAPSHOT_PATH,
  PLAYER_SPEED,
};
