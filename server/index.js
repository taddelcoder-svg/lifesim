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
  EVENT_TICK_MS,
  SNAPSHOT_INTERVAL_MS,
  SNAPSHOT_PATH,
} = require('./game');
const { serializePublic } = require('./player');

const PORT = process.env.PORT || 3000;

const app = express();
// WICHTIG: Caching bewusst komplett deaktiviert, solange aktiv am Client entwickelt
// wird. Ohne das kann der Browser (oder ein Zwischenspeicher) veraltete JS/HTML-Dateien
// behalten, obwohl auf GitHub/Render laengst eine neue Version liegt - das fuehrt zu
// verwirrenden "aber ich hab doch die Datei ersetzt"-Situationen. Sobald das Spiel
// stabiler ist, kann man hier wieder normales Caching aktivieren (bessere Ladezeiten).
app.use(express.static(path.join(__dirname, '..', 'client'), {
  etag: false,
  lastModified: false,
  setHeaders: (res) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  },
}));

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const world = new GameWorld();
const playerConnections = new Map(); // playerId -> ws, fuer gezielte Nachrichten (z.B. Event-Angebote)

function send(ws, msg) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

function sendToPlayer(playerId, msg) {
  send(playerConnections.get(playerId), msg);
}

function buildEventOfferMessage(instance) {
  return {
    type: 'eventOffer',
    instanceId: instance.instanceId,
    title: instance.title,
    text: instance.text,
    choices: instance.choices,
    expiresAt: instance.expiresAt,
  };
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
      playerConnections.set(result.player.id, ws);
      send(ws, {
        type: 'welcome',
        id: result.player.id,
        token: result.player.token,
        reconnected: result.reconnected,
        players: world.buildFullPublicState(),
      });
      if (result.reconnected && result.player.activeEvent) {
        // Spieler hatte beim Verbindungsabbruch noch ein offenes Ereignis - erneut zustellen
        send(ws, buildEventOfferMessage(result.player.activeEvent));
      }
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

    if (msg.type === 'eventChoice' && ws.playerId != null) {
      const result = world.applyEventChoice(ws.playerId, msg.instanceId, msg.choiceIndex);
      if (result.ok) {
        sendToPlayer(ws.playerId, {
          type: 'eventResolved',
          instanceId: result.instanceId,
          choiceLabel: result.choiceLabel,
          effects: result.effects,
          timedOut: false,
        });
        const player = world.players.get(ws.playerId);
        if (player) broadcast({ type: 'statUpdate', players: [serializePublic(player)] });

        // Sofort naechstes Event nachruecken, statt auf den naechsten EVENT_TICK zu warten
        const promoted = world.promoteQueuedEvents();
        for (const { player: p, instance } of promoted) {
          sendToPlayer(p.id, buildEventOfferMessage(instance));
        }
      }
      return;
    }

    if (msg.type === 'ping') {
      send(ws, { type: 'pong', t: msg.t });
    }
  });

  ws.on('close', () => {
    if (ws.playerId != null) {
      world.disconnectPlayer(ws.playerId);
      playerConnections.delete(ws.playerId);
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

// EVENT_TICK: neue Lebensereignisse auswürfeln, abgelaufene mit Standardwahl auflösen,
// naechstes aus der Warteschlange nachruecken - eigener, schnellerer Takt als slowTick,
// damit Countdown-Anzeigen im Client nicht spuerbar nachhinken.
setInterval(() => {
  world.rollEventsForConnectedPlayers();

  const expired = world.checkExpiredEvents();
  for (const { player, instance, choiceLabel, effects } of expired) {
    sendToPlayer(player.id, {
      type: 'eventResolved',
      instanceId: instance.instanceId,
      choiceLabel,
      effects,
      timedOut: true,
    });
    broadcast({ type: 'statUpdate', players: [serializePublic(player)] });
  }

  const promoted = world.promoteQueuedEvents();
  for (const { player, instance } of promoted) {
    sendToPlayer(player.id, buildEventOfferMessage(instance));
  }
}, EVENT_TICK_MS);

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
