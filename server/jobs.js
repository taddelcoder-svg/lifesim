'use strict';

// server/jobs.js
// Berufe als Karriereleitern: jeder Beruf hat mehrere Stufen. Man startet auf
// Stufe 0 und wird durch gesammelte Berufserfahrung befoerdert. Anforderungen
// (Intelligenz, Vorstrafen) werden serverseitig beim Bewerben geprueft.

const SALARY_TICKS_PER_PAYOUT = 1; // Gehalt kommt bei jedem slowTick
const XP_PER_TICK = 1;             // Berufserfahrung pro slowTick im Job
const QUIT_HAPPINESS_PENALTY = 3;  // kleiner Malus fuers Hinwerfen

const JOBS = [
  {
    id: 'retail',
    name: 'Einzelhandel',
    minSmarts: 0,
    maxWanted: 3, // bei hoeherem Fahndungslevel keine Anstellung
    levels: [
      { title: 'Aushilfe', salary: 18, xpToPromote: 8 },
      { title: 'Verkäufer', salary: 28, xpToPromote: 16 },
      { title: 'Filialleiter', salary: 45, xpToPromote: null }, // null = Endstufe
    ],
  },
  {
    id: 'office',
    name: 'Büro',
    minSmarts: 40,
    maxWanted: 2,
    levels: [
      { title: 'Sachbearbeiter', salary: 30, xpToPromote: 10 },
      { title: 'Teamleiter', salary: 50, xpToPromote: 20 },
      { title: 'Abteilungsleiter', salary: 80, xpToPromote: null },
    ],
  },
  {
    id: 'tech',
    name: 'IT & Technik',
    minSmarts: 60,
    maxWanted: 2,
    levels: [
      { title: 'Junior-Entwickler', salary: 40, xpToPromote: 12 },
      { title: 'Entwickler', salary: 70, xpToPromote: 24 },
      { title: 'Software-Architekt', salary: 110, xpToPromote: null },
    ],
  },
  {
    id: 'medicine',
    name: 'Medizin',
    minSmarts: 75,
    maxWanted: 0, // Vorstrafen sind hier ein Ausschlusskriterium
    levels: [
      { title: 'Assistenzarzt', salary: 45, xpToPromote: 16 },
      { title: 'Facharzt', salary: 90, xpToPromote: 30 },
      { title: 'Chefarzt', salary: 150, xpToPromote: null },
    ],
  },
  {
    id: 'construction',
    name: 'Bau & Handwerk',
    minSmarts: 20,
    maxWanted: 4, // hier wird am wenigsten auf die Vergangenheit geschaut
    levels: [
      { title: 'Bauhelfer', salary: 24, xpToPromote: 8 },
      { title: 'Facharbeiter', salary: 40, xpToPromote: 18 },
      { title: 'Vorarbeiter', salary: 62, xpToPromote: null },
    ],
  },
];

function findJobDefinition(jobId) {
  return JOBS.find((j) => j.id === jobId) || null;
}

/** Oeffentliche Berufsliste fuer den Client - ohne interne XP-Schwellen-Details. */
function buildJobCatalog() {
  return JOBS.map((job) => ({
    id: job.id,
    name: job.name,
    minSmarts: job.minSmarts,
    maxWanted: job.maxWanted,
    levels: job.levels.map((l) => ({ title: l.title, salary: l.salary })),
  }));
}

module.exports = {
  JOBS,
  findJobDefinition,
  buildJobCatalog,
  SALARY_TICKS_PER_PAYOUT,
  XP_PER_TICK,
  QUIT_HAPPINESS_PENALTY,
};
