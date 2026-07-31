'use strict';

// server/pets.js
// Haustiere. Sie haengen bewusst an zwei Systemen, die es schon gibt, statt ein
// drittes aufzumachen:
//
//   Zuhause  -> ohne eigenes Wohnhaus kein Tier (wie bei Kindern)
//   Fuettern -> kostet Geld, gibt Zufriedenheit (wie das Fitnessstudio)
//
// WARUM FUETTERN UND NICHT EIN DAUERBONUS: Zufriedenheit verfaellt mit 0,03 pro
// Zyklus, drei Freunde online nehmen davon schon 0,024 weg, und ein eigenes
// Zuhause haelt eine Untergrenze. Ein weiterer Abzug auf den Verfall koennte
// diesen auf null bringen und die ganze Mechanik aushebeln. Fuettern wirkt
// stattdessen wie ein Fitnessstudiobesuch: einmalig, mit Abklingzeit, ohne die
// Verfallsformel anzufassen.

const SPECIES = [
  { id: 'cat',    name: 'Katze',     price: 320 },
  { id: 'dog',    name: 'Hund',      price: 450 },
  { id: 'bunny',  name: 'Kaninchen', price: 180 },
  { id: 'fox',    name: 'Fuchs',     price: 700 },
  { id: 'parrot', name: 'Papagei',   price: 380 },
  { id: 'pig',    name: 'Schwein',   price: 260 },
];

const MAX_PET_NAME_LENGTH = 20;

// Fuettern: guenstiger als das Fitnessstudio (30), gibt dafuer weniger.
const FEED_COST = 18;
const FEED_HAPPINESS_GAIN = 8;
const FEED_COOLDOWN_MS = 30000;

// Wird ein Tier so lange nicht gefuettert, laeuft es weg. Das ist der Grund,
// warum ein Haustier eine laufende Verpflichtung ist und keine einmalige
// Anschaffung - ohne diese Folge waere es eine Zierde im Menue.
const NEGLECT_TIMEOUT_MS = 900000; // 15 Minuten

function findSpecies(id) {
  return SPECIES.find((s) => s.id === id) || null;
}

function buildSpeciesCatalog() {
  return SPECIES.map((s) => ({ id: s.id, name: s.name, price: s.price }));
}

module.exports = {
  SPECIES,
  MAX_PET_NAME_LENGTH,
  FEED_COST,
  FEED_HAPPINESS_GAIN,
  FEED_COOLDOWN_MS,
  NEGLECT_TIMEOUT_MS,
  findSpecies,
  buildSpeciesCatalog,
};
