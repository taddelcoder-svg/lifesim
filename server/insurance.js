'use strict';

// server/insurance.js
// Die Gegenseite zu Einbruch und Bankueberfall. Bis hierher war Kriminalitaet
// einseitig: der Taeter hatte drei Aktionen und seit dem Rechtssystem drei Wege
// aus der Fahndung - das Opfer hatte keine einzige Moeglichkeit, sich zu wehren.
//
// Zwei Bausteine, bewusst nach demselben Muster wie Bestechung/Anwalt auf der
// Taeterseite gebaut: einer verhindert, einer entschaedigt.
//
//   Alarmanlage  -> senkt die Erfolgschance des Einbrechers (Vorbeugung)
//   Versicherung -> ersetzt einen Teil des Schadens (Nachsorge)
//
// Beide laufen ueber die Zeit ins Geld. Sie einfach immer zu buchen ist keine
// gute Strategie: auf einem ruhigen Server verbrennt man damit Ertrag, auf einem
// mit aktiven Dieben lohnen sie sich. Genau das soll die Entscheidung sein.

// --- Alarmanlage ---
//
// Einmalige Anschaffung plus laufende Kosten. Der Anteil bezieht sich auf den
// Ertrag DER JEWEILIGEN Immobilie: teure Objekte sind lohnendere Ziele (die
// Einbruchsbeute richtet sich nach ihrem Ertrag) und zahlen deshalb auch mehr
// fuer den Schutz.
const ALARM_INSTALL_COST_RATIO = 4;      // Anschaffung = 4x Ertrag pro Tick
const ALARM_UPKEEP_RATIO = 0.08;         // laufend 8% des Ertrags
const ALARM_BURGLARY_SUCCESS_CHANCE = 0.2; // statt 0,45 ohne Anlage

// Scheitert ein Einbruch an der Anlage, wird die Polizei alarmiert - das kostet
// den Taeter zusaetzlich Fahndung. Damit ist die Anlage nicht nur passiver
// Schutz, sondern macht das Ziel aktiv unattraktiv.
const ALARM_WANTED_BONUS_ON_FAILURE = 2;

// --- Versicherung ---
//
// Praemie pro Tick, Auszahlung bei erfolgreichem Einbruch.
const INSURANCE_PREMIUM_RATIO = 0.12;    // 12% des Ertrags pro Tick
const INSURANCE_PAYOUT_RATIO = 0.7;      // ersetzt 70% des entgangenen Ertrags

// WICHTIG - kein Geld aus dem Nichts: Auszahlungen kommen aus einem Topf, der
// ausschliesslich aus den Praemien gespeist wird (genau wie der Banktresor aus
// der Vermoegenssteuer). Ist der Topf leer, gibt es entsprechend weniger. Ohne
// diesen Deckel waere die Versicherung eine Gelddruckmaschine: man liesse sich
// absichtlich von einem Zweitspieler bestehlen und kassierte beide Seiten.
const INSURANCE_POOL_START = 0;

/** Anschaffungspreis der Alarmanlage fuer diese Immobilie. */
function alarmInstallCost(property) {
  return Math.max(1, Math.round(property.incomePerTick * ALARM_INSTALL_COST_RATIO));
}

/** Laufende Kosten der Alarmanlage pro slowTick. */
function alarmUpkeep(property) {
  return Math.max(1, Math.round(property.incomePerTick * ALARM_UPKEEP_RATIO));
}

/** Versicherungspraemie pro slowTick. */
function insurancePremium(property) {
  return Math.max(1, Math.round(property.incomePerTick * INSURANCE_PREMIUM_RATIO));
}

/**
 * Entschaedigung fuer einen erfolgreichen Einbruch: ein Anteil des Ertrags, der
 * waehrend der Ausfallzeit entgeht. `disableTicks` kommt aus
 * BURGLARY_DISABLE_MS / SLOW_TICK_MS - dieselbe Groesse, aus der sich auch die
 * Beute des Einbrechers berechnet.
 */
function insurancePayout(property, disableTicks) {
  return Math.max(1, Math.round(property.incomePerTick * disableTicks * INSURANCE_PAYOUT_RATIO));
}

module.exports = {
  ALARM_INSTALL_COST_RATIO,
  ALARM_UPKEEP_RATIO,
  ALARM_BURGLARY_SUCCESS_CHANCE,
  ALARM_WANTED_BONUS_ON_FAILURE,
  INSURANCE_PREMIUM_RATIO,
  INSURANCE_PAYOUT_RATIO,
  INSURANCE_POOL_START,
  alarmInstallCost,
  alarmUpkeep,
  insurancePremium,
  insurancePayout,
};
