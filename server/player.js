'use strict';

// server/player.js
// Definiert das Spielermodell sowie Funktionen zur Serialisierung
// für unterschiedliche Broadcast-Zwecke (voller State vs. Bewegungs-Delta).

const STARTING_CASH = 500;
const STARTING_HEALTH = 100;
const STARTING_HAPPINESS = 70;
const STARTING_SMARTS = 50;
const STARTING_LOOKS = 50;
const STARTING_AGE = 18;
const WORLD_WIDTH = 2000;
const WORLD_HEIGHT = 2000;

let nextPlayerId = 1;

/**
 * Erstellt ein neues Spielerobjekt mit Startwerten.
 * @param {string} name
 * @param {string} token - Reconnect-Token (wird niemals an andere Clients gesendet)
 */
function createPlayer(name, token) {
  const id = nextPlayerId++;
  return {
    id,
    token,
    name: name && String(name).trim() ? String(name).trim().slice(0, 20) : `Spieler${id}`,
    age: STARTING_AGE,
    ageProgress: 0,
    health: STARTING_HEALTH,
    happiness: STARTING_HAPPINESS,
    smarts: STARTING_SMARTS,
    looks: STARTING_LOOKS,
    cash: STARTING_CASH,
    bank: 0,
    debt: 0,
    job: null,
    education: null,
    criminalRecord: [],
    relationships: [],
    assets: [],
    position: { x: WORLD_WIDTH / 2, y: WORLD_HEIGHT / 2 },
    velocity: { x: 0, y: 0 },
    wanted: 0,
    lastSeen: Date.now(),
    connected: true,
    lastProcessedInput: 0,
    activeEvent: null,     // aktuell angezeigtes Lebensereignis (nie Teil von serializePublic)
    eventQueue: [],        // wartende Ereignisse, falls schon eins aktiv ist
    recentEventIds: [],    // Verlauf, um Wiederholungen kurzfristig zu vermeiden
    ws: null, // Laufzeitreferenz, wird niemals serialisiert
  };
}

/**
 * Vollständiger öffentlicher State eines Spielers (für slowTick / initialen Join).
 * Enthält niemals token oder ws.
 */
function serializePublic(player) {
  return {
    id: player.id,
    name: player.name,
    age: player.age,
    health: player.health,
    happiness: player.happiness,
    smarts: player.smarts,
    looks: player.looks,
    cash: player.cash,
    bank: player.bank,
    debt: player.debt,
    job: player.job,
    education: player.education,
    wanted: player.wanted,
    x: player.position.x,
    y: player.position.y,
    connected: player.connected,
  };
}

/**
 * Minimaler Bewegungs-State für hochfrequente fastTick-Deltas.
 */
function serializeMovement(player) {
  return {
    id: player.id,
    x: player.position.x,
    y: player.position.y,
    vx: player.velocity.x,
    vy: player.velocity.y,
  };
}

module.exports = {
  createPlayer,
  serializePublic,
  serializeMovement,
  WORLD_WIDTH,
  WORLD_HEIGHT,
};
