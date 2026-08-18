'use strict';

// server/appearance.js
// Kleidung, Accessoires und das Aussehen der Spielfigur.
//
// Bewusst ein eigenes Modul mit reinen Funktionen: sie bekommen das
// Spielerobjekt uebergeben und veraendern nur dessen Aussehens-Felder. Dadurch
// muss game.js (ueber 4000 Zeilen) fuer dieses Feature gar nicht angefasst
// werden - index.js ruft die Funktionen direkt mit world.players.get(id) auf.

// Die acht Plaetze am Koerper. skin/hair/shirt/pants/shoes sind IMMER belegt,
// die drei Accessoire-Plaetze duerfen leer (null) bleiben.
const SLOTS = ['skin', 'hair', 'shirt', 'pants', 'shoes', 'hat', 'glasses', 'back'];
const REQUIRED_SLOTS = ['skin', 'hair', 'shirt', 'pants', 'shoes'];

const SLOT_LABELS = {
  skin: 'Hautton',
  hair: 'Frisur',
  shirt: 'Oberteil',
  pants: 'Hose',
  shoes: 'Schuhe',
  hat: 'Kopfbedeckung',
  glasses: 'Brille',
  back: 'Rücken',
};

/**
 * Der Katalog.
 *
 * "shape" entscheidet, WIE der Client das Teil baut, "color" WELCHE Farbe es
 * bekommt. Diese Trennung ist der Grund, warum neun Frisuren nicht neun
 * Modelle brauchen: der Client kennt fuenf Formen, der Rest ist Faerbung.
 *
 * "style" sind Stilpunkte. Sie kosten den Server nichts und veraendern keine
 * Spielwerte - sie geben dem Kaufen aber ein Ziel ausser "sieht anders aus".
 */
