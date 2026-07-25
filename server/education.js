'use strict';

// server/education.js
// Bildung als Leiter: jeder Kurs kostet Geld und Zeit (in slowTicks) und gibt
// dauerhaft Intelligenz. Hoehere Kurse setzen den jeweils vorherigen voraus -
// so entsteht eine echte Fortschrittskette Richtung der anspruchsvollen Berufe.

const COURSES = [
  {
    id: 'evening_class',
    name: 'Abendkurs',
    cost: 150,
    durationTicks: 6,
    smartsGain: 8,
    requires: null,
  },
  {
    id: 'vocational',
    name: 'Berufsschule',
    cost: 400,
    durationTicks: 12,
    smartsGain: 12,
    requires: 'evening_class',
  },
  {
    id: 'college',
    name: 'Fachhochschule',
    cost: 900,
    durationTicks: 20,
    smartsGain: 15,
    requires: 'vocational',
  },
  {
    id: 'university',
    name: 'Universität',
    cost: 1800,
    durationTicks: 30,
    smartsGain: 20,
    requires: 'college',
  },
];

// Studieren neben dem Beruf ist erlaubt, dauert aber laenger - das macht die
// Entscheidung "erstmal nur lernen" zu einer echten Abwaegung statt einer Formalie.
const EMPLOYED_STUDY_SLOWDOWN = 2; // braucht doppelt so viele Ticks, wenn man nebenbei arbeitet

const MAX_SMARTS = 100;

function findCourse(courseId) {
  return COURSES.find((c) => c.id === courseId) || null;
}

/** Oeffentlicher Kurskatalog fuer den Client. */
function buildCourseCatalog() {
  return COURSES.map((c) => ({
    id: c.id,
    name: c.name,
    cost: c.cost,
    durationTicks: c.durationTicks,
    smartsGain: c.smartsGain,
    requires: c.requires,
  }));
}

module.exports = {
  COURSES,
  findCourse,
  buildCourseCatalog,
  EMPLOYED_STUDY_SLOWDOWN,
  MAX_SMARTS,
};
