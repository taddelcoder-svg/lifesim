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
 * Baut die komplette Figur.
 *
 * @param {Object} appearance  getragene Teile je Platz (aus serializePublic)
 * @param {Object} tint        Rueckfallfarben, wenn der Katalog fehlt
 * @returns {Object} { group, parts, materials }
 */
function buildCharacter(appearance, tint) {
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

  // --- Kopfbedeckung ---------------------------------------------------
  const hutForm = slotShape(a, 'hat');
  if (hutForm) {
    const hutMat = mat(slotColor(a, 'hat', 0x2a2c30));
    const hut = new THREE.Group();
    hut.position.y = FIG_HEAD_RADIUS * 0.55;

    if (hutForm === 'cap') {
      const krone = new THREE.Mesh(
        new THREE.SphereGeometry(FIG_HEAD_RADIUS * 1.05, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.5),
        hutMat,
      );
      krone.position.y = -0.04;
      hut.add(krone);
      const schirm = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.025, 0.18), hutMat);
      schirm.position.set(0, -0.04, FIG_HEAD_RADIUS * 0.95);
      hut.add(schirm);
    } else if (hutForm === 'beanie') {
      const muetze = new THREE.Mesh(
        new THREE.SphereGeometry(FIG_HEAD_RADIUS * 1.1, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.62),
        hutMat,
      );
      muetze.position.y = -0.06;
      hut.add(muetze);
      const bommel = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6), hutMat);
      bommel.position.y = FIG_HEAD_RADIUS * 0.55;
      hut.add(bommel);
    } else if (hutForm === 'helm') {
      const schale = new THREE.Mesh(
        new THREE.SphereGeometry(FIG_HEAD_RADIUS * 1.12, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.5),
        hutMat,
      );
      schale.position.y = -0.05;
      hut.add(schale);
      const rand = new THREE.Mesh(new THREE.TorusGeometry(FIG_HEAD_RADIUS * 1.1, 0.022, 6, 16), hutMat);
      rand.rotation.x = Math.PI / 2;
      rand.position.y = -0.05;
      hut.add(rand);
    } else if (hutForm === 'zylinder') {
      const rohr = new THREE.Mesh(new THREE.CylinderGeometry(FIG_HEAD_RADIUS * 0.85, FIG_HEAD_RADIUS * 0.85, 0.3, 14), hutMat);
      rohr.position.y = 0.12;
      hut.add(rohr);
      const krempe = new THREE.Mesh(new THREE.CylinderGeometry(FIG_HEAD_RADIUS * 1.45, FIG_HEAD_RADIUS * 1.45, 0.025, 16), hutMat);
      krempe.position.y = -0.03;
      hut.add(krempe);
    } else if (hutForm === 'krone') {
      const reif = new THREE.Mesh(new THREE.CylinderGeometry(FIG_HEAD_RADIUS * 0.92, FIG_HEAD_RADIUS * 0.92, 0.1, 12, 1, true),
        new THREE.MeshStandardMaterial({ color: slotColor(a, 'hat', 0xf0c020), metalness: 0.75, roughness: 0.3, side: THREE.DoubleSide }));
      reif.position.y = 0.02;
      hut.add(reif);
      for (let i = 0; i < 6; i++) {
        const w = (i / 6) * Math.PI * 2;
        const zacke = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.11, 4),
          new THREE.MeshStandardMaterial({ color: slotColor(a, 'hat', 0xf0c020), metalness: 0.75, roughness: 0.3 }));
        zacke.position.set(Math.sin(w) * FIG_HEAD_RADIUS * 0.9, 0.12, Math.cos(w) * FIG_HEAD_RADIUS * 0.9);
        hut.add(zacke);
      }
    }

    hut.traverse((c) => { if (c.isMesh) c.castShadow = true; });
    kopf.add(hut);
  }

  // --- Brille ----------------------------------------------------------
  const brilleForm = slotShape(a, 'glasses');
  if (brilleForm) {
    const brilleMat = brilleForm === 'sonne'
      ? new THREE.MeshStandardMaterial({ color: slotColor(a, 'glasses', 0x141518), metalness: 0.5, roughness: 0.25 })
      : mat(slotColor(a, 'glasses', 0x2a2c30));
    const brille = new THREE.Group();
    brille.position.set(0, 0.05, FIG_HEAD_RADIUS - 0.02);

    for (const seite of [-1, 1]) {
      const glas = brilleForm === 'rund'
        ? new THREE.Mesh(new THREE.TorusGeometry(0.055, 0.012, 6, 14), brilleMat)
        : new THREE.Mesh(new THREE.BoxGeometry(0.105, 0.07, 0.015), brilleMat);
      glas.position.set(seite * 0.1, 0, 0.02);
      brille.add(glas);
    }
    const steg = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.012, 0.012), brilleMat);
    steg.position.z = 0.02;
    brille.add(steg);

    kopf.add(brille);
  }

  // --- Rücken ----------------------------------------------------------
  if (slotShape(a, 'back') === 'rucksack') {
    const rucksackMat = mat(slotColor(a, 'back', 0x6a6f78));
    const rucksack = new THREE.Mesh(
      new THREE.BoxGeometry(FIG_TORSO_WIDTH * 0.78, FIG_TORSO_HEIGHT * 0.78, 0.16),
      rucksackMat,
    );
    rucksack.position.set(0, FIG_LEG_HEIGHT + FIG_TORSO_HEIGHT * 0.55, -(FIG_TORSO_DEPTH * dicke / 2 + 0.08));
    rucksack.castShadow = true;
    group.add(rucksack);

    for (const seite of [-1, 1]) {
      const riemen = new THREE.Mesh(new THREE.BoxGeometry(0.05, FIG_TORSO_HEIGHT * 0.72, 0.02), rucksackMat);
      riemen.position.set(seite * 0.13, FIG_LEG_HEIGHT + FIG_TORSO_HEIGHT * 0.55, FIG_TORSO_DEPTH * dicke / 2 + 0.005);
      group.add(riemen);
    }
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

/** Aussehen zu einem Vergleichsschluessel, um unnoetiges Neubauen zu sparen. */
function appearanceKey(appearance) {
  if (!appearance) return '-';
  return ['skin', 'hair', 'shirt', 'pants', 'shoes', 'hat', 'glasses', 'back']
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

  for (const slot of st.slots) {
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