const CATALOG = [
  // --- Hautton: immer kostenlos. Aussehen darf nichts kosten, sonst waere
  //     die eigene Erscheinung an Spielfortschritt geknuepft.
  { id: 'skin-1', slot: 'skin', name: 'Sehr hell', price: 0, color: 0xf2d5b8, style: 0 },
  { id: 'skin-2', slot: 'skin', name: 'Hell', price: 0, color: 0xe0b48c, style: 0 },
  { id: 'skin-3', slot: 'skin', name: 'Mittel', price: 0, color: 0xc68a5e, style: 0 },
  { id: 'skin-4', slot: 'skin', name: 'Oliv', price: 0, color: 0xa9714b, style: 0 },
  { id: 'skin-5', slot: 'skin', name: 'Dunkel', price: 0, color: 0x7a4a2b, style: 0 },
  { id: 'skin-6', slot: 'skin', name: 'Sehr dunkel', price: 0, color: 0x4e2f1c, style: 0 },

  // --- Frisuren
  { id: 'hair-kurz-schwarz', slot: 'hair', name: 'Kurz, schwarz', price: 0, color: 0x1c1a18, shape: 'kurz', style: 0 },
  { id: 'hair-kurz-braun', slot: 'hair', name: 'Kurz, braun', price: 0, color: 0x5a3a20, shape: 'kurz', style: 0 },
  { id: 'hair-glatze', slot: 'hair', name: 'Glatze', price: 0, color: 0x000000, shape: 'glatze', style: 0 },
  { id: 'hair-kurz-blond', slot: 'hair', name: 'Kurz, blond', price: 25, color: 0xd8b464, shape: 'kurz', style: 1 },
  { id: 'hair-lang-braun', slot: 'hair', name: 'Lang, braun', price: 40, color: 0x5a3a20, shape: 'lang', style: 2 },
  { id: 'hair-lang-blond', slot: 'hair', name: 'Lang, blond', price: 40, color: 0xd8b464, shape: 'lang', style: 2 },
  { id: 'hair-lang-rot', slot: 'hair', name: 'Lang, rot', price: 60, color: 0xa8442a, shape: 'lang', style: 3 },
  { id: 'hair-afro-schwarz', slot: 'hair', name: 'Afro', price: 55, color: 0x1c1a18, shape: 'afro', style: 3 },
  { id: 'hair-irokese-gruen', slot: 'hair', name: 'Irokese, grün', price: 90, color: 0x3ec46a, shape: 'irokese', style: 5 },
  { id: 'hair-irokese-pink', slot: 'hair', name: 'Irokese, pink', price: 90, color: 0xe45aa8, shape: 'irokese', style: 5 },

  // --- Oberteile
  { id: 'shirt-tee-weiss', slot: 'shirt', name: 'T-Shirt, weiß', price: 0, color: 0xf0f0f0, shape: 'tee', style: 0 },
  { id: 'shirt-tee-blau', slot: 'shirt', name: 'T-Shirt, blau', price: 0, color: 0x4a7cff, shape: 'tee', style: 0 },
  { id: 'shirt-tee-rot', slot: 'shirt', name: 'T-Shirt, rot', price: 20, color: 0xd94a4a, shape: 'tee', style: 1 },
  { id: 'shirt-warnweste', slot: 'shirt', name: 'Warnweste', price: 45, color: 0xe8c020, shape: 'weste', style: 1 },
  { id: 'shirt-hoodie-grau', slot: 'shirt', name: 'Hoodie, grau', price: 60, color: 0x8a8f98, shape: 'hoodie', style: 3 },
  { id: 'shirt-hoodie-schwarz', slot: 'shirt', name: 'Hoodie, schwarz', price: 70, color: 0x2a2c30, shape: 'hoodie', style: 3 },
  { id: 'shirt-hemd-weiss', slot: 'shirt', name: 'Hemd, weiß', price: 90, color: 0xfafafa, shape: 'hemd', style: 4 },
  { id: 'shirt-lederjacke', slot: 'shirt', name: 'Lederjacke', price: 320, color: 0x3a2a24, shape: 'jacke', style: 9 },
  { id: 'shirt-anzug-schwarz', slot: 'shirt', name: 'Anzugjacke', price: 240, color: 0x22242a, shape: 'anzug', style: 8 },

  // --- Hosen
  { id: 'pants-jeans-blau', slot: 'pants', name: 'Jeans, blau', price: 0, color: 0x3a5a8a, shape: 'lang', style: 0 },
  { id: 'pants-jeans-schwarz', slot: 'pants', name: 'Jeans, schwarz', price: 15, color: 0x24262c, shape: 'lang', style: 1 },
  { id: 'pants-shorts-khaki', slot: 'pants', name: 'Shorts, khaki', price: 30, color: 0xa89060, shape: 'shorts', style: 1 },
  { id: 'pants-jogger-grau', slot: 'pants', name: 'Jogginghose', price: 40, color: 0x70757e, shape: 'lang', style: 2 },
  { id: 'pants-rock-rot', slot: 'pants', name: 'Rock, rot', price: 70, color: 0xc03a4a, shape: 'rock', style: 4 },
  { id: 'pants-anzughose', slot: 'pants', name: 'Anzughose', price: 160, color: 0x22242a, shape: 'lang', style: 6 },

  // --- Schuhe
  { id: 'shoes-sneaker-weiss', slot: 'shoes', name: 'Sneaker, weiß', price: 0, color: 0xe8e8e8, style: 0 },
  { id: 'shoes-sneaker-schwarz', slot: 'shoes', name: 'Sneaker, schwarz', price: 20, color: 0x2a2c30, style: 1 },
  { id: 'shoes-stiefel-braun', slot: 'shoes', name: 'Stiefel, braun', price: 70, color: 0x6a4426, style: 3 },
  { id: 'shoes-neon', slot: 'shoes', name: 'Laufschuhe, neon', price: 95, color: 0x50e030, style: 4 },
  { id: 'shoes-lack-schwarz', slot: 'shoes', name: 'Lackschuhe', price: 130, color: 0x141518, style: 5 },

  // --- Kopfbedeckung (Accessoire, darf leer bleiben)
  { id: 'hat-cap-rot', slot: 'hat', name: 'Cap, rot', price: 35, color: 0xd94a4a, shape: 'cap', style: 2 },
  { id: 'hat-cap-blau', slot: 'hat', name: 'Cap, blau', price: 35, color: 0x3a6ceb, shape: 'cap', style: 2 },
  { id: 'hat-beanie-grau', slot: 'hat', name: 'Mütze, grau', price: 45, color: 0x80858e, shape: 'beanie', style: 2 },
  { id: 'hat-helm-gelb', slot: 'hat', name: 'Bauhelm', price: 60, color: 0xe8c020, shape: 'helm', style: 2 },
  { id: 'hat-zylinder', slot: 'hat', name: 'Zylinder', price: 210, color: 0x18191c, shape: 'zylinder', style: 7 },
  { id: 'hat-krone', slot: 'hat', name: 'Krone', price: 900, color: 0xf0c020, shape: 'krone', style: 20 },

  // --- Brillen
  { id: 'glasses-rund', slot: 'glasses', name: 'Runde Brille', price: 40, color: 0x2a2c30, shape: 'rund', style: 2 },
  { id: 'glasses-eckig', slot: 'glasses', name: 'Eckige Brille', price: 40, color: 0x5a4030, shape: 'eckig', style: 2 },
  { id: 'glasses-sonne', slot: 'glasses', name: 'Sonnenbrille', price: 85, color: 0x141518, shape: 'sonne', style: 4 },
  { id: 'glasses-sonne-gold', slot: 'glasses', name: 'Sonnenbrille, gold', price: 150, color: 0xd8b040, shape: 'sonne', style: 6 },

  // --- Rücken
  { id: 'back-ranzen', slot: 'back', name: 'Schulranzen', price: 45, color: 0x4a6a9a, shape: 'rucksack', style: 1 },
  { id: 'back-rucksack-grau', slot: 'back', name: 'Rucksack, grau', price: 60, color: 0x6a6f78, shape: 'rucksack', style: 2 },
  { id: 'back-rucksack-rot', slot: 'back', name: 'Rucksack, rot', price: 60, color: 0xc0453a, shape: 'rucksack', style: 2 },
];

