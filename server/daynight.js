'use strict';

// server/daynight.js
// Tageszeit und Wetter. Beides veraendert, wie gut die Polizei ihre Umgebung
// wahrnimmt - nachts und im Nebel sieht sie weniger weit, bei Regen ist sie
// langsamer.
//
// WARUM AUSSCHLIESSLICH DIE POLIZEI: Grundprinzip 2 verlangt, dass
// Bewegungsformeln auf Server und Client identisch sind, weil der Client die
// eigene Bewegung vorhersagt. Wetter, das die SPIELERgeschwindigkeit aendert,
// muesste also in beiden Rechnungen exakt gleich ankommen - jede Abweichung
// zeigt sich als dauerhaftes Ruckeln. Die Polizei dagegen wird nur
// serverseitig bewegt und nie vorhergesagt: dort sind solche Faktoren
// gefahrlos. Deshalb bleibt die Spielerbewegung unangetastet.

// Ein voller Zyklus. Nacht ist der kuerzere Teil - sie ist der Ausnahmezustand,
// auf den man wartet und den man nutzt, kein Dauerzustand.
const CYCLE_DURATION_MS = 720000; // 12 Minuten
const NIGHT_FRACTION = 1 / 3;     // 4 Minuten Nacht, 8 Minuten Tag

// Nachts sieht die Polizei deutlich schlechter - das ist der Grund, ueberhaupt
// auf die Nacht zu warten.
const NIGHT_POLICE_RANGE_MULT = 0.5;

// Wetter wechselt unabhaengig von der Tageszeit.
const WEATHER_DURATION_MS = 240000; // 4 Minuten je Wetterlage

// `weight` steuert die Haeufigkeit: klares Wetter ueberwiegt, damit die
// Sonderlagen etwas Besonderes bleiben.
//
// ACHTUNG beim Regen-Tempofaktor: die Polizei ist mit 220 nur wenig schneller
// als ein Spieler zu Fuss (200) - laut Balancing-Grundsatz soll Flucht zu Fuss
// aussichtslos sein. Bei 0,75 waeren es 165 gewesen, also DEUTLICH langsamer
// als der Spieler; damit waere Weglaufen im Regen trivial geworden und der
// Grundsatz stillschweigend gekippt. 0,85 ergibt 187: entkommen ist moeglich,
// aber knapp und mit der Polizei dicht dahinter. Wer diesen Wert aendert,
// sollte ihn gegen PLAYER_SPEED (200) pruefen.
const WEATHER_TYPES = [
  { id: 'clear', name: 'klar',  weight: 5, policeRangeMult: 1.0, policeSpeedMult: 1.0 },
  { id: 'rain',  name: 'Regen', weight: 3, policeRangeMult: 1.0, policeSpeedMult: 0.85 },
  { id: 'fog',   name: 'Nebel', weight: 2, policeRangeMult: 0.6, policeSpeedMult: 1.0 },
];

function findWeather(id) {
  return WEATHER_TYPES.find((w) => w.id === id) || WEATHER_TYPES[0];
}

/** Zieht eine Wetterlage nach Gewichtung. Serverseitig - siehe Grundprinzip 4. */
function pickWeather(random = Math.random) {
  const total = WEATHER_TYPES.reduce((sum, w) => sum + w.weight, 0);
  let roll = random() * total;
  for (const w of WEATHER_TYPES) {
    roll -= w.weight;
    if (roll <= 0) return w.id;
  }
  return WEATHER_TYPES[0].id;
}

/**
 * Tageszeit aus der Uhrzeit ableiten - kein gespeicherter Zustand noetig, und
 * nach einem Neustart laeuft der Zyklus nahtlos weiter, statt bei Sonnenaufgang
 * neu zu beginnen.
 *
 * `progress` (0..1) gibt an, wie weit die aktuelle Phase fortgeschritten ist;
 * der Client blendet damit weich ueber, statt hart umzuschalten.
 */
function getDayPhase(now) {
  const intoCycle = now % CYCLE_DURATION_MS;
  const nightStart = CYCLE_DURATION_MS * (1 - NIGHT_FRACTION);
  if (intoCycle < nightStart) {
    return {
      phase: 'day',
      progress: intoCycle / nightStart,
      endsAt: now + (nightStart - intoCycle),
    };
  }
  const nightLength = CYCLE_DURATION_MS - nightStart;
  const intoNight = intoCycle - nightStart;
  return {
    phase: 'night',
    progress: intoNight / nightLength,
    endsAt: now + (nightLength - intoNight),
  };
}

/** Die wirksamen Faktoren aus Tageszeit UND Wetter zusammen. */
function environmentEffects(phase, weatherId) {
  const weather = findWeather(weatherId);
  return {
    policeRangeMult: (phase === 'night' ? NIGHT_POLICE_RANGE_MULT : 1) * weather.policeRangeMult,
    policeSpeedMult: weather.policeSpeedMult,
  };
}

module.exports = {
  CYCLE_DURATION_MS,
  NIGHT_FRACTION,
  NIGHT_POLICE_RANGE_MULT,
  WEATHER_DURATION_MS,
  WEATHER_TYPES,
  findWeather,
  pickWeather,
  getDayPhase,
  environmentEffects,
};
