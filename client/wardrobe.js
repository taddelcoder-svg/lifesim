/* global THREE */

/**
 * ============================================================
 *  Spielfigur und Kleiderschrank
 * ============================================================
 *
 * Die Figur war bisher ein Zylinder mit Kugel obendrauf und einem Kegel als
 * Nase. Hier entsteht stattdessen eine gegliederte Figur aus Kopf, Rumpf,
 * zwei Armen und zwei Beinen, dazu Frisur, Kopfbedeckung, Brille und Rucksack.
 *
 * Warum getrennte Koerperteile und nicht ein fertiges Modell: In keinem der
 * Modellpakete steckt eine Figur. Aus Grundformen gebaut hat ausserdem zwei
 * Vorteile, die ein fertiges Modell nicht haette - jedes Kleidungsstueck ist
 * nur eine Farbe und eine Form statt einer eigenen Datei, und die Gliedmassen
 * existieren als eigene Objekte und lassen sich spaeter zum Laufen bewegen.
 *
 * MASSE: Die Gesamthoehe bleibt bei rund 1.52 Einheiten, genau wie bei der
 * alten Figur. Das ist kein Zufall, sondern Bedingung: Kamerahoehe,
 * Namensschilder, der Abstand des Haustiers und die Gefaengnis-Darstellung
 * sind alle auf diese Groesse eingestellt.
 */

const FIG_LEG_HEIGHT = 0.45;   // Boden bis Huefte
const FIG_TORSO_HEIGHT = 0.55; // Huefte bis Schulter -> Schulter bei 1.00
const FIG_HEAD_RADIUS = 0.26;  // Kopfmitte bei 1.26, Scheitel bei 1.52
const FIG_TORSO_WIDTH = 0.46;
const FIG_TORSO_DEPTH = 0.28;
const FIG_LIMB_RADIUS = 0.075;
const FIG_SHOE_HEIGHT = 0.09;

const FIG_SHOULDER_Y = FIG_LEG_HEIGHT + FIG_TORSO_HEIGHT;
const FIG_HEAD_Y = FIG_SHOULDER_Y + FIG_HEAD_RADIUS;
const FIG_TOP_Y = FIG_SHOULDER_Y + FIG_HEAD_RADIUS * 2;

/**
 * Nachschlagewerk fuer Kleidungsstuecke, gefuellt aus der wardrobeState-
 * Nachricht des Servers.
 *
 * Bewusst KEINE zweite Kopie des Katalogs im Client: Preise und Farben stehen
 * ausschliesslich in server/appearance.js. Liefe hier eine eigene Liste mit,
 * waere sie beim ersten neuen Kleidungsstueck veraltet - und der Fehler waere
 * ein falsch gefaerbtes Hemd bei anderen Spielern, also genau die Sorte
 * Fehler, die niemand meldet.
 */
const clothingById = new Map();

function updateClothingCatalog(items) {
  if (!Array.isArray(items)) return;
  for (const i of items) clothingById.set(i.id, i);
}

function clothingInfo(id) {
  return id ? clothingById.get(id) || null : null;
}

/** Farbe eines getragenen Teils, mit Rueckfallwert bis der Katalog da ist. */
function slotColor(appearance, slot, fallback) {
  const info = clothingInfo(appearance && appearance[slot]);
  return info && typeof info.color === 'number' ? info.color : fallback;
}

function slotShape(appearance, slot) {
  const info = clothingInfo(appearance && appearance[slot]);
  return info ? info.shape : null;
}

function mat(color) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0.05 });
}


/**
 * Kopfbedeckung als eigene Gruppe.
 *
 * Bewusst herausgeloest: sowohl die selbstgebaute Figur als auch die fertigen
 * Kenney-Figuren sollen Huete tragen koennen. Bei den fertigen ist Kleidung in
 * die Textur gemalt und unveraenderlich - Zubehoer aus echter Geometrie ist
 * das Einzige, was sich dort noch anstecken laesst, und darum umso wichtiger.
 *
 * @param {number} kopfRadius  halbe Kopfbreite des Traegers, damit derselbe
 *                             Hut auf den schmalen Kugelkopf der eigenen Figur
 *                             UND auf den breiten Klotzkopf der Kenney-Figur passt
 */
