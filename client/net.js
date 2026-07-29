'use strict';

// client/net.js
// WebSocket-Verbindung, Input-Sammlung und Client-Prediction/Reconciliation.
// WICHTIG: Diese Datei bestimmt niemals die "wahre" Position - sie zeigt nur
// eine Vorhersage an, bis der Server die tatsächliche Position bestätigt.

// GESPIEGELT aus server/world.js (WORLD_SIZE). Ohne Build-Schritt gibt es keine
// gemeinsame Quelle - aendert sich die Weltgroesse dort, MUSS sie hier mit
// (Grundprinzip 2). Laeuft es auseinander, korrigiert der Server jede Bewegung
// am Rand, sichtbar als Ruckeln.
const WORLD_WIDTH = 2800;
const WORLD_HEIGHT = 2800;
const PLAYER_SPEED = 200; // px/s - MUSS mit server/game.js übereinstimmen

// Diese drei Werte UND die Formel in stepMovement() muessen EXAKT mit
// server/game.js uebereinstimmen, sonst driftet die Vorhersage staendig ab.
// Bewusst hoch angesetzt (GTA/Roblox-Gefuehl beim On-Foot-Richtungswechsel,
// kein traeges "Eislaufen") - siehe ausfuehrlichen Kommentar in server/game.js.
const PLAYER_ACCELERATION = 4000;
const PLAYER_FRICTION = 5000;

const SNAP_THRESHOLD = 60;     // ab dieser Abweichung (px) wird hart korrigiert statt sanft
const CORRECTION_BLEND = 0.25; // Anteil, mit dem kleine Abweichungen pro Frame ausgeglichen werden
const MAX_FRAME_DT_MS = 100;   // Deckel gegen Zeitspruenge nach Hintergrund-Tabs

// MUSS mit COLLISION_PASSES in server/world.js uebereinstimmen.
const COLLISION_PASSES = 4;
const RECONNECT_DELAY_MS = 2000;

