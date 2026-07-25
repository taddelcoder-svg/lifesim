'use strict';

// client/net.js
// WebSocket-Verbindung, Input-Sammlung und Client-Prediction/Reconciliation.
// WICHTIG: Diese Datei bestimmt niemals die "wahre" Position - sie zeigt nur
// eine Vorhersage an, bis der Server die tatsächliche Position bestätigt.

const WORLD_WIDTH = 2000;
const WORLD_HEIGHT = 2000;
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
  }

  setKey(key, val) {
    const k = key.toLowerCase();
    if (k in this.keys) this.keys[k] = val;
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
      this.stepMovement(state.pos, state.vel, inp.dirX, inp.dirY, inp.dt / 1000);
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
  stepMovement(pos, vel, dirX, dirY, dtSec) {
    const targetVx = dirX * PLAYER_SPEED;
    const targetVy = dirY * PLAYER_SPEED;

    const isStopping = dirX === 0 && dirY === 0;
    const maxDelta = (isStopping ? PLAYER_FRICTION : PLAYER_ACCELERATION) * dtSec;

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
  }

  /** Wandelt gedrueckte Tasten in eine normalisierte Richtung um. */
  keysToDirection(keys) {
    let dx = 0;
    let dy = 0;
    if (keys.w) dy -= 1;
    if (keys.s) dy += 1;
    if (keys.a) dx -= 1;
    if (keys.d) dx += 1;
    const len = Math.hypot(dx, dy);
    if (len > 0) {
      dx /= len;
      dy /= len;
    }
    return { dirX: dx, dirY: dy };
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
    const { dirX, dirY } = this.keysToDirection(keysSnapshot);
    this.inputSeq += 1;

    const pos = { x: this.localPlayer.x, y: this.localPlayer.y };
    this.stepMovement(pos, this.localVelocity, dirX, dirY, dt / 1000);
    this.localPlayer.x = pos.x;
    this.localPlayer.y = pos.y;
    this.localPlayer.vx = this.localVelocity.x;
    this.localPlayer.vy = this.localVelocity.y;

    this.pendingInputs.push({ seq: this.inputSeq, dirX, dirY, dt });
    this.ws.send(JSON.stringify({ type: 'input', seq: this.inputSeq, keys: keysSnapshot }));
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

  requestCourses() {
    this.send({ type: 'requestCourses' });
  }

  enrollInCourse(courseId) {
    this.send({ type: 'enrollInCourse', courseId });
  }

  dropCourse() {
    this.send({ type: 'dropCourse' });
  }
}
