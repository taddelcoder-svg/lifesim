'use strict';

// client/render.js
// 3D-Darstellung mit Three.js. Der Server kennt weiterhin nur x/y auf einer
// flachen Bodenebene (unveraendert seit Phase 1) - hier wird daraus eine
// begehbare 3D-Welt mit Kamera hinter der Figur (GTA-Stil).
//
// WICHTIG: Three.js Version bewusst auf r128 gepinnt (klassisches <script>-Tag,
// globales THREE-Objekt). Neuere Versionen verlangen ES-Module + Importmap,
// was den ganzen Datei-Aufbau dieses Projekts aendern wuerde. Deshalb KEIN
// THREE.CapsuleGeometry (erst ab r142) - Figuren bestehen aus Zylinder + Kugel.

// HINWEIS ZUR LADEREIHENFOLGE: net.js wird VOR dieser Datei geladen und definiert
// bereits global WORLD_WIDTH / WORLD_HEIGHT / PLAYER_SPEED. Diese Namen duerfen hier
// NICHT erneut mit const deklariert werden - das wuerde einen "already been declared"-
// Fehler ausloesen, der das gesamte Laden dieser Datei abbricht (Renderer waere dann
// undefiniert). Deshalb werden die Werte aus net.js hier einfach mitbenutzt.

const WORLD_SCALE = 0.05;  // 1 Server-Einheit * 0.05 = 1 3D-Einheit (menschliche Groessenordnung)
const WORLD_SIZE_3D = WORLD_WIDTH * WORLD_SCALE;

// --- Farbraum -------------------------------------------------------------
// Der Renderer gibt jetzt in sRGB aus (siehe Konstruktor). Das ist der Grund,
// warum die Texturen der Modelle endlich so hell und klar aussehen wie gedacht
// - vorher wurden sie linear ausgegeben und wirkten dunkel und uebersaettigt.
//
// Alle Hex-Farben im Code (0x4a7cff usw.) sind aber sRGB-Werte, wie man sie aus
// CSS kennt. r128 kennt noch keine automatische Farbverwaltung, also wird sie
// hier an der einzigen Stelle nachgeruestet, durch die jede Hex-Farbe laeuft:
// setHex (auch der Konstruktor und .set(zahl) landen dort). getHex rechnet
// symmetrisch zurueck, damit gemerkte Farben beim Wiedersetzen nicht doppelt
// umgerechnet werden. Modelle laden ihre Farben ueber fromArray/setRGB und
// sind davon nicht betroffen - dort liegen sie laut glTF-Norm bereits linear.
(function farbraumNachruesten() {
  if (THREE.Color.prototype._srgbPatched) return;
  const setHex = THREE.Color.prototype.setHex;
  const getHex = THREE.Color.prototype.getHex;
  THREE.Color.prototype.setHex = function (hex) {
    setHex.call(this, hex);
    return this.convertSRGBToLinear();
  };
  THREE.Color.prototype.getHex = function () {
    return getHex.call(this.clone().convertLinearToSRGB());
  };
  THREE.Color.prototype._srgbPatched = true;
})();

// Sichtweite am Tag in 3D-Einheiten. Alles dahinter liegt im Nebel und wird
// gar nicht erst gezeichnet (siehe updateCulling) - vorher gingen bei jedem
// Bild ueber eine Million Dreiecke der GANZEN Stadt durch die Grafikkarte,
// und fuer die Schatten nochmal.
const VIEW_DISTANCE = 150;
const CHUNK_SIZE_3D = 64; // Kantenlaenge der Stadtkacheln fuer das Ausblenden

// Kamera: frei zoombar (Mausrad, Pinch, +/-), Grenzen hier.
const CAMERA_MIN_DISTANCE = 3;
const CAMERA_MAX_DISTANCE = 16;
const CAMERA_MIN_PITCH = 0.12; // Bogenmass ueber der Waagerechten
const CAMERA_MAX_PITCH = 1.2;

// Schatten folgen der Figur: ein kleiner, scharfer Ausschnitt statt eines
// verwaschenen ueber die ganze Karte (vorher 336 Einheiten auf 1024 Pixel).
const SHADOW_EXTENT = 38;

// Himmelsfarben je Tageszeit: [oben, Horizont, Sonne/Licht]
const SKY_DAY = { top: 0x3f7fd6, horizon: 0xcfe3f2, sun: 0xfff1d6, ground: 0x6b7a4a };
const SKY_NIGHT = { top: 0x040915, horizon: 0x1a2440, sun: 0x9fb4ff, ground: 0x10141c };
const SKY_DUSK = { top: 0x34437a, horizon: 0xf2a263, sun: 0xffb27a, ground: 0x4a3e3a };
const SKY_RAIN = { top: 0x59636f, horizon: 0x9aa4ae, sun: 0xdfe6ee, ground: 0x4e5648 };
const SKY_FOG = { top: 0x9ba5ae, horizon: 0xc2c8cd, sun: 0xe8ecef, ground: 0x6a7068 };

const CHARACTER_RADIUS = 0.35;
const CHARACTER_BODY_HEIGHT = 1.0;
const CHARACTER_HEAD_RADIUS = 0.28;

const CAMERA_DISTANCE = 6;
const CAMERA_HEIGHT = 3;
const CAMERA_LOOK_HEIGHT = 1.3;

const FACING_MIN_SPEED = 1; // px/s, darunter wird die letzte Blickrichtung beibehalten (kein Zittern im Stand)

// Andere Spieler bekommen ihre Position nur ~20x/s ueber das Netz, gezeichnet wird
// aber ~60x/s. Ohne Interpolation waere jede Bewegung sichtbar stufig. Diese Werte
// sind Mischanteile pro 60fps-Frame und werden unten bildratenunabhaengig umgerechnet.
const REMOTE_POSITION_BLEND = 0.2;
const FACING_BLEND = 0.18;
const REMOTE_SNAP_DISTANCE = 8; // 3D-Einheiten - darueber wird hart gesetzt (z.B. Teleport ins Gefaengnis)

// --- 3D-Modelle aus dem KayKit "City Builder Bits"-Pack (CC0, Kay Lousberg) ---
// Alle Modelle stecken in EINER Datei mit gemeinsamer Textur, damit nur ein
// Ladevorgang noetig ist. Fehlt die Datei, faellt alles auf die einfachen
// Quader-Darstellungen zurueck - das Spiel bleibt dann spielbar.
const MODEL_FILE = 'citybits.glb';

// Zweite Modelldatei: Strassenteile und die Gebaeude der drei neuen Bezirke
// (Kenney City Kit, CC0 - wie das KayKit-Set). 21 Modelle, 1,5 MB, aus vier
// Einzelpaketen mit zusammen 178 Modellen und 10 MB zusammengefuehrt und
// entdoppelt. Beide Dateien landen im selben modelTemplates-Verzeichnis.
const CITYKIT_FILE = 'citykit.glb';

// Haustiere (Kenney Cube Pets, CC0). Sechs Arten, 326 KB. Jedes Tier besteht
// aus sieben Teilen, deren Versatz beim Zusammenfuehren in die Geometrie
// gerechnet wurde - sie teilen sich also einen Ursprung und lassen sich als
// Gruppe klonen.
const PET_FILE = 'pets.glb';

// Wie weit hinter dem Besitzer das Tier laeuft (3D-Einheiten).
//
// MUSS deutlich groesser sein als die Figur breit ist: CHARACTER_RADIUS ist
// 0,35, die Figur also 0,7 breit. Die erste Fassung stand auf 0,9 - das Tier
// sass damit praktisch im Koerper des Besitzers und war, weil die Kamera hinter
// dem Spieler steht, komplett verdeckt. Bei Nacht sah man gar nichts mehr.
// Lokaler Versatz an der Figur. Seitlich, weil die Kamera hinter dem Spieler
// steht - direkt dahinter waere das Tier wieder verdeckt, genau der Fehler der
// ersten Fassung.
// Abstand hinter dem Besitzer. MUSS groesser sein als die Figur breit ist
// (CHARACTER_RADIUS 0,35, also 0,7) - sonst steckt das Tier in ihr.
const PET_FOLLOW_DISTANCE = 1.8;

// Wie traege das Tier folgt. Kleiner = weicher, aber auch traeger.
const PET_FOLLOW_BLEND = 0.2;

// Ab diesem Rueckstand wird hart nachgezogen. Die Kamera steht 6 Einheiten
// hinter dem Spieler; darueber waere das Tier ausserhalb des Bildes.
const PET_MAX_LAG = 4;

// Groesse relativ zur Figur (rund 1,5 Einheiten hoch). 0,35 ergab 0,56 - zu
// klein, um bei Nacht aus der Verfolgerkamera erkennbar zu sein.
const PET_SCALE = 0.6;

// Namensschild ueber dem Tier, wie bei den Spielern. Nicht nur Zierde: es macht
// sichtbar, DASS das Tier da ist, auch wenn es im Dunkeln oder hinter einer
// Ecke steht.
const PET_LABEL_HEIGHT = 1.2;


// Ersatzfarben, falls pets.glb fehlt oder nicht laedt. Ein unsichtbares
// Haustier ist nicht von einem fehlenden Feature zu unterscheiden - ein
// farbiger Wuerfel dagegen zeigt sofort: die Daten stimmen, nur das Modell
// fehlt. Gleiche Ueberlegung wie beim Stadtkit.
const PET_FALLBACK_COLOURS = {
  cat: 0xc8a06a, dog: 0x8a5a3a, bunny: 0xd8d0c8,
  fox: 0xd07030, parrot: 0x40b060, pig: 0xe0a0b0,
};

// Kantenlaenge des alten Stadtkerns. Alles darunter bleibt beim urspruenglichen
// KayKit-Aussehen - die Altstadt soll sich nicht ueber Nacht veraendern.
const CORE_SIZE = 2800;

// Bezirke bekommen eigene Gebaeudesaetze. Damit erkennt man am Haeuserbild, wo
// man ist - und, da die Bandenquadranten ueber dem Kern liegen, auch den
// Unterschied zwischen Altstadt und Neubaugebiet.
// Jetzt aus den Buendeln: 21 Wohnhaeuser und 20 Fabrikhallen statt je sechs
// Platzhaltern. Die Namen mit Bindestrich stammen aus den neuen Dateien, die
// mit Unterstrich aus citykit.glb - beide liegen im selben Verzeichnis, der
// Renderer sieht also keinen Unterschied.
const DISTRICT_MODELS = {
  core: null, // null = die bestehenden KayKit-Gebaeude, die Altstadt bleibt
  commercial: [
    'ind-building-c', 'ind-building-l', 'ind-building-q', 'ind-building-r',
    'sub-building-type-b', 'sub-building-type-d', 'sub-building-type-n',
  ],
  suburban: [
    'sub-building-type-a', 'sub-building-type-c', 'sub-building-type-e',
    'sub-building-type-f', 'sub-building-type-j', 'sub-building-type-k',
    'sub-building-type-o', 'sub-building-type-r', 'sub-building-type-s',
    'sub-building-type-t', 'sub-building-type-u',
  ],
  industrial: [
    'ind-building-a', 'ind-building-b', 'ind-building-e', 'ind-building-f',
    'ind-building-g', 'ind-building-m', 'ind-building-n', 'ind-building-t',
  ],
};

/** Welcher Bezirk liegt an dieser Weltposition? */
function districtAt(x, y) {
  if (x < CORE_SIZE && y < CORE_SIZE) return 'core';
  if (x >= CORE_SIZE && y < CORE_SIZE) return 'commercial';
  if (x < CORE_SIZE) return 'suburban';
  return 'industrial';
}

// glTF-Norm: die Vorderseite eines Modells zeigt nach -Z. Im Spiel zeigen
// Fahrzeuge nach +Z, deshalb 180 Grad drehen. Sollten die Autos rueckwaerts
// fahren, ist das hier die einzige Stelle, die geaendert werden muss.
const VEHICLE_MODEL_YAW_OFFSET = Math.PI;

const VEHICLE_MODEL_BY_TYPE = {
  scooter: 'car-hatchback-sports',
  compact: 'car-taxi',
  sedan: 'car-sedan',
  sports: 'car-sedan-sports',
};

// Fruehere Fassung: hier standen Ziellaengen in 3D-Einheiten, auf die jedes
// Fahrzeug beim Klonen gestreckt wurde. Das ist mit den Buendeln hinfaellig -
// deren Massstab ist bereits eingerechnet. Die Werte waren ausserdem rund ein
// Fuenftel zu klein: eine Limousine stand auf 2.8 Einheiten, was bei einer
// 1.3 Einheiten hohen Figur einem 3.8-m-Auto entspraeche. Jetzt sind es 3.3
// Einheiten und damit die 4.5 m, die ein echter Wagen hat.
//
// null heisst ausdruecklich "nicht skalieren". Die Eintraege bleiben stehen,
// damit klar ist, dass die Typen bekannt sind und der Wert nicht vergessen
// wurde - und damit ein einzelner Typ bei Bedarf wieder eine feste Laenge
// bekommen kann.
const VEHICLE_MODEL_LENGTH = {
  scooter: null,
  compact: null,
  sedan: null,
  sports: null,
};

const BUILDING_MODEL_NAMES = [
  'building_A', 'building_B', 'building_C', 'building_D',
  'building_E', 'building_F', 'building_G', 'building_H',
];

// --- Stadtdeko (Laternen, Ampeln, Baenke, Buesche, Hydranten) ---
// Rein dekorativ: KEINE Kollision, damit man nicht staendig an Laternenmasten
// haengenbleibt. Alle Objekte eines Typs werden als eine einzige "Instanz-Gruppe"
// gezeichnet - so kosten 100 Laternen nur einen Zeichenaufruf statt hundert.
const PROP_SCALE = {
  streetlight: 2.7,   // Modell ist 0.96 hoch -> ca. 2.6 Einheiten (Figur: 1.3)
  trafficlight_A: 2.7,
  bench: 3.0,
  bush: 2.4,
  firehydrant: 3.2,
};

