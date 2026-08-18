/* global THREE */

/**
 * ============================================================
 *  Modellbuendel ("Kits")
 * ============================================================
 *
 * Sechs zusammengefuehrte .glb-Dateien mit zusammen 207 Modellen aus vier
 * CC0-Paketen (Kenney, KayKit, Quaternius). Jedes Buendel enthaelt EINE
 * Textur, damit der Start nur sechs Ladevorgaenge kostet statt 207.
 *
 * WICHTIG - der Massstab steckt bereits in den Dateien:
 * Beim Bauen der Buendel wurde jedes Modell auf einen gemeinsamen Massstab
 * gerechnet, mittig ueber seinen Ursprung geschoben und mit der Unterkante
 * auf y=0 gesetzt. Anker ist die Spielfigur mit rund 1.3 Einheiten Hoehe fuer
 * einen 1.75 m grossen Menschen. Ein Wohnhaus ist damit 5.1 Einheiten (7 m)
 * hoch, ein Baum bis zu 10.4 (14 m), eine Limousine 3.3 lang (4.5 m).
 *
 * Das heisst fuer den Aufrufer: NICHT skalieren. Ein Kit-Modell einfach an
 * seine Position setzen, dann stimmt die Groesse. Die alten Modelle aus
 * citybits.glb und citykit.glb haben diesen gemeinsamen Massstab NICHT -
 * die werden weiterhin ueber cloneModel(name, zielLaenge) passend gemacht.
 */

const KIT_FILES = [
  'suburban.glb',   // sub-  : 21 Wohnhaeuser, Zaeune, Wege, Einfahrten, Baeume
  'industrial.glb', // ind-  : 20 Fabrikhallen, Schornsteine, Tank
  'carkit.glb',     // car-  : 28 Fahrzeuge
  'transit.glb',    // tr-   : Bus, Zug, Fahrrad, Ampel, Schilder, Huetchen
  'nature.glb',     // nat-  : 20 Baeume, 22 Bueschen, Gras
  'furniture.glb',  // furn- : 53 Moebel fuer Innenraeume
  'characters.glb', // char- : 18 fertige Spielfiguren (Kenney Blocky Characters)
];

/**
 * Laedt alle Buendel und sortiert ihre Modelle in zwei Ablagen.
 *
 * Der Grund fuer die Trennung: die Instanzierung im Renderer greift direkt
 * auf mesh.geometry und mesh.material zu und kann deshalb nur mit EINZELNEN
 * Netzen arbeiten. Haeuser, Baeume und Moebel bestehen aus genau einem Netz
 * und landen darum in modelTemplates - dort funktioniert sofort alles, was
 * es schon gibt, inklusive der Instanzierung.
 *
 * Fahrzeuge bestehen dagegen aus fuenf bis sieben Netzen (Karosserie plus
 * Raeder). Wuerde man davon nur das erste Netz merken, bekaeme man ein Auto
 * ohne Raeder. Die kommen deshalb als ganzer Teilbaum in kitTemplates - genau
 * wie die Haustiere. Nebeneffekt: die Raeder bleiben eigene Objekte und
 * koennen sich spaeter drehen.
 *
 * @param {THREE.GLTFLoader} loader
 * @param {Map} modelTemplates  Einzelnetze, Name -> THREE.Mesh
 * @param {Map} kitTemplates    Teilbaeume, Name -> THREE.Object3D
 * @param {Function} onKitReady wird nach jedem fertigen Buendel gerufen
 */