function buildHatGroup(a, kopfRadius) {
  const hutForm = slotShape(a, 'hat');
  if (!hutForm) return null;

  const R = kopfRadius;
  const hutMat = mat(slotColor(a, 'hat', 0x2a2c30));
  const hut = new THREE.Group();
  hut.position.y = R * 0.55;

  if (hutForm === 'cap') {
    const krone = new THREE.Mesh(
      new THREE.SphereGeometry(R * 1.05, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.5),
      hutMat,
    );
    krone.position.y = -R * 0.15;
    hut.add(krone);
    const schirm = new THREE.Mesh(new THREE.BoxGeometry(R * 1.15, R * 0.1, R * 0.7), hutMat);
    schirm.position.set(0, -R * 0.15, R * 0.95);
    hut.add(schirm);
  } else if (hutForm === 'beanie') {
    const muetze = new THREE.Mesh(
      new THREE.SphereGeometry(R * 1.1, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.62),
      hutMat,
    );
    muetze.position.y = -R * 0.23;
    hut.add(muetze);
    const bommel = new THREE.Mesh(new THREE.SphereGeometry(R * 0.23, 8, 6), hutMat);
    bommel.position.y = R * 0.55;
    hut.add(bommel);
  } else if (hutForm === 'helm') {
    const schale = new THREE.Mesh(
      new THREE.SphereGeometry(R * 1.12, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.5),
      hutMat,
    );
    schale.position.y = -R * 0.19;
    hut.add(schale);
    const rand = new THREE.Mesh(new THREE.TorusGeometry(R * 1.1, R * 0.085, 6, 16), hutMat);
    rand.rotation.x = Math.PI / 2;
    rand.position.y = -R * 0.19;
    hut.add(rand);
  } else if (hutForm === 'zylinder') {
    const rohr = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.85, R * 0.85, R * 1.15, 14), hutMat);
    rohr.position.y = R * 0.46;
    hut.add(rohr);
    const krempe = new THREE.Mesh(new THREE.CylinderGeometry(R * 1.45, R * 1.45, R * 0.1, 16), hutMat);
    krempe.position.y = -R * 0.11;
    hut.add(krempe);
  } else if (hutForm === 'krone') {
    const goldMat = new THREE.MeshStandardMaterial({
      color: slotColor(a, 'hat', 0xf0c020), metalness: 0.75, roughness: 0.3, side: THREE.DoubleSide,
    });
    const reif = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.92, R * 0.92, R * 0.38, 12, 1, true), goldMat);
    reif.position.y = R * 0.08;
    hut.add(reif);
    for (let i = 0; i < 6; i++) {
      const w = (i / 6) * Math.PI * 2;
      const zacke = new THREE.Mesh(new THREE.ConeGeometry(R * 0.13, R * 0.42, 4), goldMat);
      zacke.position.set(Math.sin(w) * R * 0.9, R * 0.46, Math.cos(w) * R * 0.9);
      hut.add(zacke);
    }
  }

  hut.traverse((c) => { if (c.isMesh) c.castShadow = true; });
  return hut;
}

