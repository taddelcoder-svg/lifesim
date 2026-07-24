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
} = require('./player');
const { pickEligibleEvent } = require('./events');

const MAX_PLAYERS = 20;
const FAST_TICK_MS = 50; // Positionen / Kollision (Phase 4) / Kampf
const SLOW_TICK_MS = 10000; // Alterung / Wirtschaft
const EVENT_TICK_MS = 1000; // Lebensereignisse: Ablauf pruefen, neue anbieten
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
}

module.exports = {
  GameWorld,
  MAX_PLAYERS,
  FAST_TICK_MS,
  SLOW_TICK_MS,
  EVENT_TICK_MS,
  SNAPSHOT_INTERVAL_MS,
  SNAPSHOT_PATH,
  PLAYER_SPEED,
};
