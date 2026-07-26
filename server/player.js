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
const { SPAWN_POSITION } = require('./world');

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
    job: null,             // Berufs-ID (z.B. 'office') oder null - Definition liegt in jobs.js
    jobLevel: 0,           // Stufe innerhalb der Karriereleiter
    jobXp: 0,              // gesammelte Berufserfahrung fuer die naechste Befoerderung
    education: null,       // ID des hoechsten abgeschlossenen Kurses, oder null
    enrolledCourse: null,  // ID des aktuell laufenden Kurses, oder null
    courseProgress: 0,     // gesammelte Lern-Ticks im laufenden Kurs
    criminalRecord: [],
    relationships: [],
    assets: [],
    position: { x: SPAWN_POSITION.x, y: SPAWN_POSITION.y },
    velocity: { x: 0, y: 0 },
    inputDir: { x: 0, y: 0 }, // gewuenschte Bewegungsrichtung, velocity naehert sich dem an
    lastInputAt: 0,           // Zeitstempel der letzten Eingabe, fuer das Bewegungs-Timeout
    vehicleId: null,          // ID des gefahrenen Fahrzeugs, oder null (zu Fuss)
    wanted: 0,
    lastSeen: Date.now(),
    connected: true,
    lastProcessedInput: 0,
    activeEvent: null,     // aktuell angezeigtes Lebensereignis (nie Teil von serializePublic)
    eventQueue: [],        // wartende Ereignisse, falls schon eins aktiv ist
    recentEventIds: [],    // Verlauf, um Wiederholungen kurzfristig zu vermeiden
    jailedUntil: null,     // Zeitstempel, bis wann der Spieler im Gefaengnis sitzt (oder null)
    lastCrimeAt: 0,        // Zeitstempel der letzten Straftat, fuer das Abklingen des Fahndungslevels
    lastStealAttemptAt: 0, // Cooldown gegen Diebstahl-Spam
    friends: [],           // IDs befreundeter Spieler (nie Teil von serializePublic - privat)
    spouseId: null,        // Ehepartner-ID, oder null
    pendingReincarnation: null, // gesetzt bei Tod: { heirChildId } - Spieler wartet auf Weiterleben-Aktion
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
    jobLevel: player.jobLevel,
    jobXp: player.jobXp,
    education: player.education,
    enrolledCourse: player.enrolledCourse,
    courseProgress: player.courseProgress,
    wanted: player.wanted,
    x: player.position.x,
    y: player.position.y,
    connected: player.connected,
    jailedUntil: player.jailedUntil,
    vehicleId: player.vehicleId,
    spouseId: player.spouseId,
    awaitingReincarnation: player.pendingReincarnation != null,
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

/**
 * Vollstaendiger interner State eines Spielers, fuer die persistente Speicherung
 * (nicht fuer Broadcasts an Clients!). Enthaelt ALLES ausser der Laufzeit-
 * Verbindungsreferenz - bewusst als generisches "alles ausser ws", damit neue
 * Felder in createPlayer() automatisch mitgespeichert werden, ohne diese
 * Funktion jedes Mal von Hand nachpflegen zu muessen.
 */
function serializeFull(player) {
  const { ws, ...rest } = player;
  return rest;
}

/** Stellt sicher, dass neu erzeugte Spieler-IDs nie mit wiederhergestellten kollidieren. */
function setNextPlayerId(n) {
  if (n > nextPlayerId) nextPlayerId = n;
}

module.exports = {
  createPlayer,
  serializePublic,
  serializeMovement,
  serializeFull,
  setNextPlayerId,
  WORLD_WIDTH,
  WORLD_HEIGHT,
  STARTING_CASH,
};