/** Brille als eigene Gruppe, Masse relativ zum Kopf des Traegers. */
function buildGlassesGroup(a, kopfRadius) {
  const form = slotShape(a, 'glasses');
  if (!form) return null;

  const R = kopfRadius;
  const brilleMat = form === 'sonne'
    ? new THREE.MeshStandardMaterial({ color: slotColor(a, 'glasses', 0x141518), metalness: 0.5, roughness: 0.25 })
    : mat(slotColor(a, 'glasses', 0x2a2c30));
  const brille = new THREE.Group();

  for (const seite of [-1, 1]) {
    const glas = form === 'rund'
      ? new THREE.Mesh(new THREE.TorusGeometry(R * 0.21, R * 0.046, 6, 14), brilleMat)
      : new THREE.Mesh(new THREE.BoxGeometry(R * 0.4, R * 0.27, R * 0.06), brilleMat);
    glas.position.set(seite * R * 0.38, 0, R * 0.08);
    brille.add(glas);
  }
  const steg = new THREE.Mesh(new THREE.BoxGeometry(R * 0.35, R * 0.046, R * 0.046), brilleMat);
  steg.position.z = R * 0.08;
  brille.add(steg);

  return brille;
}

/** Rucksack als eigene Gruppe, Masse relativ zur Rumpfbreite. */
function buildBackGroup(a, breite, hoehe, tiefe) {
  if (slotShape(a, 'back') !== 'rucksack') return null;

  const rucksackMat = mat(slotColor(a, 'back', 0x6a6f78));
  const gruppe = new THREE.Group();

  const rucksack = new THREE.Mesh(
    new THREE.BoxGeometry(breite * 0.78, hoehe * 0.78, tiefe * 0.6),
    rucksackMat,
  );
  rucksack.position.z = -(tiefe / 2 + tiefe * 0.3);
  rucksack.castShadow = true;
  gruppe.add(rucksack);

  for (const seite of [-1, 1]) {
    const riemen = new THREE.Mesh(new THREE.BoxGeometry(breite * 0.11, hoehe * 0.72, tiefe * 0.08), rucksackMat);
    riemen.position.set(seite * breite * 0.28, 0, tiefe / 2 + 0.005);
    gruppe.add(riemen);
  }

  return gruppe;
}

/**
 * Baut die selbst zusammengestellte Figur aus Grundformen.
 *
 * @param {Object} appearance  getragene Teile je Platz (aus serializePublic)
 * @param {Object} tint        Rueckfallfarben, wenn der Katalog fehlt
 * @returns {Object} { group, parts, bodyMat, headMat }
 */
