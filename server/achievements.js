'use strict';

// server/achievements.js
// Lebensziele: eine feste Liste von Meilensteinen mit Belohnung.
//
// Zwei Aufgaben in einem: fuer neue Spieler ist die Reihenfolge der ersten
// Ziele ein Leitfaden ("Was mache ich jetzt?"), fuer alte Spieler sind die
// spaeten Ziele etwas, worauf man hinarbeitet. Die Reihenfolge der Liste IST
// deshalb die empfohlene Reihenfolge - das HUD zeigt immer das erste offene
// Ziel als "Nächstes Ziel" an.
//
// Jedes Ziel prueft nur Werte, die es im Spiel ohnehin gibt. `place` verweist
// auf einen Ort aus places.js, an dem man das Ziel erreichen kann - der Client
// setzt dort eine Wegmarke.
//
// Erreichte Ziele bleiben ueber den Tod hinaus erhalten (player.achievements
// haengt am Spieler, nicht am Leben). Die Belohnung gibt es nur einmal.

function netWorth(player, world) {
  let props = 0;
  for (const prop of world.properties.values()) {
    if (prop.ownerId === player.id) props += prop.price + (prop.invested || 0);
  }
  return player.cash + player.bank - player.debt + world.portfolioValue(player) + props;
}

function ownedPropertyCount(player, world) {
  let n = 0;
  for (const prop of world.properties.values()) if (prop.ownerId === player.id) n++;
  return n;
}

const ACHIEVEMENTS = [
  {
    id: 'first_job', icon: '💼', title: 'Erster Job',
    desc: 'Bewirb dich im Arbeitsamt auf eine Stelle.',
    place: 'jobcenter', reward: { cash: 150 },
    check: (p) => p.job != null || p.employerCompanyId != null,
  },
  {
    id: 'saver', icon: '🏦', title: 'Sparfuchs',
    desc: 'Zahle $500 auf dein Bankkonto ein – dort kann es dir niemand klauen.',
    place: 'bank', reward: { cash: 100 },
    progress: (p) => [Math.min(p.bank, 500), 500],
    check: (p) => p.bank >= 500,
  },
  {
    id: 'student', icon: '🎓', title: 'Bildungshunger',
    desc: 'Schließe einen Kurs an der Universität ab.',
    place: 'university', reward: { cash: 200, happiness: 5 },
    check: (p) => p.education != null,
  },
  {
    id: 'fit', icon: '💪', title: 'Gut in Form',
    desc: 'Trainiere im Fitnessstudio.',
    place: 'gym', reward: { cash: 75 },
    check: (p) => (p.lastGymAt || 0) > 0,
  },
  {
    id: 'wheels', icon: '🚗', title: 'Eigene Räder',
    desc: 'Kauf dir ein Fahrzeug im Autohaus.',
    place: 'dealership', reward: { cash: 250 },
    check: (p, w) => w.ownedVehicleCount(p.id) > 0,
  },
  {
    id: 'pet', icon: '🐾', title: 'Treuer Begleiter',
    desc: 'Hol dir ein Haustier aus der Tierhandlung.',
    place: 'petshop', reward: { happiness: 10 },
    check: (p) => p.pet != null,
  },
  {
    id: 'friend', icon: '🤝', title: 'Gesellig',
    desc: 'Schließe eine Freundschaft mit einem anderen Spieler (👥 Sozial → Freunde).',
    reward: { cash: 100, happiness: 5 },
    check: (p) => Array.isArray(p.friends) && p.friends.length > 0,
  },
  {
    id: 'promoted', icon: '📈', title: 'Karriereleiter',
    desc: 'Werde in deinem Beruf zweimal befördert.',
    reward: { cash: 400 },
    progress: (p) => [Math.min(p.jobLevel || 0, 2), 2],
    check: (p) => p.job != null && (p.jobLevel || 0) >= 2,
  },
  {
    id: 'landlord', icon: '🏠', title: 'Hausbesitzer',
    desc: 'Kaufe im Maklerbüro deine erste Immobilie.',
    place: 'realestate', reward: { cash: 500 },
    check: (p, w) => ownedPropertyCount(p, w) > 0,
  },
  {
    id: 'investor', icon: '📊', title: 'Anleger',
    desc: 'Kaufe Aktien an der Börse.',
    place: 'exchange', reward: { cash: 150 },
    check: (p) => Object.values(p.portfolio || {}).some((n) => n > 0),
  },
  {
    id: 'founder', icon: '🏭', title: 'Unternehmer',
    desc: 'Gründe im Gewerbeamt eine eigene Firma.',
    place: 'cityhall', reward: { cash: 750 },
    check: (p, w) => w.ownedCompanyCount(p.id) > 0,
  },
  {
    id: 'married', icon: '💍', title: 'Ja, ich will',
    desc: 'Heirate einen anderen Spieler (👥 Sozial → Familie).',
    reward: { happiness: 15 },
    check: (p) => p.spouseId != null,
  },
  {
    id: 'parent', icon: '👶', title: 'Familienglück',
    desc: 'Bekomme ein Kind.',
    reward: { happiness: 10 },
    check: (p, w) => w.buildChildrenForPlayer(p.id).length > 0,
  },
  {
    id: 'racer', icon: '🏁', title: 'Rennfahrer',
    desc: 'Fahre eine gewertete Runde beim Zeitfahren.',
    place: 'raceoffice', reward: { cash: 300 },
    check: (p, w) => w.race && w.race.bestTimes && w.race.bestTimes[p.id] != null,
  },
  {
    id: 'wealthy', icon: '💰', title: 'Wohlhabend',
    desc: 'Erreiche ein Gesamtvermögen von $10.000.',
    reward: { cash: 1000 },
    progress: (p, w) => [Math.max(0, Math.min(Math.round(netWorth(p, w)), 10000)), 10000],
    check: (p, w) => netWorth(p, w) >= 10000,
  },
  {
    id: 'mayor', icon: '🗳️', title: 'Stadtoberhaupt',
    desc: 'Lass dich im Rathaus zum Bürgermeister wählen.',
    place: 'townhall', reward: { cash: 1500, happiness: 10 },
    check: (p, w) => w.politics && w.politics.mayorId === p.id,
  },
  {
    id: 'thirty', icon: '🎂', title: 'Dreißig',
    desc: 'Werde 30 Jahre alt.',
    reward: { cash: 300 },
    progress: (p) => [Math.min(p.age, 30), 30],
    check: (p) => p.age >= 30,
  },
  {
    id: 'tycoon', icon: '👑', title: 'Magnat',
    desc: 'Erreiche ein Gesamtvermögen von $100.000.',
    reward: { cash: 5000, happiness: 20 },
    progress: (p, w) => [Math.max(0, Math.min(Math.round(netWorth(p, w)), 100000)), 100000],
    check: (p, w) => netWorth(p, w) >= 100000,
  },
  {
    id: 'elder', icon: '🧓', title: 'Lebenserfahrung',
    desc: 'Werde 70 Jahre alt.',
    reward: { cash: 1000, happiness: 10 },
    progress: (p) => [Math.min(p.age, 70), 70],
    check: (p) => p.age >= 70,
  },
  // Die dunkle Seite zaehlt auch - aber bewusst ans Ende und ohne Geld als
  // Belohnung, damit es kein Anreiz ist, sondern ein Abzeichen.
  {
    id: 'outlaw', icon: '🕶️', title: 'Schwarzes Schaf',
    desc: 'Lande zum ersten Mal im Gefängnis.',
    reward: {},
    check: (p) => (p.criminalRecord || []).length > 0,
  },
];

