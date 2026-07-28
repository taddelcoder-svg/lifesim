'use strict';

// server/wellbeing.js
// Gesundheit und Zufriedenheit waren bisher eine Sackgasse: `health` wurde nur
// von Lebensereignissen veraendert, `happiness` nur von Heirat/Kind/Kuendigung -
// beide liefen sonst konstant weiter, ohne Verfall und ohne eigenes Zutun. Dieses
// Modul schliesst die Luecke mit einem langsamen Verfall plus zwei Orten, an
// denen man aktiv gegensteuern kann, UND einer echten mechanischen Wirkung auf
// die bestehende Fortschrittskette (Beruf), statt nur eine kosmetische HUD-Zahl
// zu bleiben.

// --- Verfall (SLOW_TICK, alle 10s) ---
//
// Bewusst LANGSAM: ein Spieler, der nie ins Krankenhaus geht, verliert bei
// durchgehend verbundenem Spiel etwa 7 Gesundheit pro Realstunde (= Spieljahr).
// Von 100 auf 0 (Tod, siehe DEATH_HEALTH_THRESHOLD in family.js) dauert das gut
// 14 Stunden verbundene Spielzeit - eine echte Konsequenz fuer Langzeit-
// Vernachlaessigung, aber keine Uhr, die eine einzelne Sitzung bedroht.
const HEALTH_DECAY_PER_TICK = 0.02;

// Etwas schneller als Gesundheit: Zufriedenheit soll man haeufiger nachfuellen
// muessen als Gesundheit, weil sie (anders als Gesundheit) nicht toedlich ist -
// das haeufigere Nachfuellen ist der einzige Preis dafuer.
const HAPPINESS_DECAY_PER_TICK = 0.03;

// --- Auswirkung auf den Beruf (schliesst die Luecke zur Fortschrittskette) ---
//
// Ohne diese Kopplung waeren beide Werte nur eine Zahl im HUD. Krankheit
// draengt aufs Gehalt (man arbeitet weniger effektiv), fehlende Motivation auf
// den Aufstieg (man lernt langsamer dazu) - zwei unterschiedliche Wirkungen,
// damit man je nach Situation gezielt weiss, wohin man laufen muss.
const HEALTH_SICK_THRESHOLD = 30;
const HEALTH_SICK_SALARY_MULT = 0.5;   // halbes Gehalt, solange krank
const HAPPINESS_LOW_THRESHOLD = 30;
const HAPPINESS_LOW_XP_MULT = 0.5;     // halbe Berufserfahrung, solange unmotiviert

// --- Krankenhaus ---
//
// Kein fester Preis, sondern pro fehlendem Gesundheitspunkt - wer fruehzeitig
// hingeht, zahlt wenig; wer es lange aufschiebt, zahlt viel. Das macht
// regelmaessige, kleine Besuche zur guenstigeren Strategie als einen grossen
// im letzten Moment.
const HOSPITAL_COST_PER_HEALTH = 6;

// --- Fitnessstudio ---
//
// Fester Preis und fester Gewinn, dafuer mit Abklingzeit - anders als beim
// Krankenhaus (das sich durch die pro-Punkt-Kosten selbst begrenzt) waere ein
// Fitnessstudio ohne Cooldown ein Weg, mit genug Geld Zufriedenheit beliebig
// oft zu kaufen und den Verfall komplett zu neutralisieren.
const GYM_COST = 30;
const GYM_HAPPINESS_GAIN = 20;
const GYM_COOLDOWN_MS = 20000; // 20 Realsekunden

// Training hebt auch das Aussehen - der Grund, warum `looks` kein eigener Ort
// wurde: von den 25 Blockmitten sind 14 durch Immobilien und 9 durch Orte
// belegt, es waere genau eine frei geblieben. Thematisch passt es ohnehin
// besser, als ein zehntes Gebaeude dafuer aufzumachen. Deutlich kleiner als der
// Zufriedenheits-Gewinn: der Zugang zum Medienberuf (minLooks 55) soll eine
// Reihe von Besuchen kosten, kein einzelner.
const GYM_LOOKS_GAIN = 4;

// --- Freundschaft ---
//
// `friends` war reine Verwaltung: anfragen, bestaetigen, Liste anzeigen - ohne
// jede Wirkung. Jetzt bremsen Freunde den Zufriedenheitsverfall, aber NUR
// solange sie verbunden sind. Das belohnt gemeinsames Spielen statt blossem
// Namensammeln: eine Freundesliste von zwanzig Leuten, die nie online sind,
// bringt genau nichts.
const HAPPINESS_DECAY_RELIEF_PER_FRIEND = 0.008;
const MAX_FRIENDS_COUNTED = 3; // Deckel: sonst waere der Verfall komplett abschaltbar

module.exports = {
  HEALTH_DECAY_PER_TICK,
  HAPPINESS_DECAY_PER_TICK,
  HEALTH_SICK_THRESHOLD,
  HEALTH_SICK_SALARY_MULT,
  HAPPINESS_LOW_THRESHOLD,
  HAPPINESS_LOW_XP_MULT,
  HOSPITAL_COST_PER_HEALTH,
  GYM_COST,
  GYM_HAPPINESS_GAIN,
  GYM_COOLDOWN_MS,
  GYM_LOOKS_GAIN,
  HAPPINESS_DECAY_RELIEF_PER_FRIEND,
  MAX_FRIENDS_COUNTED,
};
