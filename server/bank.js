'use strict';

// server/bank.js
// Sparkonto und Kredite.
//
// Die Zinssaetze sind bewusst so gewaehlt, dass sich Rechnen lohnt:
//
//   Vermoegenssteuer:      1.0% pro Zyklus (auf Bargeld UND Guthaben)
//   Kreditzins:            0.5% pro Zyklus
//   Sparzins:              0.6% pro Zyklus
//   Immobilienrendite:  ca. 0.8-1.1% pro Zyklus
//
// Daraus folgt:
// - Geld leihen, um eine Immobilie zu kaufen, LOHNT sich (Rendite > Zins).
// - Geld leihen und einfach liegen lassen, lohnt sich NICHT (Steuer 1% frisst
//   mehr, als der Kredit mit 0.5% kostet). Damit ist die naheliegende
//   Ausnutzung von vornherein unattraktiv, ohne dass es dafuer eine Extraregel braucht.
// - Sparen ist besser als Bargeld halten (0.6% Zins gegen 1% Steuer = -0.4%
//   statt -1%) und zusaetzlich diebstahlsicher.

const SAVINGS_INTEREST_RATE = 0.006; // pro slowTick
const LOAN_INTEREST_RATE = 0.005;    // pro slowTick

// Kreditrahmen: Grundbetrag plus Sicherheiten
const LOAN_BASE_LIMIT = 1000;
const LOAN_LIMIT_PER_PROPERTY_VALUE = 0.5; // 50% des Immobilienwerts zaehlen als Sicherheit
const LOAN_LIMIT_PER_JOB_LEVEL = 600;      // ein Job erhoeht die Kreditwuerdigkeit

// Wird die Schuld zu hoch, greift die Bank auf Sicherheiten zu
const FORECLOSURE_THRESHOLD = 1.5; // ab Schuld > Kreditrahmen * 1.5

module.exports = {
  SAVINGS_INTEREST_RATE,
  LOAN_INTEREST_RATE,
  LOAN_BASE_LIMIT,
  LOAN_LIMIT_PER_PROPERTY_VALUE,
  LOAN_LIMIT_PER_JOB_LEVEL,
  FORECLOSURE_THRESHOLD,
};
