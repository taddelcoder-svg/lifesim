'use strict';

// client/net.js
// WebSocket-Verbindung, Input-Sammlung und Client-Prediction/Reconciliation.
// WICHTIG: Diese Datei bestimmt niemals die "wahre" Position - sie zeigt nur
// eine Vorhersage an, bis der Server die tatsächliche Position bestätigt.

const WORLD_WIDTH = 2000;
const WORLD_HEIGHT = 2000;
const PLAYER_SPEED = 200; // px/s - MUSS mit server/game.js übereinstimmen
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

    let x = serverState.x;
    let y = serverState.y;
    for (const inp of this.pendingInputs) {
      const res = this.simulateStep(x, y, inp.keys, inp.dt);
      x = res.x;
      y = res.y;
    }

    p.x = x;
    p.y = y;
    p.vx = serverState.vx;
    p.vy = serverState.vy;
  }

  /** Identische Bewegungslogik wie server/game.js#applyInput + stepPositions. */
  simulateStep(x, y, keys, dtMs) {
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

    const dtSec = dtMs / 1000;
    let nx = x + dx * PLAYER_SPEED * dtSec;
    let ny = y + dy * PLAYER_SPEED * dtSec;
    nx = Math.max(0, Math.min(WORLD_WIDTH, nx));
    ny = Math.max(0, Math.min(WORLD_HEIGHT, ny));
    return { x: nx, y: ny };
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

    const keysSnapshot = { ...this.keys };
    this.inputSeq += 1;
    const input = { seq: this.inputSeq, keys: keysSnapshot, dt: dtMs };

    const res = this.simulateStep(this.localPlayer.x, this.localPlayer.y, keysSnapshot, dtMs);
    this.localPlayer.x = res.x;
    this.localPlayer.y = res.y;

    this.pendingInputs.push(input);
    this.ws.send(JSON.stringify({ type: 'input', seq: input.seq, keys: keysSnapshot }));
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
}
