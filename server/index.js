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
const { EMPLOYEE_WAGE_PER_TICK } = require('./economy');

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

/**
 * Traegt eine Stadtmeldung ein und schickt sie an alle. Eine Stelle, damit
 * kein Aufrufer das Verschicken vergisst - genau der Fehler, der beim
 * Vorstrafenregister an zwei Stellen passiert waere.
 */
function announce(kind, text) {
  broadcast({ type: 'newsItem', item: world.pushNews(kind, text) });
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

function buildFriendRequestMessage(request) {
  const fromPlayer = world.players.get(request.fromPlayerId);
  return {
    type: 'friendRequest',
    requestId: request.id,
    fromPlayerId: request.fromPlayerId,
    fromName: fromPlayer ? fromPlayer.name : 'Unbekannt',
  };
}

function buildMarriageRequestMessage(request) {
  const fromPlayer = world.players.get(request.fromPlayerId);
  return {
    type: 'marriageRequest',
    requestId: request.id,
    fromPlayerId: request.fromPlayerId,
    fromName: fromPlayer ? fromPlayer.name : 'Unbekannt',
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
        friends: result.player.friends.slice(),
      });
      if (result.reconnected && result.player.activeEvent) {
        // Spieler hatte beim Verbindungsabbruch noch ein offenes Ereignis - erneut zustellen
        send(ws, buildEventOfferMessage(result.player.activeEvent));
      }
      send(ws, { type: 'worldLayout', ...world.buildWorldLayoutState() });
      send(ws, buildEconomyStateMessage()); // aktueller Immobilienmarkt + Firmenliste sofort sichtbar
      send(ws, { type: 'copsState', cops: world.buildCopsState() });
      send(ws, { type: 'chatHistory', messages: world.buildChatHistory() });
      send(ws, { type: 'jobCatalog', jobs: world.buildJobCatalogState() });
      send(ws, { type: 'courseCatalog', courses: world.buildCourseCatalogState() });
      send(ws, { type: 'vehiclesState', ...world.buildVehiclesState() });
      send(ws, { type: 'bankState', ...world.buildBankState(result.player.id) });
      // Politischer Stand gehoert zum Beitritt: wer neu dazukommt, muss sehen,
      // ob gerade Wahl ist und wer regiert.
      send(ws, { type: 'politicsState', ...world.buildPoliticsState() });
      send(ws, { type: 'marketState', ...world.buildMarketState(result.player.id) });
      send(ws, { type: 'environmentState', ...world.buildEnvironmentState() });
      send(ws, { type: 'newsState', ...world.buildNewsState() });
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

    // --- Fahrzeuge: einsteigen, aussteigen, kaufen ---

    if (msg.type === 'enterVehicle' && ws.playerId != null) {
      const result = world.enterVehicle(ws.playerId, msg.vehicleId);
      if (result.ok) {
        sendToPlayer(ws.playerId, {
          type: 'vehicleEntered',
          vehicleId: result.vehicle.id,
          typeName: result.typeName,
          wasTheft: result.wasTheft,
        });
        broadcast({ type: 'vehiclesState', ...world.buildVehiclesState() });
        broadcast({ type: 'statUpdate', players: [serializePublic(world.players.get(ws.playerId))] });
      } else {
        send(ws, { type: 'actionError', action: 'enterVehicle', reason: result.reason });
      }
      return;
    }

    if (msg.type === 'exitVehicle' && ws.playerId != null) {
      const result = world.exitVehicle(ws.playerId);
      if (result.ok) {
        sendToPlayer(ws.playerId, { type: 'vehicleExited' });
        broadcast({ type: 'vehiclesState', ...world.buildVehiclesState() });
        broadcast({ type: 'statUpdate', players: [serializePublic(world.players.get(ws.playerId))] });
      } else {
        send(ws, { type: 'actionError', action: 'exitVehicle', reason: result.reason });
      }
      return;
    }

    if (msg.type === 'buyVehicle' && ws.playerId != null) {
      const result = world.buyVehicle(ws.playerId, msg.vehicleId);
      if (result.ok) {
        sendToPlayer(ws.playerId, {
          type: 'vehicleBought',
          vehicleId: result.vehicle.id,
          typeName: result.typeName,
          price: result.price,
        });
        broadcast({ type: 'vehiclesState', ...world.buildVehiclesState() });
        broadcast({ type: 'statUpdate', players: [serializePublic(world.players.get(ws.playerId))] });
      } else {
        send(ws, { type: 'actionError', action: 'buyVehicle', reason: result.reason });
      }
      return;
    }

    // --- Gesundheit & Freizeit: Krankenhaus, Fitnessstudio ---

    if (['treatHealth', 'relax'].includes(msg.type) && ws.playerId != null) {
      const result = world[msg.type](ws.playerId);
      if (result.ok) {
        send(ws, { type: 'wellbeingAction', action: msg.type, ...result });
        broadcast({ type: 'statUpdate', players: [serializePublic(world.players.get(ws.playerId))] });
      } else {
        send(ws, { type: 'actionError', action: msg.type, reason: result.reason });
      }
      return;
    }

    // --- Bank: Sparkonto und Kredite ---

    if (msg.type === 'requestBank' && ws.playerId != null) {
      send(ws, { type: 'bankState', ...world.buildBankState(ws.playerId) });
      return;
    }

    if (['deposit', 'withdraw', 'takeLoan', 'repayLoan'].includes(msg.type) && ws.playerId != null) {
      const fn = {
        deposit: 'depositToBank',
        withdraw: 'withdrawFromBank',
        takeLoan: 'takeLoan',
        repayLoan: 'repayLoan',
      }[msg.type];
      const result = world[fn](ws.playerId, msg.amount);
      if (result.ok) {
        send(ws, { type: 'bankState', ...world.buildBankState(ws.playerId) });
        send(ws, { type: 'bankAction', action: msg.type, amount: result.amount });
        broadcast({ type: 'statUpdate', players: [serializePublic(world.players.get(ws.playerId))] });
      } else {
        send(ws, { type: 'actionError', action: msg.type, reason: result.reason, limit: result.limit });
      }
      return;
    }

    // --- Firmen: Ausbau und Mitarbeiter ---

    if (msg.type === 'upgradeCompany' && ws.playerId != null) {
      const result = world.upgradeCompany(ws.playerId, msg.companyId);
      if (result.ok) {
        sendToPlayer(ws.playerId, { type: 'companyUpgraded', name: result.company.name, level: result.newLevel, cost: result.cost });
        broadcast(buildEconomyStateMessage());
        broadcast({ type: 'statUpdate', players: [serializePublic(world.players.get(ws.playerId))] });
      } else {
        send(ws, { type: 'actionError', action: 'upgradeCompany', reason: result.reason });
      }
      return;
    }

    if (msg.type === 'offerEmployment' && ws.playerId != null) {
      const result = world.offerEmployment(ws.playerId, msg.companyId, msg.toPlayerId);
      if (result.ok) {
        const owner = world.players.get(ws.playerId);
        sendToPlayer(msg.toPlayerId, {
          type: 'employmentOffer',
          offerId: result.offer.id,
          companyName: result.company.name,
          fromName: owner ? owner.name : 'Unbekannt',
          wage: EMPLOYEE_WAGE_PER_TICK,
          expiresAt: result.offer.expiresAt,
        });
        send(ws, { type: 'employmentOfferSent' });
      } else {
        send(ws, { type: 'actionError', action: 'offerEmployment', reason: result.reason });
      }
      return;
    }

    if (msg.type === 'respondEmployment' && ws.playerId != null) {
      const result = world.respondEmployment(ws.playerId, msg.offerId, !!msg.accept);
      if (result.ok) {
        const emp = world.players.get(ws.playerId);
        sendToPlayer(result.offer.fromPlayerId, {
          type: 'employmentResolved',
          accepted: result.accepted,
          employeeName: emp ? emp.name : 'Jemand',
        });
        sendToPlayer(ws.playerId, {
          type: 'employmentResolved',
          accepted: result.accepted,
          companyName: result.company ? result.company.name : '',
        });
        if (result.accepted) {
          broadcast(buildEconomyStateMessage());
          broadcast({ type: 'statUpdate', players: [serializePublic(emp)] });
        }
      } else {
        send(ws, { type: 'actionError', action: 'respondEmployment', reason: result.reason });
      }
      return;
    }

    if (msg.type === 'leaveEmployment' && ws.playerId != null) {
      const result = world.leaveEmployment(ws.playerId);
      if (result.ok) {
        sendToPlayer(ws.playerId, { type: 'employmentEnded', reason: 'quit', companyName: result.company ? result.company.name : '' });
        if (result.company) {
          const emp = world.players.get(ws.playerId);
          sendToPlayer(result.company.ownerId, { type: 'employeeQuit', employeeName: emp ? emp.name : 'Jemand', reason: 'quit' });
        }
        broadcast(buildEconomyStateMessage());
        broadcast({ type: 'statUpdate', players: [serializePublic(world.players.get(ws.playerId))] });
      } else {
        send(ws, { type: 'actionError', action: 'leaveEmployment', reason: result.reason });
      }
      return;
    }

    if (msg.type === 'dismissEmployee' && ws.playerId != null) {
      const result = world.dismissEmployee(ws.playerId, msg.companyId, msg.employeeId);
      if (result.ok) {
        sendToPlayer(result.employeeId, { type: 'employmentEnded', reason: 'dismissed', companyName: result.company.name });
        broadcast(buildEconomyStateMessage());
        const emp = world.players.get(result.employeeId);
        if (emp) broadcast({ type: 'statUpdate', players: [serializePublic(emp)] });
      } else {
        send(ws, { type: 'actionError', action: 'dismissEmployee', reason: result.reason });
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
        const buyer = world.players.get(ws.playerId);
        announce('economy', `${buyer.name} hat "${result.property.name}" erworben.`);
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

    // --- Rechtliches: Kaution, Bestechung, Anwalt ---

    if (['postBail', 'bribePolice', 'hireLawyer'].includes(msg.type) && ws.playerId != null) {
      const result = world[msg.type](ws.playerId);
      if (result.ok) {
        send(ws, {
          type: 'legalAction',
          action: msg.type,
          cost: result.cost,
          success: result.success !== false,
          cleared: result.cleared,
        });
        // Fahndungslevel und Haftstatus sehen auch die anderen - die Rangliste
        // sortiert danach, und die Polizei-Anzeige haengt daran.
        broadcast({ type: 'statUpdate', players: [serializePublic(result.player)] });
      } else {
        send(ws, { type: 'actionError', action: msg.type, reason: result.reason });
      }
      return;
    }

    if (msg.type === 'buyNewVehicle' && ws.playerId != null) {
      const result = world.buyNewVehicle(ws.playerId, msg.typeId);
      if (result.ok) {
        send(ws, {
          type: 'vehicleBought',
          vehicleId: result.vehicle.id,
          typeName: result.typeName,
          price: result.price,
        });
        // Vollstaendiger Fahrzeugzustand an ALLE: das Auto ist neu und den
        // anderen Clients sonst unbekannt - ein blosses Delta wuerde ins Leere
        // laufen, weil sie das Fahrzeug gar nicht kennen.
        broadcast({ type: 'vehiclesState', ...world.buildVehiclesState() });
        broadcast({ type: 'statUpdate', players: [serializePublic(world.players.get(ws.playerId))] });
      } else {
        send(ws, { type: 'actionError', action: 'buyNewVehicle', reason: result.reason });
      }
      return;
    }

    // --- Boerse: Kauf und Verkauf ---

    if (['buyShares', 'sellShares'].includes(msg.type) && ws.playerId != null) {
      const result = msg.type === 'buyShares'
        ? world.buyShares(ws.playerId, msg.symbol, msg.shares)
        : world.sellShares(ws.playerId, msg.symbol, msg.shares);
      if (result.ok) {
        send(ws, {
          type: 'marketAction',
          action: msg.type,
          symbol: result.symbol,
          shares: result.shares,
          cost: result.cost,
          payout: result.payout,
          capped: !!result.capped,
        });
        // Kurse aendern sich durch den Handel - das betrifft alle. Der eigene
        // Bestand geht nur an den Handelnden.
        send(ws, { type: 'marketState', ...world.buildMarketState(ws.playerId) });
        for (const client of wss.clients) {
          if (client !== ws && client.playerId != null && client.readyState === 1) {
            send(client, { type: 'marketState', ...world.buildMarketState(client.playerId) });
          }
        }
        broadcast({ type: 'statUpdate', players: [serializePublic(result.player)] });
      } else {
        send(ws, { type: 'actionError', action: msg.type, reason: result.reason });
      }
      return;
    }

    // --- Politik: Kandidatur, Stimme, Steuersatz ---

    if (['runForMayor', 'castVote', 'setTaxRate'].includes(msg.type) && ws.playerId != null) {
      const result = msg.type === 'runForMayor'
        ? world.runForMayor(ws.playerId)
        : msg.type === 'castVote'
          ? world.castVote(ws.playerId, msg.candidateId)
          : world.setTaxRate(ws.playerId, msg.rate);
      if (result.ok) {
        send(ws, { type: 'politicsAction', action: msg.type, fee: result.fee, taxRate: result.taxRate });
        // Kandidatenliste, Stimmenstand und Steuersatz betreffen alle.
        broadcast({ type: 'politicsState', ...world.buildPoliticsState() });
        broadcast({ type: 'statUpdate', players: [serializePublic(result.player)] });
      } else {
        send(ws, { type: 'actionError', action: msg.type, reason: result.reason });
      }
      return;
    }

    if (['buyAlarm', 'setInsurance'].includes(msg.type) && ws.playerId != null) {
      const result = msg.type === 'buyAlarm'
        ? world.buyAlarm(ws.playerId, msg.propertyId)
        : world.setInsurance(ws.playerId, msg.propertyId, !!msg.on);
      if (result.ok) {
        send(ws, {
          type: 'protectionChanged',
          action: msg.type,
          propertyName: result.property.name,
          cost: result.cost,
          premium: result.premium,
          insured: result.insured,
        });
        // Schutzstatus gehoert in den Wirtschaftszustand: potenzielle Einbrecher
        // sollen SEHEN, dass ein Objekt gesichert ist - sonst waere die
        // Abschreckung wirkungslos und die Anlage reine Gluecksache.
        broadcast(buildEconomyStateMessage());
        broadcast({ type: 'statUpdate', players: [serializePublic(world.players.get(ws.playerId))] });
      } else {
        send(ws, { type: 'actionError', action: msg.type, reason: result.reason });
      }
      return;
    }

    if (msg.type === 'burgle' && ws.playerId != null) {
      const result = world.attemptBurglary(ws.playerId, msg.propertyId);
      if (result.ok) {
        if (result.success) {
          announce('crime', `Einbruch in "${result.property.name}".`);
        } else if (result.alarmTriggered) {
          announce('police', `Alarmanlage in "${result.property.name}" hat einen Einbruch verhindert.`);
        }
        sendToPlayer(result.burglar.id, {
          type: 'burglaryResult',
          success: result.success,
          loot: result.loot || 0,
          propertyName: result.property.name,
          alarmTriggered: !!result.alarmTriggered,
        });
        if (result.success && result.owner) {
          sendToPlayer(result.owner.id, {
            type: 'burgledFrom',
            propertyName: result.property.name,
            loot: result.loot,
            payout: result.payout || 0,
          });
        } else if (!result.success && result.alarmTriggered && result.owner) {
          // Auch der VERSUCH wird gemeldet, wenn eine Anlage anschlaegt - sonst
          // merkt der Besitzer nie, dass sich das Geld gelohnt hat.
          sendToPlayer(result.owner.id, {
            type: 'alarmTriggered',
            propertyName: result.property.name,
          });
        }
        // Der Ertragsausfall gehoert in den Wirtschaftszustand, damit ALLE
        // sehen, dass das Objekt gerade nichts abwirft - auch die, die es
        // gerade kaufen wollten.
        broadcast(buildEconomyStateMessage());
        broadcast({ type: 'statUpdate', players: [serializePublic(result.burglar)] });
      } else {
        send(ws, { type: 'actionError', action: 'burgle', reason: result.reason });
      }
      return;
    }

    if (msg.type === 'robBank' && ws.playerId != null) {
      const result = world.attemptBankRobbery(ws.playerId);
      if (result.ok) {
        if (result.success) {
          announce('crime', `Überfall auf den Banktresor — $${result.loot} erbeutet.`);
        } else {
          announce('police', 'Ein Überfall auf die Bankfiliale ist gescheitert.');
        }
        sendToPlayer(result.player.id, {
          type: 'robberyResult',
          success: result.success,
          loot: result.loot || 0,
          jailed: !!result.jailed,
        });
        if (result.jailed) {
          sendToPlayer(result.player.id, { type: 'jailed', until: result.player.jailedUntil });
        }
        broadcast({ type: 'statUpdate', players: [serializePublic(result.player)] });
      } else {
        send(ws, { type: 'actionError', action: 'robBank', reason: result.reason });
      }
      return;
    }

    // --- Soziales: Chat, Freundschaften, Rangliste ---

    if (msg.type === 'chatMessage' && ws.playerId != null) {
      const result = world.sendChatMessage(ws.playerId, msg.text);
      if (result.ok) {
        broadcast({ type: 'chatMessage', message: result.message });
      } else {
        send(ws, { type: 'actionError', action: 'chatMessage', reason: result.reason });
      }
      return;
    }

    if (msg.type === 'proposeFriendship' && ws.playerId != null) {
      const result = world.proposeFriendship(ws.playerId, msg.toPlayerId);
      if (result.ok) {
        sendToPlayer(msg.toPlayerId, buildFriendRequestMessage(result.request));
        send(ws, { type: 'friendRequestSent', requestId: result.request.id });
      } else {
        send(ws, { type: 'actionError', action: 'proposeFriendship', reason: result.reason });
      }
      return;
    }

    if (msg.type === 'respondFriendRequest' && ws.playerId != null) {
      const result = world.respondFriendRequest(ws.playerId, msg.requestId, !!msg.accept);
      if (result.ok) {
        const resolvedMsg = {
          type: 'friendResolved',
          requestId: result.request.id,
          accepted: result.accepted,
          otherPlayerId: result.accepted ? result.request.fromPlayerId : null,
        };
        sendToPlayer(result.request.fromPlayerId, {
          ...resolvedMsg,
          otherPlayerId: result.accepted ? result.request.toPlayerId : null,
        });
        sendToPlayer(result.request.toPlayerId, {
          ...resolvedMsg,
          otherPlayerId: result.accepted ? result.request.fromPlayerId : null,
        });

        // Die Freundesliste ging bisher NUR beim Beitritt raus (im 'welcome')
        // und wurde nie aktualisiert - nach einer neuen Freundschaft war sie im
        // Client bis zum naechsten Verbindungsaufbau veraltet. Jetzt bekommen
        // beide Seiten ihren aktuellen Stand.
        if (result.accepted) {
          for (const id of [result.request.fromPlayerId, result.request.toPlayerId]) {
            const p = world.players.get(id);
            if (p) sendToPlayer(id, { type: 'friendList', friends: p.friends.slice() });
          }
        }
      } else {
        send(ws, { type: 'actionError', action: 'respondFriendRequest', reason: result.reason });
      }
      return;
    }

    if (msg.type === 'requestLeaderboard' && ws.playerId != null) {
      send(ws, { type: 'leaderboard', ...world.buildLeaderboards() });
      return;
    }

    // --- Familie: Ehe, Kinder, Wiedergeburt ---

    if (msg.type === 'proposeMarriage' && ws.playerId != null) {
      const result = world.proposeMarriage(ws.playerId, msg.toPlayerId);
      if (result.ok) {
        sendToPlayer(msg.toPlayerId, buildMarriageRequestMessage(result.request));
        send(ws, { type: 'marriageRequestSent', requestId: result.request.id });
      } else {
        send(ws, { type: 'actionError', action: 'proposeMarriage', reason: result.reason });
      }
      return;
    }

    if (msg.type === 'respondMarriageRequest' && ws.playerId != null) {
      const result = world.respondMarriageRequest(ws.playerId, msg.requestId, !!msg.accept);
      if (result.ok) {
        if (result.accepted) {
          const one = world.players.get(result.request.fromPlayerId);
          const two = world.players.get(result.request.toPlayerId);
          if (one && two) announce('life', `${one.name} und ${two.name} haben geheiratet.`);
        }
        const resolvedBase = { type: 'marriageResolved', requestId: result.request.id, accepted: result.accepted };
        sendToPlayer(result.request.fromPlayerId, { ...resolvedBase, otherPlayerId: result.accepted ? result.request.toPlayerId : null });
        sendToPlayer(result.request.toPlayerId, { ...resolvedBase, otherPlayerId: result.accepted ? result.request.fromPlayerId : null });
        if (result.accepted) {
          const fromP = world.players.get(result.request.fromPlayerId);
          const toP = world.players.get(result.request.toPlayerId);
          broadcast({ type: 'statUpdate', players: [fromP, toP].filter(Boolean).map(serializePublic) });
        }
      } else {
        send(ws, { type: 'actionError', action: 'respondMarriageRequest', reason: result.reason });
      }
      return;
    }

    if (msg.type === 'divorce' && ws.playerId != null) {
      const result = world.divorce(ws.playerId);
      if (result.ok) {
        const player = world.players.get(ws.playerId);
        const exSpouse = world.players.get(result.exSpouseId);
        sendToPlayer(ws.playerId, { type: 'divorced' });
        if (exSpouse) sendToPlayer(exSpouse.id, { type: 'divorced' });
        broadcast({ type: 'statUpdate', players: [player, exSpouse].filter(Boolean).map(serializePublic) });
      } else {
        send(ws, { type: 'actionError', action: 'divorce', reason: result.reason });
      }
      return;
    }

    if (msg.type === 'haveChild' && ws.playerId != null) {
      const result = world.haveChild(ws.playerId, msg.name);
      if (result.ok) {
        const player = world.players.get(ws.playerId);
        const spouse = player.spouseId != null ? world.players.get(player.spouseId) : null;
        announce('life', `Nachwuchs in der Stadt: ${result.child.name} wurde geboren.`);
        const bornMsg = { type: 'childBorn', child: result.child };
        sendToPlayer(ws.playerId, bornMsg);
        if (spouse) sendToPlayer(spouse.id, bornMsg);
        broadcast({ type: 'statUpdate', players: [player, spouse].filter(Boolean).map(serializePublic) });
      } else {
        send(ws, { type: 'actionError', action: 'haveChild', reason: result.reason });
      }
      return;
    }

    if (msg.type === 'requestFamily' && ws.playerId != null) {
      send(ws, { type: 'familyState', children: world.buildChildrenForPlayer(ws.playerId) });
      return;
    }

    // --- Beruf: Bewerben, Kuendigen, Katalog ---

    if (msg.type === 'requestJobs' && ws.playerId != null) {
      send(ws, { type: 'jobCatalog', jobs: world.buildJobCatalogState() });
      return;
    }

    if (msg.type === 'applyForJob' && ws.playerId != null) {
      const result = world.applyForJob(ws.playerId, msg.jobId);
      if (result.ok) {
        sendToPlayer(ws.playerId, {
          type: 'jobStarted',
          jobName: result.jobName,
          title: result.title,
          salary: result.salary,
        });
        broadcast({ type: 'statUpdate', players: [serializePublic(world.players.get(ws.playerId))] });
      } else {
        send(ws, { type: 'actionError', action: 'applyForJob', reason: result.reason });
      }
      return;
    }

    if (msg.type === 'quitJob' && ws.playerId != null) {
      const result = world.quitJob(ws.playerId);
      if (result.ok) {
        sendToPlayer(ws.playerId, { type: 'jobQuit' });
        broadcast({ type: 'statUpdate', players: [serializePublic(world.players.get(ws.playerId))] });
      } else {
        send(ws, { type: 'actionError', action: 'quitJob', reason: result.reason });
      }
      return;
    }

    // --- Bildung: Kurse belegen ---

    if (msg.type === 'requestCourses' && ws.playerId != null) {
      send(ws, { type: 'courseCatalog', courses: world.buildCourseCatalogState() });
      return;
    }

    if (msg.type === 'enrollInCourse' && ws.playerId != null) {
      const result = world.enrollInCourse(ws.playerId, msg.courseId);
      if (result.ok) {
        const player = world.players.get(ws.playerId);
        sendToPlayer(ws.playerId, {
          type: 'courseEnrolled',
          courseName: result.course.name,
          requiredTicks: world.requiredTicksFor(player, result.course),
        });
        broadcast({ type: 'statUpdate', players: [serializePublic(player)] });
      } else {
        send(ws, { type: 'actionError', action: 'enrollInCourse', reason: result.reason });
      }
      return;
    }

    if (msg.type === 'dropCourse' && ws.playerId != null) {
      const result = world.dropCourse(ws.playerId);
      if (result.ok) {
        sendToPlayer(ws.playerId, { type: 'courseDropped' });
        broadcast({ type: 'statUpdate', players: [serializePublic(world.players.get(ws.playerId))] });
      } else {
        send(ws, { type: 'actionError', action: 'dropCourse', reason: result.reason });
      }
      return;
    }

    if (msg.type === 'reincarnate' && ws.playerId != null) {
      const result = world.reincarnate(ws.playerId);
      if (result.ok) {
        send(ws, {
          type: 'reincarnated',
          name: result.player.name,
          becameChild: result.becameChild,
          cash: result.player.cash,
        });
        broadcast({ type: 'statUpdate', players: [serializePublic(result.player)] });
      } else {
        send(ws, { type: 'actionError', action: 'reincarnate', reason: result.reason });
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

  // Positionen der GEFAHRENEN Fahrzeuge mitsenden - geparkte aendern sich nicht
  // und wuerden nur unnoetig Bandbreite kosten.
  const movingVehicles = [...world.vehicles.values()]
    .filter((v) => v.driverId != null)
    .map((v) => ({ id: v.id, x: v.x, y: v.y }));
  if (movingVehicles.length > 0) {
    broadcast({ type: 'vehicleDelta', vehicles: movingVehicles });
  }
}, FAST_TICK_MS);

// slowTick: individuelle Lebensuhr weiterlaufen lassen, plus Wirtschaft (Phase 3):
// Immobilien- und Firmen-Einnahmen abzueglich Instandhaltung/Unterhalt einziehen.
let lastSlowTick = Date.now();
setInterval(() => {
  const now = Date.now();
  const dt = now - lastSlowTick;
  lastSlowTick = now;

  // Wahlphase/Amtszeit voranbringen. Meldet nur etwas, wenn ein Wechsel
  // stattgefunden hat - sonst laege bei jedem Tick ein Broadcast an.
  // Tageszeit/Wetter: der Zustand wird bei jedem slowTick geschickt. Der Client
  // koennte die Tageszeit zwar selbst aus der Uhr ableiten, aber massgeblich ist
  // der Server (Grundprinzip 1) - und das Wetter kennt er ohnehin nur von dort.
  world.updateWeather();
  broadcast({ type: 'environmentState', ...world.buildEnvironmentState() });

  // Kurse bewegen sich mit jedem Wirtschaftszyklus.
  world.stepMarket();
  for (const client of wss.clients) {
    if (client.playerId != null && client.readyState === 1) {
      send(client, { type: 'marketState', ...world.buildMarketState(client.playerId) });
    }
  }

  const politicsEvent = world.advancePolitics();
  if (politicsEvent) {
    broadcast({ type: 'politicsState', ...world.buildPoliticsState() });
    broadcast({ type: 'politicsEvent', ...politicsEvent });
    if (politicsEvent.type === 'elected') {
      announce('politics', `${politicsEvent.mayorName} wurde mit ${politicsEvent.votes} Stimmen zum Bürgermeister gewählt.`);
    } else if (politicsEvent.type === 'no_mayor') {
      announce('politics', 'Die Wahl brachte keine Mehrheit — das Amt bleibt unbesetzt.');
    } else {
      announce('politics', 'Ein neuer Wahlkampf hat begonnen.');
    }
  }

  world.ageConnectedPlayers(dt);
  world.applyHealthAndHappinessDecay();
  world.removeStalePlayers();

  // Gehaelter BEWUSST vor der Vermoegenssteuer, damit das frische Gehalt
  // im selben Tick korrekt mitversteuert wird (statt einen Tick "steuerfrei" zu sein).
  const promotions = world.payAndProgressJobs();
  for (const { player, jobName, newTitle, newSalary } of promotions) {
    sendToPlayer(player.id, {
      type: 'jobPromotion',
      jobName,
      newTitle,
      newSalary,
    });
  }

  const completions = world.progressCourses();
  for (const { player, courseName, smartsGained, newSmarts } of completions) {
    sendToPlayer(player.id, {
      type: 'courseCompleted',
      courseName,
      smartsGained,
      newSmarts,
    });
  }

  const { repossessed, quits } = world.collectEconomyIncome();
  for (const q of quits) {
    sendToPlayer(q.employee.id, { type: 'employmentEnded', reason: 'unpaid', companyName: q.company.name });
    sendToPlayer(q.company.ownerId, { type: 'employeeQuit', employeeName: q.employee.name, reason: 'unpaid' });
  }
  if (quits.length > 0) broadcast(buildEconomyStateMessage());

  // Bankzinsen VOR der Steuer: sonst waeren frisch gutgeschriebene Zinsen
  // einen Zyklus lang steuerfrei.
  const bankEvents = world.applyBankInterest();
  for (const ev of bankEvents) {
    if (ev.type === 'foreclosure') {
      sendToPlayer(ev.player.id, {
        type: 'foreclosure',
        propertyName: ev.property.name,
      });
      broadcast(buildEconomyStateMessage());
    }
  }

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

  for (const offer of world.checkExpiredEmploymentOffers()) {
    sendToPlayer(offer.toPlayerId, { type: 'employmentOfferExpired', offerId: offer.id });
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

  const deaths = world.checkDeaths();
  if (deaths.length > 0) {
    broadcast({ type: 'statUpdate', players: deaths.map((d) => serializePublic(d.player)) });
    for (const { player, spouse, heirChild } of deaths) {
      announce('life', `${player.name} ist im Alter von ${player.age} Jahren gestorben.`);
      sendToPlayer(player.id, {
        type: 'died',
        hasHeir: !!heirChild,
        heirName: heirChild ? heirChild.name : null,
        hadSpouse: !!spouse,
      });
      if (spouse) {
        sendToPlayer(spouse.id, { type: 'widowed', exPartnerName: player.name });
        broadcast({ type: 'statUpdate', players: [serializePublic(spouse)] });
      }
    }
  }
}, EVENT_TICK_MS);

// COPS_TICK: Polizei-NPCs bewegen sich in eigenem, fluessigerem Takt.
setInterval(() => {
  const arrests = world.updateCops(COPS_TICK_MS);
  broadcast({ type: 'copsState', cops: world.buildCopsState() });
  if (arrests.length > 0) {
    broadcast({ type: 'statUpdate', players: arrests.map(serializePublic) });
    for (const p of arrests) announce('police', `${p.name} wurde von der Polizei verhaftet.`);
    for (const player of arrests) {
      sendToPlayer(player.id, { type: 'jailed', until: player.jailedUntil });
    }
  }
}, COPS_TICK_MS);

// Persistenz: kompletter Weltzustand periodisch UND beim Beenden gespeichert.
// Ohne das "beim Beenden speichern" waere bei jedem Server-Neustart (z.B. jedes
// Render-Deploy sendet SIGTERM) der Fortschritt seit dem letzten periodischen
// Speichern verloren - das deckt die Luecke ab.
function saveSnapshotNow() {
  try {
    fs.writeFileSync(SNAPSHOT_PATH, JSON.stringify(world.buildFullSnapshot(), null, 2));
  } catch (err) {
    console.error('Snapshot fehlgeschlagen:', err.message);
  }
}

setInterval(saveSnapshotNow, SNAPSHOT_INTERVAL_MS);

function shutdownGracefully(signal) {
  console.log(`${signal} erhalten - speichere Weltzustand vor dem Beenden...`);
  saveSnapshotNow();
  process.exit(0);
}
process.on('SIGTERM', () => shutdownGracefully('SIGTERM'));
process.on('SIGINT', () => shutdownGracefully('SIGINT'));

// Beim Start: falls ein frueherer Weltzustand auf Disk liegt, wiederherstellen -
// sonst waere nach jedem Neustart der komplette Fortschritt aller Spieler weg.
try {
  if (fs.existsSync(SNAPSHOT_PATH)) {
    const saved = JSON.parse(fs.readFileSync(SNAPSHOT_PATH, 'utf8'));
    const restoredCount = world.restoreFromSnapshot(saved);
    console.log(`Weltzustand wiederhergestellt: ${restoredCount} Spieler.`);
  } else {
    console.log('Kein vorheriger Weltzustand gefunden - starte mit leerer Welt.');
  }
} catch (err) {
  console.error('Weltzustand konnte nicht geladen werden, starte mit leerer Welt:', err.message);
}

server.listen(PORT, () => {
  console.log(`Server läuft auf http://localhost:${PORT}`);
});