function buildSimpleCharacter(appearance, tint) {
  const group = new THREE.Group();
  const a = appearance || {};
  const rueck = tint || { body: 0x4a7cff, head: 0xe0b48c };

  const hautFarbe = slotColor(a, 'skin', rueck.head);
  const shirtFarbe = slotColor(a, 'shirt', rueck.body);
  const hoseFarbe = slotColor(a, 'pants', 0x3a5a8a);
  const schuhFarbe = slotColor(a, 'shoes', 0xe8e8e8);

  const hautMat = mat(hautFarbe);
  const shirtMat = mat(shirtFarbe);
  const hoseMat = mat(hoseFarbe);
  const schuhMat = mat(schuhFarbe);

  const hosenForm = slotShape(a, 'pants');
  const shirtForm = slotShape(a, 'shirt');

  // --- Beine -----------------------------------------------------------
  // Shorts und Rock lassen den Unterschenkel frei - dafuer wird das Bein in
  // zwei Abschnitte geteilt, oben Stoff, unten Haut. Bei langer Hose sind
  // beide Abschnitte Stoff, dann sieht man die Teilung nicht.
  const rock = hosenForm === 'rock';
  const kurz = hosenForm === 'shorts';
  const stoffAnteil = rock ? 0.55 : (kurz ? 0.45 : 1);

  const beine = [];
  for (const seite of [-1, 1]) {
    const bein = new THREE.Group();
    bein.position.set(seite * 0.12, FIG_LEG_HEIGHT, 0);

    // Die Beine haengen an der Huefte und zeigen nach UNTEN. Dadurch dreht
    // eine spaetere Laufanimation sie um den richtigen Punkt - waeren sie
    // mittig verankert, wuerde das Bein beim Ausschlagen im Boden versinken.
    const oben = new THREE.Mesh(
      new THREE.CylinderGeometry(FIG_LIMB_RADIUS * 1.15, FIG_LIMB_RADIUS, FIG_LEG_HEIGHT * stoffAnteil, 8),
      rock ? hoseMat : hoseMat,
    );
    oben.position.y = -FIG_LEG_HEIGHT * stoffAnteil / 2;
    oben.castShadow = true;
    bein.add(oben);

    if (stoffAnteil < 1) {
      const unten = new THREE.Mesh(
        new THREE.CylinderGeometry(FIG_LIMB_RADIUS, FIG_LIMB_RADIUS, FIG_LEG_HEIGHT * (1 - stoffAnteil), 8),
        hautMat,
      );
      unten.position.y = -FIG_LEG_HEIGHT * stoffAnteil - FIG_LEG_HEIGHT * (1 - stoffAnteil) / 2;
      unten.castShadow = true;
      bein.add(unten);
    }

    const schuh = new THREE.Mesh(
      new THREE.BoxGeometry(FIG_LIMB_RADIUS * 2.6, FIG_SHOE_HEIGHT, FIG_LIMB_RADIUS * 3.6),
      schuhMat,
    );
    schuh.position.set(0, -FIG_LEG_HEIGHT + FIG_SHOE_HEIGHT / 2, 0.03);
    schuh.castShadow = true;
    bein.add(schuh);

    group.add(bein);
    beine.push(bein);
  }

  // Rock als eigener Kegelstumpf ueber der Huefte
  if (rock) {
    const rockMesh = new THREE.Mesh(
      new THREE.CylinderGeometry(FIG_TORSO_WIDTH * 0.42, FIG_TORSO_WIDTH * 0.72, 0.26, 12, 1, true),
      new THREE.MeshStandardMaterial({ color: hoseFarbe, side: THREE.DoubleSide, roughness: 0.85 }),
    );
    rockMesh.position.y = FIG_LEG_HEIGHT + 0.04;
    rockMesh.castShadow = true;
    group.add(rockMesh);
  }

  // --- Rumpf -----------------------------------------------------------
  // Jacken und Hoodies tragen etwas auf, Hemd und T-Shirt nicht. Ein Wert
  // statt eigener Formen: der Unterschied ist aus der Verfolgerkamera genau
  // so weit erkennbar, wie er sein muss.
  const dicke = (shirtForm === 'jacke' || shirtForm === 'hoodie' || shirtForm === 'anzug') ? 1.12 : 1;
  const rumpf = new THREE.Mesh(
    new THREE.BoxGeometry(FIG_TORSO_WIDTH * dicke, FIG_TORSO_HEIGHT, FIG_TORSO_DEPTH * dicke),
    shirtMat,
  );
  rumpf.position.y = FIG_LEG_HEIGHT + FIG_TORSO_HEIGHT / 2;
  rumpf.castShadow = true;
  group.add(rumpf);

  // Warnweste und Anzug bekommen einen sichtbaren Aufschlag vorne, damit sie
  // sich von einem einfarbigen T-Shirt derselben Farbe unterscheiden.
  if (shirtForm === 'weste' || shirtForm === 'anzug' || shirtForm === 'hemd') {
    const streifenFarbe = shirtForm === 'weste' ? 0xf8f8f8 : (shirtForm === 'anzug' ? 0xf0f0f0 : 0x2a2c30);
    const streifen = new THREE.Mesh(
      new THREE.BoxGeometry(shirtForm === 'hemd' ? 0.05 : FIG_TORSO_WIDTH * 0.7, FIG_TORSO_HEIGHT * 0.8, 0.02),
      mat(streifenFarbe),
    );
    streifen.position.set(0, FIG_LEG_HEIGHT + FIG_TORSO_HEIGHT / 2, FIG_TORSO_DEPTH * dicke / 2 + 0.01);
    group.add(streifen);
  }

  // --- Arme ------------------------------------------------------------
  // Kurze Aermel bei T-Shirt und Weste, lange bei allem anderen.
  const kurzarm = shirtForm === 'tee' || shirtForm === 'weste' || !shirtForm;
  const armLaenge = 0.44;
  const aermelAnteil = kurzarm ? 0.4 : 0.85;

  const arme = [];
  for (const seite of [-1, 1]) {
    const arm = new THREE.Group();
    arm.position.set(seite * (FIG_TORSO_WIDTH * dicke / 2 + FIG_LIMB_RADIUS * 0.7), FIG_SHOULDER_Y - 0.04, 0);

    const aermel = new THREE.Mesh(
      new THREE.CylinderGeometry(FIG_LIMB_RADIUS, FIG_LIMB_RADIUS * 0.9, armLaenge * aermelAnteil, 8),
      shirtMat,
    );
    aermel.position.y = -armLaenge * aermelAnteil / 2;
    aermel.castShadow = true;
    arm.add(aermel);

    const haut = new THREE.Mesh(
      new THREE.CylinderGeometry(FIG_LIMB_RADIUS * 0.9, FIG_LIMB_RADIUS * 0.85, armLaenge * (1 - aermelAnteil), 8),
      hautMat,
    );
    haut.position.y = -armLaenge * aermelAnteil - armLaenge * (1 - aermelAnteil) / 2;
    haut.castShadow = true;
    arm.add(haut);

    const hand = new THREE.Mesh(new THREE.SphereGeometry(FIG_LIMB_RADIUS * 1.05, 8, 6), hautMat);
    hand.position.y = -armLaenge;
    arm.add(hand);

    group.add(arm);
    arme.push(arm);
  }

  // --- Kopf ------------------------------------------------------------
  const kopf = new THREE.Group();
  kopf.position.y = FIG_HEAD_Y;
  group.add(kopf);

  const schaedel = new THREE.Mesh(new THREE.SphereGeometry(FIG_HEAD_RADIUS, 16, 12), hautMat);
  schaedel.castShadow = true;
  kopf.add(schaedel);

  // Nase auf +Z: sie ist der einzige Hinweis auf die Blickrichtung, solange
  // die Figur steht. Ohne sie wirkt eine stehende Figur richtungslos.
  const nase = new THREE.Mesh(new THREE.ConeGeometry(0.045, 0.1, 8), hautMat);
  nase.rotation.x = Math.PI / 2;
  nase.position.set(0, -0.01, FIG_HEAD_RADIUS + 0.03);
  kopf.add(nase);

  const augenMat = mat(0x1a1a1e);
  for (const seite of [-1, 1]) {
    const auge = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 6), augenMat);
    auge.position.set(seite * 0.1, 0.05, FIG_HEAD_RADIUS - 0.035);
    kopf.add(auge);
  }

  // --- Frisur ----------------------------------------------------------
  const haarForm = slotShape(a, 'hair');
  const haarFarbe = slotColor(a, 'hair', 0x5a3a20);
  if (haarForm && haarForm !== 'glatze') {
    const haarMat = mat(haarFarbe);

    if (haarForm === 'kurz' || haarForm === 'lang') {
      // Halbkugel als Kappe. phiStart/phiLength schneiden die untere Haelfte
      // weg, sonst haette die Figur Haare im Gesicht.
      const kappe = new THREE.Mesh(
        new THREE.SphereGeometry(FIG_HEAD_RADIUS * 1.06, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.58),
        haarMat,
      );
      kappe.position.y = 0.01;
      kappe.castShadow = true;
      kopf.add(kappe);

      if (haarForm === 'lang') {
        const laenge = new THREE.Mesh(
          new THREE.CylinderGeometry(FIG_HEAD_RADIUS * 0.85, FIG_HEAD_RADIUS * 0.7, 0.42, 12, 1, true),
          new THREE.MeshStandardMaterial({ color: haarFarbe, side: THREE.DoubleSide, roughness: 0.9 }),
        );
        laenge.position.set(0, -0.2, -0.05);
        laenge.castShadow = true;
        kopf.add(laenge);
      }
    } else if (haarForm === 'afro') {
      const afro = new THREE.Mesh(new THREE.SphereGeometry(FIG_HEAD_RADIUS * 1.42, 14, 10), haarMat);
      afro.position.y = 0.07;
      afro.castShadow = true;
      kopf.add(afro);
    } else if (haarForm === 'irokese') {
      const kamm = new THREE.Mesh(
        new THREE.BoxGeometry(0.07, 0.22, FIG_HEAD_RADIUS * 1.7),
        haarMat,
      );
      kamm.position.y = FIG_HEAD_RADIUS * 0.86;
      kamm.castShadow = true;
      kopf.add(kamm);
    }
  }

  // --- Zubehoer --------------------------------------------------------
  const hut = buildHatGroup(a, FIG_HEAD_RADIUS);
  if (hut) kopf.add(hut);

  const brille = buildGlassesGroup(a, FIG_HEAD_RADIUS);
  if (brille) {
    brille.position.set(0, 0.05, FIG_HEAD_RADIUS - 0.02);
    kopf.add(brille);
  }

  const rucksack = buildBackGroup(a, FIG_TORSO_WIDTH, FIG_TORSO_HEIGHT, FIG_TORSO_DEPTH * dicke);
  if (rucksack) {
    rucksack.position.y = FIG_LEG_HEIGHT + FIG_TORSO_HEIGHT * 0.55;
    group.add(rucksack);
  }

  return {
    group,
    parts: { beine, arme, kopf, rumpf },
    // bodyMat/headMat behalten ihre alten Namen: die Gefaengnis-Darstellung
    // und die Spielerfarben greifen an anderer Stelle darauf zu, und ein
    // Umbenennen wuerde dort still ins Leere laufen.
    bodyMat: shirtMat,
    headMat: hautMat,
  };
}



