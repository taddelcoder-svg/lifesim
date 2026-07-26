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

const CHARACTER_RADIUS = 0.35;
const CHARACTER_BODY_HEIGHT = 1.0;
const CHARACTER_HEAD_RADIUS = 0.28;

const CAMERA_DISTANCE = 6;
const CAMERA_HEIGHT = 3;
const CAMERA_LOOK_HEIGHT = 1.3;
const CAMERA_SMOOTH = 0.12; // 0..1 - hoeher = Kamera folgt schneller/ruckartiger

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

// glTF-Norm: die Vorderseite eines Modells zeigt nach -Z. Im Spiel zeigen
// Fahrzeuge nach +Z, deshalb 180 Grad drehen. Sollten die Autos rueckwaerts
// fahren, ist das hier die einzige Stelle, die geaendert werden muss.
const VEHICLE_MODEL_YAW_OFFSET = Math.PI;

const VEHICLE_MODEL_BY_TYPE = {
  scooter: 'car_hatchback',
  compact: 'car_taxi',
  sedan: 'car_sedan',
  sports: 'car_stationwagon',
};

// Gewuenschte Laenge im Spiel je Fahrzeugtyp (3D-Einheiten). Zum Vergleich:
// die Spielfigur ist etwa 1.3 Einheiten hoch.
const VEHICLE_MODEL_LENGTH = {
  scooter: 1.6,
  compact: 2.2,
  sedan: 2.8,
  sports: 3.0,
};