function loadKitBundles(loader, modelTemplates, kitTemplates, onKitReady) {
  const bilanz = { dateien: 0, netze: 0, baeume: 0, fehler: [] };

  for (const datei of KIT_FILES) {
    loader.load(
      datei,
      (gltf) => {
        // Nur die OBERSTE Ebene durchgehen. Jedes Modell ist beim Bauen der
        // Buendel in genau einen benannten Knoten gehuellt worden - dessen
        // Name ist der Modellname. Ein traverse() ueber den ganzen Baum wuerde
        // stattdessen die Innereien einsammeln ("wheel-front-right" statt
        // "car-sedan") und die Namen der Buendel unbrauchbar machen.
        for (const knoten of gltf.scene.children) {
          if (!knoten.name) continue;

          const netze = [];
          knoten.traverse((c) => { if (c.isMesh) netze.push(c); });
          if (netze.length === 0) continue;

          if (netze.length === 1) {
            const netz = netze[0];

            // Der eingerechnete Massstab sitzt in der Transformation des
            // Huellknotens. Er MUSS in die Geometrie wandern, nicht in die
            // Objekt-Transformation des Netzes: normalizedGeometry() und die
            // Instanzierung im Renderer lesen mesh.geometry direkt und sehen
            // eine Objekt-Transformation gar nicht. Laege der Massstab dort,
            // stuende jedes instanzierte Haus wieder in Originalgroesse da -
            // und zwar nur die instanzierten, was den Fehler besonders
            // schwer auffindbar machen wuerde.
            knoten.updateMatrixWorld(true);
            const geometrie = netz.geometry.clone();
            geometrie.applyMatrix4(netz.matrixWorld);

            // Eigene Transformation zuruecksetzen, sonst wirkt sie ein
            // zweites Mal, sobald cloneModel() das Netz klont.
            const kopie = netz.clone();
            kopie.geometry = geometrie;
            kopie.position.set(0, 0, 0);
            kopie.rotation.set(0, 0, 0);
            kopie.scale.set(1, 1, 1);
            kopie.updateMatrix();
            kopie.name = knoten.name;

            modelTemplates.set(knoten.name, kopie);
            bilanz.netze++;
          } else {
            kitTemplates.set(knoten.name, knoten);
            bilanz.baeume++;
          }
        }

        bilanz.dateien++;
        if (onKitReady) onKitReady(datei, bilanz);
      },
      undefined,
      (err) => {
        // Leise scheitern: fehlt ein Buendel, bleibt der Rest der Stadt
        // stehen. Eine halbe Stadt ist besser als eine schwarze Karte.
        bilanz.fehler.push(datei);
        console.warn('Buendel nicht geladen:', datei, err && err.message);
      },
    );
  }

  return bilanz;
}

/**
 * Klont einen mehrteiligen Teilbaum (Fahrzeuge, Zug, Fahrrad).
 *
 * Object3D.clone() uebernimmt den Teilbaum samt allen Zwischenebenen. Das ist
 * hier zwingend: ein Kenney-Auto haengt seine Raeder als eigene Knoten mit
 * eigenem Versatz unter die Karosserie. Klont man nur die Netze und haengt
 * sie in eine neue Gruppe, verlieren sie diesen Versatz und stapeln sich in
 * der Mitte des Wagens.
 *
 * @returns {THREE.Group|null} Gruppe mit Ursprung mittig auf dem Boden
 */
function cloneKitModel(kitTemplates, name) {
  const vorlage = kitTemplates.get(name);
  if (!vorlage) return null;

  const kopie = vorlage.clone();

  // Materialien einzeln mitklonen. Sonst teilen sich alle Kopien dasselbe
  // Material - und ein eingefaerbtes Polizeiauto wuerde jedes andere Auto der
  // Stadt mit einfaerben.
  kopie.traverse((c) => {
    if (!c.isMesh) return;
    c.material = Array.isArray(c.material)
      ? c.material.map((m) => m.clone())
      : c.material.clone();
    c.castShadow = true;
    c.receiveShadow = true;
  });

  // In eine Gruppe legen, damit der Aufrufer eine feste Schnittstelle hat:
  // Ursprung mittig, Unterkante auf dem Boden - dieselbe Zusage wie bei
  // cloneModel(). Der Massstab steckt schon in der Datei, es wird hier
  // bewusst NICHT skaliert.
  const gruppe = new THREE.Group();
  gruppe.add(kopie);
  return gruppe;
}
