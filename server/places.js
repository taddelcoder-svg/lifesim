'use strict';

// server/places.js
// Feste Orte in der Stadt, an denen bestimmte Aktionen ueberhaupt erst moeglich
// sind. Vorher liess sich alles - Bewerbung, Einschreibung, Bankgeschaefte,
// Immobilienkauf - von jedem beliebigen Punkt der Karte aus erledigen. Die 3D-
// Stadt war damit reine Kulisse; ortsgebunden waren nur Diebstahl, Fahrzeuge und
// Polizei. Erst durch diese Bindung bekommt das Herumlaufen einen Zweck.
//
// GRUNDSATZ: Gebunden wird nur, was etwas EINBRINGT. Ausstiege (kuendigen, Kurs
// abbrechen, Firma schliessen, Schulden tilgen) bleiben ueberall moeglich. Sonst
// koennte man sich am anderen Ende der Karte handlungsunfaehig manoevrieren -
// etwa Schulden nicht tilgen koennen und dadurch in die Zwangsversteigerung
// laufen, obwohl das Geld da waere.

// Reichweite in Server-Einheiten. Die Untergrenze ergibt sich aus der Geometrie:
// die Kollisionsflaeche ist ein ACHSENPARALLELES Quadrat von 150 Kantenlaenge,
// um den Figurenradius (18) aufgeweitet also 93 pro Halbachse. Seitlich steht man
// damit ab 93 Einheiten frei - diagonal aber erst ab 93 / cos(45 Grad) = 131,5.
// Eine Reichweite von 150 liesse an den Ecken nur einen 18 Einheiten schmalen
// Streifen uebrig, in dem man gleichzeitig frei steht UND in Reichweite ist.
// 170 gibt rundherum einen brauchbaren Ring.
//
// Nach oben begrenzt die Strasse: deren innere Kante liegt 155 Einheiten von der
// Blockmitte entfernt (200 minus halbe Strassenbreite). Bei 170 kann man also vom
// Bordstein aus buchen, aber nicht mehr aus der Strassenmitte im Vorbeifahren -
// das ist die Absicht.
const PLACE_INTERACT_RANGE = 170;

// Kantenlaenge des Ortsgebaeudes (quadratisch, wie die Immobilien-Kollisionsflaechen).
const PLACE_SIZE = 150;

