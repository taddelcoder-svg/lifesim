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
  COPS_TICK_MS,
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

function buildEconomyStateMessage() {
  return {
    type: 'economyState',
    properties: world.buildPropertiesState(),
    companies: world.buildCompaniesState(),
  };
}

function buildTradeOfferMessage(trade) {
  const property = world.properties.get(trade.propertyId);
  return {
    type: 'tradeOffer',
    tradeId: trade.id,
    fromPlayerId: trade.fromPlayerId,
    propertyId: trade.propertyId,
    propertyName: property ? property.name : 'Unbekannte Immobilie',
    price: trade.price,
    expiresAt: trade.expiresAt,
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
      send(ws, buildEconomyStateMessage()); // aktueller Immobilienmarkt + Firmenliste sofort sichtbar
      send(ws, { type: 'copsState', cops: world.buildCopsState() });
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

    // --- Wirtschaft: Immobilien, Firmen, Handel ---

    if (msg.type === 'buyProperty' && ws.playerId != null) {
      const result = world.buyProperty(ws.playerId, msg.propertyId);
      if (result.ok) {
        broadcast(buildEconomyStateMessage());
        broadcast({ type: 'statUpdate', players: [serializePublic(world.players.get(ws.playerId))] });
      } else {
        send(ws, { type: 'actionError', action: 'buyProperty', reason: result.reason });
      }
      return;
    }

    if (msg.type === 'sellProperty' && ws.playerId != null) {
      const result = world.sellPropertyToBank(ws.playerId, msg.propertyId);
      if (result.ok) {
        broadcast(buildEconomyStateMessage());
        broadcast({ type: 'statUpdate', players: [serializePublic(world.players.get(ws.playerId))] });
      } else {
        send(ws, { type: 'actionError', action: 'sellProperty', reason: result.reason });
      }
      return;
    }

    if (msg.type === 'foundCompany' && ws.playerId != null) {
      const result = world.foundCompany(ws.playerId, msg.name);
      if (result.ok) {
        broadcast(buildEconomyStateMessage());
        broadcast({ type: 'statUpdate', players: [serializePublic(world.players.get(ws.playerId))] });
      } else {
        send(ws, { type: 'actionError', action: 'foundCompany', reason: result.reason });
      }
      return;
    }

    if (msg.type === 'closeCompany' && ws.playerId != null) {
      const result = world.closeCompany(ws.playerId, msg.companyId);
      if (result.ok) {
        broadcast(buildEconomyStateMessage());
        broadcast({ type: 'statUpdate', players: [serializePublic(world.players.get(ws.playerId))] });
      } else {
        send(ws, { type: 'actionError', action: 'closeCompany', reason: result.reason });
      }
      return;
    }

    if (msg.type === 'proposeTrade' && ws.playerId != null) {
      const result = world.proposeTrade(ws.playerId, msg.toPlayerId, msg.propertyId, msg.price);
      if (result.ok) {
        sendToPlayer(msg.toPlayerId, buildTradeOfferMessage(result.trade));
        send(ws, { type: 'tradeSent', tradeId: result.trade.id });
      } else {
        send(ws, { type: 'actionError', action: 'proposeTrade', reason: result.reason });
      }
      return;
    }

    if (msg.type === 'respondTrade' && ws.playerId != null) {
      const result = world.respondTrade(ws.playerId, msg.tradeId, !!msg.accept);
      if (result.ok) {
        const buyerId = result.trade.toPlayerId;
        const sellerId = result.trade.fromPlayerId;
        const resolvedMsg = {
          type: 'tradeResolved',
          tradeId: result.trade.id,
          accepted: result.accepted,
          propertyId: result.trade.propertyId,
          price: result.trade.price,
        };
        sendToPlayer(buyerId, resolvedMsg);
        sendToPlayer(sellerId, resolvedMsg);
        if (result.accepted) {
          broadcast(buildEconomyStateMessage());
          const buyer = world.players.get(buyerId);
          const seller = world.players.get(sellerId);
          const updated = [buyer, seller].filter(Boolean).map(serializePublic);
          if (updated.length > 0) broadcast({ type: 'statUpdate', players: updated });
        }
      } else {
        send(ws, { type: 'actionError', action: 'respondTrade', reason: result.reason });
      }
      return;
    }

    // --- Kriminalität: Diebstahl ---

    if (msg.type === 'stealAttempt' && ws.playerId != null) {
      const result = world.attemptSteal(ws.playerId, msg.targetPlayerId);
      if (result.ok) {
        sendToPlayer(result.thief.id, {
          type: 'stealResult',
          success: result.success,
          amount: result.amount || 0,
        });
        if (result.success) {
          sendToPlayer(result.victim.id, {
            type: 'stolenFrom',
            thiefName: result.thief.name,
            amount: result.amount,
          });
        }
        const updated = [result.thief, result.victim].map(serializePublic);
        broadcast({ type: 'statUpdate', players: updated });
      } else {
        send(ws, { type: 'actionError', action: 'stealAttempt', reason: result.reason });
      }
      return;
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

// slowTick: individuelle Lebensuhr weiterlaufen lassen, plus Wirtschaft (Phase 3):
// Immobilien- und Firmen-Einnahmen abzueglich Instandhaltung/Unterhalt einziehen.
let lastSlowTick = Date.now();
setInterval(() => {
  const now = Date.now();
  const dt = now - lastSlowTick;
  lastSlowTick = now;

  world.ageConnectedPlayers(dt);
  world.removeStalePlayers();

  const repossessed = world.collectEconomyIncome();
  world.applyWealthTax();
  if (repossessed.length > 0) {
    broadcast(buildEconomyStateMessage());
    for (const { asset, player } of repossessed) {
      sendToPlayer(player.id, {
        type: 'propertyRepossessed',
        propertyId: asset.id,
        propertyName: asset.name,
      });
    }
  }

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

  const expiredTrades = world.checkExpiredTrades();
  for (const trade of expiredTrades) {
    const msg = {
      type: 'tradeResolved',
      tradeId: trade.id,
      accepted: false,
      timedOut: true,
      propertyId: trade.propertyId,
      price: trade.price,
    };
    sendToPlayer(trade.toPlayerId, msg);
    sendToPlayer(trade.fromPlayerId, msg);
  }

  world.decayWanted();

  const released = world.checkJailReleases();
  if (released.length > 0) {
    broadcast({ type: 'statUpdate', players: released.map(serializePublic) });
    for (const player of released) {
      sendToPlayer(player.id, { type: 'released' });
    }
  }
}, EVENT_TICK_MS);

// COPS_TICK: Polizei-NPCs bewegen sich in eigenem, fluessigerem Takt.
setInterval(() => {
  const arrests = world.updateCops(COPS_TICK_MS);
  broadcast({ type: 'copsState', cops: world.buildCopsState() });
  if (arrests.length > 0) {
    broadcast({ type: 'statUpdate', players: arrests.map(serializePublic) });
    for (const player of arrests) {
      sendToPlayer(player.id, { type: 'jailed', until: player.jailedUntil });
    }
  }
}, COPS_TICK_MS);

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