const BY_ID = new Map(CATALOG.map((i) => [i.id, i]));

// Was jeder Spieler von Anfang an besitzt: alle Hauttoene und je ein
// schlichtes Teil pro Pflichtplatz. Ohne das stuende ein neuer Spieler nackt
// da und muesste erst einkaufen, um ueberhaupt auszusehen.
const STARTER_ITEMS = CATALOG.filter((i) => i.price === 0).map((i) => i.id);

const DEFAULT_APPEARANCE = {
  skin: 'skin-2',
  hair: 'hair-kurz-braun',
  shirt: 'shirt-tee-blau',
  pants: 'pants-jeans-blau',
  shoes: 'shoes-sneaker-weiss',
  hat: null,
  glasses: null,
  back: null,
};

/** Startgarderobe fuer einen frisch erzeugten Spieler. */
function createWardrobe() {
  return STARTER_ITEMS.slice();
}

/** Startaussehen fuer einen frisch erzeugten Spieler. */
function createAppearance() {
  return { ...DEFAULT_APPEARANCE };
}

/**
 * Bringt ein moeglicherweise kaputtes Aussehen in einen gueltigen Zustand.
 *
 * Wird bei JEDEM Lesen angewandt, nicht nur beim Setzen. Der Grund: gespeicherte
 * Weltzustaende koennen aus einer aelteren Fassung stammen, in der es ein Teil
 * noch nicht gab oder das Feld ganz fehlte. Ohne diese Absicherung wuerde ein
 * einziger unbekannter Bezeichner die Figur beim Zeichnen zerlegen.
 */
function sanitizeAppearance(appearance) {
  const sauber = { ...DEFAULT_APPEARANCE };
  if (appearance && typeof appearance === 'object') {
    for (const slot of SLOTS) {
      const id = appearance[slot];
      if (id === null || id === undefined) {
        // Pflichtplaetze behalten den Standard, Accessoires bleiben leer.
        if (!REQUIRED_SLOTS.includes(slot)) sauber[slot] = null;
        continue;
      }
      const item = BY_ID.get(id);
      if (item && item.slot === slot) sauber[slot] = id;
    }
  }
  return sauber;
}

/** Besitzt der Spieler dieses Teil? Startteile gelten immer als besessen. */
function owns(player, itemId) {
  if (STARTER_ITEMS.includes(itemId)) return true;
  return Array.isArray(player.wardrobe) && player.wardrobe.includes(itemId);
}