// Alle Positionen liegen auf freien BLOCKMITTEN (Raster 400, Mitten bei
// 200/600/1000/1400/1800). Belegt sind bereits die 14 Immobilien aus economy.js -
// diese fuenf Punkte sind die verbleibenden freien Mitten. Ausserdem gemieden:
// die Startpositionen der Polizei (200/1000, 800/1000, 1400/1000), der Startpunkt
// (800/800) und das Gefaengnis (100/1900).
const PLACES = [
  {
    id: 'jobcenter',
    name: 'Arbeitsamt',
    dative: 'zum Arbeitsamt',
    icon: '💼',
    // Bewusst der Ort direkt neben dem Startpunkt (Entfernung ~280): die
    // Bewerbung ist fuer neue Spieler der erste sinnvolle Schritt.
    position: { x: 600, y: 600 },
    actions: ['applyForJob'],
  },
  {
    id: 'university',
    name: 'Universität',
    dative: 'zur Universität',
    icon: '🎓',
    position: { x: 1000, y: 1400 },
    actions: ['enrollInCourse'],
  },
  {
    id: 'bank',
    name: 'Bankfiliale',
    dative: 'zur Bankfiliale',
    icon: '🏦',
    // Die Entfernung zum Startpunkt (~850) ist Absicht: Bargeld ist als einziges
    // bestehlbar, und der Weg zur Filiale ist genau das Risikofenster dafuer.
    position: { x: 1400, y: 1400 },
    // robBank gehoert bewusst hierher: der Ueberfall braucht dieselbe
    // Ortsbindung wie die legalen Bankgeschaefte.
    actions: ['deposit', 'withdraw', 'takeLoan', 'robBank'],
  },
  {
    id: 'realestate',
    name: 'Maklerbüro',
    dative: 'zum Maklerbüro',
    icon: '🏠',
    position: { x: 200, y: 200 },
    // Alarmanlage und Versicherung gehoeren hierher statt in einen eigenen
    // zehnten Ort: das Maklerbuero verwaltet ohnehin alles rund um Immobilien,
    // und von den 25 Blockmitten waere sonst KEINE mehr frei (14 Immobilien,
    // 9 Orte) - die letzte bleibt bewusst fuer etwas Groesseres reserviert.
    actions: ['buyProperty', 'sellProperty', 'buyAlarm', 'setInsurance', 'upgradeProperty'],
  },
  {
    id: 'cityhall',
    name: 'Gewerbeamt',
    dative: 'zum Gewerbeamt',
    icon: '🏛️',
    // Am weitesten weg (~1170) - Firmen sind ohnehin ein spaeter Schritt.
    position: { x: 1800, y: 200 },
    actions: ['foundCompany', 'upgradeCompany'],
  },
  {
    id: 'hospital',
    name: 'Krankenhaus',
    dative: 'zum Krankenhaus',
    icon: '🏥',
    // Aehnliche Entfernung wie Bank/Maklerbuero (~850): kein spontaner
    // Zwischenstopp, aber ein bewusster, regelmaessig noetiger Weg.
    position: { x: 1400, y: 200 },
    actions: ['treatHealth'],
  },
  {
    id: 'gym',
    name: 'Fitnessstudio',
    dative: 'zum Fitnessstudio',
    icon: '💪',
    // Etwas weiter draussen als das Krankenhaus - Zufriedenheit ist dringlich,
    // aber nie lebensbedrohlich, ein laengerer Weg dorthin passt dazu.
    position: { x: 1800, y: 1000 },
    actions: ['relax'],
  },
  {
    id: 'lawoffice',
    name: 'Anwaltskanzlei',
    dative: 'zur Anwaltskanzlei',
    icon: '⚖️',
    // Absichtlich weit vom Startpunkt (~1170): der legale Weg aus der Fahndung
    // verlangt eine Fahrt quer durch die Stadt, mit der Polizei im Nacken. Genau
    // das ist der Gegenwert zur schnellen, aber riskanten Bestechung.
    position: { x: 1400, y: 1800 },
    actions: ['hireLawyer'],
  },
  {
    id: 'townhall',
    name: 'Rathaus',
    dative: 'zum Rathaus',
    icon: '🗳️',
    // Erste Nutzung des neuen Bezirks (x > 2000). Bewusst am Rand des alten
    // Gebiets, nicht tief im neuen: waehlen soll ein Weg sein, aber kein
    // Ausflug - sonst sinkt die Beteiligung, und eine Wahl ohne Waehler ist
    // keine.
    position: { x: 2200, y: 1000 },
    actions: ['runForMayor', 'castVote', 'setTaxRate'],
  },
  {
    id: 'exchange',
    name: 'Börse',
    dative: 'zur Börse',
    icon: '📈',
    // Zweiter Bau im neuen Bezirk, gegenueber dem Rathaus. Dass Handeln einen
    // Weg kostet, ist Absicht: sonst wuerde man bei jedem Kursausschlag
    // nachjustieren, statt eine Entscheidung zu treffen.
    position: { x: 2200, y: 1800 },
    actions: ['buyShares', 'sellShares'],
  },
  {
    id: 'raceoffice',
    name: 'Rennleitung',
    dative: 'zur Rennleitung',
    icon: '🏁',
    // Direkt neben der Startlinie (2400/400), aber auf einer Blockmitte - die
    // Strecke selbst liegt auf Strassen und kann deshalb kein Ort sein.
    // Anmelden und Fahren sind getrennt: die Uhr laeuft erst am ersten
    // Kontrollpunkt los, man muss also nicht an der Linie stehen, wenn man zahlt.
    position: { x: 2200, y: 600 },
    actions: ['enterRace'],
  },
  {
    id: 'blackmarket',
    name: 'Hinterhof',
    dative: 'zum Hinterhof',
    icon: '🕶️',
    // Am weitesten draussen im neuen Bezirk. Bewusst neutral benannt: "Hinterhof"
    // statt "Schwarzmarkt" - der Ort steht auf der Karte, weil man ihn sonst
    // nie fände, gibt aber nicht preis, was dort gehandelt wird.
    position: { x: 2600, y: 600 },
    // Bandengruendung und Gebietsansprueche laufen ebenfalls hier - eine
    // Bande ist keine Sache fuers Gewerbeamt.
    actions: ['buyIllegalItem', 'foundGang', 'claimTerritory'],
  },
  {
    id: 'dealership',
    name: 'Autohaus',
    dative: 'zum Autohaus',
    icon: '🚗',
    // Eine der letzten freien Blockmitten. Entfernung zum Startpunkt ~1020 -
    // passend, denn selbst der guenstigste Neuwagen (Roller, 500) ist keine
    // Anschaffung fuer die erste Spielminute.
    position: { x: 600, y: 1800 },
    actions: ['buyNewVehicle'],
  },
];

