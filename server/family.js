'use strict';

// server/family.js
// Konstanten fuer Ehe, Kinder und Vererbung.

const MARRIAGE_HAPPINESS_BONUS = 10;
const DIVORCE_HAPPINESS_PENALTY = 8;

const CHILD_COST = 200;
const CHILD_HAPPINESS_BONUS = 8;
const CHILD_NAME_MAX_LENGTH = 20;

// Tod: sobald die Gesundheit auf diesen Wert faellt (oder darunter), stirbt der Spieler.
const DEATH_HEALTH_THRESHOLD = 0;

// Vererbung: je nachdem, wer noch lebt, wird das Barvermoegen aufgeteilt.
// Der Rest ("Bestattungskosten"/unbeanspruchtes Erbe) verschwindet einfach - echte Geld-Senke.
const INHERITANCE_CHILD_AND_SPOUSE = { child: 0.5, spouse: 0.3 }; // 20% verloren
const INHERITANCE_CHILD_ONLY = { child: 0.7 };                    // 30% verloren
const INHERITANCE_SPOUSE_ONLY = { spouse: 0.6 };                  // 40% verloren
// Ohne Ehepartner und Kind: 100% verloren

module.exports = {
  MARRIAGE_HAPPINESS_BONUS,
  DIVORCE_HAPPINESS_PENALTY,
  CHILD_COST,
  CHILD_HAPPINESS_BONUS,
  CHILD_NAME_MAX_LENGTH,
  DEATH_HEALTH_THRESHOLD,
  INHERITANCE_CHILD_AND_SPOUSE,
  INHERITANCE_CHILD_ONLY,
  INHERITANCE_SPOUSE_ONLY,
};