const BY_ID = new Map(ACHIEVEMENTS.map((a) => [a.id, a]));

function safe(fn, fallback) {
  try { return fn(); } catch (err) { return fallback; }
}

/**
 * Prueft alle offenen Ziele eines Spielers. Schreibt neu erreichte in
 * player.achievements und zahlt die Belohnung aus.
 * @returns {Array} neu erreichte Zieldefinitionen
 */
function checkPlayer(player, world) {
  if (!player.achievements || typeof player.achievements !== 'object') player.achievements = {};
  const unlocked = [];
  for (const def of ACHIEVEMENTS) {
    if (player.achievements[def.id]) continue;
    if (!safe(() => def.check(player, world), false)) continue;
    player.achievements[def.id] = Date.now();
    const r = def.reward || {};
    if (r.cash) player.cash += r.cash;
    if (r.happiness) player.happiness = Math.min(100, (player.happiness || 0) + r.happiness);
    unlocked.push(def);
  }
  return unlocked;
}

/** Zustand fuer den Client: alle Ziele mit Fortschritt, Reihenfolge wie oben. */
function buildState(player, world) {
  const done = player.achievements || {};
  return {
    list: ACHIEVEMENTS.map((def) => ({
      id: def.id,
      icon: def.icon,
      title: def.title,
      desc: def.desc,
      place: def.place || null,
      reward: def.reward || {},
      doneAt: done[def.id] || null,
      progress: def.progress && !done[def.id] ? safe(() => def.progress(player, world), null) : null,
    })),
  };
}

module.exports = { ACHIEVEMENTS, BY_ID, checkPlayer, buildState, netWorth };
