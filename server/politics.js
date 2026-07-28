'use strict';

// server/politics.js
// Buergermeisteramt: der Steuersatz war bis hierher eine feste Zahl in
// economy.js. Jetzt bestimmt ihn ein gewaehlter Spieler - aus einem technischen
// Wert wird ein sozialer.
//
// DER KERN IST DER INTERESSENKONFLIKT: Der Buergermeister bekommt einen Anteil
// der eingezogenen Steuer als Amtsbezuege. Er profitiert also von einem hohen
// Satz, waehrend alle anderen darunter leiden. Ohne diesen Konflikt waere jede
// Wahl bedeutungslos - jeder wuerde einfach den niedrigsten Satz versprechen und
// es gaebe nichts zu entscheiden.
//
// Der Satz ist nach oben UND unten begrenzt. Nach unten, weil die Steuer die
// einzige echte Geld-Senke der Wirtschaft ist (siehe economy.js): ein
// Buergermeister, der sie auf 0 setzt, wuerde die Waehrung entwerten. Nach oben,
// damit ein boeswillig Gewaehlter niemanden enteignen kann.

// --- Ablauf ---
//
// Zwei Phasen im Wechsel. Die Wahlphase ist deutlich kuerzer als die Amtszeit:
// Wahlkampf soll ein Ereignis sein, kein Dauerzustand.
const CAMPAIGN_DURATION_MS = 180000; // 3 Minuten Kandidatur + Abstimmung
const TERM_DURATION_MS = 600000;     // 10 Minuten Amtszeit

// Kandidatur kostet Geld - sonst stellt sich jeder auf und die Wahl zerfaellt in
// zwanzig Kandidaten mit je einer Stimme.
const CANDIDACY_FEE = 300;

// --- Steuerhoheit ---
const TAX_RATE_MIN = 0.004; // 0,4% - darunter versiegt die Geld-Senke
const TAX_RATE_MAX = 0.025; // 2,5% - darueber wird es enteignend
const DEFAULT_TAX_RATE = 0.01; // gilt ohne Buergermeister (= bisheriger Festwert)

// Anteil der eingezogenen Steuer, der als Amtsbezuege an den Buergermeister
// geht. Bewusst spuerbar, aber weit unter der Haelfte: das Amt soll sich lohnen,
// ohne dass ein einziger Gewaehlter das gesamte Steueraufkommen abschoepft.
const MAYOR_TAX_SHARE = 0.25;

/** Liegt ein gewuenschter Steuersatz im erlaubten Band? */
function isValidTaxRate(rate) {
  return typeof rate === 'number'
    && Number.isFinite(rate)
    && rate >= TAX_RATE_MIN
    && rate <= TAX_RATE_MAX;
}

/** Frischer Ausgangszustand - auch fuer Welten ohne gespeicherte Politik. */
function createInitialPolitics(now) {
  return {
    phase: 'campaign',
    phaseEndsAt: now + CAMPAIGN_DURATION_MS,
    mayorId: null,
    mayorName: null,
    taxRate: DEFAULT_TAX_RATE,
    candidates: [],  // [{ playerId, name }]
    votes: {},       // waehlerId -> kandidatId
  };
}

module.exports = {
  CAMPAIGN_DURATION_MS,
  TERM_DURATION_MS,
  CANDIDACY_FEE,
  TAX_RATE_MIN,
  TAX_RATE_MAX,
  DEFAULT_TAX_RATE,
  MAYOR_TAX_SHARE,
  isValidTaxRate,
  createInitialPolitics,
};