class NetClient {
  constructor() {
    this.ws = null;
    this.myId = null;
    this.token = localStorage.getItem('lifesim_token') || null;
    this.players = new Map(); // id -> { id, name, age, x, y, vx, vy, ...stats }
    this.localPlayer = null;
    this.inputSeq = 0;
    this.pendingInputs = []; // noch nicht vom Server bestätigte Eingaben
    this.localVelocity = { x: 0, y: 0 }; // eigene Geschwindigkeit fuer die Vorhersage
    this.cameraYaw = 0; // frei drehbare Kamera-Blickrichtung (Bogenmass) - per Wischgeste gesteuert

    // Stadtaufbau - kommt vom Server, damit Rendering UND Kollision garantiert
    // zu dem passen, was der Server rechnet.
    this.worldRoads = [];
    this.worldBuildings = [];
    this.collisionRects = [];
    this.collisionRadius = 18;
    this.onWorldLayout = null;

    // Feste Orte (Bank, Uni, Arbeitsamt, ...) samt der dort moeglichen Aktionen.
    // Kommt mit dem worldLayout; daraus baut render.js die Beschriftung in der
    // Stadt und index.html die Meldung "dafuer musst du zum ...".
    this.places = [];

    // Fahrzeuge
    this.vehicleCatalog = []; // [{ id, name, price, speed, acceleration, friction }]
    this.vehicles = new Map(); // vehicleId -> { id, typeId, x, y, ownerId, driverId }
    this.onVehiclesState = null;
    this.onVehicleEntered = null;
    this.onVehicleExited = null;
    this.onVehicleBought = null;

    // Bank
    this.bank = { cash: 0, savings: 0, debt: 0, creditLimit: 0, savingsRate: 0, loanRate: 0, vault: 0 };
    this.onBankState = null;
    this.onBankAction = null;
    this.onForeclosure = null;

    // Umwelt: Tageszeit und Wetter
    this.environment = { phase: 'day', progress: 0, weather: 'clear', weatherName: 'klar' };
    this.onEnvironmentState = null;

    // Boerse
    this.market = { reserve: 0, stocks: [] };
    this.onMarketState = null;
    this.onMarketAction = null;

    // Politik: Wahl, Amtszeit, Steuersatz
    this.politics = { phase: 'campaign', candidates: [], taxRate: 0.01, mayorId: null };
    this.onPoliticsState = null;
    this.onPoliticsEvent = null;
    this.onPoliticsAction = null;

    // Schutz: Alarmanlage und Versicherung
    this.onProtectionChanged = null;
    this.onAlarmTriggered = null;

    // Kriminalitaet: Einbruch und Bankueberfall
    this.onBurglaryResult = null;
    this.onBurgledFrom = null;
    this.onRobberyResult = null;

    // Rechtliches: Kaution, Bestechung, Anwalt
    this.onLegalAction = null;

    // Gesundheit & Freizeit
    this.onWellbeingAction = null;
    this.onStatUpdate = null;

    // Firmen: Anstellungen
    this.incomingEmploymentOffers = new Map(); // offerId -> Angebot
    this.onEmploymentOffer = null;
    this.onEmploymentResolved = null;
    this.onEmploymentEnded = null;
    this.onEmployeeQuit = null;
    this.onCompanyUpgraded = null;
    this.keys = { w: false, a: false, s: false, d: false };
    this.onWelcome = null;
    this.onJoinError = null;
    this.activeEventOffer = null; // aktuell angezeigtes Lebensereignis, oder null
    this.onEventOffer = null;
    this.onEventResolved = null;
    this.onConnectionLost = null;
    this._pendingName = null;

    // Wirtschaft (Phase 3)
    this.properties = new Map();  // propertyId -> { id, name, price, incomePerTick, maintenancePerTick, ownerId, position }
    this.companies = new Map();   // companyId -> { id, ownerId, name }
    this.incomingTrades = new Map(); // tradeId -> Handelsangebot, das MIR gemacht wurde
    this.onEconomyState = null;
    this.onTradeOffer = null;
    this.onTradeResolved = null;
    this.onActionError = null;
    this.onPropertyRepossessed = null;

    // Kriminalität (Phase 4)
    this.cops = new Map(); // copId -> { id, x, y }
    this.onStealResult = null;
    this.onStolenFrom = null;
    this.onJailed = null;
    this.onReleased = null;

    // Soziales (Phase 5)
    this.chatMessages = []; // { id, playerId, name, text, timestamp }
    this.incomingFriendRequests = new Map(); // requestId -> { requestId, fromPlayerId, fromName }
    this.myFriends = []; // IDs befreundeter Spieler - eigene, private Sicht
    this.onChatMessage = null;
    this.onFriendRequest = null;
    this.onFriendResolved = null;
    this.onLeaderboard = null;

    // Familie (Ehe, Kinder, Tod & Wiedergeburt)
    this.incomingMarriageRequests = new Map(); // requestId -> { requestId, fromPlayerId, fromName }
    this.myChildren = []; // { id, name, parentIds, bornAt, inheritedCash, claimed }
    this.onMarriageRequest = null;
    this.onMarriageResolved = null;
    this.onDivorced = null;
    this.onChildBorn = null;
    this.onFamilyState = null;
    this.onDied = null;
    this.onWidowed = null;
    this.onReincarnated = null;

    // Beruf
    this.jobCatalog = []; // [{ id, name, minSmarts, maxWanted, levels: [{title, salary}] }]
    this.onJobCatalog = null;
    this.onJobStarted = null;
    this.onJobQuit = null;
    this.onJobPromotion = null;

    // Bildung
    this.courseCatalog = []; // [{ id, name, cost, durationTicks, smartsGain, requires }]
    this.onCourseCatalog = null;
    this.onCourseEnrolled = null;
    this.onCourseDropped = null;
    this.onCourseCompleted = null;

    window.addEventListener('keydown', (e) => this.setKey(e.key, true));
    window.addEventListener('keyup', (e) => this.setKey(e.key, false));

    // WICHTIG gegen "laeuft endlos weiter": Verliert das Fenster den Fokus oder
    // wechselt man den Tab/die App, waehrend eine Taste gedrueckt ist, kommt das
    // zugehoerige keyup NIE an - die Taste bliebe fuer immer "gedrueckt". Deshalb
    // hier alle Tasten zuruecksetzen.
    window.addEventListener('blur', () => this.releaseAllKeys());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.releaseAllKeys();
    });
  }

  setKey(key, val) {
    const k = key.toLowerCase();
    if (k in this.keys) this.keys[k] = val;
  }

  /** Alle Tasten loslassen - gegen haengende Tasten bei Fokusverlust/Tabwechsel. */
  releaseAllKeys() {
    for (const k of Object.keys(this.keys)) this.keys[k] = false;
  }

  connect(name) {
    this._pendingName = name;
    const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
    this.ws = new WebSocket(`${protocol}://${location.host}`);

    this.ws.addEventListener('open', () => {
      this.ws.send(JSON.stringify({ type: 'join', name, token: this.token }));
    });

    this.ws.addEventListener('message', (event) => {
      let msg;
      try {
        msg = JSON.parse(event.data);
      } catch (err) {
        return;
      }
      this.handleMessage(msg);
    });

    this.ws.addEventListener('close', () => {
      console.warn('Verbindung getrennt. Neuverbindung in 2s...');
      // Nach aussen melden, damit die Oberflaeche z.B. den Ladebildschirm
      // aktualisieren kann statt endlos zu drehen.
      if (this.onConnectionLost) this.onConnectionLost();
      setTimeout(() => this.connect(this._pendingName), RECONNECT_DELAY_MS);
    });
  }

  handleMessage(msg) {
    switch (msg.type) {
      case 'welcome': {
        this.myId = msg.id;
        this.token = msg.token;
        localStorage.setItem('lifesim_token', this.token);
        this.players.clear();
        this.pendingInputs = [];
        for (const p of msg.players) {
          this.players.set(p.id, { ...p, vx: 0, vy: 0 });
        }
        this.localPlayer = this.players.get(this.myId);
        this.myFriends = msg.friends || [];
        if (this.onWelcome) this.onWelcome();
        break;
      }

      case 'joinError': {
        if (this.onJoinError) this.onJoinError(msg.reason);
        break;
      }

      case 'eventOffer': {
        this.activeEventOffer = msg;
        if (this.onEventOffer) this.onEventOffer(msg);
        break;
      }

      case 'eventResolved': {
        this.activeEventOffer = null;
        if (this.onEventResolved) this.onEventResolved(msg);
        break;
      }

      case 'playerJoined': {
        if (!this.players.has(msg.player.id)) {
          this.players.set(msg.player.id, { ...msg.player, vx: 0, vy: 0 });
        }
        break;
      }

      case 'playerDisconnected': {
        const p = this.players.get(msg.id);
        if (p) p.connected = false;
        break;
      }

      case 'delta': {
        for (const d of msg.players) {
          let p = this.players.get(d.id);
          if (!p) {
            p = { id: d.id, name: '?', age: 18, connected: true };
            this.players.set(d.id, p);
          }
          if (d.id === this.myId) {
            this.reconcile(d);
          } else {
            p.x = d.x;
            p.y = d.y;
            p.vx = d.vx;
            p.vy = d.vy;
          }
        }
        break;
      }

      case 'statUpdate': {
        for (const s of msg.players) {
          const p = this.players.get(s.id);
          if (p) Object.assign(p, s);
          else this.players.set(s.id, { ...s, vx: 0, vy: 0 });
        }
        // Hook, damit offene Bedienbereiche auf sich aendernde Werte reagieren
        // koennen - Gesundheit und Zufriedenheit sinken durch den Verfall auch
        // ohne jedes Zutun des Spielers.
        if (this.onStatUpdate) this.onStatUpdate(msg);
        break;
      }

      case 'economyState': {
        this.properties.clear();
        for (const p of msg.properties) this.properties.set(p.id, p);
        this.companies.clear();
        for (const c of msg.companies) this.companies.set(c.id, c);
        if (this.onEconomyState) this.onEconomyState();
        break;
      }

      case 'tradeOffer': {
        this.incomingTrades.set(msg.tradeId, msg);
        if (this.onTradeOffer) this.onTradeOffer(msg);
        break;
      }

      case 'tradeResolved': {
        this.incomingTrades.delete(msg.tradeId);
        if (this.onTradeResolved) this.onTradeResolved(msg);
        break;
      }

      case 'actionError': {
        if (this.onActionError) this.onActionError(msg);
        break;
      }

      case 'propertyRepossessed': {
        if (this.onPropertyRepossessed) this.onPropertyRepossessed(msg);
        break;
      }

      case 'copsState': {
        this.cops.clear();
        for (const cop of msg.cops) this.cops.set(cop.id, cop);
        break;
      }

      case 'stealResult': {
        if (this.onStealResult) this.onStealResult(msg);
        break;
      }

      case 'stolenFrom': {
        if (this.onStolenFrom) this.onStolenFrom(msg);
        break;
      }

      case 'jailed': {
        if (this.onJailed) this.onJailed(msg);
        break;
      }

      case 'released': {
        if (this.onReleased) this.onReleased(msg);
        break;
      }

      case 'chatHistory': {
        this.chatMessages = msg.messages;
        if (this.onChatMessage) this.onChatMessage(null); // signalisiert: Liste neu aufbauen
        break;
      }

      case 'chatMessage': {
        this.chatMessages.push(msg.message);
        if (this.chatMessages.length > 50) this.chatMessages.shift();
        if (this.onChatMessage) this.onChatMessage(msg.message);
        break;
      }

      case 'friendRequest': {
        this.incomingFriendRequests.set(msg.requestId, msg);
        if (this.onFriendRequest) this.onFriendRequest(msg);
        break;
      }

      case 'friendList': {
        this.myFriends = msg.friends || [];
        if (this.onFriendResolved) this.onFriendResolved(msg);
        break;
      }

      case 'friendResolved': {
        this.incomingFriendRequests.delete(msg.requestId);
        if (msg.accepted && msg.otherPlayerId != null && !this.myFriends.includes(msg.otherPlayerId)) {
          this.myFriends.push(msg.otherPlayerId);
        }
        if (this.onFriendResolved) this.onFriendResolved(msg);
        break;
      }

      case 'leaderboard': {
        if (this.onLeaderboard) this.onLeaderboard(msg);
        break;
      }

      case 'marriageRequest': {
        this.incomingMarriageRequests.set(msg.requestId, msg);
        if (this.onMarriageRequest) this.onMarriageRequest(msg);
        break;
      }

      case 'marriageResolved': {
        this.incomingMarriageRequests.delete(msg.requestId);
        if (this.onMarriageResolved) this.onMarriageResolved(msg);
        break;
      }

      case 'divorced': {
        if (this.onDivorced) this.onDivorced(msg);
        break;
      }

      case 'childBorn': {
        this.myChildren.push(msg.child);
        if (this.onChildBorn) this.onChildBorn(msg);
        break;
      }

      case 'familyState': {
        this.myChildren = msg.children;
        if (this.onFamilyState) this.onFamilyState(msg);
        break;
      }

      case 'died': {
        if (this.onDied) this.onDied(msg);
        break;
      }

      case 'widowed': {
        if (this.onWidowed) this.onWidowed(msg);
        break;
      }

      case 'reincarnated': {
        if (this.onReincarnated) this.onReincarnated(msg);
        break;
      }

      case 'jobCatalog': {
        this.jobCatalog = msg.jobs;
        if (this.onJobCatalog) this.onJobCatalog(msg);
        break;
      }

      case 'jobStarted': {
        if (this.onJobStarted) this.onJobStarted(msg);
        break;
      }

      case 'jobQuit': {
        if (this.onJobQuit) this.onJobQuit(msg);
        break;
      }

      case 'jobPromotion': {
        if (this.onJobPromotion) this.onJobPromotion(msg);
        break;
      }

      case 'courseCatalog': {
        this.courseCatalog = msg.courses;
        if (this.onCourseCatalog) this.onCourseCatalog(msg);
        break;
      }

      case 'courseEnrolled': {
        if (this.onCourseEnrolled) this.onCourseEnrolled(msg);
        break;
      }

      case 'courseDropped': {
        if (this.onCourseDropped) this.onCourseDropped(msg);
        break;
      }

      case 'employmentOffer': {
        this.incomingEmploymentOffers.set(msg.offerId, msg);
        if (this.onEmploymentOffer) this.onEmploymentOffer(msg);
        break;
      }

      case 'employmentOfferExpired': {
        this.incomingEmploymentOffers.delete(msg.offerId);
        break;
      }

      case 'employmentResolved': {
        if (this.onEmploymentResolved) this.onEmploymentResolved(msg);
        break;
      }

      case 'employmentEnded': {
        if (this.onEmploymentEnded) this.onEmploymentEnded(msg);
        break;
      }

      case 'employeeQuit': {
        if (this.onEmployeeQuit) this.onEmployeeQuit(msg);
        break;
      }

      case 'companyUpgraded': {
        if (this.onCompanyUpgraded) this.onCompanyUpgraded(msg);
        break;
      }

      case 'bankState': {
        this.bank = {
          cash: msg.cash, savings: msg.savings, debt: msg.debt,
          creditLimit: msg.creditLimit, savingsRate: msg.savingsRate, loanRate: msg.loanRate,
          vault: msg.vault ?? 0,
        };
        if (this.onBankState) this.onBankState(this.bank);
        break;
      }

      case 'bankAction': {
        if (this.onBankAction) this.onBankAction(msg);
        break;
      }

      case 'environmentState': {
        this.environment = msg;
        if (this.onEnvironmentState) this.onEnvironmentState(msg);
        break;
      }

      case 'marketState': {
        this.market = msg;
        if (this.onMarketState) this.onMarketState(msg);
        break;
      }

      case 'marketAction': {
        if (this.onMarketAction) this.onMarketAction(msg);
        break;
      }

      case 'politicsState': {
        this.politics = msg;
        if (this.onPoliticsState) this.onPoliticsState(msg);
        break;
      }

      case 'politicsEvent': {
        if (this.onPoliticsEvent) this.onPoliticsEvent(msg);
        break;
      }

      case 'politicsAction': {
        if (this.onPoliticsAction) this.onPoliticsAction(msg);
        break;
      }

      case 'protectionChanged': {
        if (this.onProtectionChanged) this.onProtectionChanged(msg);
        break;
      }

      case 'alarmTriggered': {
        if (this.onAlarmTriggered) this.onAlarmTriggered(msg);
        break;
      }

      case 'burglaryResult': {
        if (this.onBurglaryResult) this.onBurglaryResult(msg);
        break;
      }

      case 'burgledFrom': {
        if (this.onBurgledFrom) this.onBurgledFrom(msg);
        break;
      }

      case 'robberyResult': {
        if (this.onRobberyResult) this.onRobberyResult(msg);
        break;
      }

      case 'legalAction': {
        if (this.onLegalAction) this.onLegalAction(msg);
        break;
      }

      case 'wellbeingAction': {
        if (this.onWellbeingAction) this.onWellbeingAction(msg);
        break;
      }

      case 'foreclosure': {
        if (this.onForeclosure) this.onForeclosure(msg);
        break;
      }

      case 'vehiclesState': {
        this.vehicleCatalog = msg.catalog || [];
        this.vehicles.clear();
        for (const v of msg.vehicles || []) this.vehicles.set(v.id, v);
        if (this.onVehiclesState) this.onVehiclesState(msg);
        break;
      }

      case 'vehicleDelta': {
        for (const upd of msg.vehicles || []) {
          const v = this.vehicles.get(upd.id);
          if (v) { v.x = upd.x; v.y = upd.y; }
        }
        break;
      }

      case 'vehicleEntered': {
        if (this.onVehicleEntered) this.onVehicleEntered(msg);
        break;
      }

      case 'vehicleExited': {
        if (this.onVehicleExited) this.onVehicleExited(msg);
        break;
      }

      case 'vehicleBought': {
        if (this.onVehicleBought) this.onVehicleBought(msg);
        break;
      }

      case 'worldLayout': {
        this.worldRoads = msg.roads || [];
        this.worldBuildings = msg.buildings || [];
        this.collisionRects = msg.collisionRects || [];
        this.places = msg.places || [];

        // Grundprinzip 2 in der Praxis: laeuft die gespiegelte Weltgroesse aus
        // dem Server auseinander, korrigiert der Server jede Bewegung am Rand -
        // sichtbar nur als unerklaerliches Ruckeln. Lieber sofort und deutlich
        // melden, statt es beim Spielen suchen zu muessen.
        if (typeof msg.worldSize === 'number' && msg.worldSize !== WORLD_WIDTH) {
          console.error(
            `WELTGRÖSSE LÄUFT AUSEINANDER: Server ${msg.worldSize}, Client ${WORLD_WIDTH}. ` +
            'WORLD_WIDTH/WORLD_HEIGHT in client/net.js an server/world.js (WORLD_SIZE) angleichen.'
          );
        }
        if (typeof msg.collisionRadius === 'number') this.collisionRadius = msg.collisionRadius;
        if (this.onWorldLayout) this.onWorldLayout(msg);
        break;
      }

      case 'courseCompleted': {
        if (this.onCourseCompleted) this.onCourseCompleted(msg);
        break;
      }

      default:
        break;
    }
  }

  /**
   * Server-Reconciliation: übernimmt die autoritative Serverposition und
   * spielt alle noch unbestätigten (nach dem Server-Tick gesendeten) Inputs
   * erneut ab, um Ruckeln zu vermeiden.
   */
  reconcile(serverState) {
    const p = this.localPlayer;
    if (!p) return;

    this.pendingInputs = this.pendingInputs.filter(
      (inp) => inp.seq > serverState.lastProcessedInput
    );

    // Vom bestaetigten Serverzustand aus alle noch offenen Eingaben neu abspielen.
    // Wichtig: die Geschwindigkeit gehoert jetzt mit zum Zustand, weil die
    // Beschleunigung sonst nicht reproduzierbar waere.
    const state = {
      pos: { x: serverState.x, y: serverState.y },
      vel: { x: serverState.vx, y: serverState.vy },
    };
    for (const inp of this.pendingInputs) {
      this.stepMovement(state.pos, state.vel, inp.dirX, inp.dirY, inp.dt / 1000, inp.params);
    }

    // Kleine Abweichungen sanft ausgleichen statt hart zu springen - ein harter
    // Sprung waere bei jedem Netzwerk-Jitter als Ruckler sichtbar. Grosse
    // Abweichungen (z.B. Teleport ins Gefaengnis) werden weiterhin sofort uebernommen.
    const errX = state.pos.x - p.x;
    const errY = state.pos.y - p.y;
    const error = Math.hypot(errX, errY);

    if (error > SNAP_THRESHOLD) {
      p.x = state.pos.x;
      p.y = state.pos.y;
    } else {
      p.x += errX * CORRECTION_BLEND;
      p.y += errY * CORRECTION_BLEND;
    }

    p.vx = state.vel.x;
    p.vy = state.vel.y;
    this.localVelocity.x = state.vel.x;
    this.localVelocity.y = state.vel.y;
  }

  /**
   * Bewegungsschritt - MUSS exakt dieselbe Formel und dieselben Konstanten
   * verwenden wie stepMovement() in server/game.js, sonst driftet die Vorhersage
   * dauerhaft von der Server-Wahrheit ab.
   * Veraendert pos und vel direkt.
   */
  stepMovement(pos, vel, dirX, dirY, dtSec, params) {
    const p = params || this.currentMovementParams();

    const targetVx = dirX * p.speed;
    const targetVy = dirY * p.speed;

    const isStopping = dirX === 0 && dirY === 0;
    const maxDelta = (isStopping ? p.friction : p.accel) * dtSec;

    const dvx = targetVx - vel.x;
    const dvy = targetVy - vel.y;
    const dvLen = Math.hypot(dvx, dvy);

    if (dvLen <= maxDelta || dvLen === 0) {
      vel.x = targetVx;
      vel.y = targetVy;
    } else {
      vel.x += (dvx / dvLen) * maxDelta;
      vel.y += (dvy / dvLen) * maxDelta;
    }

    pos.x = Math.max(0, Math.min(WORLD_WIDTH, pos.x + vel.x * dtSec));
    pos.y = Math.max(0, Math.min(WORLD_HEIGHT, pos.y + vel.y * dtSec));

    // Aus Gebaeuden herausschieben. MUSS exakt mit resolveCollisions() in
    // server/world.js uebereinstimmen - sonst laeuft die Vorhersage auseinander
    // und man "zappelt" an Waenden.
    this.resolveCollisions(pos, vel);
  }

  /** Identisch zu resolveCollisions() in server/world.js - inklusive Anzahl der Durchgaenge. */
  resolveCollisions(pos, vel) {
    const radius = this.collisionRadius;

    for (let pass = 0; pass < COLLISION_PASSES; pass++) {
      let anyOverlap = false;

      for (const r of this.collisionRects) {
        const halfW = r.w / 2 + radius;
        const halfD = r.d / 2 + radius;

        const dx = pos.x - r.x;
        const dy = pos.y - r.y;

        if (Math.abs(dx) >= halfW || Math.abs(dy) >= halfD) continue;

        anyOverlap = true;

        const overlapX = halfW - Math.abs(dx);
        const overlapY = halfD - Math.abs(dy);

        if (overlapX < overlapY) {
          pos.x += dx >= 0 ? overlapX : -overlapX;
          vel.x = 0;
        } else {
          pos.y += dy >= 0 ? overlapY : -overlapY;
          vel.y = 0;
        }
      }

      if (!anyOverlap) break;
    }
  }

  /**
   * Wandelt gedrueckte Tasten + Kamera-Blickrichtung in eine Weltrichtung um.
   * MUSS exakt mit keysToWorldDirection() in server/game.js uebereinstimmen -
   * sonst weicht die lokale Vorhersage von dem ab, was der Server tatsaechlich
   * berechnet, und die Bewegung faengt an zu ruckeln/korrigieren.
   */
  keysToWorldDirection(keys, cameraYaw) {
    const inputForward = (keys.w ? 1 : 0) - (keys.s ? 1 : 0);
    const inputRight = (keys.d ? 1 : 0) - (keys.a ? 1 : 0);

    if (inputForward === 0 && inputRight === 0) return { dirX: 0, dirY: 0 };

    const sin = Math.sin(cameraYaw);
    const cos = Math.cos(cameraYaw);

    // "Rechts" relativ zur Kamera ist forward x up (Three.js-Konvention) -
    // MUSS exakt mit server/game.js uebereinstimmen.
    let dirX = inputForward * sin - inputRight * cos;
    let dirY = inputForward * cos + inputRight * sin;

    const len = Math.hypot(dirX, dirY);
    if (len > 0) {
      dirX /= len;
      dirY /= len;
    }
    return { dirX, dirY };
  }

  /** Wird von der UI aufgerufen, wenn der Spieler eine Option bei einem Lebensereignis waehlt. */
  chooseEventOption(choiceIndex) {
    if (!this.activeEventOffer || !this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify({
      type: 'eventChoice',
      instanceId: this.activeEventOffer.instanceId,
      choiceIndex,
    }));
    this.activeEventOffer = null; // sofort ausblenden, Server bestaetigt gleich per eventResolved
  }

  /** Wird jeden Frame vom Renderer aufgerufen: sendet Input, wendet Prediction an. */
  update(dtMs) {
    if (!this.localPlayer || !this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    // Sehr grosse Zeitspruenge begrenzen (z.B. wenn der Tab im Hintergrund war) -
    // sonst wuerde die Figur beim Zurueckkehren quer durch die Welt schiessen.
    const dt = Math.min(dtMs, MAX_FRAME_DT_MS);

    const keysSnapshot = { ...this.keys };
    const { dirX, dirY } = this.keysToWorldDirection(keysSnapshot, this.cameraYaw);
    this.inputSeq += 1;

    // Bewegungswerte EINMAL bestimmen und mitspeichern: beim spaeteren erneuten
    // Abspielen in reconcile() muessen dieselben Werte gelten wie jetzt, sonst
    // rechnet die Korrektur mit Fusswerten, obwohl man damals gefahren ist.
    const params = this.currentMovementParams();

    const pos = { x: this.localPlayer.x, y: this.localPlayer.y };
    this.stepMovement(pos, this.localVelocity, dirX, dirY, dt / 1000, params);
    this.localPlayer.x = pos.x;
    this.localPlayer.y = pos.y;
    this.localPlayer.vx = this.localVelocity.x;
    this.localPlayer.vy = this.localVelocity.y;

    this.pendingInputs.push({ seq: this.inputSeq, dirX, dirY, dt, params });
    this.ws.send(JSON.stringify({
      type: 'input',
      seq: this.inputSeq,
      keys: keysSnapshot,
      cameraYaw: this.cameraYaw,
    }));
  }

  /** Wird von der Oberflaeche aufgerufen, wenn der Spieler die Kamera per Wischgeste dreht. */
  rotateCameraYaw(deltaRadians) {
    this.cameraYaw += deltaRadians;
  }

  /** Kleiner Hilfsmethoden-Block fuer die Wirtschaft - alles serverseitig geprueft, hier nur Versand. */
  send(obj) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(obj));
    }
  }

  buyProperty(propertyId) {
    this.send({ type: 'buyProperty', propertyId });
  }

  sellProperty(propertyId) {
    this.send({ type: 'sellProperty', propertyId });
  }

  foundCompany(name) {
    this.send({ type: 'foundCompany', name });
  }

  closeCompany(companyId) {
    this.send({ type: 'closeCompany', companyId });
  }

  proposeTrade(toPlayerId, propertyId, price) {
    this.send({ type: 'proposeTrade', toPlayerId, propertyId, price });
  }

  respondTrade(tradeId, accept) {
    this.send({ type: 'respondTrade', tradeId, accept });
    this.incomingTrades.delete(tradeId); // sofort ausblenden, Server bestaetigt gleich
  }

  /** Server prueft die tatsaechliche Distanz - hier nur eine Heuristik fuer die UI (Zielwahl). */
  findNearestOtherPlayer() {
    if (!this.localPlayer) return null;
    let nearest = null;
    let bestDist = Infinity;
    for (const p of this.players.values()) {
      if (p.id === this.myId || p.connected === false) continue;
      const dist = Math.hypot((p.x ?? 0) - this.localPlayer.x, (p.y ?? 0) - this.localPlayer.y);
      if (dist < bestDist) {
        bestDist = dist;
        nearest = p;
      }
    }
    return nearest ? { player: nearest, distance: bestDist } : null;
  }

  stealAttempt(targetPlayerId) {
    this.send({ type: 'stealAttempt', targetPlayerId });
  }

  sendChatMessage(text) {
    this.send({ type: 'chatMessage', text });
  }

  proposeFriendship(toPlayerId) {
    this.send({ type: 'proposeFriendship', toPlayerId });
  }

  respondFriendRequest(requestId, accept) {
    this.send({ type: 'respondFriendRequest', requestId, accept });
    this.incomingFriendRequests.delete(requestId);
  }

  requestLeaderboard() {
    this.send({ type: 'requestLeaderboard' });
  }

  proposeMarriage(toPlayerId) {
    this.send({ type: 'proposeMarriage', toPlayerId });
  }

  respondMarriageRequest(requestId, accept) {
    this.send({ type: 'respondMarriageRequest', requestId, accept });
    this.incomingMarriageRequests.delete(requestId);
  }

  divorce() {
    this.send({ type: 'divorce' });
  }

  haveChild(name) {
    this.send({ type: 'haveChild', name });
  }

  requestFamily() {
    this.send({ type: 'requestFamily' });
  }

  reincarnate() {
    this.send({ type: 'reincarnate' });
  }

  requestJobs() {
    this.send({ type: 'requestJobs' });
  }

  applyForJob(jobId) {
    this.send({ type: 'applyForJob', jobId });
  }

  quitJob() {
    this.send({ type: 'quitJob' });
  }

  enterVehicle(vehicleId) {
    this.send({ type: 'enterVehicle', vehicleId });
  }

  exitVehicle() {
    this.send({ type: 'exitVehicle' });
  }

  buyVehicle(vehicleId) {
    this.send({ type: 'buyVehicle', vehicleId });
  }

  upgradeCompany(companyId) { this.send({ type: 'upgradeCompany', companyId }); }
  offerEmployment(companyId, toPlayerId) { this.send({ type: 'offerEmployment', companyId, toPlayerId }); }
  respondEmployment(offerId, accept) {
    this.send({ type: 'respondEmployment', offerId, accept });
    this.incomingEmploymentOffers.delete(offerId);
  }
  leaveEmployment() { this.send({ type: 'leaveEmployment' }); }
  dismissEmployee(companyId, employeeId) { this.send({ type: 'dismissEmployee', companyId, employeeId }); }

  requestBank() {
    this.send({ type: 'requestBank' });
  }

  deposit(amount) { this.send({ type: 'deposit', amount }); }
  withdraw(amount) { this.send({ type: 'withdraw', amount }); }
  takeLoan(amount) { this.send({ type: 'takeLoan', amount }); }
  repayLoan(amount) { this.send({ type: 'repayLoan', amount }); }

  /** Naechstes Fahrzeug in Reichweite - nur fuer die Bedienoberflaeche, Server prueft selbst. */
  findNearestVehicle() {
    if (!this.localPlayer) return null;
    let nearest = null;
    let best = Infinity;
    for (const v of this.vehicles.values()) {
      const d = Math.hypot(v.x - this.localPlayer.x, v.y - this.localPlayer.y);
      if (d < best) { best = d; nearest = v; }
    }
    return nearest ? { vehicle: nearest, distance: best } : null;
  }

  /**
   * Der Ort, an dem der Spieler gerade steht - oder null. Ausschliesslich fuer
   * die Anzeige (HUD-Hinweis); massgeblich ist immer die Pruefung im Server.
   */
  currentPlace() {
    if (!this.localPlayer) return null;
    for (const place of this.places) {
      const d = Math.hypot(place.position.x - this.localPlayer.x, place.position.y - this.localPlayer.y);
      if (d <= place.range) return place;
    }
    return null;
  }

  /**
   * Welcher Ort wird fuer diese Aktion gebraucht, und wie weit ist er weg?
   * Der Server meldet bei Ablehnung nur 'too_far' - den Namen holt sich der
   * Client hier aus dem Katalog.
   */
  placeForAction(action) {
    const place = this.places.find((p) => Array.isArray(p.actions) && p.actions.includes(action));
    if (!place) return null;
    const distance = this.localPlayer
      ? Math.hypot(place.position.x - this.localPlayer.x, place.position.y - this.localPlayer.y)
      : null;
    return { place, distance };
  }

  /**
   * Aktuelle Bewegungswerte: im Fahrzeug gelten die Fahrzeugwerte, sonst die
   * Fusswerte. MUSS mit der Logik in server/game.js#stepPositions uebereinstimmen.
   */
  currentMovementParams() {
    const vid = this.localPlayer && this.localPlayer.vehicleId;
    if (vid != null) {
      const v = this.vehicles.get(vid);
      const type = v ? this.vehicleCatalog.find((t) => t.id === v.typeId) : null;
      if (type) return { speed: type.speed, accel: type.acceleration, friction: type.friction };
    }
    return { speed: PLAYER_SPEED, accel: PLAYER_ACCELERATION, friction: PLAYER_FRICTION };
  }

  requestCourses() {
    this.send({ type: 'requestCourses' });
  }

  enrollInCourse(courseId) {
    this.send({ type: 'enrollInCourse', courseId });
  }

  dropCourse() {
    this.send({ type: 'dropCourse' });
  }

  treatHealth() {
    this.send({ type: 'treatHealth' });
  }

  relax() {
    this.send({ type: 'relax' });
  }

  burgle(propertyId) {
    this.send({ type: 'burgle', propertyId });
  }

  robBank() {
    this.send({ type: 'robBank' });
  }

  buyNewVehicle(typeId) {
    this.send({ type: 'buyNewVehicle', typeId });
  }

  buyShares(symbol, shares) {
    this.send({ type: 'buyShares', symbol, shares });
  }

  sellShares(symbol, shares) {
    this.send({ type: 'sellShares', symbol, shares });
  }

  runForMayor() {
    this.send({ type: 'runForMayor' });
  }

  castVote(candidateId) {
    this.send({ type: 'castVote', candidateId });
  }

  setTaxRate(rate) {
    this.send({ type: 'setTaxRate', rate });
  }

  buyAlarm(propertyId) {
    this.send({ type: 'buyAlarm', propertyId });
  }

  setInsurance(propertyId, on) {
    this.send({ type: 'setInsurance', propertyId, on });
  }

  postBail() {
    this.send({ type: 'postBail' });
  }

  bribePolice() {
    this.send({ type: 'bribePolice' });
  }

  hireLawyer() {
    this.send({ type: 'hireLawyer' });
  }
}
