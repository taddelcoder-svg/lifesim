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

// --- Einbruch in fremde Immobilien ---
//
// Taschendiebstahl (oben) greift nur auf BARGELD zu und ist bei 300 gedeckelt.
// Im spaeten Spiel liegt Vermoegen laengst auf der Bank (diebstahlsicher) und in
// Immobilien - erfolgreiche Spieler waren damit als Ziel uninteressant, und
// Kriminalitaet verlor genau dann an Sinn, wenn Wirtschaft interessant wurde.
// Der Einbruch schliesst die Luecke, indem er den ERTRAGSSTROM angreift statt
// gespeichertes Geld.
//
// WICHTIG - kein Geld aus dem Nichts: Die Beute entspricht exakt dem Ertrag, den
// die Immobilie waehrend der Ausfallzeit gebracht haette. Der Besitzer verliert
// genau das, was der Einbrecher bekommt; die Geldmenge bleibt unveraendert.
const BURGLARY_RANGE = 120;            // so nah muss man an der Immobilie stehen
const BURGLARY_COOLDOWN_MS = 30000;    // deutlich laenger als beim Taschendiebstahl (5s)
const BURGLARY_SUCCESS_CHANCE = 0.45;  // niedriger als Taschendiebstahl (0,6) - hoehere Beute
const BURGLARY_DISABLE_MS = 60000;     // 60s = 6 slowTicks Ertragsausfall fuer den Besitzer
const BURGLARY_WANTED_ON_ATTEMPT = 2;
const BURGLARY_WANTED_ON_SUCCESS_BONUS = 1;

// --- Bankueberfall ---
//
// Der Tresor wird aus der Vermoegenssteuer gespeist (siehe VAULT_TAX_SHARE):
// bisher verschwand das eingezogene Geld ersatzlos. Jetzt sammelt sich ein Teil
// davon sichtbar an und wird zur Beute - auch hier entsteht KEIN neues Geld,
// es kehrt nur bereits eingezogenes in den Umlauf zurueck.
const VAULT_TAX_SHARE = 0.5;           // Anteil der Steuer, der im Tresor landet
const ROBBERY_COOLDOWN_MS = 120000;    // 2 Minuten zwischen zwei Versuchen desselben Spielers
const ROBBERY_SUCCESS_CHANCE = 0.3;    // klar riskanter als alles andere
const ROBBERY_LOOT_SHARE = 0.5;        // erbeutet die Haelfte des Tresors, nicht alles
const ROBBERY_MIN_VAULT = 200;         // darunter lohnt der Ueberfall nicht und wird abgelehnt
const ROBBERY_WANTED_ON_ATTEMPT = 3;
const ROBBERY_WANTED_ON_SUCCESS_BONUS = 2;
const ROBBERY_JAIL_ON_FAILURE = true;  // Fehlschlag heisst SOFORT Gefaengnis, nicht nur Fahndung

module.exports = {
  STEAL_RANGE,
  STEAL_COOLDOWN_MS,
  STEAL_SUCCESS_CHANCE,
  STEAL_MIN_PERCENT,
  STEAL_MAX_PERCENT,
  STEAL_MAX_AMOUNT,
  STEAL_WANTED_ON_ATTEMPT,
  STEAL_WANTED_ON_SUCCESS_BONUS,
  BURGLARY_RANGE,
  BURGLARY_COOLDOWN_MS,
  BURGLARY_SUCCESS_CHANCE,
  BURGLARY_DISABLE_MS,
  BURGLARY_WANTED_ON_ATTEMPT,
  BURGLARY_WANTED_ON_SUCCESS_BONUS,
  VAULT_TAX_SHARE,
  ROBBERY_COOLDOWN_MS,
  ROBBERY_SUCCESS_CHANCE,
  ROBBERY_LOOT_SHARE,
  ROBBERY_MIN_VAULT,
  ROBBERY_WANTED_ON_ATTEMPT,
  ROBBERY_WANTED_ON_SUCCESS_BONUS,
  ROBBERY_JAIL_ON_FAILURE,
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
