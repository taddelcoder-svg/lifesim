'use strict';

// server/racing.js
// Fahrzeugrennen. Es gibt vier Fahrzeugtypen mit unterschiedlichem Tempo und
// Beschleunigung - aber `vehicleId` tauchte im gesamten Code ausnahmslos zur
// Fortbewegung auf. Nichts hat die Unterschiede je gegeneinander gemessen, und
// der teuerste Kauf des Spiels (Sportwagen, $7500) hatte keinen anderen Zweck,
// als etwas frueher anzukommen.
//
// KEIN GLEICHZEITIGER START: Rennen sind Zeitfahren. Ein synchroner Start
// braucht mehrere Spieler, die gleichzeitig online sind und gleichzeitig Lust
// haben - auf einem Server mit wenigen Leuten faende nie eines statt. Beim
// Zeitfahren faehrt jeder allein gegen die Uhr, und der Wettkampf entsteht ueber
// die Bestzeiten einer Saison.
//
// GELDMENGE: Der Preistopf besteht ausschliesslich aus Startgeldern - wie beim
// Banktresor (Steuer), Versicherungstopf (Praemien) und der Boersenkasse
// (Kaeufe). Es wird nie mehr ausgeschuettet, als eingezahlt wurde.

// Rundkurs auf Rasterlinien (Vielfache von 400), damit die Strecke durchgehend
// befahrbar ist - Blockmitten waeren bebaut. Reihenfolge ist verbindlich.
const CHECKPOINTS = [
  { x: 2400, y: 400 },
  { x: 2400, y: 1200 },
  { x: 1600, y: 1200 },
  { x: 1600, y: 400 },
];

// Grosszuegig: die Strasse ist 90 breit, und man soll die Linie im Vorbeifahren
// treffen, nicht zentimetergenau anhalten muessen.
const CHECKPOINT_RADIUS = 70;

// Startgeld je Versuch. Landet vollstaendig im Preistopf.
const RACE_ENTRY_FEE = 120;

// Eine Saison. Danach bekommt die Bestzeit den Topf, und die Zeiten werden
// geleert - sonst haette der erste schnelle Fahrer den Titel fuer immer.
const RACE_SEASON_MS = 600000; // 10 Minuten

// Sicherheitsnetz: wer sich anmeldet und dann nicht faehrt, blockiert sonst
// dauerhaft einen Startplatz und seine Anmeldung liefe nie ab.
const RACE_TIMEOUT_MS = 300000; // 5 Minuten

/** Rundenlaenge in Welteinheiten - nur zur Anzeige. */
function lapLength() {
  let len = 0;
  for (let i = 0; i < CHECKPOINTS.length; i++) {
    const a = CHECKPOINTS[i];
    const b = CHECKPOINTS[(i + 1) % CHECKPOINTS.length];
    len += Math.hypot(b.x - a.x, b.y - a.y);
  }
  return len;
}

module.exports = {
  CHECKPOINTS,
  CHECKPOINT_RADIUS,
  RACE_ENTRY_FEE,
  RACE_SEASON_MS,
  RACE_TIMEOUT_MS,
  lapLength,
};