/**
 * Kauft ein Teil. Preis wird vom Bargeld abgezogen, nicht vom Konto -
 * so verhaelt es sich wie jeder andere Ladenkauf im Spiel.
 */
function buyItem(player, itemId) {
  const item = BY_ID.get(itemId);
  if (!item) return { ok: false, reason: 'Dieses Kleidungsstück gibt es nicht.' };
  if (owns(player, itemId)) return { ok: false, reason: 'Das hast du schon.' };
  if ((player.cash || 0) < item.price) {
    return { ok: false, reason: `Du brauchst $${item.price}, hast aber nur $${Math.floor(player.cash || 0)}.` };
  }

  player.cash -= item.price;
  if (!Array.isArray(player.wardrobe)) player.wardrobe = createWardrobe();
  player.wardrobe.push(itemId);

  // Direkt anziehen. Alles andere waere ein zweiter Klick fuer etwas, das
  // niemand anders will - man kauft ein Hemd, um es zu tragen.
  player.appearance = sanitizeAppearance({ ...player.appearance, [item.slot]: itemId });

  // Neue Kleidung hebt die Laune ein wenig. Kleiner Betrag mit harter
  // Obergrenze: Kleidung soll ein Grund zum Ausgeben sein, kein Weg,
  // Zufriedenheit beliebig nachzukaufen.
  player.happiness = Math.min(100, (player.happiness || 0) + 2);

  return { ok: true, item, player };
}

/** Zieht ein bereits besessenes Teil an. */
function equipItem(player, itemId) {
  const item = BY_ID.get(itemId);
  if (!item) return { ok: false, reason: 'Dieses Kleidungsstück gibt es nicht.' };
  if (!owns(player, itemId)) return { ok: false, reason: 'Das besitzt du noch nicht.' };

  player.appearance = sanitizeAppearance({ ...player.appearance, [item.slot]: itemId });
  return { ok: true, item, player };
}

/** Legt ein Accessoire ab. Pflichtplaetze lassen sich nicht leeren. */
function unequipSlot(player, slot) {
  if (!SLOTS.includes(slot)) return { ok: false, reason: 'Diesen Platz gibt es nicht.' };
  if (REQUIRED_SLOTS.includes(slot)) {
    return { ok: false, reason: `${SLOT_LABELS[slot]} kann nicht leer bleiben.` };
  }
  player.appearance = sanitizeAppearance({ ...player.appearance, [slot]: null });
  return { ok: true, player };
}

/** Summe der Stilpunkte aller getragenen Teile. */
function styleScore(appearance) {
  const a = sanitizeAppearance(appearance);
  let summe = 0;
  for (const slot of SLOTS) {
    const item = a[slot] ? BY_ID.get(a[slot]) : null;
    if (item) summe += item.style || 0;
  }
  return summe;
}

/**
 * Der Zustand fuer den Kleiderschrank im Client: der ganze Katalog plus die
 * Information, was davon besessen und was getragen wird.
 */
function buildWardrobeState(player) {
  const appearance = sanitizeAppearance(player.appearance);
  return {
    slots: SLOTS.map((id) => ({ id, label: SLOT_LABELS[id], optional: !REQUIRED_SLOTS.includes(id) })),
    items: CATALOG.map((i) => ({
      id: i.id,
      slot: i.slot,
      name: i.name,
      price: i.price,
      style: i.style || 0,
      color: i.color,
      // Form MUSS mit: der Client baut daraus die Figur und braucht sie auch
      // fuer fremde Spieler, von denen er nur die Bezeichner der Teile kennt.
      shape: i.shape || null,
      owned: owns(player, i.id),
      worn: appearance[i.slot] === i.id,
    })),
    appearance,
    style: styleScore(appearance),
    cash: Math.floor(player.cash || 0),
  };
}

module.exports = {
  SLOTS,
  REQUIRED_SLOTS,
  SLOT_LABELS,
  CATALOG,
  DEFAULT_APPEARANCE,
  createWardrobe,
  createAppearance,
  sanitizeAppearance,
  owns,
  buyItem,
  equipItem,
  unequipSlot,
  styleScore,
  buildWardrobeState,
};
