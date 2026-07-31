'use strict';

// server/world.js
// Erzeugt den Stadtaufbau: Strassenraster + Gebaeude. Alles deterministisch aus
// einem festen Startwert, damit der Aufbau bei jedem Serverstart identisch ist.
//
// WICHTIG: Der Client bekommt diese Daten beim Beitritt zugeschickt und rendert
// bzw. kollidiert genau damit. So gibt es nur EINE Quelle der Wahrheit - der
// Aufbau kann nicht zwischen Server und Client auseinanderlaufen.

// EINZIGE Definition der Weltgroesse auf dem Server. player.js leitet
// WORLD_WIDTH/HEIGHT daraus ab - vorher stand die Zahl dort ein zweites Mal,
// mit einem Kommentar "muss uebereinstimmen" statt einer echten Verbindung.
// Die dritte Kopie in client/net.js bleibt unvermeidbar (kein Build-Schritt),
// sie faellt damit unter Grundprinzip 2: aendert man hier, muss man dort mit.
//
// 5600: bei Raster 400 ergibt das 14x14 = 196 Blockmitten. Die Vergroesserung
// von 2000 auf 2800 hatte einen messbaren Grund (das Raster war erschoepft,
// die Stadt erzeugte nur noch drei Dekogebaeude). Dieser Schritt hat ihn NICHT
// - er ist eine bewusste Entscheidung fuer eine groessere Welt, nicht die
// Behebung eines Engpasses. Wer sie zurueckdreht, verliert nur Flaeche.
//
// ALLE bestehenden Inhalte liegen unveraendert im Bereich 0..2800, also im
// Nordwest-Quadranten. Wege und Balancing zwischen ihnen bleiben damit exakt
// wie abgestimmt; die drei neuen Quadranten sind zusaetzliche Flaeche.
//
// Alle bestehenden Positionen (Immobilien, Orte, Startpunkt, Parkplaetze,
// Gefaengnis) liegen unveraendert im alten Bereich - Wege und Balancing bleiben
// damit exakt so, wie sie abgestimmt wurden.
const WORLD_SIZE = 5600;

const ROAD_SPACING = 400;  // Abstand der Strassen im Raster
const ROAD_WIDTH = 90;     // Breite der Strassen (begehbarer Korridor)
const BLOCK_MARGIN = 25;   // Abstand der Gebaeude zur Strasse

// Breite der Gasse zwischen zwei Gebaeuden im selben Block. MUSS deutlich groesser
// als 2 x PLAYER_COLLISION_RADIUS (= 36) sein. Sonst ueberlappen die um den
// Spielerradius aufgeweiteten Kollisionsflaechen, und es entsteht eine Zone, in
// der die Figur zwischen beiden Gebaeuden hin- und hergeschoben wird - genau
// dieser Fehler trat auf (Luecke war nur ~21 Einheiten).
const ALLEY_WIDTH = 90;

const PLAYER_COLLISION_RADIUS = 18; // Server-Einheiten - wie "dick" die Figur bei Kollision ist

// Startpunkt BEWUSST auf einer Strassenkreuzung (Vielfaches von ROAD_SPACING) und
// NICHT in der Weltmitte: dort steht jetzt ein Gebaeude, Spieler wuerden sonst
// mitten in einer Wand erscheinen und herausgeschoben werden.
const SPAWN_POSITION = { x: 800, y: 800 };

/** Einfacher, reproduzierbarer Zufallsgenerator (damit der Aufbau immer gleich ist). */
function makeSeededRandom(seed) {
  let state = seed >>> 0;
  return function next() {
    // xorshift32 - reicht voellig fuer Layout-Erzeugung
    state ^= state << 13; state >>>= 0;
    state ^= state >> 17;
    state ^= state << 5; state >>>= 0;
    return state / 4294967296;
  };
}

/**
 * Erzeugt den kompletten Stadtaufbau.
 * @param {Array} reservedSpots Standorte, die freigehalten werden (die kaufbaren
 *   Immobilien) - dort wird kein Deko-Gebaeude platziert, sonst stuenden zwei
 *   Gebaeude ineinander.
 * Rueckgabe: { roads: [...], buildings: [...] }
 * Jedes Gebaeude ist ein achsenparalleles Rechteck { x, y, w, d, height, kind }.
 * "x/y" ist die MITTE des Rechtecks (passt zu den Immobilien-Positionen).
 */
