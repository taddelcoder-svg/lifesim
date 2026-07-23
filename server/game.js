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

const MAX_PLAYERS = 20;
const FAST_TICK_MS = 50; // Positionen / Kollision (Phase 4) / Kampf
const SLOW_TICK_MS = 10000; // Alterung / Wirtschaft
const SNAPSHOT_INTERVAL_MS = 60000;
const SNAPSHOT_PATH = path.join(__dirname, '..', 'world-snapshot.json');

const YEARS_PER_MS = 1 / (60 * 60 * 1000); // 1 Spieljahr pro Realstunde aktiver Verbindung
const RECONNECT_GRACE_MS = 5 * 60 * 1000; // Zeitfenster, in dem ein Reconnect den alten Spieler übernimmt
const PLAYER_SPEED = 200; // px/s - MUSS mit client/net.js übereinstimmen (Prediction)

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
}

module.exports = {
  GameWorld,
  MAX_PLAYERS,
  FAST_TICK_MS,
  SLOW_TICK_MS,
  SNAPSHOT_INTERVAL_MS,
  SNAPSHOT_PATH,
  PLAYER_SPEED,
};
