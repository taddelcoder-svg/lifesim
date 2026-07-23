'use strict';

// server/index.js
// Einstiegspunkt: HTTP-Server (statischer Client) + WebSocket-Server,
// verdrahtet Lobby, fastTick (Bewegung), slowTick (Alterung) und Snapshots.

const path = require('path');
const fs = require('fs');
const http = require('http');
const express = require('express');
const WebSocket = require('ws');

const {
  GameWorld,
  FAST_TICK_MS,
  SLOW_TICK_MS,
  SNAPSHOT_INTERVAL_MS,
  SNAPSHOT_PATH,
} = require('./game');
const { serializePublic } = require('./player');

const PORT = process.env.PORT || 3000;

const app = express();
app.use(express.static(path.join(__dirname, '..', 'client')));

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const world = new GameWorld();

function send(ws, msg) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

function broadcast(msg, exceptWs) {
  const data = JSON.stringify(msg);
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN && client !== exceptWs) {
      client.send(data);
    }
  }
}

wss.on('connection', (ws) => {
  ws.playerId = null;
  ws.isAlive = true;

  ws.on('pong', () => {
    ws.isAlive = true;
  });

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch (err) {
      return; // ungültige Nachricht ignorieren, nie crashen
    }

    if (msg.type === 'join') {
      const result = world.joinPlayer(msg.name, msg.token, ws);
      if (result.error) {
        send(ws, { type: 'joinError', reason: result.error });
        return;
      }
      ws.playerId = result.player.id;
      send(ws, {
        type: 'welcome',
        id: result.player.id,
        token: result.player.token,
        reconnected: result.reconnected,
        players: world.buildFullPublicState(),
      });
      broadcast({ type: 'playerJoined', player: serializePublic(result.player) }, ws);
      console.log(
        `${result.reconnected ? 'Reconnect' : 'Join'}: ${result.player.name} (#${result.player.id}) - ${world.playerCount} online`
      );
      return;
    }

    if (msg.type === 'input' && ws.playerId != null) {
      world.applyInput(ws.playerId, msg);
      return;
    }

    if (msg.type === 'ping') {
      send(ws, { type: 'pong', t: msg.t });
    }
  });

  ws.on('close', () => {
    if (ws.playerId != null) {
      world.disconnectPlayer(ws.playerId);
      broadcast({ type: 'playerDisconnected', id: ws.playerId });
      console.log(`Disconnect: #${ws.playerId} - ${world.playerCount} online`);
    }
  });

  ws.on('error', () => {
    // Verbindungsfehler werden über 'close' abgewickelt
  });
});

// Tote Verbindungen erkennen (z.B. Netzwerkabbruch ohne sauberes close-Event)
setInterval(() => {
  for (const client of wss.clients) {
    if (client.isAlive === false) {
      client.terminate();
      continue;
    }
    client.isAlive = false;
    client.ping();
  }
}, 30000);

// fastTick: Positionen fortschreiben + Bewegungs-Delta an alle senden
let lastFastTick = Date.now();
setInterval(() => {
  const now = Date.now();
  const dt = now - lastFastTick;
  lastFastTick = now;

  world.stepPositions(dt);
  const deltas = world.buildMovementDeltas();
  if (deltas.length > 0) {
    broadcast({ type: 'delta', players: deltas });
  }
}, FAST_TICK_MS);

// slowTick: individuelle Lebensuhr weiterlaufen lassen, Wirtschaft folgt in Phase 3
let lastSlowTick = Date.now();
setInterval(() => {
  const now = Date.now();
  const dt = now - lastSlowTick;
  lastSlowTick = now;

  world.ageConnectedPlayers(dt);
  world.removeStalePlayers();
  broadcast({ type: 'statUpdate', players: world.buildFullPublicState() });
}, SLOW_TICK_MS);

// Snapshot: In-Memory-State periodisch auf Disk sichern (einfache Persistenz für Phase 1)
setInterval(() => {
  try {
    const data = world.buildFullPublicState();
    fs.writeFileSync(SNAPSHOT_PATH, JSON.stringify(data, null, 2));
  } catch (err) {
    console.error('Snapshot fehlgeschlagen:', err.message);
  }
}, SNAPSHOT_INTERVAL_MS);

server.listen(PORT, () => {
  console.log(`Server läuft auf http://localhost:${PORT}`);
});