function buildCityLayout(reservedSpots) {
  const reserved = Array.isArray(reservedSpots) ? reservedSpots : [];
  const rand = makeSeededRandom(20260724);

  const roads = [];
  const gridLines = [];
  for (let v = 0; v <= WORLD_SIZE; v += ROAD_SPACING) gridLines.push(v);

  for (const v of gridLines) {
    roads.push({ orientation: 'vertical', center: v, width: ROAD_WIDTH });
    roads.push({ orientation: 'horizontal', center: v, width: ROAD_WIDTH });
  }

  const buildings = [];
  const halfRoad = ROAD_WIDTH / 2;

  // Ueber alle Bloecke zwischen den Strassen laufen
  for (let bx = 0; bx < gridLines.length - 1; bx++) {
    for (let by = 0; by < gridLines.length - 1; by++) {
      const blockMinX = gridLines[bx] + halfRoad + BLOCK_MARGIN;
      const blockMaxX = gridLines[bx + 1] - halfRoad - BLOCK_MARGIN;
      const blockMinY = gridLines[by] + halfRoad + BLOCK_MARGIN;
      const blockMaxY = gridLines[by + 1] - halfRoad - BLOCK_MARGIN;

      const blockW = blockMaxX - blockMinX;
      const blockD = blockMaxY - blockMinY;
      if (blockW < 60 || blockD < 60) continue;

      const centerX = blockMinX + blockW / 2;
      const centerY = blockMinY + blockD / 2;

      // Wird dieser Block von einer kaufbaren Immobilie belegt? Dann freihalten.
      const isReserved = reserved.some(
        (spot) => Math.abs(spot.x - centerX) < ROAD_SPACING / 2 && Math.abs(spot.y - centerY) < ROAD_SPACING / 2
      );
      if (isReserved) continue;

      // Pro Block 1 oder 2 Gebaeude, damit es abwechslungsreich statt schematisch wirkt
      const buildingCount = rand() < 0.45 ? 2 : 1;

      if (buildingCount === 1) {
        const w = blockW * (0.55 + rand() * 0.4);
        const d = blockD * (0.55 + rand() * 0.4);
        buildings.push({
          x: centerX,
          y: centerY,
          w, d,
          height: 8 + rand() * 26,
          kind: 'decor',
        });
      } else {
        // Zwei Gebaeude mit einer begehbaren Gasse dazwischen. Die Gassenbreite
        // ist FEST (nicht prozentual), damit sie garantiert breit genug bleibt.
        const splitHorizontally = rand() < 0.5;
        const availableAcross = (splitHorizontally ? blockW : blockD) - ALLEY_WIDTH;

        // Reicht der Platz nicht fuer zwei Gebaeude + Gasse, dann lieber nur eines
        // bauen als eine zu enge Gasse zu erzeugen.
        if (availableAcross < 80) {
          buildings.push({
            x: centerX, y: centerY,
            w: blockW * 0.8, d: blockD * 0.8,
            height: 8 + rand() * 26,
            kind: 'decor',
          });
          continue;
        }

        const sizeAcross = availableAcross / 2;
        const offset = ALLEY_WIDTH / 2 + sizeAcross / 2;

        for (let i = 0; i < 2; i++) {
          const sign = i === 0 ? -1 : 1;
          buildings.push({
            x: splitHorizontally ? centerX + sign * offset : centerX,
            y: splitHorizontally ? centerY : centerY + sign * offset,
            w: splitHorizontally ? sizeAcross : blockW * (0.6 + rand() * 0.3),
            d: splitHorizontally ? blockD * (0.6 + rand() * 0.3) : sizeAcross,
            height: 8 + rand() * 26,
            kind: 'decor',
          });
        }
      }
    }
  }

  return { roads, buildings, roadSpacing: ROAD_SPACING, roadWidth: ROAD_WIDTH, worldSize: WORLD_SIZE };
}

// Mehrere Aufloesungsdurchgaenge: Ein einzelner Durchgang reicht nicht, weil das
// Herausschieben aus einem Gebaeude in ein benachbartes hineinschieben kann, das
// dann zurueckschiebt - die Figur blieb dadurch stecken. Mit mehreren Durchgaengen
// klingt das zuverlaessig aus. MUSS im Client identisch sein.
const COLLISION_PASSES = 4;

/**
 * Schiebt eine Position aus allen ueberlappenden Rechtecken heraus.
 * MUSS im Client identisch implementiert sein (siehe client/net.js) - sonst
 * driftet die Vorhersage von der Server-Wahrheit ab.
 * Veraendert pos und vel direkt.
 */
function resolveCollisions(pos, vel, rects, radius) {
  for (let pass = 0; pass < COLLISION_PASSES; pass++) {
    let anyOverlap = false;

    for (const r of rects) {
      const halfW = r.w / 2 + radius;
      const halfD = r.d / 2 + radius;

      const dx = pos.x - r.x;
      const dy = pos.y - r.y;

      // Kein Ueberlapp -> naechstes Rechteck
      if (Math.abs(dx) >= halfW || Math.abs(dy) >= halfD) continue;

      anyOverlap = true;

      // Ueberlapp vorhanden: auf der Achse mit der GERINGSTEN Eindringtiefe
      // herausschieben - so rutscht man an Waenden entlang statt haengenzubleiben.
      const overlapX = halfW - Math.abs(dx);
      const overlapY = halfD - Math.abs(dy);

      if (overlapX < overlapY) {
        pos.x += dx >= 0 ? overlapX : -overlapX;
        vel.x = 0;
      } else {
        pos.y += dy >= 0 ? overlapY : -overlapY;
        vel.y = 0;
      }
    }

    if (!anyOverlap) break; // frueh raus, wenn nichts mehr ueberlappt
  }
}

module.exports = {
  buildCityLayout,
  resolveCollisions,
  PLAYER_COLLISION_RADIUS,
  SPAWN_POSITION,
  ROAD_SPACING,
  ROAD_WIDTH,
  WORLD_SIZE,
};