const STREETLIGHT_SPACING = 400; // Server-Einheiten zwischen zwei Laternen
const PROP_EDGE_OFFSET = 56;     // Abstand von der Strassenmitte zum Gehweg

// Strassenbaeume stehen weiter draussen als alles andere: eine Krone ist bis
// zu 6 Einheiten breit, ein Laternenmast keine halbe. Bei gleichem Abstand
// staende jede Laterne im Baum.
const TREE_SPACING = 520;
const TREE_EDGE_OFFSET = 76;

// Vier Arten im Wechsel. Eine einzige Art ueber die ganze Stadt saehe aus wie
// ein Kopierfehler; mehr als vier kosten je einen weiteren Zeichenaufruf,
// ohne dass man den Unterschied noch bemerkt.
const STREET_TREE_MODELS = [
  'nat-Tree_1_B_Color1',
  'nat-Tree_2_C_Color1',
  'nat-Tree_3_B_Color1',
  'nat-Tree_4_B_Color1',
];


/** Mischanteil bildratenunabhaengig machen, damit es bei 30fps genauso schnell wirkt wie bei 120fps. */
function frameRateIndependentBlend(perFrameRate, dtMs) {
  return 1 - Math.pow(1 - perFrameRate, Math.max(dtMs, 1) / 16.667);
}

/** Winkel weich angleichen, inklusive korrektem Umgang mit dem Sprung bei ±180°. */
function lerpAngle(current, target, t) {
  let diff = target - current;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  return current + diff * t;
}

const BUILDING_FOOTPRINT = 3; // Breite/Tiefe aller Immobilien-Gebaeude in 3D-Einheiten
const BUILDING_MIN_HEIGHT = 4;
const BUILDING_HEIGHT_PER_PRICE = 1 / 400; // teurere Immobilien wirken sichtbar groesser

// MUSS mit server/crime.js (JAIL_POSITION) uebereinstimmen
const JAIL_POSITION = { x: 100, y: 1900 };

// Andere Spieler bekommen eine von mehreren Farben statt alle identisch rot zu sein -
// Zuweisung ist deterministisch aus der Spieler-ID, daher sehen ALLE Clients denselben
// Spieler auch in derselben Farbe (kein Zufall, kein Server-Synchronisierungsaufwand noetig).
const OTHER_PLAYER_PALETTE = [
  { body: 0xe05a5a, head: 0xe98080 }, // rot
  { body: 0xe0a45a, head: 0xe9c080 }, // orange
  { body: 0xd6c74a, head: 0xe3d980 }, // gelb
  { body: 0x5ac488, head: 0x80e0a8 }, // gruen
  { body: 0x5ab8c4, head: 0x80d6e0 }, // tuerkis
  { body: 0xa05ae0, head: 0xc080e9 }, // lila
  { body: 0xe05aa8, head: 0xe980c4 }, // pink
];

function colorPairForPlayer(isSelf, playerId) {
  if (isSelf) return { body: 0x4a7cff, head: 0x6f97ff };
  return OTHER_PLAYER_PALETTE[playerId % OTHER_PLAYER_PALETTE.length];
}

class Renderer {
  constructor(canvas, net) {
    this.net = net;
    this.lastFrame = performance.now();
    this.running = false;
    this.hud = document.getElementById('hud');

    this.scene = new THREE.Scene();
    // Kein einfarbiger Hintergrund mehr: den Himmel zeichnet eine Kuppel
    // (buildSky), der Nebel bekommt deren Horizontfarbe - so verschwimmt die
    // Stadt in der Ferne mit dem Himmel statt vor einer grauen Wand zu enden.
    this.scene.fog = new THREE.Fog(SKY_DAY.horizon, 60, VIEW_DISTANCE);

    this.camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 900);
    this.camera.position.set(WORLD_SIZE_3D / 2, CAMERA_HEIGHT, WORLD_SIZE_3D / 2 + CAMERA_DISTANCE);

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.outputEncoding = THREE.sRGBEncoding;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    // Stadtkacheln, die ausserhalb der Sichtweite ausgeblendet werden, und die
    // Teilmenge davon, die der Kamera im Weg stehen kann (Gebaeude, Baeume).
    this.cullChunks = [];
    this.occluderChunks = [];
    this.fogFar = VIEW_DISTANCE;
    this.nightFactor = 0;
    this.weather = 'clear';

    // Kamera: Abstand und Neigung sind vom Spieler einstellbar, der
    // tatsaechliche Abstand kann durch Hindernisse kuerzer sein.
    this.camZoom = CAMERA_DISTANCE + 1.5;
    this.camPitch = 0.3;
    this.camActualDistance = this.camZoom;
    this.raycaster = new THREE.Raycaster();
    this.frameCount = 0;
    this.labelSprites = new Set(); // alle Beschriftungen, fuer das Ausblenden nach Entfernung

    // Durchsicht: gemeinsame Werte fuer alle Materialien, die zwischen Kamera
    // und Figur durchsichtig werden (siehe applyCameraFade).
    this.fadeUniforms = { uFadeFocus: { value: new THREE.Vector3() } };

    this.entities = new Map();  // playerId -> { group, headMat, bodyMat, label, lastLabelText }
    this.copEntities = new Map(); // copId -> { group }
    this.buildingEntities = new Map(); // propertyId -> { group, mat, label, lastLabelText, lastColorKey }
    this.cityMeshes = []; // Strassen und Deko-Gebaeude aus dem Server-Layout
    this.vehicleEntities = new Map(); // vehicleId -> { group, mat, lastColorKey }
    this.modelTemplates = new Map();
    // Haustiere getrennt halten: modelTemplates enthaelt einzelne Meshes (die
    // Instanzierung greift auf .geometry zu), Haustiere sind ganze Teilbaeume.
    this.petTemplates = new Map();  // Modellname -> Vorlage zum Klonen

    // Mehrteilige Modelle aus den Buendeln (Fahrzeuge, Zug, Fahrrad). Gleiche
    // Ueberlegung wie bei den Haustieren: ein Kenney-Auto besteht aus
    // Karosserie plus vier Raedern als eigene Netze und laesst sich nicht als
    // Einzelnetz ablegen, ohne die Raeder zu verlieren.
    this.kitTemplates = new Map();

    // Diagnose statt Konsolen-Logs: auf dem iPad ist die Browser-Konsole ohne
    // angeschlossenen Mac nicht erreichbar. Diese Werte lassen sich im Spiel
    // anzeigen und beantworten die Frage "woran liegt es" ohne Werkzeuge.
    this.petDiag = { loaded: 0, placed: 0, seen: 0, last: '-' };

    // Haustiere als eigene Entitaeten, analog zu this.entities fuer die Figuren.
    this.petEntities = new Map();
    this.modelsReady = false;
    this.facingById = new Map(); // playerId -> Bogenmass, Blickrichtung bei Stillstand beibehalten

    this.smoothedCamPos = this.camera.position.clone();
    this.smoothedCamTarget = new THREE.Vector3(WORLD_SIZE_3D / 2, CAMERA_LOOK_HEIGHT, WORLD_SIZE_3D / 2);

