'use strict';

// server/events.js
// Waehlt ein zufaelliges, altersgerechtes Lebensereignis fuer einen Spieler aus.
// "weight" bestimmt die relative Haeufigkeit - hoeher = kommt oefter vor.

const EVENTS = require('./events.json');

function pickEligibleEvent(player, excludeIds) {
  const excluded = excludeIds || [];
  const eligible = EVENTS.filter((e) => {
    const minAge = typeof e.minAge === 'number' ? e.minAge : 0;
    const maxAge = typeof e.maxAge === 'number' ? e.maxAge : 200;
    return player.age >= minAge && player.age <= maxAge && !excluded.includes(e.id);
  });
  if (eligible.length === 0) return null;

  const totalWeight = eligible.reduce((sum, e) => sum + (e.weight || 1), 0);
  let roll = Math.random() * totalWeight;
  for (const e of eligible) {
    roll -= (e.weight || 1);
    if (roll <= 0) return e;
  }
  return eligible[eligible.length - 1];
}

module.exports = { pickEligibleEvent, EVENTS };