/**
 * Baut eine fertige Figur aus dem Kenney-Pack.
 *
 * Diese 18 Figuren sind KOMPLETTE Charaktere - Haut, Frisur und Kleidung sind
 * in eine Textur gemalt und lassen sich nicht einzeln tauschen. Deshalb blendet
 * der Laden bei ihnen die Kleiderauswahl aus. Was bleibt, ist Zubehoer aus
 * echter Geometrie: Hut, Brille und Rucksack werden hier angesteckt.
 *
 * Die Anbaupunkte werden GEMESSEN statt fest eingetragen. Der Klotzkopf dieser
 * Figuren ist deutlich breiter als der Kugelkopf der eigenen Figur, und feste
 * Werte haetten entweder dort oder hier danebengelegen.
 */
function buildBlockyCharacter(appearance, modelName, kitTemplates) {
  const roh = cloneKitModel(kitTemplates, modelName);
  if (!roh) return null;

  const group = new THREE.Group();
  group.add(roh);

  // Die benannten Teile heraussuchen. Kenney liefert head, torso, arm-left,
  // arm-right, leg-left und leg-right als eigene Knoten - genau die Gliederung,
  // die eine Laufanimation spaeter braucht.
  const teile = {};
  roh.traverse((c) => { if (c.name) teile[c.name] = c; });

  const kopf = teile.head || null;
  const rumpf = teile.torso || null;
  const arme = [teile['arm-left'], teile['arm-right']].filter(Boolean);
  const beine = [teile['leg-left'], teile['leg-right']].filter(Boolean);

  let kopfMat = null;
  let rumpfMat = null;
  if (kopf) kopf.traverse((c) => { if (c.isMesh && !kopfMat) kopfMat = c.material; });
  if (rumpf) rumpf.traverse((c) => { if (c.isMesh && !rumpfMat) rumpfMat = c.material; });

  // --- Zubehoer anstecken ---
  if (kopf) {
    const kopfBox = new THREE.Box3().setFromObject(kopf);
    const kopfMass = new THREE.Vector3();
    kopfBox.getSize(kopfMass);
    const R = Math.max(kopfMass.x, kopfMass.z) / 2;

    // Der Hut haengt AM Kopfknoten, nicht an der Figur: dreht sich der Kopf
    // spaeter mit einer Animation, dreht der Hut mit. Andersherum wuerde er
    // im Gesicht stehen bleiben.
    const hut = buildHatGroup(appearance, R);
    if (hut) {
      // In den lokalen Raum des Kopfes umrechnen. Ohne diese Umrechnung
      // landet der Hut um den Versatz des Kopfes daneben - bei dieser Figur
      // immerhin zwei Drittel ihrer Hoehe.
      kopf.updateMatrixWorld(true);
      const obenWelt = new THREE.Vector3(
        (kopfBox.min.x + kopfBox.max.x) / 2,
        kopfBox.max.y,
        (kopfBox.min.z + kopfBox.max.z) / 2,
      );
      hut.position.copy(kopf.worldToLocal(obenWelt.clone()));
      kopf.add(hut);
    }

    const brille = buildGlassesGroup(appearance, R);
    if (brille) {
      kopf.updateMatrixWorld(true);
      const vornWelt = new THREE.Vector3(
        (kopfBox.min.x + kopfBox.max.x) / 2,
        kopfBox.min.y + kopfMass.y * 0.62,
        kopfBox.max.z,
      );
      brille.position.copy(kopf.worldToLocal(vornWelt.clone()));
      kopf.add(brille);
    }
  }

  if (rumpf) {
    const rumpfBox = new THREE.Box3().setFromObject(rumpf);
    const rumpfMass = new THREE.Vector3();
    rumpfBox.getSize(rumpfMass);

    const rucksack = buildBackGroup(appearance, rumpfMass.x, rumpfMass.y, rumpfMass.z);
    if (rucksack) {
      rumpf.updateMatrixWorld(true);
      const mitteWelt = new THREE.Vector3(
        (rumpfBox.min.x + rumpfBox.max.x) / 2,
        rumpfBox.min.y + rumpfMass.y * 0.55,
        (rumpfBox.min.z + rumpfBox.max.z) / 2,
      );
      rucksack.position.copy(rumpf.worldToLocal(mitteWelt.clone()));
      rumpf.add(rucksack);
    }
  }

  return {
    group,
    parts: { beine, arme, kopf, rumpf },
    // Fuer die Gefaengnis-Faerbung. Bei dieser Figur wird die Textur getoent,
    // nicht eine Flaeche umgefaerbt - das Ergebnis ist ein grauer Schleier
    // ueber dem Charakter statt eines einfarbigen Kloetzchens.
    bodyMat: rumpfMat || mat(0xffffff),
    headMat: kopfMat || mat(0xffffff),
    blocky: true,
  };
}

