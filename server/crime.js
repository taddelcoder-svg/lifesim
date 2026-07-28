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

// --- Vorstrafen, Kaution, Bestechung, Anwalt ---
//
// Bisher war Kriminalitaet einseitig: der Taeter hatte drei Aktionen, konnte sein
// Risiko aber in keiner Weise steuern. `wanted` liess sich nur durch Zeit,
// Verhaftung oder Reinkarnation senken, und Gefaengnis waren 20 Sekunden reines
// Zusehen.
//
// Ausserdem war `criminalRecord` ein totes Feld: angelegt, bei Reinkarnation
// geleert, sonst nie beschrieben. Der Kommentar bei `maxWanted: 0` in jobs.js
// ("Vorstrafen sind hier ein Ausschlusskriterium") zeigt, dass da mal etwas
// geplant war. Jetzt sammelt das Feld tatsaechlich Eintraege - und je laenger
// die Liste, desto haerter die Strafe.
const JAIL_EXTRA_PER_RECORD_MS = 5000; // je Vorstrafe 5s laenger sitzen
const JAIL_MAX_DURATION_MS = 60000;    // Deckel: sonst waeren Wiederholungstaeter irgendwann minutenlang weg
const CRIMINAL_RECORD_LIMIT = 20;      // aeltere Eintraege fallen raus, damit die Liste nicht endlos waechst

// Kaution: sofort raus, Preis steigt mit der RESTZEIT - frueh rauskaufen ist
// teuer, kurz vor Ablauf fast umsonst. Dazu ein Aufschlag je Vorstrafe.
const BAIL_BASE_COST = 150;
const BAIL_COST_PER_SECOND = 25;
const BAIL_COST_PER_RECORD = 80;

// Bestechung: schnell, ueberall, aber illegal. Schlaegt sie fehl, wird es
// deutlich schlimmer als vorher - das ist der Preis fuer die Bequemlichkeit
// gegenueber dem Anwalt.
const BRIBE_COST_PER_WANTED = 200;
const BRIBE_SUCCESS_CHANCE = 0.55;
const BRIBE_WANTED_REDUCTION = 2;
const BRIBE_WANTED_ON_FAILURE = 2;
const BRIBE_COOLDOWN_MS = 30000;

// Anwalt: der legale Weg. Teuer, aber sicher und raeumt zusaetzlich die
// Vorstrafen ab. Der Haken ist die Ortsbindung an die Kanzlei - man muss mit
// laufender Fahndung quer durch die Stadt, vorbei an der Polizei.
const LAWYER_BASE_COST = 400;
const LAWYER_COST_PER_RECORD = 250;

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
  JAIL_EXTRA_PER_RECORD_MS,
  JAIL_MAX_DURATION_MS,
  CRIMINAL_RECORD_LIMIT,
  BAIL_BASE_COST,
  BAIL_COST_PER_SECOND,
  BAIL_COST_PER_RECORD,
  BRIBE_COST_PER_WANTED,
  BRIBE_SUCCESS_CHANCE,
  BRIBE_WANTED_REDUCTION,
  BRIBE_WANTED_ON_FAILURE,
  BRIBE_COOLDOWN_MS,
  LAWYER_BASE_COST,
  LAWYER_COST_PER_RECORD,
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
