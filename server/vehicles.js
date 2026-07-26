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

function findVehicleType(typeId) {
  return VEHICLE_TYPES.find((t) => t.id === typeId) || null;
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
  findVehicleType,
  createInitialVehicles,
  buildVehicleCatalog,
};