/**
 * Verteiler: fertige Figur aus dem Pack, sonst die selbstgebaute.
 *
 * Faellt bewusst auf die selbstgebaute Figur zurueck, wenn das Buendel noch
 * nicht geladen ist. Beim Spielstart dauert das einen Moment - ohne Rueckfall
 * waere die Figur in dieser Zeit unsichtbar, und ein unsichtbarer Spieler ist
 * von einem Verbindungsfehler nicht zu unterscheiden.
 */
function buildCharacter(appearance, tint, kitTemplates) {
  const figurTeil = clothingInfo(appearance && appearance.figur);
  const modell = figurTeil && figurTeil.model;

  if (modell && kitTemplates) {
    const fertig = buildBlockyCharacter(appearance, modell, kitTemplates);
    if (fertig) return fertig;
  }

  return buildSimpleCharacter(appearance, tint);
}

/** Aussehen zu einem Vergleichsschluessel, um unnoetiges Neubauen zu sparen. */
function appearanceKey(appearance) {
  if (!appearance) return '-';
  return ['figur', 'skin', 'hair', 'shirt', 'pants', 'shoes', 'hat', 'glasses', 'back']
    .map((s) => appearance[s] || '')
    .join('|');
}

/**
 * ============================================================
 *  Der Laden
 * ============================================================
 * Baut den Kleiderschrank in einen Container. Nach Plaetzen gruppiert, weil
 * eine Liste aus 50 Teilen ohne Gliederung auf einem Telefon unbrauchbar ist.
 */
