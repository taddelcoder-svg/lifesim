'use strict';

// server/blackmarket.js
// Schwarzmarkt. Die Kriminalitaet hatte bisher nur Werkzeuge zum ENTKOMMEN
// (Kaution, Bestechung, Anwalt) - keins zum VORBEREITEN. Man konnte sein Risiko
// nachtraeglich verwalten, aber nicht im Vorhinein senken.
//
// Alle drei Waren greifen an einer Stelle an, die es schon gibt, statt eine neue
// Mechanik aufzumachen:
//
//   Dietrich          -> die Erfolgschance beim Einbruch
//   Polizeiscanner    -> eine Information, die der Server bewusst NICHT sendet
//   Gefaelschte Papiere -> das Fahndungslevel, wie Bestechung und Anwalt
//
// Der Scanner ist der interessanteste Fall: buildCopsState() schickt nur
// Position und ID der Polizisten, nie ihr Ziel. Man sieht also, wo sie sind,
// erfaehrt aber nie, ob einer die Verfolgung aufgenommen hat. Diese Information
// an ALLE zu senden waere falsch - dann wuesste jeder, wer gerade gejagt wird.
// Der Scanner liefert sie ausschliesslich seinem Besitzer.

// Einkauf hier ist selbst strafbar: mit dieser Wahrscheinlichkeit wird man
// dabei beobachtet und das Fahndungslevel steigt. Der Kauf gelingt trotzdem -
// es ist ein Aufpreis in Risiko, kein Verlust des Geldes.
const BUST_CHANCE = 0.15;
const BUST_WANTED = 1;

// `consumable: true` = wird bei Gebrauch verbraucht. `false` = dauerhaft.
//
// Der Dietrich ist bewusst VERBRAUCHBAR: eine dauerhaft erhoehte
// Einbruchschance waere eine einmalige Anschaffung, nach der das Risiko
// dauerhaft niedriger liegt. Als Verbrauchsgut skaliert der Preis mit der
// Aktivitaet - wer viel einbricht, zahlt viel.
const ITEMS = [
  {
    id: 'lockpick',
    name: 'Dietrich',
    price: 250,
    consumable: true,
    // Ersetzt die normale Erfolgschance (0,45 ohne Alarm / 0,2 mit).
    burglaryChance: 0.7,
    burglaryChanceAlarmed: 0.4,
    description: 'Erhöht die Einbruchschance deutlich. Wird pro Versuch verbraucht.',
  },
  {
    id: 'scanner',
    name: 'Polizeiscanner',
    price: 600,
    consumable: false,
    description: 'Warnt, sobald die Polizei die Verfolgung aufnimmt.',
  },
  {
    id: 'papers',
    name: 'Gefälschte Papiere',
    price: 500,
    consumable: true,
    // Setzt die Fahndung sofort auf 0 - ohne Weg, ohne Risiko, aber teurer als
    // eine Bestechung und ohne die Vorstrafen zu loeschen (das kann nur der
    // Anwalt). Damit hat jeder der drei Wege seinen eigenen Platz.
    description: 'Setzt die Fahndung sofort auf 0. Vorstrafen bleiben.',
  },
];

function findItem(id) {
  return ITEMS.find((i) => i.id === id) || null;
}

/** Katalog fuer den Client. */
function buildItemCatalog() {
  return ITEMS.map((i) => ({
    id: i.id,
    name: i.name,
    price: i.price,
    consumable: i.consumable,
    description: i.description,
  }));
}

module.exports = {
  ITEMS,
  BUST_CHANCE,
  BUST_WANTED,
  findItem,
  buildItemCatalog,
};