// Umkehrtabelle Aktion -> Ort, einmal beim Laden aufgebaut. Wird bei jeder
// gebundenen Aktion nachgeschlagen, deshalb nicht bei jedem Aufruf neu bauen.
const PLACE_BY_ACTION = new Map();
for (const place of PLACES) {
  for (const action of place.actions) PLACE_BY_ACTION.set(action, place);
}

/** Der fuer eine Aktion noetige Ort, oder null wenn die Aktion ortsungebunden ist. */
function findPlaceForAction(action) {
  return PLACE_BY_ACTION.get(action) || null;
}

/** Ist der Spieler nah genug an diesem Ort? Fahrzeug spielt keine Rolle - man haelt davor. */
function isPlayerAtPlace(player, place) {
  if (!player || !player.position || !place) return false;
  const dx = player.position.x - place.position.x;
  const dy = player.position.y - place.position.y;
  return Math.hypot(dx, dy) <= PLACE_INTERACT_RANGE;
}

/**
 * Kollisionsflaechen der Ortsgebaeude - im gleichen Format wie die der
 * Immobilien, damit man nicht hindurchlaufen kann.
 */
function buildPlaceCollisionRects() {
  return PLACES.map((p) => ({ x: p.position.x, y: p.position.y, w: PLACE_SIZE, d: PLACE_SIZE }));
}

/**
 * Katalog fuer den Client: Position, Name und die dort moeglichen Aktionen.
 * Der Client leitet daraus BEIDES ab - die Beschriftung in der 3D-Stadt und die
 * Fehlermeldung "dafuer musst du zum ...". Dadurch muss der Server bei einer
 * Ablehnung nur 'too_far' schicken und keinen Ortsnamen mitsenden.
 */
function buildPlacesCatalog() {
  return PLACES.map((p) => ({
    id: p.id,
    name: p.name,
    // Dativform fuer Meldungen ("Dafuer musst du ZUR Bankfiliale"). Als eigenes
    // Feld, weil sich der Artikel nicht aus dem Namen ableiten laesst.
    dative: p.dative,
    icon: p.icon,
    position: { ...p.position },
    actions: [...p.actions],
    size: PLACE_SIZE,
    range: PLACE_INTERACT_RANGE,
  }));
}

module.exports = {
  PLACES,
  PLACE_SIZE,
  PLACE_INTERACT_RANGE,
  findPlaceForAction,
  isPlayerAtPlace,
  buildPlaceCollisionRects,
  buildPlacesCatalog,
};