function renderWardrobeSection(container, net, escapeHtml) {
  if (!container || !net) return;
  const st = net.wardrobeState;
  container.innerHTML = '';

  if (!st || !st.items) {
    const hinweis = document.createElement('div');
    hinweis.className = 'market-item-detail';
    hinweis.textContent = 'Kleiderschrank wird geladen …';
    container.appendChild(hinweis);
    return;
  }

  const kopf = document.createElement('div');
  kopf.className = 'market-item-detail';
  kopf.innerHTML = `Stilpunkte: <b>${st.style}</b> — Gekauftes wird sofort angezogen.`;
  container.appendChild(kopf);

  // Wird eine fertige Figur getragen, sind Haut, Frisur und Kleidung in ihre
  // Textur gemalt. Das MUSS dastehen - sonst wirkt der halbe verschwundene
  // Laden wie ein Fehler statt wie eine Folge der eigenen Wahl.
  if (st.simpleFigure === false) {
    const hinweis = document.createElement('div');
    hinweis.className = 'market-item-detail';
    hinweis.innerHTML = 'Fertige Figuren bringen Haut, Frisur und Kleidung fest mit. '
      + 'Für freie Kleiderwahl zurück auf <b>Eigene Figur</b> wechseln — '
      + 'Gekauftes bleibt im Schrank.';
    container.appendChild(hinweis);
  }

  for (const slot of st.slots) {
    if (slot.hidden) continue;
    const teile = st.items.filter((i) => i.slot === slot.id);
    if (teile.length === 0) continue;

    const titel = document.createElement('div');
    titel.className = 'market-item-name';
    titel.style.marginTop = '8px';
    titel.textContent = slot.label;
    container.appendChild(titel);

    // Ablegen nur bei Accessoires anbieten. Ein "Ablegen" bei der Hose waere
    // ein Knopf, der immer eine Fehlermeldung erzeugt.
    if (slot.optional && st.appearance[slot.id]) {
      const abRow = document.createElement('div');
      abRow.className = 'market-item';
      abRow.innerHTML = '<div class="market-item-detail">Wird gerade getragen</div>';
      const abBtn = document.createElement('button');
      abBtn.className = 'market-btn-small danger';
      abBtn.textContent = 'Ablegen';
      abBtn.addEventListener('click', () => net.unequipSlot(slot.id));
      abRow.appendChild(abBtn);
      container.appendChild(abRow);
    }

    for (const teil of teile) {
      const row = document.createElement('div');
      row.className = 'market-item';

      const farbe = '#' + (teil.color >>> 0).toString(16).padStart(6, '0');
      const stil = teil.style > 0 ? ` · ${teil.style} Stil` : '';
      row.innerHTML =
        `<div class="market-item-name">` +
        `<span style="display:inline-block;width:11px;height:11px;border-radius:3px;` +
        `background:${farbe};border:1px solid rgba(255,255,255,.35);margin-right:6px;"></span>` +
        `${escapeHtml(teil.name)}</div>` +
        `<div class="market-item-detail">${teil.owned ? 'im Schrank' : `$${teil.price}`}${stil}</div>`;

      const btn = document.createElement('button');
      btn.className = 'market-btn-small';

      if (teil.worn) {
        btn.textContent = 'getragen';
        btn.disabled = true;
      } else if (teil.owned) {
        btn.textContent = 'Anziehen';
        btn.addEventListener('click', () => net.equipClothing(teil.id));
      } else {
        btn.textContent = `Kaufen $${teil.price}`;
        btn.disabled = st.cash < teil.price;
        btn.addEventListener('click', () => net.buyClothing(teil.id));
      }

      row.appendChild(btn);
      container.appendChild(row);
    }
  }
}