    this.buildStaticScene();
    this.loadModels(); // laeuft im Hintergrund, bis dahin Quader
    window.addEventListener('resize', () => this.onResize());
  }

  buildStaticScene() {
    // Als Feld merken: Tageszeit und Wetter aendern Helligkeit und Farbe,
    // dafuer muss man die Lichtquellen spaeter noch erreichen koennen.
    // Himmelslicht statt flachem Umgebungslicht: von oben kommt Himmelsblau,
    // von unten der Widerschein des Bodens. Dadurch haben Flaechen, die nicht
    // in der Sonne liegen, trotzdem Form statt einheitlichem Grau.
    const hemi = new THREE.HemisphereLight(SKY_DAY.top, SKY_DAY.ground, 0.75);
    this.ambientLight = hemi;
    this.scene.add(hemi);

    const sun = new THREE.DirectionalLight(SKY_DAY.sun, 1.6);
    this.sunLight = sun;
    // Richtung relativ zur Figur - die Position wird jedes Bild mitgefuehrt
    // (updateSun), damit der scharfe Schattenausschnitt immer dort liegt, wo
    // man hinschaut.
    this.sunOffset = new THREE.Vector3(28, 55, 18);
    sun.position.set(WORLD_SIZE_3D / 2 + 28, 55, WORLD_SIZE_3D / 2 + 18);
    sun.castShadow = true;
    const hochwertig = !/iPhone|iPad|Android/i.test(navigator.userAgent);
    sun.shadow.mapSize.width = hochwertig ? 2048 : 1024;
    sun.shadow.mapSize.height = hochwertig ? 2048 : 1024;
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 140;
    sun.shadow.camera.left = -SHADOW_EXTENT;
    sun.shadow.camera.right = SHADOW_EXTENT;
    sun.shadow.camera.top = SHADOW_EXTENT;
    sun.shadow.camera.bottom = -SHADOW_EXTENT;
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.03;
    sun.target.position.set(WORLD_SIZE_3D / 2, 0, WORLD_SIZE_3D / 2);
    this.scene.add(sun.target);
    this.scene.add(sun);

    // Nachts eine sanfte Lichtquelle an der eigenen Figur - wie der Schein
    // der Strassenlaternen, ohne hunderte echte Lichter (die kein Tablet
    // durchhalten wuerde). Tagsueber auf 0.
    this.playerGlow = new THREE.PointLight(0xffd9a0, 0, 14, 1.6);
    this.scene.add(this.playerGlow);

    // Boden: Wiese mit leichter Struktur statt dunklem Asphaltgrau. Die
    // Strassen liegen darueber, die Wiese bleibt zwischen den Haeusern sichtbar.
    const groundGeo = new THREE.PlaneGeometry(WORLD_SIZE_3D + 400, WORLD_SIZE_3D + 400);
    const groundMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: this.makeGroundTexture(),
      roughness: 1,
    });
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(WORLD_SIZE_3D / 2, 0, WORLD_SIZE_3D / 2);
    ground.receiveShadow = true;
    this.scene.add(ground);

    this.buildSky();
    this.buildRain();

    // Kein Hilfsraster mehr: Die echten Strassen aus dem Server-Layout uebernehmen
    // jetzt die Orientierungsfunktion, zusaetzliche Rasterlinien wuerden nur stoeren.

    this.buildJailMarker();
  }

  /** Wiese: gruener Grund mit Sprenkeln, aus Code gemalt statt als Bilddatei. */
  makeGroundTexture() {
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#5f8a3e';
    ctx.fillRect(0, 0, 256, 256);
    // Deterministischer Zufall, damit die Wiese bei jedem Laden gleich aussieht
    let seed = 7;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    const toene = ['#557d37', '#6a9746', '#4f7433', '#739f4d', '#5a843b'];
    for (let i = 0; i < 2600; i++) {
      ctx.fillStyle = toene[i % toene.length];
      const s = 1 + rnd() * 3;
      ctx.fillRect(rnd() * 256, rnd() * 256, s, s);
    }
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set((WORLD_SIZE_3D + 400) / 10, (WORLD_SIZE_3D + 400) / 10);
    tex.encoding = THREE.sRGBEncoding;
    tex.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
    return tex;
  }

  /**
   * Himmelskuppel mit Farbverlauf, Sonne/Mond und Sternen. Eine grosse Kugel,
   * von innen gesehen, die jedes Bild mit der Kamera mitwandert - so ist sie
   * nie erreichbar und immer "unendlich weit" weg.
   */
  buildSky() {
    const uniforms = {
      topColor: { value: new THREE.Color(SKY_DAY.top) },
      horizonColor: { value: new THREE.Color(SKY_DAY.horizon) },
      groundColor: { value: new THREE.Color(SKY_DAY.ground) },
      sunColor: { value: new THREE.Color(SKY_DAY.sun) },
      sunDir: { value: new THREE.Vector3(0.4, 0.8, 0.3).normalize() },
      stars: { value: 0 },
    };
    const material = new THREE.ShaderMaterial({
      uniforms,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      vertexShader: `
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: `
        uniform vec3 topColor; uniform vec3 horizonColor; uniform vec3 groundColor;
        uniform vec3 sunColor; uniform vec3 sunDir; uniform float stars;
        varying vec3 vDir;
        float hash(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 45.164))) * 43758.5453); }
        void main() {
          vec3 d = normalize(vDir);
          float h = d.y;
          vec3 col = mix(horizonColor, topColor, pow(clamp(h, 0.0, 1.0), 0.5));
          col = mix(col, groundColor, smoothstep(0.0, -0.2, h));
          float s = max(dot(d, normalize(sunDir)), 0.0);
          col += sunColor * (pow(s, 1200.0) * 3.0 + pow(s, 16.0) * 0.18);
          if (stars > 0.0 && h > 0.05) {
            vec3 cell = floor(d * 220.0);
            float st = step(0.9975, hash(cell));
            col += vec3(st * stars * (0.6 + 0.4 * hash(cell + 1.0)));
          }
          gl_FragColor = vec4(col, 1.0);
          #include <tonemapping_fragment>
          #include <encodings_fragment>
        }`,
    });
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(800, 32, 16), material);
    this.sky.renderOrder = -1;
    this.sky.frustumCulled = false;
    this.scene.add(this.sky);

    // Aktuelle und Zielwerte der Umgebung. Der Server schickt Tageszeit und
    // Wetter nur alle zehn Sekunden - ohne weiches Nachfuehren wuerde der
    // Himmel sprunghaft umschalten.
    this.envCurrent = null;
    this.envTarget = this.computeEnvTarget({ phase: 'day', progress: 0.5, weather: 'clear' });
  }

  /** Regen als kurze Striche in einem Kasten um die Kamera. */
  buildRain() {
    const N = 1400;
    const pos = new Float32Array(N * 6);
    this.rainDrops = [];
    for (let i = 0; i < N; i++) {
      this.rainDrops.push({
        x: (Math.random() - 0.5) * 40,
        y: Math.random() * 30,
        z: (Math.random() - 0.5) * 40,
        v: 22 + Math.random() * 8,
      });
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.LineBasicMaterial({ color: 0xdfe8f5, transparent: true, opacity: 0.75, fog: false, toneMapped: false });
    this.rain = new THREE.LineSegments(geo, mat);
    this.rain.frustumCulled = false;
    this.rain.visible = false;
    this.scene.add(this.rain);
  }

  updateRain(dtSec) {
    if (!this.rain) return;
    const on = this.weather === 'rain';
    this.rain.visible = on;
    if (!on) return;
    const cx = this.camera.position.x;
    const cy = this.camera.position.y;
    const cz = this.camera.position.z;
    const arr = this.rain.geometry.attributes.position.array;
    const wind = 0.12;
    for (let i = 0; i < this.rainDrops.length; i++) {
      const d = this.rainDrops[i];
      d.y -= d.v * dtSec;
      d.x -= d.v * wind * dtSec;
      if (d.y < -cy) { d.y += 30; d.x = (Math.random() - 0.5) * 40; d.z = (Math.random() - 0.5) * 40; }
      const x = cx + d.x;
      const y = cy + d.y - 8;
      const z = cz + d.z;
      const k = i * 6;
      arr[k] = x; arr[k + 1] = y; arr[k + 2] = z;
      arr[k + 3] = x + wind * 1.1; arr[k + 4] = y - 1.1; arr[k + 5] = z;
    }
    this.rain.geometry.attributes.position.needsUpdate = true;
  }

  /** Weicher, runder Lichtfleck - fuer Laternenschein und Wegmarke. */
  makeGlowTexture() {
    if (this._glowTex) return this._glowTex;
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const ctx = c.getContext('2d');
    const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.25, 'rgba(255,255,255,0.6)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);
    this._glowTex = new THREE.CanvasTexture(c);
    return this._glowTex;
  }

  /**
   * Laternenschein: ein leuchtender Punkt am Mast und ein Lichtkegel auf dem
   * Boden, beides nur nachts sichtbar. Echte Lichtquellen waeren bei ueber
   * 400 Laternen fuer kein Tablet zu stemmen - das hier kostet zwei
   * Zeichenaufrufe.
   */
  buildLampGlow(lamps) {
    if (!lamps || lamps.length === 0) return;
    const tex = this.makeGlowTexture();

    const pos = new Float32Array(lamps.length * 3);
    lamps.forEach((l, i) => {
      // Der Kopf der Laterne haengt etwas zur Strasse hin (rotY zeigt dorthin).
      pos[i * 3] = l.x * WORLD_SCALE + Math.sin(l.rotY || 0) * 0.55;
      pos[i * 3 + 1] = 2.55;
      pos[i * 3 + 2] = l.y * WORLD_SCALE + Math.cos(l.rotY || 0) * 0.55;
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({
      map: tex, color: 0xffd08a, size: 2.4, sizeAttenuation: true,
      transparent: true, opacity: 0, depthWrite: false,
      blending: THREE.AdditiveBlending, fog: false,
    });
    const points = new THREE.Points(geo, mat);
    points.frustumCulled = false;
    this.scene.add(points);
    this.cityMeshes.push(points);

    const pool = new THREE.InstancedMesh(
      new THREE.PlaneGeometry(7, 7).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({
        map: tex, color: 0xffc070, transparent: true, opacity: 0,
        depthWrite: false, blending: THREE.AdditiveBlending,
      }),
      lamps.length,
    );
    const m = new THREE.Matrix4();
    lamps.forEach((l, i) => {
      m.makeTranslation(l.x * WORLD_SCALE + Math.sin(l.rotY || 0) * 1.2, 0.06, l.y * WORLD_SCALE + Math.cos(l.rotY || 0) * 1.2);
      pool.setMatrixAt(i, m);
    });
    pool.frustumCulled = false;
    this.scene.add(pool);
    this.cityMeshes.push(pool);

    this.lampGlow = { points, pool };
  }

  /**
   * Zielwerte fuer Himmel, Licht und Nebel aus Tageszeit und Wetter.
   *
   * `progress` (0..1) kommt vom Server und laeuft innerhalb der Phase durch.
   * An den Phasengrenzen wird ueber die ersten und letzten 15% geblendet -
   * genau dort liegt die Daemmerung mit ihrem orangen Horizont.
   */
  computeEnvTarget(env) {
    const edge = 0.15;
    const p = Math.min(1, Math.max(0, env.progress || 0));
    let night;
    if (env.phase === 'night') {
      night = p < edge ? p / edge : (p > 1 - edge ? (1 - p) / edge : 1);
    } else {
      night = p < edge ? 1 - p / edge : (p > 1 - edge ? 1 - (1 - p) / edge : 0);
    }
    const fog = env.weather === 'fog';
    const rain = env.weather === 'rain';
    const base = rain ? SKY_RAIN : fog ? SKY_FOG : SKY_DAY;
    const dusk = (1 - Math.abs(2 * night - 1)) * (rain || fog ? 0.3 : 0.85);

    const mix = (key) => {
      const c = new THREE.Color(base[key]).lerp(new THREE.Color(SKY_NIGHT[key]), night);
      return c.lerp(new THREE.Color(SKY_DUSK[key]), dusk);
    };

    // Sonnenstand: im Tagesverlauf von Ost nach West, nachts der Mond.
    const winkel = env.phase === 'night' ? 0.35 + p * 0.3 : 0.2 + p * 0.6;
    const hoehe = Math.sin(winkel * Math.PI);
    const sunDir = new THREE.Vector3(Math.cos(winkel * Math.PI) * 0.9, 0.25 + hoehe * 0.75, 0.35).normalize();

    const damp = fog ? 0.7 : rain ? 0.8 : 1;
    return {
      top: mix('top'), horizon: mix('horizon'), ground: mix('ground'), sun: mix('sun'),
      sunDir,
      hemiI: (0.8 - night * 0.45) * damp,
      sunI: (1.7 - night * 1.35) * damp,
      fogNear: fog ? 12 : 60 - night * 25,
      fogFar: fog ? 60 : VIEW_DISTANCE - night * 40,
      night,
      stars: rain || fog ? 0 : Math.max(0, night * 1.2 - 0.2),
      exposure: 1.05 + night * 0.25,
    };
  }

  /** Setzt Beleuchtung und Sichtweite nach Tageszeit und Wetter. */
  applyEnvironment(env) {
    if (!env || !this.sky) return;
    this.weather = env.weather || 'clear';
    this.envTarget = this.computeEnvTarget(env);
    if (!this.envCurrent) this.envCurrent = this.cloneEnv(this.envTarget);
  }

  cloneEnv(e) {
    return {
      ...e,
      top: e.top.clone(), horizon: e.horizon.clone(), ground: e.ground.clone(),
      sun: e.sun.clone(), sunDir: e.sunDir.clone(),
    };
  }

  /** Jedes Bild: Umgebung weich an das Ziel heranfuehren und anwenden. */
  updateEnvironment(dtMs) {
    if (!this.envTarget) return;
    if (!this.envCurrent) this.envCurrent = this.cloneEnv(this.envTarget);
    const c = this.envCurrent;
    const t = this.envTarget;
    const b = frameRateIndependentBlend(0.02, dtMs);
    for (const k of ['top', 'horizon', 'ground', 'sun']) c[k].lerp(t[k], b);
    c.sunDir.lerp(t.sunDir, b).normalize();
    for (const k of ['hemiI', 'sunI', 'fogNear', 'fogFar', 'night', 'stars', 'exposure']) {
      c[k] += (t[k] - c[k]) * b;
    }

    const u = this.sky.material.uniforms;
    u.topColor.value.copy(c.top);
    u.horizonColor.value.copy(c.horizon);
    u.groundColor.value.copy(c.ground);
    u.sunColor.value.copy(c.sun);
    u.sunDir.value.copy(c.sunDir);
    u.stars.value = c.stars;

    this.scene.fog.color.copy(c.horizon);
    this.scene.fog.near = c.fogNear;
    this.scene.fog.far = c.fogFar;
    this.fogFar = c.fogFar;

    this.ambientLight.color.copy(c.top).lerp(new THREE.Color(0xffffff), 0.45);
    this.ambientLight.groundColor.copy(c.ground);
    this.ambientLight.intensity = c.hemiI;
    this.sunLight.color.copy(c.sun);
    this.sunLight.intensity = c.sunI;
    this.sunOffset.copy(c.sunDir).multiplyScalar(65);
    this.renderer.toneMappingExposure = c.exposure;
    this.nightFactor = c.night;

    this.playerGlow.intensity = c.night * 1.1;
    if (this.lampGlow) {
      this.lampGlow.points.material.opacity = Math.min(1, c.night * 1.3);
      this.lampGlow.pool.material.opacity = c.night * 0.35;
    }
  }

  /** Sonne und Schattenausschnitt folgen der eigenen Figur. */
  updateSun(focus) {
    const s = this.sunLight;
    // Auf ganze Schatten-Texel runden, sonst flimmern die Schattenkanten beim
    // Laufen, weil der Ausschnitt jedes Bild um Bruchteile verrutscht.
    const texel = (SHADOW_EXTENT * 2) / s.shadow.mapSize.width;
    const fx = Math.round(focus.x / texel) * texel;
    const fz = Math.round(focus.z / texel) * texel;
    s.target.position.set(fx, 0, fz);
    s.position.set(fx + this.sunOffset.x, this.sunOffset.y, fz + this.sunOffset.z);
    s.target.updateMatrixWorld();
    this.playerGlow.position.set(focus.x, 3.2, focus.z);
  }

  /**
   * Blendet Stadtkacheln aus, die komplett im Nebel liegen. Nur alle paar
   * Bilder - die Figur bewegt sich in der Zeit kaum eine Einheit.
   */
  updateCulling(focus) {
    const grenze = this.fogFar + 6;
    for (const ch of this.cullChunks) {
      const d = Math.hypot(ch.x - focus.x, ch.z - focus.z) - ch.r;
      ch.obj.visible = d < grenze;
      // Schatten nur fuer Kacheln, die den Schattenausschnitt beruehren -
      // sonst rechnet die Grafikkarte die halbe Stadt ein zweites Mal durch.
      if (ch.shadow) ch.obj.castShadow = d < SHADOW_EXTENT * 1.5;
    }
  }

  /**
   * Verteilt Platzierungen auf Kacheln und baut je Kachel eine InstancedMesh.
   * Gibt eine Gruppe zurueck, die wie bisher EIN Objekt in cityMeshes ist.
   * Mehr Zeichenaufrufe als vorher (eine Handvoll pro Modell), dafuer wird
   * alles ausserhalb der Sichtweite gar nicht erst gezeichnet.
   */
  buildChunkedInstances(geometry, material, items, opts = {}) {
    const chunks = new Map();
    for (const it of items) {
      const key = Math.floor(it.x / CHUNK_SIZE_3D) + ',' + Math.floor(it.z / CHUNK_SIZE_3D);
      if (!chunks.has(key)) chunks.set(key, []);
      chunks.get(key).push(it);
    }
    if (!geometry.boundingSphere) geometry.computeBoundingSphere();
    const modelR = geometry.boundingSphere.radius;

    const group = new THREE.Group();
    const matrix = new THREE.Matrix4();
    const quat = new THREE.Quaternion();
    const pos = new THREE.Vector3();
    const scl = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);

    if (opts.occluder || opts.fade) this.applyCameraFade(material);
    for (const list of chunks.values()) {
      const mesh = new THREE.InstancedMesh(geometry, material, list.length);
      mesh.castShadow = opts.castShadow !== false;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      let minX = Infinity; let maxX = -Infinity; let minZ = Infinity; let maxZ = -Infinity; let maxS = 1;
      list.forEach((p, idx) => {
        pos.set(p.x, p.y || 0, p.z);
        quat.setFromAxisAngle(up, p.rotY || 0);
        scl.set(p.sx != null ? p.sx : 1, p.sy != null ? p.sy : 1, p.sz != null ? p.sz : 1);
        matrix.compose(pos, quat, scl);
        mesh.setMatrixAt(idx, matrix);
        minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
        minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
        maxS = Math.max(maxS, scl.x, scl.y, scl.z);
      });
      mesh.instanceMatrix.needsUpdate = true;
      group.add(mesh);
      const entry = {
        shadow: mesh.castShadow,
        obj: mesh,
        x: (minX + maxX) / 2,
        z: (minZ + maxZ) / 2,
        r: Math.hypot(maxX - minX, maxZ - minZ) / 2 + modelR * maxS,
      };
      this.cullChunks.push(entry);
      if (opts.occluder) this.occluderChunks.push(entry);
    }
    return group;
  }

  /**
   * Durchsicht fuer Gebaeude und Baeume: Was zwischen Kamera und Figur steht
   * oder der Kamera zu nahe kommt, wird im Rastermuster ausgespart. So sieht
   * man die eigene Figur auch hinter einem Baumstamm - wie in den meisten
   * Third-Person-Spielen. Pro Instanz ginge das mit InstancedMesh nicht,
   * deshalb im Shader pro Pixel.
   *
   * Nur der Farbdurchgang wird veraendert; die Schatten rechnet three.js mit
   * einem eigenen Tiefenmaterial, sie bleiben also vollstaendig.
   */
  applyCameraFade(material) {
    // WeakSet statt userData-Merker: material.clone() kopiert userData mit,
    // aber NICHT onBeforeCompile - ein Klon saehe sonst faelschlich
    // "schon erledigt" aus.
    if (!this._fadePatched) this._fadePatched = new WeakSet();
    if (!material || this._fadePatched.has(material)) return;
    this._fadePatched.add(material);
    const shared = this.fadeUniforms;
    material.onBeforeCompile = (shader) => {
      shader.uniforms.uFadeFocus = shared.uFadeFocus;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vFadeWorld;')
        .replace('#include <project_vertex>', [
          '#include <project_vertex>',
          'vec4 fadeWorld = vec4(transformed, 1.0);',
          '#ifdef USE_INSTANCING',
          'fadeWorld = instanceMatrix * fadeWorld;',
          '#endif',
          'vFadeWorld = (modelMatrix * fadeWorld).xyz;',
        ].join('\n'));
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vFadeWorld;\nuniform vec3 uFadeFocus;')
        .replace('#include <clipping_planes_fragment>', [
          '#include <clipping_planes_fragment>',
          '{',
          '  vec3 seg = uFadeFocus - cameraPosition;',
          '  float len = length(seg);',
          '  vec3 dir = seg / max(len, 0.001);',
          '  vec3 rel = vFadeWorld - cameraPosition;',
          '  float t = dot(rel, dir);',
          '  float quer = length(rel - dir * t);',
          '  bool zwischen = t > 0.0 && t < len - 0.6 && quer < 1.6 + t * 0.12;',
          '  bool nah = length(rel) < 2.2;',
          '  if (zwischen || nah) {',
          '    vec2 f = floor(gl_FragCoord.xy);',
          '    if (mod(f.x + f.y, 2.0) < 1.0 || mod(f.y, 2.0) < 1.0) discard;',
          '  }',
          '}',
        ].join('\n'));
    };
    material.needsUpdate = true;
  }

  /**
   * Kamera nicht durch Waende: Strahl von der Figur zur
   * gewuenschten Kameraposition, bei einem Treffer rueckt die Kamera davor.
   * Geprueft wird nur, was in der Naehe steht.
   */
  cameraObstacleDistance(from, dir, maxDist) {
    const nah = [];
    for (const ch of this.occluderChunks) {
      if (!ch.obj.visible) continue;
      if (Math.hypot(ch.x - from.x, ch.z - from.z) - ch.r < maxDist + 2) nah.push(ch.obj);
    }
    if (this.placeModels) for (const m of this.placeModels) nah.push(m);
    if (nah.length === 0) return maxDist;
    this.raycaster.set(from, dir);
    this.raycaster.far = maxDist;
    const hits = this.raycaster.intersectObjects(nah, true);
    return hits.length > 0 ? hits[0].distance : maxDist;
  }

  /** Beschriftungen nach Entfernung ein- und ausblenden, gegen Schilderwald. */
  updateLabels(focus) {
    for (const sprite of this.labelSprites) {
      let root = sprite;
      while (root.parent) root = root.parent;
      if (root !== this.scene) { this.labelSprites.delete(sprite); continue; }
      const max = sprite.userData.maxDist;
      if (!max) continue;
      sprite.getWorldPosition(this._tmpV || (this._tmpV = new THREE.Vector3()));
      const d = Math.hypot(this._tmpV.x - focus.x, this._tmpV.z - focus.z);
      const fade = Math.min(1, Math.max(0, (max - d) / (max * 0.25)));
      sprite.material.opacity = fade;
      sprite.visible = fade > 0.02 && sprite.userData.hidden !== true;
    }
  }

  /**
   * Wegmarke: eine Lichtsaeule ueber einem Ort, sichtbar ueber die Daecher
   * hinweg. Zeigt dem Spieler, wohin es fuer das naechste Lebensziel geht.
   * null blendet sie aus.
   */
  setGoalMarker(place) {
    if (!this.goalMarker) {
      const group = new THREE.Group();
      const beam = new THREE.Mesh(
        new THREE.CylinderGeometry(0.9, 0.9, 70, 16, 1, true),
        new THREE.MeshBasicMaterial({
          color: 0xffd35a, transparent: true, opacity: 0.28,
          depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false,
        }),
      );
      beam.position.y = 35;
      group.add(beam);
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(1.4, 2.0, 32).rotateX(-Math.PI / 2),
        new THREE.MeshBasicMaterial({ color: 0xffd35a, transparent: true, opacity: 0.8, depthWrite: false, side: THREE.DoubleSide }),
      );
      ring.position.y = 0.08;
      group.add(ring);
      group.userData.ring = ring;
      group.visible = false;
      this.scene.add(group);
      this.goalMarker = group;
    }
    if (!place) { this.goalMarker.visible = false; this.goalMarkerPlace = null; return; }
    this.goalMarkerPlace = place;
    this.goalMarker.position.set(place.position.x * WORLD_SCALE, 0, place.position.y * WORLD_SCALE);
    this.goalMarker.visible = true;
  }

  updateGoalMarker(now, focus) {
    const g = this.goalMarker;
    if (!g || !g.visible) return;
    const s = 1 + Math.sin(now / 350) * 0.15;
    g.userData.ring.scale.set(s, 1, s);
    // Wer schon da ist, braucht keine Saeule mehr, die ihm die Sicht nimmt.
    const d = Math.hypot(g.position.x - focus.x, g.position.z - focus.z);
    g.children[0].material.opacity = d < 12 ? 0.06 : 0.28;
  }

  /** Sichtbarer Gefaengnis-Standort: einfacher Kaefig aus duennen Stangen, statt einer unsichtbaren Ecke. */
  buildJailMarker() {
    const jx = JAIL_POSITION.x * WORLD_SCALE;
    const jz = JAIL_POSITION.y * WORLD_SCALE;
    const size = 5;
    const barMat = new THREE.MeshStandardMaterial({ color: 0x8a8f9a });

    const floorGeo = new THREE.PlaneGeometry(size, size);
    const floorMat = new THREE.MeshStandardMaterial({ color: 0x35302a });
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(jx, 0.02, jz);
    this.scene.add(floor);

    const barPositions = [
      [-size / 2, -size / 2], [size / 2, -size / 2],
      [-size / 2, size / 2], [size / 2, size / 2],
      [0, -size / 2], [0, size / 2], [-size / 2, 0], [size / 2, 0],
    ];
    for (const [dx, dz] of barPositions) {
      const barGeo = new THREE.CylinderGeometry(0.06, 0.06, 2.2, 6);
      const bar = new THREE.Mesh(barGeo, barMat);
      bar.position.set(jx + dx, 1.1, jz + dz);
      this.scene.add(bar);
    }

    const label = this.createLabelSprite('🚔 Gefängnis', null, 150);
    label.position.set(jx, 3, jz);
    this.scene.add(label);
  }

  /**
   * Die festen Orte (Bank, Uni, Arbeitsamt, ...) als erkennbare Gebaeude mit
   * farbiger Bodenplatte und Beschriftung. Die Platte hat bewusst genau den
   * Durchmesser der Interaktionsreichweite aus dem Server-Katalog: wer mit
   * beiden Fuessen darauf steht, ist garantiert nah genug. So muss niemand
   * raten, wie dicht man herangehen muss.
   *
   * Die Meshes landen in cityMeshes, damit sie bei einem erneuten Layout
   * (Reconnect) zusammen mit dem Rest abgeraeumt werden.
   */
  buildPlaceMarkers() {
    const plateColors = {
      jobcenter: 0x3f6b46,
      university: 0x4a4a8c,
      bank: 0x2f6d78,
      realestate: 0x7a5a2e,
      cityhall: 0x74364f,
      hospital: 0x8c3a3a,
      gym: 0x3a7a6a,
      dealership: 0x5a5a2e,
      lawoffice: 0x4a4a5c,
      townhall: 0x6a5a3a,
      exchange: 0x2e6a4a,
      blackmarket: 0x2a2a2e,
      raceoffice: 0x7a3a2e,
    };

    this.placeModels = [];
    for (const place of this.net.places) {
      const px = place.position.x * WORLD_SCALE;
      const pz = place.position.y * WORLD_SCALE;

      // Bodenplatte = Reichweite. Radius, nicht Durchmesser - deshalb kein /2.
      const plateGeo = new THREE.CircleGeometry(place.range * WORLD_SCALE, 32);
      const plateMat = new THREE.MeshStandardMaterial({
        color: plateColors[place.id] || 0x555555,
        transparent: true,
        opacity: 0.55,
      });
      const plate = new THREE.Mesh(plateGeo, plateMat);
      plate.rotation.x = -Math.PI / 2;
      // Knapp ueber der Strasse (die liegt auf 0.03), sonst flackern beide gegeneinander
      plate.position.set(px, 0.04, pz);
      plate.receiveShadow = true;
      this.scene.add(plate);
      this.cityMeshes.push(plate);

      const footprint = place.size * WORLD_SCALE;
      const modelName = BUILDING_MODEL_NAMES[
        Math.abs(Math.round(place.position.x * 31 + place.position.y * 17)) % BUILDING_MODEL_NAMES.length
      ];
      const model = this.cloneModel(modelName, footprint);

      // Wie bei den Immobilien: die Beschriftungshoehe aus der TATSAECHLICHEN
      // Modellhoehe messen statt aus der Grundflaeche zu schaetzen. Vorher stand
      // hier footprint * 1.7 (~12.7 Einheiten) - das hat mit der echten Hoehe des
      // Gebaeudes (ca. 3-4 Einheiten) nichts zu tun und liess die Schrift weit
      // ueber dem Dach schweben.
      let labelHeight;

      if (model) {
        model.position.set(px, 0, pz);
        model.traverse((o) => { if (o.isMesh) this.applyCameraFade(o.material); });
        this.scene.add(model);
        this.cityMeshes.push(model);
        this.placeModels.push(model);
        const box = new THREE.Box3().setFromObject(model);
        labelHeight = box.max.y + 0.5;
      } else {
        // Ohne geladene Modelle: einfacher Quader, damit der Ort trotzdem steht
        // und nicht bloss eine bemalte Flaeche ist.
        const h = footprint * 1.4;
        const geo = new THREE.BoxGeometry(footprint, h, footprint);
        const mat = new THREE.MeshStandardMaterial({ color: plateColors[place.id] || 0x555555 });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.set(px, h / 2, pz);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        this.scene.add(mesh);
        this.cityMeshes.push(mesh);
        labelHeight = h + 0.5;
      }

      // Groesser als die Standardbeschriftung (2.2 x 0.55): die Namen sind laenger
      // ("🏛️ Gewerbeamt") und sollen aus der Entfernung noch lesbar sein, aus der
      // man einen Ort ueberhaupt erst als Ziel anlaeuft.
      const label = this.createLabelSprite(`${place.icon} ${place.name}`, [3.4, 0.85], 400);
      label.position.set(px, labelHeight, pz);
      this.scene.add(label);
      this.cityMeshes.push(label);
    }
  }

  /**
   * Beschriftet die Firmensitze im Industriegebiet.
   *
   * Die Gebaeude stehen ohnehin als Stadtdeko da - hier kommt nur der Name
   * darueber. Das macht aus einer Zahl in einem Menue einen Ort, den man
   * ansteuern kann, und aus dem Industriegebiet eine Gegend mit Inhalt statt
   * einer Kulisse.
   */
  buildCompanySigns() {
    if (!this.companySigns) this.companySigns = [];
    for (const sign of this.companySigns) this.scene.remove(sign);
    this.companySigns = [];

    for (const company of this.net.companies.values()) {
      if (!company.site) continue;
      const label = this.createLabelSprite(`🏭 ${company.name}`, [3.0, 0.75], 90);
      label.position.set(company.site.x * WORLD_SCALE, 4.5, company.site.y * WORLD_SCALE);
      this.scene.add(label);
      this.companySigns.push(label);
    }
  }

  /** Baut Strassen und Deko-Gebaeude aus dem Server-Layout. Wird einmal aufgerufen, sobald es ankommt. */
  buildCityFromLayout() {
    // Vorherigen Aufbau entfernen, falls das Layout erneut ankommt (Reconnect)
    for (const mesh of this.cityMeshes) this.scene.remove(mesh);
    this.cityMeshes = [];
    this.cullChunks = [];
    this.occluderChunks = [];
    this.lampGlow = null;

    // Strassenkacheln aus dem Stadtkit. Nur wenn die Modelle da sind - sonst
    // bleiben die flachen Flaechen, damit die Karte nie leer ist.
    if (this.modelTemplates.has('road_straight')) {
      this.buildRoadTiles();
    } else {
      this.buildFlatRoads();
    }
  }

  /** Frueheres Verhalten: einfarbige Flaechen. Rueckfall ohne Modelle. */
  buildFlatRoads() {
    const roadMat = new THREE.MeshStandardMaterial({ color: 0x15171c });
    const worldSize3D = WORLD_SIZE_3D;

    for (const road of this.net.worldRoads) {
      const widthScaled = road.width * WORLD_SCALE;
      const isVertical = road.orientation === 'vertical';
      const geo = new THREE.PlaneGeometry(
        isVertical ? widthScaled : worldSize3D,
        isVertical ? worldSize3D : widthScaled
      );
      const mesh = new THREE.Mesh(geo, roadMat);
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.set(
        isVertical ? road.center * WORLD_SCALE : worldSize3D / 2,
        0.03, // knapp ueber dem Boden, damit es nicht mit dem Untergrund flackert
        isVertical ? worldSize3D / 2 : road.center * WORLD_SCALE
      );
      mesh.receiveShadow = true;
      this.scene.add(mesh);
      this.cityMeshes.push(mesh);
    }
  }

  /**
   * Legt das Strassenraster aus echten Kacheln aus: an jeder Kreuzung eine
   * Kreuzungskachel, dazwischen gerade Stuecke.
   *
   * Die Laenge der geraden Stuecke ergibt sich aus der Luecke zwischen zwei
   * Kreuzungen (Rasterabstand minus eine Kreuzungsbreite), geteilt durch die
   * Anzahl - so passt es exakt auf, ohne Fugen oder Ueberlappung. Die Kacheln
   * sind 1x1, ihre Breite wird auf die Strassenbreite gezogen.
   */
  buildRoadTiles() {
    const roads = this.net.worldRoads || [];
    const verticals = roads.filter((r) => r.orientation === 'vertical').map((r) => r.center).sort((a, b) => a - b);
    const horizontals = roads.filter((r) => r.orientation === 'horizontal').map((r) => r.center).sort((a, b) => a - b);
    if (verticals.length === 0 || horizontals.length === 0) return;

    const width = (roads[0].width || 90) * WORLD_SCALE;
    const TILES_PER_GAP = 4;

    const crossings = [];
    for (const vx of verticals) {
      for (const hz of horizontals) {
        crossings.push({ x: vx * WORLD_SCALE, z: hz * WORLD_SCALE, sx: width, sy: 1, sz: width });
      }
    }

    const straights = [];
    // Senkrechte Strassen: gerade Stuecke zwischen benachbarten Querstrassen.
    for (const vx of verticals) {
      for (let i = 0; i < horizontals.length - 1; i++) {
        const from = horizontals[i] * WORLD_SCALE + width / 2;
        const to = horizontals[i + 1] * WORLD_SCALE - width / 2;
        const len = (to - from) / TILES_PER_GAP;
        if (len <= 0) continue;
        for (let t = 0; t < TILES_PER_GAP; t++) {
          straights.push({ x: vx * WORLD_SCALE, z: from + len * (t + 0.5), sx: width, sy: 1, sz: len });
        }
      }
    }
    // Waagerechte: gleiches Verfahren, Kachel um 90 Grad gedreht, damit die
    // Fahrbahnmarkierung in Fahrtrichtung liegt.
    for (const hz of horizontals) {
      for (let i = 0; i < verticals.length - 1; i++) {
        const from = verticals[i] * WORLD_SCALE + width / 2;
        const to = verticals[i + 1] * WORLD_SCALE - width / 2;
        const len = (to - from) / TILES_PER_GAP;
        if (len <= 0) continue;
        for (let t = 0; t < TILES_PER_GAP; t++) {
          straights.push({ x: from + len * (t + 0.5), z: hz * WORLD_SCALE, rotY: Math.PI / 2, sx: width, sy: 1, sz: len });
        }
      }
    }

    for (const [name, list] of [['road_cross', crossings], ['road_straight', straights]]) {
      // Kacheln werfen keinen Schatten - sie liegen flach, und bei ueber
      // 1900 Stueck kostet die Schattenberechnung mehr, als sie zeigt.
      const inst = this.createModelInstances(name, list, { castShadow: false });
      if (inst) {
        this.scene.add(inst);
        this.cityMeshes.push(inst);
      }
    }
    console.log('Strassenkacheln:', crossings.length + straights.length, 'in 2 Zeichenaufrufen');

    // Deko-Gebaeude: leicht unterschiedliche Grautoene, damit die Stadt nicht
    // wie eine Reihe identischer Kloetze wirkt.
    // Gebaeude nach Modell gruppieren und je Modell EINE InstancedMesh bauen.
    // Vorher war jedes Gebaeude ein eigenes Objekt - bei 40 ging das, bei 239
    // in der vergroesserten Welt nicht mehr.
    const byModel = new Map();

    for (const b of this.net.worldBuildings) {
      // Modell deterministisch aus der Position waehlen, damit alle Clients
      // dieselbe Stadt sehen und sich beim Neuladen nichts veraendert.
      // Der Bezirk bestimmt dabei, aus WELCHEM Satz gewaehlt wird.
      const district = districtAt(b.x, b.y);
      const set = DISTRICT_MODELS[district] || BUILDING_MODEL_NAMES;
      const names = set.every((n) => this.modelTemplates.has(n)) ? set : BUILDING_MODEL_NAMES;
      const pick = Math.abs(Math.round(b.x * 31 + b.y * 17)) % names.length;
      const footprint = Math.max(b.w, b.d) * WORLD_SCALE;
      const name = names[pick];

      if (this.modelTemplates.has(name)) {
        const entry = this.normalizedGeometry(name);
        // Auf die Grundflaeche skalieren - die Modelle der drei Kits sind
        // unterschiedlich gross (0,8 bis 2,1 Einheiten), ohne Anpassung
        // stuenden Reihenhaeuser und Fabrikhallen in derselben Luecke.
        const scale = entry && entry.size.z > 0 ? footprint / entry.size.z : 1;
        if (!byModel.has(name)) byModel.set(name, []);
        byModel.get(name).push({
          x: b.x * WORLD_SCALE,
          z: b.y * WORLD_SCALE,
          rotY: (pick % 4) * (Math.PI / 2),
          sx: scale, sy: scale, sz: scale,
        });
      } else {
        const h = b.height * WORLD_SCALE * 4;
        const geo = new THREE.BoxGeometry(b.w * WORLD_SCALE, h, b.d * WORLD_SCALE);
        const shade = 0.55 + ((b.x * 31 + b.y * 17) % 100) / 400;
        const mat = new THREE.MeshStandardMaterial({
          color: new THREE.Color(shade * 0.38, shade * 0.40, shade * 0.46),
        });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.set(b.x * WORLD_SCALE, h / 2, b.y * WORLD_SCALE);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        this.scene.add(mesh);
        this.cityMeshes.push(mesh);
      }
    }

    let instanced = 0;
    for (const [name, list] of byModel) {
      const inst = this.createModelInstances(name, list, { occluder: true });
      if (inst) {
        this.scene.add(inst);
        this.cityMeshes.push(inst);
        instanced += list.length;
      }
    }
    if (instanced > 0) {
      console.log('Gebäude:', instanced, 'in', byModel.size, 'Zeichenaufrufen');
    }

    // Stadtdeko - nur wenn die Modelle geladen sind, sonst bleibt die Stadt schlicht
    if (this.modelsReady) {
      let propCount = 0;
      const alleDeko = this.buildPropPlacements();
      for (const [name, placements] of alleDeko) {
        // Baeume werden durchsichtig, wenn sie im Bild stehen, ziehen die
        // Kamera aber nicht heran - sonst springt sie beim Vorbeilaufen an
        // jeder Baumreihe vor und zurueck. Laternen sind zu duenn, um zu stoeren.
        const inst = this.createPropInstances(name, placements, { fade: STREET_TREE_MODELS.includes(name) });
        if (inst) {
          this.scene.add(inst);
          this.cityMeshes.push(inst);
          propCount += placements.length;
        }
      }
      this.buildLampGlow(alleDeko.get('streetlight'));
      if (propCount > 0) console.log('Stadtdeko platziert:', propCount, 'Objekte');
    }

    // Zuletzt, damit die Bodenplatten der Orte ueber der Strasse liegen und
    // nicht von spaeter hinzugefuegter Deko ueberdeckt werden.
    this.buildPlaceMarkers();
    this.buildCompanySigns();
  }

  /**
   * Laedt die Modelldatei. Laeuft im Hintergrund - bis sie da ist, zeigt das
   * Spiel die einfachen Quader. Sobald sie geladen ist, werden die bereits
   * gebauten Objekte einmal neu erzeugt, damit die Modelle erscheinen.
   */
  loadModels() {
    if (typeof THREE.GLTFLoader === 'undefined') {
      console.warn('GLTFLoader nicht geladen - Modelle werden nicht angezeigt, Quader bleiben.');
      return;
    }
    const loader = new THREE.GLTFLoader();

    // Die sechs Modellbuendel mit gemeinsamem Massstab (siehe kits.js). Sie
    // fuellen dieselben modelTemplates wie die alten Dateien, ihre Modelle
    // sind also ueberall dort verwendbar, wo bisher schon ein Name stand.
    if (typeof loadKitBundles === 'function') {
      loadKitBundles(loader, this.modelTemplates, this.kitTemplates, (datei, bilanz) => {
        this.modelsReady = this.modelTemplates.size > 0;
        console.log(`Buendel ${datei} geladen - Einzelnetze: ${bilanz.netze}, mehrteilig: ${bilanz.baeume}`);
        this.rebuildWithModels();

        // Figuren, die vor dem Laden des Buendels entstanden sind, stehen noch
        // als Grundformen da. Ihr Vergleichsschluessel wird zurueckgesetzt,
        // damit der naechste Bilddurchlauf sie mit dem echten Modell neu baut.
        if (datei === 'characters.glb') {
          for (const entry of this.entities.values()) entry.appearanceKey = '\u0000neu';
        }
      });
    } else {
      console.warn('kits.js nicht geladen - die neuen Modellbuendel fehlen.');
    }

    // Das Stadtkit wird ZUSAETZLICH geladen und scheitert leise: fehlt die
    // Datei, bleibt die Altstadt vollstaendig und die neuen Bezirke fallen auf
    // die Ersatzquader zurueck - besser als eine schwarze Karte.
    loader.load(
      PET_FILE,
      (gltf) => {
        // Den GANZEN Teilbaum je Tier merken, nicht die einzelnen Meshes.
        //
        // Die Tiere sind mehrstufig verschachtelt: unter "animal-cat" haengt
        // eine Zwischenebene und darunter erst die sieben Teile. Klont man nur
        // die Blaetter und haengt sie in eine neue Gruppe, geht jede
        // Transformation der Ebenen dazwischen verloren - die Teile landen
        // uebereinander oder ausserhalb des Sichtfelds. Object3D.clone()
        // uebernimmt den Teilbaum samt allem.
        gltf.scene.traverse((child) => {
          if (child.name && child.name.startsWith('animal-')) {
            this.petTemplates.set(child.name.slice('animal-'.length), child);
          }
        });
        this.petDiag.loaded = this.petTemplates.size;
        console.log('Haustiermodelle geladen:', this.petTemplates.size);
      },
      undefined,
      (err) => console.warn('Haustiermodelle nicht geladen:', err && err.message),
    );

    loader.load(
      CITYKIT_FILE,
      (gltf) => {
        gltf.scene.traverse((child) => {
          if (child.isMesh && child.name) this.modelTemplates.set(child.name, child);
        });
        this.modelsReady = this.modelTemplates.size > 0;
        console.log('Stadtkit geladen, Modelle gesamt:', this.modelTemplates.size);
        this.rebuildWithModels();
      },
      undefined,
      (err) => console.warn('Stadtkit nicht geladen:', err && err.message),
    );

    loader.load(
      MODEL_FILE,
      (gltf) => {
        // Alle benannten Netze einsammeln, damit sie spaeter per Name klonbar sind
        gltf.scene.traverse((child) => {
          if (child.isMesh && child.name) {
            this.modelTemplates.set(child.name, child);
          }
        });
        this.modelsReady = this.modelTemplates.size > 0;
        console.log('Modelle geladen:', this.modelTemplates.size);
        this.rebuildWithModels();
      },
      undefined,
      (err) => {
        console.warn('Modelldatei konnte nicht geladen werden, Quader bleiben:', err && err.message);
      }
    );
  }

  /** Wirft bereits erzeugte Platzhalter weg, damit sie mit Modellen neu entstehen. */
  rebuildWithModels() {
    for (const entry of this.vehicleEntities.values()) this.scene.remove(entry.group);
    this.vehicleEntities.clear();
    for (const entry of this.buildingEntities.values()) this.scene.remove(entry.group);
    this.buildingEntities.clear();
    for (const entry of this.copEntities.values()) this.scene.remove(entry.group);
    this.copEntities.clear();
    if (this.net.worldBuildings && this.net.worldBuildings.length > 0) this.buildCityFromLayout();
  }

  /**
   * Erzeugt eine Kopie eines geladenen Modells, skaliert auf die gewuenschte
   * Laenge (z-Achse). Gibt null zurueck, wenn das Modell nicht verfuegbar ist -
   * der Aufrufer faellt dann auf die Quader-Darstellung zurueck.
   */
  cloneModel(name, targetLength) {
    const template = this.modelTemplates.get(name);

    // Mehrteilige Buendel-Modelle (Fahrzeuge) liegen woanders und tragen
    // ihren Massstab schon in sich - targetLength wird fuer sie bewusst
    // ignoriert, sonst waere die ganze Vereinheitlichung wieder hin.
    // Gibt selbst null zurueck, wenn es den Namen auch dort nicht gibt - der
    // Aufrufer faellt dann wie bisher auf die Quader-Darstellung zurueck.
    if (!template) return cloneKitModel(this.kitTemplates, name);

    const mesh = template.clone();
    // Material MITKLONEN: sonst teilen sich alle Kopien dasselbe Material, und
    // das Einfaerben einer Immobilie wuerde alle anderen mit einfaerben.
    mesh.material = template.material.clone();
    mesh.castShadow = true;
    mesh.receiveShadow = true;

    // Ausgangsgroesse ermitteln und auf die Zielgroesse skalieren
    const box = new THREE.Box3().setFromObject(mesh);
    const size = new THREE.Vector3();
    box.getSize(size);
    if (targetLength && size.z > 0) {
      const s = targetLength / size.z;
      mesh.scale.set(s, s, s);
    }

    // In eine Gruppe legen und so verschieben, dass das Modell mittig steht
    // und mit der Unterkante auf dem Boden aufsitzt.
    const wrapper = new THREE.Group();
    wrapper.add(mesh);
    const scaledBox = new THREE.Box3().setFromObject(mesh);
    const center = new THREE.Vector3();
    scaledBox.getCenter(center);
    mesh.position.x -= center.x;
    mesh.position.z -= center.z;
    mesh.position.y -= scaledBox.min.y;

    return wrapper;
  }

  /**
   * Berechnet, wo welche Deko steht. Alles deterministisch aus dem Strassenraster
   * abgeleitet, damit jeder Client dieselbe Stadt sieht - ohne dass der Server
   * dafuer Daten schicken muss.
   * @returns {Map} Modellname -> [{ x, y, rotY }] in Server-Koordinaten
   */
  buildPropPlacements() {
    const placements = new Map();
    const add = (name, x, y, rotY) => {
      if (!placements.has(name)) placements.set(name, []);
      placements.get(name).push({ x, y, rotY });
    };

    const roads = this.net.worldRoads || [];
    const verticals = roads.filter((r) => r.orientation === 'vertical').map((r) => r.center);
    const horizontals = roads.filter((r) => r.orientation === 'horizontal').map((r) => r.center);
    const worldSize = WORLD_WIDTH;

    // Laternen entlang der Strassen, abwechselnd links und rechts
    let flip = false;
    for (const cx of verticals) {
      for (let y = STREETLIGHT_SPACING / 2; y < worldSize; y += STREETLIGHT_SPACING) {
        flip = !flip;
        const side = flip ? 1 : -1;
        const x = cx + side * PROP_EDGE_OFFSET;
        if (x < 20 || x > worldSize - 20) continue;
        // Laterne zeigt zur Strasse hin
        add('streetlight', x, y, side > 0 ? Math.PI / 2 : -Math.PI / 2);
      }
    }
    for (const cy of horizontals) {
      for (let x = STREETLIGHT_SPACING / 2; x < worldSize; x += STREETLIGHT_SPACING) {
        flip = !flip;
        const side = flip ? 1 : -1;
        const y = cy + side * PROP_EDGE_OFFSET;
        if (y < 20 || y > worldSize - 20) continue;
        add('streetlight', x, y, side > 0 ? Math.PI : 0);
      }
    }

    // Ampeln an den inneren Kreuzungen (nicht am Kartenrand, dort ist kein Verkehr)
    for (const cx of verticals) {
      for (const cy of horizontals) {
        if (cx <= 0 || cx >= worldSize || cy <= 0 || cy >= worldSize) continue;
        add('trafficlight_A', cx - PROP_EDGE_OFFSET, cy - PROP_EDGE_OFFSET, Math.PI / 4);
        add('trafficlight_A', cx + PROP_EDGE_OFFSET, cy + PROP_EDGE_OFFSET, -Math.PI * 0.75);
      }
    }

    // Kleinkram an den Gehwegen: Baenke, Buesche, Hydranten.
    // Reihenfolge und Verteilung sind fest (kein Zufall), damit es reproduzierbar bleibt.
    const smallProps = ['bench', 'bush', 'bush', 'firehydrant'];
    let i = 0;
    for (const cx of verticals) {
      for (let y = 120; y < worldSize; y += 260) {
        const name = smallProps[i % smallProps.length];
        i++;
        const side = i % 2 === 0 ? 1 : -1;
        const x = cx + side * (PROP_EDGE_OFFSET + 14);
        if (x < 20 || x > worldSize - 20) continue;
        add(name, x, y, side > 0 ? -Math.PI / 2 : Math.PI / 2);
      }
    }

    // Strassenbaeume entlang beider Achsen, abwechselnd links und rechts.
    // Deterministisch wie alles hier: gleicher Baum an gleicher Stelle bei
    // jedem Client und nach jedem Neuladen, ohne dass der Server etwas
    // schicken muss. Die Drehung in Achtelschritten sorgt dafuer, dass auch
    // zwei Baeume derselben Art nebeneinander nicht wie Zwillinge wirken.
    let baum = 0;
    for (const cx of verticals) {
      for (let y = TREE_SPACING / 2; y < worldSize; y += TREE_SPACING) {
        baum++;
        const seite = baum % 2 === 0 ? 1 : -1;
        const x = cx + seite * TREE_EDGE_OFFSET;
        if (x < 40 || x > worldSize - 40) continue;
        add(STREET_TREE_MODELS[baum % STREET_TREE_MODELS.length], x, y, (baum % 8) * (Math.PI / 4));
      }
    }
    for (const cy of horizontals) {
      for (let x = TREE_SPACING / 2; x < worldSize; x += TREE_SPACING) {
        baum++;
        const seite = baum % 2 === 0 ? 1 : -1;
        const y = cy + seite * TREE_EDGE_OFFSET;
        if (y < 40 || y > worldSize - 40) continue;
        add(STREET_TREE_MODELS[baum % STREET_TREE_MODELS.length], x, y, (baum % 8) * (Math.PI / 4));
      }
    }

    return placements;
  }

  /**
   * Zeichnet alle Objekte eines Deko-Typs als EINE Instanz-Gruppe.
   * Das ist der entscheidende Unterschied zu einzelnen Kopien: 60 Laternen
   * kosten so einen statt sechzig Zeichenaufrufe - wichtig fuers iPad.
   */
  /**
   * Geometrie eines Modells, auf den Ursprung zentriert und mit der Unterkante
   * auf y=0. Wird zwischengespeichert, weil sie fuer jede Instanzgruppe
   * gebraucht wird.
   *
   * Ohne diese Normalisierung muesste der Versatz in JEDE Instanzmatrix
   * eingerechnet werden - und wuerde dabei mitrotiert und mitskaliert, was die
   * Modelle bei gedrehten Instanzen verschieben wuerde.
   */
  normalizedGeometry(name) {
    if (!this._normGeo) this._normGeo = new Map();
    if (this._normGeo.has(name)) return this._normGeo.get(name);

    const template = this.modelTemplates.get(name);
    if (!template) return null;

    const geo = template.geometry.clone();
    geo.computeBoundingBox();
    const b = geo.boundingBox;
    geo.translate(-(b.min.x + b.max.x) / 2, -b.min.y, -(b.min.z + b.max.z) / 2);
    geo.computeBoundingBox();

    const size = new THREE.Vector3();
    geo.boundingBox.getSize(size);
    const entry = { geometry: geo, material: template.material, size };
    this._normGeo.set(name, entry);
    return entry;
  }

  /**
   * Eine InstancedMesh aus beliebig vielen Platzierungen mit eigener Position,
   * Drehung und Skalierung.
   *
   * Das ist der Grund, warum die vergroesserte Welt ueberhaupt tragbar ist:
   * 1905 Strassenkacheln und 239 Gebaeude werden zu rund zwei Dutzend
   * Zeichenaufrufen statt ueber zweitausend Einzelobjekten.
   */
  createModelInstances(name, placements, opts) {
    const entry = this.normalizedGeometry(name);
    if (!entry || placements.length === 0) return null;
    return this.buildChunkedInstances(entry.geometry, entry.material, placements, opts);
  }

  createPropInstances(name, placements, opts) {
    const template = this.modelTemplates.get(name);
    if (!template || placements.length === 0) return null;

    const scale = PROP_SCALE[name] || 1;
    const items = placements.map((p) => ({
      x: p.x * WORLD_SCALE, z: p.y * WORLD_SCALE, rotY: p.rotY || 0,
      sx: scale, sy: scale, sz: scale,
    }));
    return this.buildChunkedInstances(template.geometry, template.material, items, opts);
  }

  onResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  start() {
    this.running = true;
    this.lastFrame = performance.now();
    requestAnimationFrame((t) => this.loop(t));
  }

  loop(now) {
    if (!this.running) return;
    const rawDt = now - this.lastFrame;
    this.lastFrame = now;

    // Deckel gegen Zeitspruenge (Tab war im Hintergrund) - sonst wuerde die
    // Interpolation in einem Frame komplett durchspringen.
    const dt = Math.min(rawDt, 100);

    this.frameCount++;
    this.net.update(rawDt);
    this.syncEntities(dt);
    // NACH syncEntities: die Blickrichtungen (facingById) werden dort
    // aktualisiert, und das Ziel der Tiere haengt daran.
    this.syncPetEntities(dt);
    this.syncBuildings();
    this.syncVehicles(dt);
    this.updateCamera(dt);

    const me = this.entities.get(this.net.myId);
    const focus = me ? me.group.position : this.smoothedCamTarget;
    this.updateEnvironment(dt);
    this.updateSun(focus);
    if (this.frameCount % 10 === 1) {
      this.updateCulling(focus);
      this.updateLabels(focus);
    }
    this.updateRain(dt / 1000);
    this.updateGoalMarker(now, focus);
    this.sky.position.copy(this.camera.position);

    this.renderer.render(this.scene, this.camera);
    // Das HUD ist DOM, kein WebGL - zehnmal pro Sekunde reicht voellig und
    // spart dem Browser das staendige Neu-Layouten.
    if (this.frameCount % 6 === 0) this.updateHud();
    if (window.gameHud && this.frameCount % 2 === 0) window.gameHud.drawMinimap();

    requestAnimationFrame((t) => this.loop(t));
  }

  /**
   * Baut eine Spielfigur: gegliederte Figur aus wardrobe.js, dazu Namensschild.
   *
   * Die frueheren Grundformen (ein Zylinder, eine Kugel, ein Kegel) stecken
   * jetzt in buildCharacter(). Fehlt wardrobe.js, faellt diese Funktion auf
   * die alte Darstellung zurueck - eine unsichtbare Figur waere sonst von
   * einem Verbindungsfehler nicht zu unterscheiden.
   */
  createEntity(isSelf, playerId, appearance) {
    const colors = colorPairForPlayer(isSelf, playerId);

    let group;
    let bodyMat;
    let headMat;
    let parts = null;

    if (typeof buildCharacter === 'function') {
      const figur = buildCharacter(appearance, colors, this.kitTemplates);
      group = figur.group;
      bodyMat = figur.bodyMat;
      headMat = figur.headMat;
      parts = figur.parts || null;
    } else {
      group = new THREE.Group();
      const bodyGeo = new THREE.CylinderGeometry(CHARACTER_RADIUS, CHARACTER_RADIUS, CHARACTER_BODY_HEIGHT, 12);
      bodyMat = new THREE.MeshStandardMaterial({ color: colors.body });
      const body = new THREE.Mesh(bodyGeo, bodyMat);
      body.position.y = CHARACTER_BODY_HEIGHT / 2;
      body.castShadow = true;
      group.add(body);

      const headGeo = new THREE.SphereGeometry(CHARACTER_HEAD_RADIUS, 14, 10);
      headMat = new THREE.MeshStandardMaterial({ color: colors.head });
      const head = new THREE.Mesh(headGeo, headMat);
      head.position.y = CHARACTER_BODY_HEIGHT + CHARACTER_HEAD_RADIUS;
      head.castShadow = true;
      group.add(head);
    }

    const label = this.createLabelSprite('', null, 80);
    label.position.y = CHARACTER_BODY_HEIGHT + CHARACTER_HEAD_RADIUS * 2 + 0.4;
    group.add(label);

    this.scene.add(group);
    return {
      group, label, lastLabelText: '', bodyMat, headMat, isJailedVisual: false,
      parts, walkPhase: 0, walkAmp: 0,
      // Die Rueckfallfarben merken sich, worauf die Gefaengnis-Faerbung
      // zuruecksetzt. Bei angezogener Kleidung ist das deren echte Farbe,
      // nicht mehr die Spielerfarbe.
      normalBodyColor: bodyMat.color.getHex(),
      normalHeadColor: headMat.color.getHex(),
      appearanceKey: typeof appearanceKey === 'function' ? appearanceKey(appearance) : '-',
      isSelf,
    };
  }

  createLabelSprite(text, scale, maxDist) {
    const canvasEl = document.createElement('canvas');
    canvasEl.width = 512;
    canvasEl.height = 128;

    // WICHTIG (Safari): Erst auf die Zeichenflaeche malen, DANN als Textur registrieren.
    // Umgekehrt wirft Safari einen InvalidStateError, weil eine noch komplett leere
    // Zeichenflaeche nicht als gueltige Bildquelle akzeptiert wird.
    this.paintCanvasText(canvasEl, text || ' ');

    const texture = new THREE.CanvasTexture(canvasEl);
    texture.encoding = THREE.sRGBEncoding;
    texture.anisotropy = 4;
    // toneMapped aus: Schrift soll exakt weiss bleiben und nicht von der
    // Filmkurve gedaempft werden.
    const material = new THREE.SpriteMaterial({ map: texture, depthTest: false, transparent: true, toneMapped: false });
    const sprite = new THREE.Sprite(material);
    const [sx, sy] = scale || [2.2, 0.55];
    sprite.scale.set(sx, sy, 1);
    sprite.renderOrder = 10;
    sprite.userData.canvasEl = canvasEl;
    sprite.userData.texture = texture;
    sprite.userData.maxDist = maxDist || 0;
    this.labelSprites.add(sprite);
    return sprite;
  }

  /** Malt Text auf eine Zeichenflaeche - getrennt, damit es auch VOR der Texturerstellung nutzbar ist. */
  paintCanvasText(canvasEl, text) {
    const ctx = canvasEl.getContext('2d');
    const W = canvasEl.width;
    const H = canvasEl.height;
    ctx.clearRect(0, 0, W, H);
    if (!text || !text.trim()) return;

    // Schrift so gross wie moeglich, aber lange Namen passen noch hinein.
    const schrift = (px) => `600 ${px}px system-ui, -apple-system, "Segoe UI", sans-serif`;
    let size = 50;
    ctx.font = schrift(size);
    let w = ctx.measureText(text).width;
    if (w > W - 60) {
      size = Math.max(26, Math.floor(size * (W - 60) / w));
      ctx.font = schrift(size);
      w = ctx.measureText(text).width;
    }

    // Halbtransparente Pille hinter der Schrift: auf hellem Himmel und
    // weissen Fassaden war die helle Schrift vorher kaum zu lesen.
    const pw = Math.min(W - 4, w + 44);
    const ph = size + 30;
    const x = (W - pw) / 2;
    const y = (H - ph) / 2;
    const r = ph / 2;
    ctx.fillStyle = 'rgba(14, 18, 28, 0.62)';
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + pw, y, x + pw, y + ph, r);
    ctx.arcTo(x + pw, y + ph, x, y + ph, r);
    ctx.arcTo(x, y + ph, x, y, r);
    ctx.arcTo(x, y, x + pw, y, r);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, W / 2, H / 2 + 2);
  }

  paintLabelSprite(sprite, text) {
    this.paintCanvasText(sprite.userData.canvasEl, text);
    sprite.userData.texture.needsUpdate = true;
  }

  getOrCreateEntity(id, isSelf, appearance) {
    let entry = this.entities.get(id);

    // Kleidungswechsel: die Figur wird komplett neu gebaut statt Teile
    // nachtraeglich umzufaerben. Das ist der einfachere Weg und kostet nichts,
    // weil er nur bei einer tatsaechlichen Aenderung laeuft - der Vergleich
    // ueber den Schluessel verhindert ein Neubauen in jedem Bild.
    const key = typeof appearanceKey === 'function' ? appearanceKey(appearance) : '-';
    if (entry && entry.appearanceKey !== key) {
      const alteDrehung = entry.group.rotation.y;
      const altePosition = entry.group.position.clone();
      this.scene.remove(entry.group);
      entry = this.createEntity(entry.isSelf, id, appearance);
      entry.group.rotation.y = alteDrehung;
      entry.group.position.copy(altePosition);
      this.entities.set(id, entry);
      return entry;
    }

    if (!entry) {
      entry = this.createEntity(isSelf, id, appearance);
      this.entities.set(id, entry);
    }
    return entry;
  }

  removeEntity(id) {
    const entry = this.entities.get(id);
    if (!entry) return;
    this.scene.remove(entry.group);
    this.entities.delete(id);
    this.facingById.delete(id);
  }

  /**
   * Haustiere als EIGENE Entitaeten, die ihren Besitzern dauerhaft nachlaufen.
   *
   * Aufgebaut wie die Spielerfiguren: eine eigene Gruppe in der Szene, ein
   * Eintrag in einer Map, jeden Frame neu positioniert. Der Unterschied zur
   * ersten Fassung liegt in drei Punkten, die damals einzeln falsch waren:
   *
   *   1. Das Ziel liegt IMMER hinter dem Besitzer bezogen auf seine
   *      Blickrichtung, nicht dort, wo das Tier zufaellig herdriftet. Damit
   *      kann es nicht mehr zwischen Kamera und Spieler geraten oder in der
   *      Figur stecken.
   *   2. Der Abstand ist groesser als die Figur breit ist (0,7).
   *   3. Faellt es zu weit zurueck, wird es hart nachgezogen statt langsam
   *      hinterherzukriechen.
   */
  syncPetEntities(dtMs) {
    const gesehen = new Set();
    const blend = frameRateIndependentBlend(PET_FOLLOW_BLEND, dtMs);

    for (const player of this.net.players.values()) {
      if (player.connected === false || !player.pet) continue;
      gesehen.add(player.id);
      this.petDiag.seen++;

      const schluessel = `${player.pet.species}|${player.pet.name}`;
      let eintrag = this.petEntities.get(player.id);

      if (!eintrag || eintrag.schluessel !== schluessel) {
        if (eintrag) this.scene.remove(eintrag.group);

        const group = new THREE.Group();
        const modell = this.clonePet(player.pet.species);
        if (!modell) continue;
        group.add(modell);

        const label = this.createLabelSprite(`🐾 ${player.pet.name}`, [1.6, 0.4], 35);
        label.position.y = PET_LABEL_HEIGHT;
        group.add(label);

        this.scene.add(group);
        eintrag = { group, schluessel, gesetzt: false };
        this.petEntities.set(player.id, eintrag);
        this.petDiag.placed++;
        this.petDiag.last = `${player.pet.species} für #${player.id}`;
      }

      // Zielpunkt: hinter dem Besitzer, aus seiner Blickrichtung abgeleitet.
      // facingById fuehrt der Renderer ohnehin fuer die Figuren mit.
      const facing = this.facingById.get(player.id) || 0;
      const px = player.x * WORLD_SCALE;
      const pz = player.y * WORLD_SCALE;
      const zielX = px - Math.sin(facing) * PET_FOLLOW_DISTANCE;
      const zielZ = pz - Math.cos(facing) * PET_FOLLOW_DISTANCE;

      if (!eintrag.gesetzt) {
        // Beim ersten Mal direkt hinsetzen, nicht von irgendwo heranfliegen.
        eintrag.group.position.set(zielX, 0, zielZ);
        eintrag.gesetzt = true;
      } else {
        eintrag.group.position.x += (zielX - eintrag.group.position.x) * blend;
        eintrag.group.position.z += (zielZ - eintrag.group.position.z) * blend;

        // Zu weit weg (schnelles Fahrzeug, Teleport nach dem Gefaengnis)?
        // Dann hart nachziehen - ein Tier, das minutenlang aufholt, ist so gut
        // wie keins.
        const dx = eintrag.group.position.x - px;
        const dz = eintrag.group.position.z - pz;
        const abstand = Math.hypot(dx, dz);
        if (abstand > PET_MAX_LAG) {
          eintrag.group.position.set(zielX, 0, zielZ);
        }
      }

      // Blickrichtung: zum Besitzer schauen.
      eintrag.group.rotation.y = Math.atan2(px - eintrag.group.position.x, pz - eintrag.group.position.z);
    }

    // Tiere entfernen, deren Besitzer weg ist oder das Tier verloren hat.
    for (const [id, eintrag] of this.petEntities) {
      if (gesehen.has(id)) continue;
      this.scene.remove(eintrag.group);
      this.petEntities.delete(id);
    }
  }

  /**
   * Kurzbericht zur Haustier-Anzeige, im Spiel abrufbar. Beantwortet in einer
   * Zeile, an welcher Stelle die Kette reisst.
   */
  petReport() {
    const d = this.petDiag;
    if (d.seen === 0) return 'Kein Haustier in den Spielerdaten — der Server schickt keins.';
    if (d.placed === 0) return `Haustier in den Daten (${d.seen}x), aber kein Objekt erzeugt.`;

    // Am tatsaechlichen Szenenbaum ablesen statt an Zaehlern: die erste Fassung
    // schloss aus "loaded === 0" auf einen Ersatzwuerfel und meldete "pets.glb
    // FEHLT", obwohl das echte Modell verwendet wurde. Was zaehlt, ist was
    // WIRKLICH an der Figur haengt.
    const meins = this.petEntities.get(this.net.myId);
    if (!meins) return `${d.placed}x erzeugt, aber keins für dich (${d.last})`;

    const box = new THREE.Box3().setFromObject(meins.group);
    const size = new THREE.Vector3();
    box.getSize(size);
    const figur = this.entities.get(this.net.myId);
    const abstand = figur
      ? Math.hypot(meins.group.position.x - figur.group.position.x,
                   meins.group.position.z - figur.group.position.z).toFixed(1)
      : '?';
    const echt = d.loaded > 0 ? 'Modell' : 'Ersatzwürfel';
    return `${echt} ${size.x.toFixed(2)}x${size.y.toFixed(2)}, `
      + `${abstand} Einheiten hinter dir, Sichtbarkeit ${meins.group.visible ? 'an' : 'AUS'}`;
  }

  /**
   * Baut ein Haustier aus seinen Teilen. Die Modelle bestehen aus sieben
   * Meshes (pet_cat_2 bis pet_cat_8), deren Versatz beim Zusammenfuehren in die
   * Geometrie gerechnet wurde - sie lassen sich deshalb einfach in eine Gruppe
   * legen und sitzen an ihrem Platz.
   */
  clonePet(species) {
    const group = new THREE.Group();
    const template = this.petTemplates.get(species);

    if (template) {
      const model = template.clone();
      model.traverse((o) => {
        if (!o.isMesh) return;
        o.castShadow = true;
        // Material klonen und leicht selbstleuchtend machen: nachts liegt die
        // Umgebungshelligkeit bei 0,25, ein kleines dunkles Objekt waere sonst
        // schlicht unsichtbar. Ohne das Klonen wuerden alle Tiere derselben
        // Art dasselbe Material teilen.
        o.material = o.material.clone();
        o.material.emissive = new THREE.Color(0x333333);
      });
      group.add(model);
      group.scale.setScalar(PET_SCALE);
      return group;
    }

    // Kein Modell da: Ersatzwuerfel statt gar nichts. Einmalig warnen, nicht
    // bei jedem Tier - sonst laeuft die Konsole voll.
    if (!this._petModelWarned) {
      this._petModelWarned = true;
      console.warn(
        'pets.glb nicht geladen - Haustiere werden als Würfel dargestellt. '
        + 'Liegt die Datei im selben Ordner wie citybits.glb?'
      );
    }
    const geo = new THREE.BoxGeometry(0.6, 0.6, 0.85);
    const mat = new THREE.MeshStandardMaterial({
      color: PET_FALLBACK_COLOURS[species] || 0xaaaaaa,
      emissive: new THREE.Color(0x333333),
    });
    const box = new THREE.Mesh(geo, mat);
    box.position.y = 0.3;
    box.castShadow = true;
    group.add(box);
    return group;
  }

  /** Ueberschreibt Position/Blickrichtung/Label aller sichtbaren Spieler anhand des Netzwerk-State. */
  syncEntities(dtMs) {
    const seen = new Set();
    const now = Date.now();
    const posBlend = frameRateIndependentBlend(REMOTE_POSITION_BLEND, dtMs);
    const facingBlend = frameRateIndependentBlend(FACING_BLEND, dtMs);

    for (const p of this.net.players.values()) {
      if (p.connected === false) continue;
      seen.add(p.id);

      const isSelf = p.id === this.net.myId;
      const entry = this.getOrCreateEntity(p.id, isSelf, p.appearance);

      const targetX = p.x * WORLD_SCALE;
      const targetZ = p.y * WORLD_SCALE;

      if (isSelf) {
        // Eigene Figur: direkt setzen. Die Position kommt aus der lokalen Vorhersage
        // und ist bereits geglaettet - hier nochmal zu interpolieren wuerde sich
        // nur wie Eingabeverzoegerung anfuehlen.
        entry.group.position.x = targetX;
        entry.group.position.z = targetZ;
      } else {
        // Andere Spieler: zwischen den ~20 Netzwerk-Updates pro Sekunde interpolieren,
        // sonst waere die Bewegung sichtbar stufig.
        const dist = Math.hypot(entry.group.position.x - targetX, entry.group.position.z - targetZ);
        if (dist > REMOTE_SNAP_DISTANCE) {
          entry.group.position.x = targetX;
          entry.group.position.z = targetZ;
        } else {
          entry.group.position.x += (targetX - entry.group.position.x) * posBlend;
          entry.group.position.z += (targetZ - entry.group.position.z) * posBlend;
        }
      }

      const speed = Math.hypot(p.vx || 0, p.vy || 0);
      if (speed > FACING_MIN_SPEED) {
        this.facingById.set(p.id, Math.atan2(p.vx, p.vy));
      }
      this.animateWalk(entry, p.vehicleId == null ? speed : 0, dtMs);
      // Weich eindrehen statt sofort umzuschnappen
      const targetFacing = this.facingById.get(p.id) || 0;
      entry.group.rotation.y = lerpAngle(entry.group.rotation.y, targetFacing, facingBlend);

      // Wer faehrt, sitzt IM Fahrzeug - die Figur wuerde sonst daneben mitschweben.
      entry.group.visible = p.vehicleId == null;

      // Im Gefaengnis: Figur graeulich einfaerben, damit der Status auch optisch erkennbar ist
      const isJailed = p.jailedUntil != null && p.jailedUntil > now;
      if (isJailed !== entry.isJailedVisual) {
        entry.bodyMat.color.set(isJailed ? 0x5a6270 : entry.normalBodyColor);
        entry.headMat.color.set(isJailed ? 0x7a8090 : entry.normalHeadColor);
        entry.isJailedVisual = isJailed;
      }

      const labelText = isJailed ? `${p.name} (im Gefängnis)` : `${p.name} (${p.age})`;
      if (entry.lastLabelText !== labelText) {
        this.paintLabelSprite(entry.label, labelText);
        entry.lastLabelText = labelText;
      }
    }

    for (const id of [...this.entities.keys()]) {
      if (!seen.has(id)) this.removeEntity(id);
    }

    this.syncCops(dtMs);
  }

  /**
   * Laufanimation: Beine und Arme pendeln gegengleich, der Koerper wippt.
   * Die Figuren aus wardrobe.js haengen ihre Glieder bereits an Huefte und
   * Schulter auf - genau dafuer war das dort vorbereitet.
   */
  animateWalk(entry, speed, dtMs) {
    const parts = entry.parts;
    if (!parts) return;
    const anteil = Math.min(1, speed / PLAYER_SPEED);
    entry.walkAmp += (anteil - entry.walkAmp) * frameRateIndependentBlend(0.2, dtMs);
    if (entry.walkAmp < 0.01 && anteil === 0) {
      if (entry.walkPhase !== 0) {
        entry.walkPhase = 0;
        for (const b of parts.beine || []) b.rotation.x = 0;
        for (const a of parts.arme || []) a.rotation.x = 0;
        entry.group.position.y = 0;
      }
      return;
    }
    entry.walkPhase += (dtMs / 1000) * (6 + anteil * 5);
    const swing = Math.sin(entry.walkPhase) * 0.7 * entry.walkAmp;
    const beine = parts.beine || [];
    const arme = parts.arme || [];
    if (beine[0]) beine[0].rotation.x = swing;
    if (beine[1]) beine[1].rotation.x = -swing;
    if (arme[0]) arme[0].rotation.x = -swing * 0.8;
    if (arme[1]) arme[1].rotation.x = swing * 0.8;
    entry.group.position.y = Math.abs(Math.sin(entry.walkPhase)) * 0.05 * entry.walkAmp;
  }

  /** Erstellt ein Immobilien-Gebaeude: Quader, dessen Hoehe den Preis widerspiegelt. */
  createBuildingEntity(property) {
    const height = BUILDING_MIN_HEIGHT + property.price * BUILDING_HEIGHT_PER_PRICE;
    const group = new THREE.Group();

    // Gebaeudemodell deterministisch aus der ID waehlen, damit alle Clients
    // dieselbe Immobilie gleich sehen und es beim Neuladen nicht springt.
    const idNum = parseInt(String(property.id).replace(/\D/g, ''), 10) || 0;
    const modelName = BUILDING_MODEL_NAMES[idNum % BUILDING_MODEL_NAMES.length];
    const model = this.cloneModel(modelName, BUILDING_FOOTPRINT * 1.3);

    let mesh = null;
    let mat = null;
    let labelHeight;

    if (model) {
      group.add(model);
      // Material des geklonten Netzes fuer die Besitz-Einfaerbung merken
      model.traverse((c) => { if (c.isMesh && !mat) { mesh = c; mat = c.material; } });
      const box = new THREE.Box3().setFromObject(model);
      labelHeight = box.max.y + 0.6;
    } else {
      const geo = new THREE.BoxGeometry(BUILDING_FOOTPRINT, height, BUILDING_FOOTPRINT);
      mat = new THREE.MeshStandardMaterial({ color: 0x4a5062 });
      mesh = new THREE.Mesh(geo, mat);
      mesh.position.y = height / 2;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);
      labelHeight = height + 0.6;
    }

    const label = this.createLabelSprite(property.name, null, 70);
    label.position.y = labelHeight;
    group.add(label);

    this.scene.add(group);
    return { group, mesh, mat, label, lastLabelText: property.name, lastColorKey: null, height, hasModel: !!model };
  }

  /** Farbe zeigt Besitzstatus: grau = frei, blau = dir gehoerend, rot = jemand anderem gehoerend. */
  colorKeyForProperty(property) {
    if (!property.ownerId) return 'free';
    return property.ownerId === this.net.myId ? 'mine' : 'other';
  }

  /** Positioniert/faerbt alle Immobilien-Gebaeude anhand des zuletzt empfangenen economyState. */
  syncBuildings() {
    for (const property of this.net.properties.values()) {
      let entry = this.buildingEntities.get(property.id);
      if (!entry) {
        entry = this.createBuildingEntity(property);
        this.buildingEntities.set(property.id, entry);
        entry.group.position.x = property.position.x * WORLD_SCALE;
        entry.group.position.z = property.position.y * WORLD_SCALE;
      }

      const colorKey = this.colorKeyForProperty(property);
      if (colorKey !== entry.lastColorKey && entry.mat) {
        // Bei texturierten Modellen wirkt die Farbe als Toenung - deshalb helle,
        // dezente Werte, sonst waere die Textur nicht mehr zu erkennen.
        const tinted = { free: 0xffffff, mine: 0x9ec4ff, other: 0xffb0b0 };
        const plain  = { free: 0x4a5062, mine: 0x3a6ceb, other: 0xb84a4a };
        entry.mat.color.set((entry.hasModel ? tinted : plain)[colorKey]);
        entry.lastColorKey = colorKey;
      }

      const labelText = property.ownerId ? `${property.name} ($${property.price})` : `${property.name} - frei ($${property.price})`;
      if (entry.lastLabelText !== labelText) {
        this.paintLabelSprite(entry.label, labelText);
        entry.lastLabelText = labelText;
      }
    }
  }
  /** Erstellt ein Fahrzeug - als echtes Modell, sonst als Quader. */
  createVehicleEntity(vehicle) {
    const group = new THREE.Group();

    const dims = {
      scooter: { w: 0.6, h: 0.6, d: 1.3, color: 0xd9a13b },
      compact: { w: 1.1, h: 0.8, d: 2.2, color: 0x4a9ed9 },
      sedan:   { w: 1.3, h: 0.85, d: 2.8, color: 0x9a5ad9 },
      sports:  { w: 1.3, h: 0.65, d: 3.0, color: 0xd94a4a },
    };
    const cfg = dims[vehicle.typeId] || dims.compact;

    const modelName = VEHICLE_MODEL_BY_TYPE[vehicle.typeId];
    // Bewusst auf undefined pruefen statt auf Wahrheitswert: null heisst hier
    // "nicht skalieren, der Massstab steckt im Modell". Ein "|| cfg.d" wuerde
    // genau diesen Fall in die Quader-Ersatzgroesse umbiegen.
    const gesetzt = VEHICLE_MODEL_LENGTH[vehicle.typeId];
    const targetLength = gesetzt === undefined ? cfg.d : gesetzt;
    const model = modelName ? this.cloneModel(modelName, targetLength) : null;

    let labelHeight;
    if (model) {
      // Modelle zeigen nach glTF-Norm nach -Z, im Spiel gilt +Z als vorwaerts
      model.rotation.y = VEHICLE_MODEL_YAW_OFFSET;
      group.add(model);
      labelHeight = targetLength * 0.55;
    } else {
      const mat = new THREE.MeshStandardMaterial({ color: cfg.color });
      const body = new THREE.Mesh(new THREE.BoxGeometry(cfg.w, cfg.h, cfg.d), mat);
      body.position.y = cfg.h / 2 + 0.1;
      body.castShadow = true;
      group.add(body);

      const roofMat = new THREE.MeshStandardMaterial({ color: 0x22262f });
      const roof = new THREE.Mesh(new THREE.BoxGeometry(cfg.w * 0.85, cfg.h * 0.5, cfg.d * 0.5), roofMat);
      roof.position.y = cfg.h + 0.1;
      roof.castShadow = true;
      group.add(roof);
      labelHeight = cfg.h + 0.9;
    }

    const label = this.createLabelSprite('', null, 45);
    label.position.y = labelHeight;
    group.add(label);

    this.scene.add(group);
    return { group, label, lastLabelText: '', lastColorKey: null };
  }

  /** Positioniert und beschriftet alle Fahrzeuge. */
  syncVehicles(dtMs) {
    const blend = frameRateIndependentBlend(REMOTE_POSITION_BLEND, dtMs);
    const facingBlend = frameRateIndependentBlend(FACING_BLEND, dtMs);
    const seen = new Set();

    for (const v of this.net.vehicles.values()) {
      seen.add(v.id);
      let entry = this.vehicleEntities.get(v.id);
      const targetX = v.x * WORLD_SCALE;
      const targetZ = v.y * WORLD_SCALE;

      if (!entry) {
        entry = this.createVehicleEntity(v);
        this.vehicleEntities.set(v.id, entry);
        entry.group.position.x = targetX;
        entry.group.position.z = targetZ;
      } else if (v.driverId === this.net.myId) {
        // Selbst gefahren: der eigenen vorhergesagten Position direkt folgen,
        // sonst haengt das Auto sichtbar hinter der eigenen Bewegung her.
        const me = this.net.localPlayer;
        if (me) {
          entry.group.position.x = me.x * WORLD_SCALE;
          entry.group.position.z = me.y * WORLD_SCALE;
        }
      } else if (v.driverId != null) {
        // Von einem ANDEREN Spieler gefahren: interpolieren (kommt nur ~20x/s)
        const dist = Math.hypot(entry.group.position.x - targetX, entry.group.position.z - targetZ);
        if (dist > REMOTE_SNAP_DISTANCE) {
          entry.group.position.x = targetX;
          entry.group.position.z = targetZ;
        } else {
          entry.group.position.x += (targetX - entry.group.position.x) * blend;
          entry.group.position.z += (targetZ - entry.group.position.z) * blend;
        }
      } else {
        // Geparkt: einfach setzen
        entry.group.position.x = targetX;
        entry.group.position.z = targetZ;
      }

      // Fahrtrichtung uebernehmen, wenn gefahren
      if (v.driverId != null) {
        const facing = this.facingById.get(v.driverId);
        if (facing != null) {
          entry.group.rotation.y = lerpAngle(entry.group.rotation.y, facing, facingBlend);
        }
      }

      const type = this.net.vehicleCatalog.find((t) => t.id === v.typeId);
      const typeName = type ? type.name : 'Fahrzeug';
      let labelText;
      if (v.driverId != null) labelText = typeName;
      else if (v.ownerId === this.net.myId) labelText = `${typeName} (dein)`;
      else if (v.ownerId != null) labelText = `${typeName} (fremd)`;
      else labelText = `${typeName} - $${type ? type.price : '?'}`;

      if (entry.lastLabelText !== labelText) {
        this.paintLabelSprite(entry.label, labelText);
        entry.lastLabelText = labelText;
      }
    }

    for (const [id, entry] of this.vehicleEntities) {
      if (!seen.has(id)) {
        this.scene.remove(entry.group);
        this.vehicleEntities.delete(id);
      }
    }
  }

  /** Erstellt eine Polizeieinheit - als Streifenwagen, sonst als Figur. */
  createCopEntity() {
    const group = new THREE.Group();

    // Streifenwagen passt besser zur Stadt mit Strassen als eine laufende Figur
    const model = this.cloneModel('car_police', 2.6);
    if (model) {
      model.rotation.y = VEHICLE_MODEL_YAW_OFFSET;
      group.add(model);
      const label = this.createLabelSprite('🚓 Polizei', null, 60);
      label.position.y = 1.6;
      group.add(label);
      this.scene.add(group);
      return { group };
    }

    const bodyGeo = new THREE.CylinderGeometry(CHARACTER_RADIUS, CHARACTER_RADIUS, CHARACTER_BODY_HEIGHT, 12);
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0x2a3a6e });
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    body.position.y = CHARACTER_BODY_HEIGHT / 2;
    body.castShadow = true;
    group.add(body);

    const headGeo = new THREE.SphereGeometry(CHARACTER_HEAD_RADIUS, 14, 10);
    const headMat = new THREE.MeshStandardMaterial({ color: 0x1f2a52 });
    const head = new THREE.Mesh(headGeo, headMat);
    head.position.y = CHARACTER_BODY_HEIGHT + CHARACTER_HEAD_RADIUS;
    head.castShadow = true;
    group.add(head);

    const label = this.createLabelSprite('🚓 Polizei', null, 60);
    label.position.y = CHARACTER_BODY_HEIGHT + CHARACTER_HEAD_RADIUS * 2 + 0.4;
    group.add(label);

    this.scene.add(group);
    return { group };
  }

  /** Positioniert die Polizei-NPCs anhand des zuletzt empfangenen copsState. */
  syncCops(dtMs) {
    // Polizei-Updates kommen nur 5x/s (COPS_TICK_MS = 200) - ohne Interpolation
    // waere das die sichtbar ruckeligste Bewegung im ganzen Spiel.
    const blend = frameRateIndependentBlend(REMOTE_POSITION_BLEND, dtMs);
    const seen = new Set();

    for (const cop of this.net.cops.values()) {
      seen.add(cop.id);
      let entry = this.copEntities.get(cop.id);
      const targetX = cop.x * WORLD_SCALE;
      const targetZ = cop.y * WORLD_SCALE;

      if (!entry) {
        entry = this.createCopEntity();
        this.copEntities.set(cop.id, entry);
        entry.group.position.x = targetX;
        entry.group.position.z = targetZ;
        continue;
      }

      const dist = Math.hypot(entry.group.position.x - targetX, entry.group.position.z - targetZ);
      if (dist > REMOTE_SNAP_DISTANCE) {
        entry.group.position.x = targetX;
        entry.group.position.z = targetZ;
      } else {
        entry.group.position.x += (targetX - entry.group.position.x) * blend;
        entry.group.position.z += (targetZ - entry.group.position.z) * blend;
      }
    }

    for (const [id, entry] of this.copEntities) {
      if (!seen.has(id)) {
        this.scene.remove(entry.group);
        this.copEntities.delete(id);
      }
    }
  }

  /** Kamera-Zoom: positiv = weiter weg. */
  zoomCamera(delta) {
    this.camZoom = Math.min(CAMERA_MAX_DISTANCE, Math.max(CAMERA_MIN_DISTANCE, this.camZoom + delta));
  }

  /** Kamera-Neigung: positiv = steiler von oben. */
  tiltCamera(delta) {
    this.camPitch = Math.min(CAMERA_MAX_PITCH, Math.max(CAMERA_MIN_PITCH, this.camPitch + delta));
  }

  /**
   * Kamera hinter der eigenen Figur (GTA-Stil), mit einstellbarem Abstand und
   * Neigung. Steht etwas zwischen Figur und Kamera (Hauswand, Baumkrone),
   * rueckt die Kamera davor - schnell beim Heranruecken, langsam beim
   * Zurueckgehen, damit sie hinter einem Baum nicht hin und her springt.
   */
  updateCamera(dtMs) {
    const me = this.entities.get(this.net.myId);
    if (!me) return;

    // WICHTIG: Die Kamera folgt der frei drehbaren cameraYaw (per Wischgeste
    // gesteuert), NICHT der Bewegungsrichtung. Die Figur selbst dreht sich
    // dahin, wohin sie tatsaechlich laeuft (siehe syncEntities) - das sind
    // bewusst zwei getrennte Dinge, genau wie in GTA/Roblox.
    const yaw = this.net.cameraYaw || 0;
    const horiz = Math.cos(this.camPitch);
    const dir = new THREE.Vector3(-Math.sin(yaw) * horiz, Math.sin(this.camPitch), -Math.cos(yaw) * horiz);

    // Im Auto etwas weiter weg: das Fahrzeug ist laenger als die Figur.
    const imAuto = this.net.localPlayer && this.net.localPlayer.vehicleId != null;
    const wunsch = this.camZoom + (imAuto ? 2.5 : 0);

    // Bildratenunabhaengig, damit sich die Kamera auf einem 120Hz-Display
    // nicht doppelt so schnell anfuehlt wie auf einem 60Hz-Display.
    const targetLook = new THREE.Vector3(me.group.position.x, CAMERA_LOOK_HEIGHT, me.group.position.z);
    // Beim Beitritt oder nach einem Teleport (Gefaengnis) hart umsetzen,
    // statt quer ueber die Karte zu fliegen.
    if (this.smoothedCamTarget.distanceTo(targetLook) > 20) this.smoothedCamTarget.copy(targetLook);
    else this.smoothedCamTarget.lerp(targetLook, frameRateIndependentBlend(0.25, dtMs));

    if (this.frameCount % 2 === 0 || this._camFree == null) {
      this._camFree = this.cameraObstacleDistance(this.smoothedCamTarget, dir, wunsch);
    }
    const erlaubt = Math.max(1.2, Math.min(wunsch, this._camFree - 0.4));
    const k = erlaubt < this.camActualDistance ? 0.5 : 0.05;
    this.camActualDistance += (erlaubt - this.camActualDistance) * frameRateIndependentBlend(k, dtMs);

    this.smoothedCamPos.copy(this.smoothedCamTarget).addScaledVector(dir, this.camActualDistance);
    if (this.smoothedCamPos.y < 0.4) this.smoothedCamPos.y = 0.4;
    this.fadeUniforms.uFadeFocus.value.set(me.group.position.x, 1.0, me.group.position.z);

    this.camera.position.copy(this.smoothedCamPos);
    this.camera.lookAt(this.smoothedCamTarget);
  }

  /** Das HUD lebt in hud.js - hier nur der Takt. */
  updateHud() {
    if (window.gameHud) window.gameHud.update();
  }
}
