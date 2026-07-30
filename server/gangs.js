'use strict';

// server/gangs.js
// Banden. Das Spiel hatte bisher Freundschaft (bremst den Zufriedenheitsverfall)
// und Ehe (Erbe), aber keine Struktur, in der mehrere Spieler ein gemeinsames
// wirtschaftliches Interesse haben. Man spielte nebeneinander.
//
// KEIN KAMPF. Es gibt im ganzen Spiel keinen Spieler-gegen-Spieler-Kampf - der
// einzige Schaden entsteht ueber Diebstahl und Einbruch, und die Polizei ist der
// einzige Gegner. Ein Bandenkrieg mit Waffen waere ein voellig neues System.
// Territorium laeuft deshalb ueber GELD: beanspruchen kostet, halten kostet
// laufend, und wer nicht mehr zahlen kann, verliert es. Das erzeugt Wechsel
// ohne eine einzige neue Kampfmechanik.

// Gruendung kostet - sonst gibt es zwanzig Ein-Mann-Banden.
const GANG_FOUNDING_COST = 1500;
const MAX_GANG_MEMBERS = 5;
const MAX_GANG_NAME_LENGTH = 24;

// --- Territorium ---
//
// Die Welt wird in vier Quadranten geteilt. Bewusst grob: bei 2800x2800 ist ein
// Quadrant 1400x1400 gross und enthaelt mehrere Immobilien und Orte, ein
// feineres Raster waere unuebersichtlich und die Kontrolle bedeutungslos.
const QUADRANTS = [
  { id: 'nw', name: 'Nordwest' },
  { id: 'ne', name: 'Nordost' },
  { id: 'sw', name: 'Südwest' },
  { id: 'se', name: 'Südost' },
];

// Einmalige Beanspruchung plus laufende Kosten aus der Bandenkasse. Kann die
// Kasse den Unterhalt nicht mehr tragen, faellt das Gebiet zurueck - so
// entsteht Wechsel, ohne dass jemand jemanden angreifen muesste.
const TERRITORY_CLAIM_COST = 2000;
const TERRITORY_UPKEEP_PER_TICK = 25;

// Wirkung: Einbrueche im eigenen Gebiet bringen mehr. Bewusst NUR die Beute und
// nicht die Erfolgschance - sonst waere Kontrolle ein Freibrief statt eines
// Vorteils, und der Wert von Alarmanlagen (die an der Chance ansetzen) waere
// entwertet.
const TERRITORY_LOOT_BONUS = 0.25;

/** In welchem Quadranten liegt dieser Punkt? worldSize wird hereingereicht. */
function quadrantAt(x, y, worldSize) {
  const half = worldSize / 2;
  if (y < half) return x < half ? 'nw' : 'ne';
  return x < half ? 'sw' : 'se';
}

function findQuadrant(id) {
  return QUADRANTS.find((q) => q.id === id) || null;
}

module.exports = {
  GANG_FOUNDING_COST,
  MAX_GANG_MEMBERS,
  MAX_GANG_NAME_LENGTH,
  QUADRANTS,
  TERRITORY_CLAIM_COST,
  TERRITORY_UPKEEP_PER_TICK,
  TERRITORY_LOOT_BONUS,
  quadrantAt,
  findQuadrant,
};