const BUILDING_MODEL_NAMES = [
  'building_A', 'building_B', 'building_C', 'building_D',
  'building_E', 'building_F', 'building_G', 'building_H',
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
    this.scene.background = new THREE.Color(0x1a1d23);
    this.scene.fog = new THREE.Fog(0x1a1d23, 45, 130);

    this.camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 300);
    this.camera.position.set(WORLD_SIZE_3D / 2, CAMERA_HEIGHT, WORLD_SIZE_3D / 2 + CAMERA_DISTANCE);

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.entities = new Map();  // playerId -> { group, headMat, bodyMat, label, lastLabelText }
    this.copEntities = new Map(); // copId -> { group }
    this.buildingEntities = new Map(); // propertyId -> { group, mat, label, lastLabelText, lastColorKey }
    this.cityMeshes = []; // Strassen und Deko-Gebaeude aus dem Server-Layout
    this.vehicleEntities = new Map(); // vehicleId -> { group, mat, lastColorKey }
    this.modelTemplates = new Map();  // Modellname -> Vorlage zum Klonen
    this.modelsReady = false;
    this.facingById = new Map(); // playerId -> Bogenmass, Blickrichtung bei Stillstand beibehalten

    this.smoothedCamPos = this.camera.position.clone();
    this.smoothedCamTarget = new THREE.Vector3(WORLD_SIZE_3D / 2, CAMERA_LOOK_HEIGHT, WORLD_SIZE_3D / 2);

    this.buildStaticScene();
    this.loadModels(); // laeuft im Hintergrund, bis dahin Quader
    window.addEventListener('resize', () => this.onResize());
  }

  buildStaticScene() {
    const ambient = new THREE.AmbientLight(0xffffff, 0.6);
    this.scene.add(ambient);

    const sun = new THREE.DirectionalLight(0xffffff, 0.75);
    sun.position.set(WORLD_SIZE_3D * 0.3, 40, WORLD_SIZE_3D * 0.2);
    sun.castShadow = true;
    sun.shadow.mapSize.width = 1024;
    sun.shadow.mapSize.height = 1024;
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 150;
    sun.shadow.camera.left = -WORLD_SIZE_3D * 0.6;
    sun.shadow.camera.right = WORLD_SIZE_3D * 0.6;
    sun.shadow.camera.top = WORLD_SIZE_3D * 0.6;
    sun.shadow.camera.bottom = -WORLD_SIZE_3D * 0.6;
    sun.target.position.set(WORLD_SIZE_3D / 2, 0, WORLD_SIZE_3D / 2);
    this.scene.add(sun.target);
    this.scene.add(sun);

    const groundGeo = new THREE.PlaneGeometry(WORLD_SIZE_3D, WORLD_SIZE_3D);
    const groundMat = new THREE.MeshStandardMaterial({ color: 0x21252d });
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(WORLD_SIZE_3D / 2, 0, WORLD_SIZE_3D / 2);
    ground.receiveShadow = true;
    this.scene.add(ground);

    // Kein Hilfsraster mehr: Die echten Strassen aus dem Server-Layout uebernehmen
    // jetzt die Orientierungsfunktion, zusaetzliche Rasterlinien wuerden nur stoeren.

    this.buildJailMarker();
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

    const label = this.createLabelSprite('🚔 Gefängnis');
    label.position.set(jx, 3, jz);
    this.scene.add(label);
  }

  /** Baut Strassen und Deko-Gebaeude aus dem Server-Layout. Wird einmal aufgerufen, sobald es ankommt. */
  buildCityFromLayout() {
    // Vorherigen Aufbau entfernen, falls das Layout erneut ankommt (Reconnect)
    for (const mesh of this.cityMeshes) this.scene.remove(mesh);
    this.cityMeshes = [];

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

    // Deko-Gebaeude: leicht unterschiedliche Grautoene, damit die Stadt nicht
    // wie eine Reihe identischer Kloetze wirkt.
    for (const b of this.net.worldBuildings) {
      // Modell deterministisch aus der Position waehlen, damit alle Clients
      // dieselbe Stadt sehen und sich beim Neuladen nichts veraendert.
      const pick = Math.abs(Math.round(b.x * 31 + b.y * 17)) % BUILDING_MODEL_NAMES.length;
      const footprint = Math.max(b.w, b.d) * WORLD_SCALE;
      const model = this.cloneModel(BUILDING_MODEL_NAMES[pick], footprint);

      if (model) {
        model.position.set(b.x * WORLD_SCALE, 0, b.y * WORLD_SCALE);
        // Viertelrotationen sorgen fuer Abwechslung, ohne die Kollisionsflaeche
        // zu veraendern (die Modelle haben quadratischen Grundriss).
        model.rotation.y = (pick % 4) * (Math.PI / 2);
        this.scene.add(model);
        this.cityMeshes.push(model);
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
    if (!template) return null;

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

    this.net.update(rawDt);
    this.syncEntities(dt);
    this.syncBuildings();
    this.syncVehicles(dt);
    this.updateCamera(dt);
    this.renderer.render(this.scene, this.camera);
    this.updateHud();

    requestAnimationFrame((t) => this.loop(t));
  }

  /** Baut eine Spielfigur aus Grundformen: Zylinder (Koerper) + Kugel (Kopf) + Kegel (Blickrichtung). */
  createEntity(isSelf, playerId) {
    const group = new THREE.Group();
    const colors = colorPairForPlayer(isSelf, playerId);

    const bodyGeo = new THREE.CylinderGeometry(CHARACTER_RADIUS, CHARACTER_RADIUS, CHARACTER_BODY_HEIGHT, 12);
    const bodyMat = new THREE.MeshStandardMaterial({ color: colors.body });
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    body.position.y = CHARACTER_BODY_HEIGHT / 2;
    body.castShadow = true;
    group.add(body);

    const headGeo = new THREE.SphereGeometry(CHARACTER_HEAD_RADIUS, 14, 10);
    const headMat = new THREE.MeshStandardMaterial({ color: colors.head });
    const head = new THREE.Mesh(headGeo, headMat);
    head.position.y = CHARACTER_BODY_HEIGHT + CHARACTER_HEAD_RADIUS;
    head.castShadow = true;
    group.add(head);

    // Kegel als "Nase" - liegt auf lokaler +Z-Achse und zeigt so die Blickrichtung der Figur
    const noseGeo = new THREE.ConeGeometry(0.1, 0.22, 8);
    const noseMat = new THREE.MeshStandardMaterial({ color: 0xffffff });
    const nose = new THREE.Mesh(noseGeo, noseMat);
    nose.rotation.x = Math.PI / 2;
    nose.position.set(0, CHARACTER_BODY_HEIGHT + CHARACTER_HEAD_RADIUS, CHARACTER_HEAD_RADIUS + 0.1);
    group.add(nose);

    const label = this.createLabelSprite('');
    label.position.y = CHARACTER_BODY_HEIGHT + CHARACTER_HEAD_RADIUS * 2 + 0.4;
    group.add(label);

    this.scene.add(group);
    return {
      group, label, lastLabelText: '', bodyMat, headMat, isJailedVisual: false,
      normalBodyColor: colors.body, normalHeadColor: colors.head,
    };
  }

  createLabelSprite(text) {
    const canvasEl = document.createElement('canvas');
    canvasEl.width = 256;
    canvasEl.height = 64;

    // WICHTIG (Safari): Erst auf die Zeichenflaeche malen, DANN als Textur registrieren.
    // Umgekehrt wirft Safari einen InvalidStateError, weil eine noch komplett leere
    // Zeichenflaeche nicht als gueltige Bildquelle akzeptiert wird.
    this.paintCanvasText(canvasEl, text || ' ');

    const texture = new THREE.CanvasTexture(canvasEl);
    const material = new THREE.SpriteMaterial({ map: texture, depthTest: false });
    const sprite = new THREE.Sprite(material);
    sprite.scale.set(2.2, 0.55, 1);
    sprite.userData.canvasEl = canvasEl;
    sprite.userData.texture = texture;
    return sprite;
  }

  /** Malt Text auf eine Zeichenflaeche - getrennt, damit es auch VOR der Texturerstellung nutzbar ist. */
  paintCanvasText(canvasEl, text) {
    const ctx = canvasEl.getContext('2d');
    ctx.clearRect(0, 0, canvasEl.width, canvasEl.height);
    ctx.fillStyle = '#e8e8e8';
    ctx.font = '28px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, canvasEl.width / 2, canvasEl.height / 2);
  }

  paintLabelSprite(sprite, text) {
    this.paintCanvasText(sprite.userData.canvasEl, text);
    sprite.userData.texture.needsUpdate = true;
  }

  getOrCreateEntity(id, isSelf) {
    let entry = this.entities.get(id);
    if (!entry) {
      entry = this.createEntity(isSelf, id);
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
      const entry = this.getOrCreateEntity(p.id, isSelf);

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

    const label = this.createLabelSprite(property.name);
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
    const targetLength = VEHICLE_MODEL_LENGTH[vehicle.typeId] || cfg.d;
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

    const label = this.createLabelSprite('');
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
      const label = this.createLabelSprite('Polizei');
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

    const label = this.createLabelSprite('Polizei');
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

  /** Kamera folgt sanft hinter der Blickrichtung der eigenen Figur (GTA-Stil). */
  updateCamera(dtMs) {
    const me = this.entities.get(this.net.myId);
    if (!me) return;

    // WICHTIG: Die Kamera folgt jetzt der frei drehbaren cameraYaw (per Wischgeste
    // gesteuert), NICHT mehr der Bewegungsrichtung. Die Figur selbst dreht sich
    // weiterhin dahin, wohin sie tatsaechlich laeuft (siehe syncEntities) - das
    // sind bewusst zwei getrennte Dinge, genau wie in GTA/Roblox.
    const yaw = this.net.cameraYaw || 0;
    const dirX = Math.sin(yaw);
    const dirZ = Math.cos(yaw);

    const targetCamPos = new THREE.Vector3(
      me.group.position.x - dirX * CAMERA_DISTANCE,
      CAMERA_HEIGHT,
      me.group.position.z - dirZ * CAMERA_DISTANCE
    );
    const targetLook = new THREE.Vector3(me.group.position.x, CAMERA_LOOK_HEIGHT, me.group.position.z);

    // Bildratenunabhaengig, damit sich die Kamera auf einem 120Hz-Display
    // nicht doppelt so schnell anfuehlt wie auf einem 60Hz-Display.
    const blend = frameRateIndependentBlend(CAMERA_SMOOTH, dtMs);
    this.smoothedCamPos.lerp(targetCamPos, blend);
    this.smoothedCamTarget.lerp(targetLook, blend);

    this.camera.position.copy(this.smoothedCamPos);
    this.camera.lookAt(this.smoothedCamTarget);
  }

  updateHud() {
    const me = this.net.localPlayer;
    if (!me) return;
    const online = [...this.net.players.values()].filter((p) => p.connected !== false).length;
    const wantedText = me.wanted > 0 ? ` &nbsp;|&nbsp; Gesucht: ${'⭐'.repeat(Math.min(me.wanted, 5))}` : '';

    // Berufstitel aus dem Katalog nachschlagen - der Server sendet nur ID + Stufe,
    // die lesbaren Titel stehen im Katalog, der beim Beitritt mitkommt.
    let jobText = 'arbeitslos';
    if (me.job) {
      const jobDef = this.net.jobCatalog.find((j) => j.id === me.job);
      const level = jobDef ? jobDef.levels[me.jobLevel] : null;
      jobText = level ? level.title : 'angestellt';
    }

    // Laufenden Kurs anzeigen, damit man den Fortschritt ohne Panel mitbekommt
    let studyText = '';
    if (me.enrolledCourse) {
      const course = this.net.courseCatalog.find((c) => c.id === me.enrolledCourse);
      const required = course ? (me.job ? course.durationTicks * 2 : course.durationTicks) : 0;
      studyText = ` &nbsp;|&nbsp; 🎓 ${course ? course.name : 'Kurs'} ${me.courseProgress ?? 0}/${required}`;
    }

    // Faehrt der Spieler? Dann Fahrzeug statt "zu Fuss" anzeigen.
    let travelText = '🚶 zu Fuß';
    if (me.vehicleId != null) {
      const v = this.net.vehicles.get(me.vehicleId);
      const type = v ? this.net.vehicleCatalog.find((t) => t.id === v.typeId) : null;
      travelText = '🚗 ' + (type ? type.name : 'Fahrzeug');
    }

    this.hud.innerHTML =
      `Name: ${me.name} &nbsp;|&nbsp; Alter: ${me.age} &nbsp;|&nbsp; Cash: $${me.cash ?? 0}${wantedText}<br>` +
      `❤️ ${me.health ?? 100} &nbsp; 😊 ${me.happiness ?? 70} &nbsp; 🧠 ${me.smarts ?? 50} &nbsp; ✨ ${me.looks ?? 50} &nbsp;|&nbsp; 💼 ${jobText}${studyText}<br>` +
      `Spieler online: ${online} &nbsp;|&nbsp; ${travelText}`;
  }
}
