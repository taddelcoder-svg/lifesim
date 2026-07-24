'use strict';

// server/crime.js
// Konstanten fuer das Kriminalitaetssystem: Diebstahl zwischen Spielern,
// Polizei-NPCs, die Fahndungslevel verfolgen, und Gefaengnis als Konsequenz.

const STEAL_RANGE = 100; // Server-Einheiten (px) - so nah muessen sich Dieb und Opfer sein
const STEAL_COOLDOWN_MS = 5000; // Sperre zwischen zwei Versuchen desselben Diebes
const STEAL_SUCCESS_CHANCE = 0.6;
const STEAL_MIN_PERCENT = 0.1;  // stiehlt mind. 10% des Bargelds des Opfers
const STEAL_MAX_PERCENT = 0.25; // hoechstens 25%
const STEAL_MAX_AMOUNT = 300;   // Deckel, damit reiche Opfer nicht auf einen Schlag ausgeraubt werden
const STEAL_WANTED_ON_ATTEMPT = 1;  // wird IMMER faellig (Risiko, gesehen zu werden)
const STEAL_WANTED_ON_SUCCESS_BONUS = 1; // zusaetzlich bei Erfolg

const POLICE_COUNT = 3;
const POLICE_CHASE_SPEED = 220;   // etwas schneller als Spieler (200) - macht Flucht riskant
const POLICE_PATROL_SPEED = 90;   // langsames Umherlaufen ohne Ziel
const POLICE_CATCH_RANGE = 50;    // so nah muss die Polizei kommen, um zu verhaften
const POLICE_CHASE_RANGE = 700;   // ab hier "sieht" die Polizei einen gesuchten Spieler

const JAIL_DURATION_MS = 20000;  // 20 Realsekunden Haft (narrativ: "ein paar Monate")
const JAIL_POSITION = { x: 100, y: 1900 }; // fester Ort in der Ecke der Karte

const WANTED_DECAY_INTERVAL_MS = 15000; // alle 15s ohne neue Straftat sinkt das Fahndungslevel
const WANTED_DECAY_AMOUNT = 1;

module.exports = {
  STEAL_RANGE,
  STEAL_COOLDOWN_MS,
  STEAL_SUCCESS_CHANCE,
  STEAL_MIN_PERCENT,
  STEAL_MAX_PERCENT,
  STEAL_MAX_AMOUNT,
  STEAL_WANTED_ON_ATTEMPT,
  STEAL_WANTED_ON_SUCCESS_BONUS,
  POLICE_COUNT,
  POLICE_CHASE_SPEED,
  POLICE_PATROL_SPEED,
  POLICE_CATCH_RANGE,
  POLICE_CHASE_RANGE,
  JAIL_DURATION_MS,
  JAIL_POSITION,
  WANTED_DECAY_INTERVAL_MS,
  WANTED_DECAY_AMOUNT,
};
