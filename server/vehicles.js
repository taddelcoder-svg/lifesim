'use strict';

// server/vehicles.js
// Fahrzeugtypen und deren Startpositionen. Fahrzeuge stehen an Strassen geparkt,
// koennen gekauft oder geklaut werden (letzteres erhoeht das Fahndungslevel).

const VEHICLE_TYPES = [
  { id: 'scooter', name: 'Roller',      price: 400,  speed: 340, acceleration: 2200, friction: 2600 },
  { id: 'compact', name: 'Kleinwagen',  price: 1200, speed: 460, acceleration: 1600, friction: 2000 },
  { id: 'sedan',   name: 'Limousine',   price: 2800, speed: 580, acceleration: 1300, friction: 1700 },
  { id: 'sports',  name: 'Sportwagen',  price: 6000, speed: 760, acceleration: 1900, friction: 2400 },
];

// Fest vorgegebene Parkplaetze an Strassenkreuzungen bzw. Strassenraendern.
// Bewusst NICHT zufaellig: so ist nach jedem Serverstart alles am gleichen Ort,
// und die Plaetze liegen garantiert nicht in Gebaeuden.
const VEHICLE_SPAWNS = [
  { typeId: 'scooter', x: 800,  y: 760 },
  { typeId: 'scooter', x: 400,  y: 1240 },
  { typeId: 'compact', x: 1200, y: 840 },
  { typeId: 'compact', x: 760,  y: 1600 },
  { typeId: 'compact', x: 1600, y: 440 },
  { typeId: 'sedan',   x: 400,  y: 400 },
  { typeId: 'sedan',   x: 1240, y: 1600 },
  { typeId: 'sports',  x: 1600, y: 1600 },
];

// So nah muss man sein, um einzusteigen (Server-Einheiten)
const VEHICLE_ENTER_RANGE = 70;

// Ein fremdes Fahrzeug zu klauen erhoeht das Fahndungslevel um diesen Wert.
const VEHICLE_THEFT_WANTED = 2;

// --- Autohaus: Neuwagen ---
//
// Bis hierher gab es genau 8 Fahrzeuge in der ganzen Welt, die nie nachgebildet
// wurden - bei bis zu 20 Mitspielern kam ab dem achten Besitzer niemand mehr
// legal an ein Auto. Das Autohaus erzeugt frische Fahrzeuge.
//
// Neuwagen kosten einen Aufschlag, damit der Gebrauchtwagen am Strassenrand die
// guenstigere Option bleibt: wer als Erster da ist, faehrt billiger.
const NEW_VEHICLE_PRICE_MULT = 1.25;

// Obergrenzen. MAX_OWNED_VEHICLES verhindert, dass ein einzelner Spieler den
// Bestand aufkauft; MAX_VEHICLES ist die harte Grenze gegen unbegrenztes
// Wachstum der Welt (Darstellung, Speichergroesse, Broadcast-Umfang).
const MAX_OWNED_VEHICLES = 2;
const MAX_VEHICLES = 32;

// Abstellplaetze rund um das Autohaus. ACHTUNG, dieselbe Diagonalen-Falle wie
// bei PLACE_INTERACT_RANGE: die Kollisionsflaeche ist ein achsenparalleles
// Quadrat, um den Figurenradius aufgeweitet 93 pro Halbachse. Seitlich ist ab 93
// alles frei - diagonal aber erst ab 93 / cos(45 Grad) = 131,5.
//
// Ein einheitlicher Radius von 115 sah richtig aus und war es auf den vier
// Achsen auch; die vier Diagonalplaetze lagen jedoch mitten im Gebaeude
// (115 x cos45 = 81 < 93). Deshalb zwei Radien:
//   - Achsen:    115 (frei ab 93)
//   - Diagonalen: 145 (ergibt 102,5 pro Achse, frei ab 93)
// Beide bleiben unter 155, der inneren Strassenkante - es parkt also niemand
// mitten auf der Fahrbahn.
const DEALERSHIP_SLOT_RADIUS_AXIS = 115;
const DEALERSHIP_SLOT_RADIUS_DIAGONAL = 145;
const DEALERSHIP_SLOT_COUNT = 8;

function findVehicleType(typeId) {
  return VEHICLE_TYPES.find((t) => t.id === typeId) || null;
}

/** Preis eines Neuwagens beim Autohaus (inkl. Aufschlag). */
function newVehiclePrice(type) {
  return Math.round(type.price * NEW_VEHICLE_PRICE_MULT);
}

/** Abstellplatz Nummer n rund um das Autohaus. */
function dealershipSlot(center, n) {
  const index = ((n % DEALERSHIP_SLOT_COUNT) + DEALERSHIP_SLOT_COUNT) % DEALERSHIP_SLOT_COUNT;
  const angle = index * (2 * Math.PI / DEALERSHIP_SLOT_COUNT);
  // Ungerade Plaetze liegen auf den Diagonalen und brauchen den groesseren Radius.
  const radius = index % 2 === 0 ? DEALERSHIP_SLOT_RADIUS_AXIS : DEALERSHIP_SLOT_RADIUS_DIAGONAL;
  return {
    x: Math.round(center.x + Math.cos(angle) * radius),
    y: Math.round(center.y + Math.sin(angle) * radius),
  };
}

/** Erzeugt die Fahrzeuge fuer eine frische Welt. */
function createInitialVehicles() {
  const vehicles = new Map();
  let nextId = 1;
  for (const spawn of VEHICLE_SPAWNS) {
    const type = findVehicleType(spawn.typeId);
    if (!type) continue;
    const id = nextId++;
    vehicles.set(id, {
      id,
      typeId: type.id,
      x: spawn.x,
      y: spawn.y,
      ownerId: null,   // null = niemandem gehoerend (kaufbar/klaubar)
      driverId: null,  // wer gerade drin sitzt
      // false = feste Weltausstattung. Diese 8 kehren bei Tod/Abmeldung des
      // Besitzers in den freien Bestand zurueck. Neuwagen aus dem Autohaus
      // (spawned: true) werden stattdessen entfernt - sonst waechst der Bestand
      // mit jeder Reinkarnation weiter an.
      spawned: false,
    });
  }
  return { vehicles, nextVehicleId: nextId };
}

/** Oeffentlicher Katalog fuer den Client (Namen, Preise, Geschwindigkeiten). */
function buildVehicleCatalog() {
  return VEHICLE_TYPES.map((t) => ({
    id: t.id,
    name: t.name,
    price: t.price,
    speed: t.speed,
    acceleration: t.acceleration,
    friction: t.friction,
  }));
}

module.exports = {
  VEHICLE_TYPES,
  VEHICLE_SPAWNS,
  VEHICLE_ENTER_RANGE,
  VEHICLE_THEFT_WANTED,
  NEW_VEHICLE_PRICE_MULT,
  MAX_OWNED_VEHICLES,
  MAX_VEHICLES,
  newVehiclePrice,
  dealershipSlot,
  findVehicleType,
  createInitialVehicles,
  buildVehicleCatalog,
};
