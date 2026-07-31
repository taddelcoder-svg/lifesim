'use strict';

// server/game.js
// Server-autoritative Spielwelt: Lobby, Bewegung, Alterung, Delta-Erzeugung.
// Der Client bestimmt niemals Position, Geld oder Schaden - er sendet nur
// Eingabeabsichten (Tasten), die hier validiert und angewendet werden.

const crypto = require('crypto');
const path = require('path');
const {
  createPlayer,
  serializePublic,
  serializeMovement,
  serializeFull,
  setNextPlayerId,
  WORLD_WIDTH,
  WORLD_HEIGHT,
  STARTING_CASH,
} = require('./player');
const { pickEligibleEvent } = require('./events');
const {
  PROPERTIES,
  COMPANY_FOUNDING_COST,
  COMPANY_LEVELS,
  MAX_OWNED_COMPANIES,
  PROPERTY_LEVELS,
  SHOP_MIN_PRICE,
  SHOP_MAX_PRICE,
  SHOP_INCOME_RATIO,
  SHOP_MAINTENANCE_RATIO,
  MAX_OWNED_SHOPS,
  SHOP_NAMES,
  SHOP_STREETS,
  HOME_MIN_PRICE,
  HOME_MAX_PRICE,
  HOME_MAINTENANCE_RATIO,
  MAX_OWNED_HOMES,
  HOME_HAPPINESS_FLOOR,
  HOME_NAMES,
  HOME_STREETS,
  EMPLOYEE_INCOME_PER_TICK,
  EMPLOYEE_WAGE_PER_TICK,
  EMPLOYMENT_OFFER_DURATION_MS,
  PROPERTY_SELL_BACK_RATIO,
  COMPANY_CLOSE_REFUND_RATIO,
  WEALTH_TAX_RATE,
  TRADE_RESPONSE_DURATION_MS,
} = require('./economy');
const {
  STEAL_RANGE,
  STEAL_COOLDOWN_MS,
  STEAL_SUCCESS_CHANCE,
  STEAL_MIN_PERCENT,
  STEAL_MAX_PERCENT,
  STEAL_MAX_AMOUNT,
  STEAL_WANTED_ON_ATTEMPT,
  STEAL_WANTED_ON_SUCCESS_BONUS,
  BURGLARY_RANGE,
  BURGLARY_COOLDOWN_MS,
  BURGLARY_SUCCESS_CHANCE,
  BURGLARY_DISABLE_MS,
  BURGLARY_WANTED_ON_ATTEMPT,
  BURGLARY_WANTED_ON_SUCCESS_BONUS,
  VAULT_TAX_SHARE,
  ROBBERY_COOLDOWN_MS,
  ROBBERY_SUCCESS_CHANCE,
  ROBBERY_LOOT_SHARE,
  ROBBERY_MIN_VAULT,
  ROBBERY_WANTED_ON_ATTEMPT,
  ROBBERY_WANTED_ON_SUCCESS_BONUS,
  JAIL_EXTRA_PER_RECORD_MS,
  JAIL_MAX_DURATION_MS,
  CRIMINAL_RECORD_LIMIT,
  BAIL_BASE_COST,
  BAIL_COST_PER_SECOND,
  BAIL_COST_PER_RECORD,
  BRIBE_COST_PER_WANTED,
  BRIBE_SUCCESS_CHANCE,
  BRIBE_WANTED_REDUCTION,
  BRIBE_WANTED_ON_FAILURE,
  BRIBE_COOLDOWN_MS,
  LAWYER_BASE_COST,
  LAWYER_COST_PER_RECORD,
  POLICE_COUNT,
  POLICE_CHASE_SPEED,
  POLICE_PATROL_SPEED,
  POLICE_CATCH_RANGE,
  POLICE_CHASE_RANGE,
  JAIL_DURATION_MS,
  JAIL_POSITION,
  WANTED_DECAY_INTERVAL_MS,
  WANTED_DECAY_AMOUNT,
} = require('./crime');
const { MAX_CHAT_LENGTH, CHAT_HISTORY_LIMIT, LEADERBOARD_LIMIT } = require('./social');
const {
  PLACES,
  findPlaceForAction,
  isPlayerAtPlace,
  buildPlaceCollisionRects,
  buildPlacesCatalog,
} = require('./places');
const {
  HEALTH_DECAY_PER_TICK,
  HAPPINESS_DECAY_PER_TICK,
  HEALTH_SICK_THRESHOLD,
  HEALTH_SICK_SALARY_MULT,
  HAPPINESS_LOW_THRESHOLD,
  HAPPINESS_LOW_XP_MULT,
  HOSPITAL_COST_PER_HEALTH,
  GYM_COST,
  GYM_HAPPINESS_GAIN,
  GYM_COOLDOWN_MS,
  GYM_LOOKS_GAIN,
  HAPPINESS_DECAY_RELIEF_PER_FRIEND,
  MAX_FRIENDS_COUNTED,
} = require('./wellbeing');
const {
  ALARM_BURGLARY_SUCCESS_CHANCE,
  ALARM_WANTED_BONUS_ON_FAILURE,
  alarmInstallCost,
  alarmUpkeep,
  insurancePremium,
  insurancePayout,
} = require('./insurance');
const {
  CAMPAIGN_DURATION_MS,
  TERM_DURATION_MS,
  CANDIDACY_FEE,
  TAX_RATE_MIN,
  TAX_RATE_MAX,
  DEFAULT_TAX_RATE,
  MAYOR_TAX_SHARE,
  isValidTaxRate,
  createInitialPolitics,
} = require('./politics');
const {
  STOCKS,
  MAX_SHARES_PER_STOCK,
  createInitialMarket,
  findStock,
  stepPrice,
  applyTradeImpact,
} = require('./market');
const {
  WEATHER_DURATION_MS,
  findWeather,
  pickWeather,
  getDayPhase,
  environmentEffects,
} = require('./daynight');
const { NEWS_LIMIT } = require('./news');
const {
  MAX_PET_NAME_LENGTH,
  FEED_COST,
  FEED_HAPPINESS_GAIN,
  FEED_COOLDOWN_MS,
  NEGLECT_TIMEOUT_MS,
  findSpecies,
  buildSpeciesCatalog,
} = require('./pets');
const {
  BUST_CHANCE,
  BUST_WANTED,
  findItem,
  buildItemCatalog,
} = require('./blackmarket');
const {
  CHECKPOINTS,
  CHECKPOINT_RADIUS,
  RACE_ENTRY_FEE,
  RACE_SEASON_MS,
  RACE_TIMEOUT_MS,
  lapLength,
} = require('./racing');
const {
  GANG_FOUNDING_COST,
  MAX_GANG_MEMBERS,
  MAX_GANG_NAME_LENGTH,
  QUADRANTS,
  TERRITORY_CLAIM_COST,
  TERRITORY_UPKEEP_PER_TICK,
  TERRITORY_LOOT_BONUS,
  quadrantAt,
  findQuadrant,
} = require('./gangs');
const {
  MARRIAGE_HAPPINESS_BONUS,
  DIVORCE_HAPPINESS_PENALTY,
  CHILD_COST,
  CHILD_HAPPINESS_BONUS,
  CHILD_NAME_MAX_LENGTH,
  DEATH_HEALTH_THRESHOLD,
  INHERITANCE_CHILD_AND_SPOUSE,
  INHERITANCE_CHILD_ONLY,
  INHERITANCE_SPOUSE_ONLY,
} = require('./family');
const {
  findJobDefinition,
  buildJobCatalog,
  XP_PER_TICK,
  QUIT_HAPPINESS_PENALTY,
} = require('./jobs');
const {
  findCourse,
  buildCourseCatalog,
  EMPLOYED_STUDY_SLOWDOWN,
  MAX_SMARTS,
} = require('./education');
const {
  buildCityLayout,
  resolveCollisions,
  PLAYER_COLLISION_RADIUS,
  SPAWN_POSITION,
} = require('./world');
const {
  SAVINGS_INTEREST_RATE,
  LOAN_INTEREST_RATE,
  LOAN_BASE_LIMIT,
  LOAN_LIMIT_PER_PROPERTY_VALUE,
  LOAN_LIMIT_PER_JOB_LEVEL,
  FORECLOSURE_THRESHOLD,
} = require('./bank');
const {
  findVehicleType,
  createInitialVehicles,
  buildVehicleCatalog,
  VEHICLE_ENTER_RANGE,
  VEHICLE_THEFT_WANTED,
  VEHICLE_SPAWNS,
  MAX_OWNED_VEHICLES,
  MAX_VEHICLES,
  newVehiclePrice,
  dealershipSlot,
} = require('./vehicles');

const MAX_PLAYERS = 20;
const FAST_TICK_MS = 50; // Positionen / Kollision (Phase 4) / Kampf
const SLOW_TICK_MS = 10000; // Alterung / Wirtschaft
const EVENT_TICK_MS = 1000; // Lebensereignisse: Ablauf pruefen, neue anbieten
const COPS_TICK_MS = 200; // Polizei-Bewegung - eigener, fluessigerer Takt als EVENT_TICK
const SNAPSHOT_INTERVAL_MS = 60000;
const SNAPSHOT_PATH = path.join(__dirname, '..', 'world-snapshot.json');

const YEARS_PER_MS = 1 / (60 * 60 * 1000); // 1 Spieljahr pro Realstunde aktiver Verbindung
const RECONNECT_GRACE_MS = 5 * 60 * 1000; // Zeitfenster, in dem ein Reconnect den alten Spieler übernimmt
const PLAYER_SPEED = 200; // px/s - MUSS mit client/net.js übereinstimmen (Prediction)

// Beschleunigung/Traegheit statt sofortigem Vollspeed - laesst die Bewegung
// weniger roboterhaft wirken. Diese Werte UND die Formel in stepMovement()
// muessen EXAKT mit client/net.js uebereinstimmen, sonst driftet die
// Client-Vorhersage von der Server-Wahrheit ab und es ruckelt staendig.
//
// WICHTIG zur Groessenordnung: Diese Werte sind BEWUSST hoch (nicht wie ein
// Auto mit traeger Physik). On-Foot-Bewegung in GTA/Roblox hat praktisch keine
// Trägheit beim Richtungswechsel - man dreht nahezu sofort um, nur der Start
// aus dem Stand hat einen kurzen, kaum wahrnehmbaren Anlauf. Mit den alten,
// niedrigeren Werten "rutschte" die Figur beim Umkehren sichtbar 6 Ticks lang
// in die falsche Richtung weiter - das ist der Fehler, den diese Werte beheben.
const PLAYER_ACCELERATION = 4000; // px/s² - Vollspeed aus dem Stand in 0.05s
const PLAYER_FRICTION = 5000;     // px/s² - Stillstand aus Vollspeed in 0.04s

// Sicherheitsnetz gegen "laeuft endlos weiter": Der Client sendet Eingaben pro
// Frame (~60/s). Bleiben sie laenger als diese Spanne aus - Netzwerkaussetzer,
// Tab im Hintergrund, App minimiert, verpasstes Tasten-Loslassen -, bliebe die
// gemerkte Richtung sonst FUER IMMER gesetzt und die Figur wuerde unkontrolliert
// weiterlaufen. Genau dieser Fehler trat auf. Nach dieser Zeit wird gestoppt.
const INPUT_TIMEOUT_MS = 250;

/**
 * Wandelt gedrueckte Tasten + Kamera-Blickrichtung in eine Weltrichtung um.
 * "W" bedeutet ab jetzt "dorthin, wo die Kamera gerade hinschaut" statt einer
 * festen Kartenrichtung - das ist der Kern des GTA/Roblox-Steuergefuehls.
 * MUSS mit derselben Funktion in client/net.js uebereinstimmen (Vorhersage).
 */
function keysToWorldDirection(keys, cameraYaw) {
  const inputForward = (keys.w ? 1 : 0) - (keys.s ? 1 : 0);
  const inputRight = (keys.d ? 1 : 0) - (keys.a ? 1 : 0);

  if (inputForward === 0 && inputRight === 0) return { dx: 0, dy: 0 };

  const yaw = typeof cameraYaw === 'number' && Number.isFinite(cameraYaw) ? cameraYaw : 0;
  const sin = Math.sin(yaw);
  const cos = Math.cos(yaw);

  // "Rechts" relativ zur Kamera ist forward x up (Three.js-Konvention), nicht
  // umgekehrt - das Vorzeichen hier war zunaechst falsch herum und hat A/D vertauscht.
  let dx = inputForward * sin - inputRight * cos;
  let dy = inputForward * cos + inputRight * sin;

  const len = Math.hypot(dx, dy);
  if (len > 0) {
    dx /= len;
    dy /= len;
  }
  return { dx, dy };
}

/**
 * Ein Bewegungsschritt. Bewusst als reine Funktion ohne Seiteneffekte, damit
 * Server und Client garantiert dasselbe rechnen koennen.
 *
 * speed/accel/friction werden BEWUSST uebergeben statt fest verdrahtet: zu Fuss
 * gelten andere Werte als im Fahrzeug. Der Client muss dieselben Werte verwenden,
 * sonst driftet die Vorhersage - deshalb schickt der Server den Fahrzeugkatalog mit.
 * Veraendert pos und vel direkt.
 */
function stepMovement(pos, vel, dirX, dirY, dtSec, worldW, worldH, speed, accel, friction) {
  const maxSpeed = speed != null ? speed : PLAYER_SPEED;
  const accelRate = accel != null ? accel : PLAYER_ACCELERATION;
  const frictionRate = friction != null ? friction : PLAYER_FRICTION;

  const targetVx = dirX * maxSpeed;
  const targetVy = dirY * maxSpeed;

  const isStopping = dirX === 0 && dirY === 0;
  const maxDelta = (isStopping ? frictionRate : accelRate) * dtSec;

  const dvx = targetVx - vel.x;
  const dvy = targetVy - vel.y;
  const dvLen = Math.hypot(dvx, dvy);

  if (dvLen <= maxDelta || dvLen === 0) {
    vel.x = targetVx;
    vel.y = targetVy;
  } else {
    vel.x += (dvx / dvLen) * maxDelta;
    vel.y += (dvy / dvLen) * maxDelta;
  }

  pos.x = Math.max(0, Math.min(worldW, pos.x + vel.x * dtSec));
  pos.y = Math.max(0, Math.min(worldH, pos.y + vel.y * dtSec));
}

const MAX_EVENT_QUEUE = 3; // mehr wartende Ereignisse pro Spieler werden nicht angesammelt
const EVENT_ROLL_CHANCE = 0.05; // Chance pro EVENT_TICK, dass ein neues Ereignis in die Warteschlange kommt
const RECENT_EVENT_MEMORY = 5; // so viele zuletzt gesehene Event-IDs werden kurzfristig vermieden

let nextEventInstanceId = 1;

/** Wendet die Effekte einer Event-Wahl auf einen Spieler an, mit sinnvollen Grenzen. */
function applyEffects(player, effects) {
  if (!effects) return;
  const clamp = (v) => Math.max(0, Math.min(100, v));
  if (typeof effects.cash === 'number') player.cash = Math.max(0, player.cash + effects.cash);
  if (typeof effects.health === 'number') player.health = clamp(player.health + effects.health);
  if (typeof effects.happiness === 'number') player.happiness = clamp(player.happiness + effects.happiness);
  if (typeof effects.smarts === 'number') player.smarts = clamp(player.smarts + effects.smarts);
  if (typeof effects.looks === 'number') player.looks = clamp(player.looks + effects.looks);
  if (typeof effects.wanted === 'number') player.wanted = Math.max(0, player.wanted + effects.wanted);
}

class GameWorld {
  constructor() {
    this.players = new Map(); // id -> player
    this.tokenIndex = new Map(); // token -> id
    this.lastBroadcastMovement = new Map(); // id -> zuletzt gesendeter Bewegungs-State

    // Immobilien: feste, begrenzte Liste - Objekte werden NIE neu erzeugt,
    // dadurch entsteht echte Konkurrenz zwischen Spielern um wenige Objekte.
    this.properties = new Map();
    for (const def of PROPERTIES) {
      // baseIncome/baseMaintenance festhalten: Ausbaustufen aendern
      // incomePerTick und maintenancePerTick DIREKT am Objekt, damit alle
      // Verbraucher (Ertrag, Einbruchsbeute, Alarmkosten, Praemie,
      // Entschaedigung) automatisch mitziehen. Ohne die Ausgangswerte liesse
      // sich die Stufe nach einem Neustart nicht rekonstruieren.
      this.properties.set(def.id, {
        ...def,
        ownerId: null,
        level: 1,
        invested: 0,
        baseIncome: def.incomePerTick,
        baseMaintenance: def.maintenancePerTick,
      });
    }

    this.companies = new Map(); // id -> { id, ownerId, name }
    this.nextCompanyId = 1;

    this.trades = new Map(); // id -> Handelsangebot zwischen zwei Spielern
    this.nextTradeId = 1;

    // Banktresor: wird aus der Vermoegenssteuer gespeist und ist das Ziel von
    // Bankueberfaellen. Siehe VAULT_TAX_SHARE in crime.js - das Geld ist bereits
    // aus dem Umlauf gezogen, ein Ueberfall bringt es zurueck statt neues zu schaffen.
    this.bankVault = 0;

    // Versicherungstopf: wird ausschliesslich aus den Praemien gespeist, und
    // Entschaedigungen kommen ausschliesslich daraus. Gleiches Prinzip wie beim
    // Banktresor - ohne diesen Deckel waere die Versicherung eine
    // Gelddruckmaschine (man liesse sich absichtlich bestehlen und kassierte
    // beide Seiten).
    this.insurancePool = 0;

    // Politik: gewaehlter Buergermeister, aktueller Steuersatz, laufende Wahl.
    this.politics = createInitialPolitics(Date.now());

    // Boerse: Kurse plus KASSENBESTAND. Der Bestand ist die Garantie gegen
    // Geldschoepfung - es wird nie mehr ausgezahlt als eingezahlt wurde.
    this.market = createInitialMarket();

    // Umwelt: Tageszeit wird aus der Uhr abgeleitet (kein Zustand noetig), das
    // Wetter dagegen gewuerfelt und deshalb serverseitig gehalten.
    this.environment = { weather: pickWeather(), weatherUntil: Date.now() + WEATHER_DURATION_MS };

    // Stadtnachrichten: Ringpuffer der juengsten oeffentlichen Ereignisse.
    this.news = [];
    this.nextNewsId = 1;

    // Banden und Territorium.
    this.gangs = new Map();   // id -> { id, name, leaderId, members:[], treasury }
    this.nextGangId = 1;
    this.territory = {};      // quadrantId -> gangId
    for (const q of QUADRANTS) this.territory[q.id] = null;

    // Rennen: Preistopf aus Startgeldern, Bestzeiten der laufenden Saison.
    this.race = {
      pot: 0,
      seasonEndsAt: Date.now() + RACE_SEASON_MS,
      bestTimes: {}, // spielerId -> { name, ms }
    };

    // Polizei-NPCs: keine echten Spieler, einfache Verfolgungs-KI serverseitig.
    this.cops = [];
    for (let i = 0; i < POLICE_COUNT; i++) {
      this.cops.push({
        id: 'cop_' + i,
        position: { x: 200 + i * 600, y: 1000 },
        velocity: { x: 0, y: 0 },
        targetPlayerId: null,
        patrolChangeAt: 0,
      });
    }

    this.chatLog = []; // {id, playerId, name, text, timestamp} - begrenzt auf CHAT_HISTORY_LIMIT
    this.nextChatId = 1;

    this.friendRequests = new Map(); // id -> { id, fromPlayerId, toPlayerId }
    this.nextFriendRequestId = 1;

    this.employmentOffers = new Map(); // id -> { id, companyId, fromPlayerId, toPlayerId, expiresAt }
    this.nextEmploymentOfferId = 1;

    this.marriageRequests = new Map(); // id -> { id, fromPlayerId, toPlayerId }
    this.nextMarriageRequestId = 1;

    this.children = new Map(); // id -> { id, name, parentIds:[p1,p2], bornAt, inheritedCash, claimed }
    this.nextChildId = 1;

    // Stadtaufbau: Strassen + Deko-Gebaeude. Die kaufbaren Immobilien werden dabei
    // ausgespart und danach als eigene Kollisionsflaechen ergaenzt - so laeuft man
    // durch KEIN Gebaeude hindurch, egal welcher Art.
    // Die Ortsgebaeude (Bank, Uni, ...) werden genauso behandelt wie die
    // Immobilien: ihr Block bleibt von Deko frei, damit nicht zwei Gebaeude
    // ineinander stehen, und danach kommen sie als eigene Kollisionsflaeche dazu.
    this.cityLayout = buildCityLayout([
      ...PROPERTIES.map((p) => p.position),
      ...PLACES.map((p) => p.position),
    ]);

    // Industriegebaeude als moegliche Firmensitze. Sie sind Teil der Stadtdeko
    // und stehen bereits - hier wird nur festgehalten, welche davon vergeben
    // werden koennen. Damit bekommen Firmen erstmals einen ORT: bisher waren
    // sie reine Zahlen ohne jede Stelle auf der Karte.
    //
    // Die Liste ist deterministisch aus dem Stadtaufbau abgeleitet (Grundsatz 4)
    // und deshalb auf allen Clients gleich; gespeichert wird nur der INDEX.
    this.industrialSites = this.cityLayout.buildings
      .map((b, index) => ({ index, x: b.x, y: b.y }))
      .filter((b) => b.x >= 2800 && b.y >= 2800);

    // Laeden aus den Gewerbegebaeuden erzeugen. Sie kommen in DIESELBE
    // properties-Map wie die kuratierten Objekte - damit funktionieren Kauf,
    // Ertrag, Einbruch, Alarmanlage, Versicherung und Ausbau ohne eine einzige
    // Zeile Sonderbehandlung. Unterschieden werden sie nur ueber `kind`.
    for (const shop of this.generateShops()) this.properties.set(shop.id, shop);
    for (const home of this.generateHomes()) this.properties.set(home.id, home);

    this.collisionRects = [
      ...this.cityLayout.buildings.map((b) => ({ x: b.x, y: b.y, w: b.w, d: b.d })),
      ...PROPERTIES.map((p) => ({ x: p.position.x, y: p.position.y, w: 120, d: 120 })),
      ...buildPlaceCollisionRects(),
    ];

    const vehicleInit = createInitialVehicles();
    this.vehicles = vehicleInit.vehicles;
    this.nextVehicleId = vehicleInit.nextVehicleId;
  }

  /** Der komplette Stadtaufbau fuer den Client (Rendering + identische Kollision). */
  buildWorldLayoutState() {
    return {
      roads: this.cityLayout.roads,
      buildings: this.cityLayout.buildings,
      collisionRects: this.collisionRects,
      collisionRadius: PLAYER_COLLISION_RADIUS,
      // Wurde bisher berechnet, aber nie gesendet. Der Client spiegelt die
      // Weltgroesse zwangslaeufig als eigene Konstante (kein Build-Schritt) -
      // mit diesem Wert kann er wenigstens PRUEFEN, ob sein Spiegel noch stimmt,
      // statt still auseinanderzulaufen.
      worldSize: this.cityLayout.worldSize,
      places: buildPlacesCatalog(),
    };
  }

  /**
   * Prueft die Ortsbindung einer Aktion. Rueckgabe null = erlaubt (entweder ist
   * die Aktion ortsungebunden oder der Spieler steht nah genug), sonst das
   * fertige Fehlerobjekt zum Zurueckgeben.
   *
   * Es wird bewusst NUR 'too_far' gemeldet, ohne Ortsnamen: der Client kennt den
   * Ortskatalog aus dem worldLayout und schlaegt den Namen selbst nach. So muss
   * kein einziges der rund 15 actionError-Sende-Statements in index.js angefasst
   * werden - die Fehlermeldung bleibt trotzdem konkret.
   */
  checkPlaceRequirement(player, action) {
    const place = findPlaceForAction(action);
    if (!place) return null;
    if (isPlayerAtPlace(player, place)) return null;
    return { ok: false, reason: 'too_far', placeId: place.id };
  }

  /** Liegt diese Position in einem Gebaeude? Genutzt beim Laden alter Spielstaende. */
  isPositionBlocked(pos) {
    if (!pos) return false;
    return this.collisionRects.some(
      (r) =>
        Math.abs(pos.x - r.x) < r.w / 2 + PLAYER_COLLISION_RADIUS &&
        Math.abs(pos.y - r.y) < r.d / 2 + PLAYER_COLLISION_RADIUS
    );
  }

  // ---------------------------------------------------------------------
  // FAHRZEUGE: einsteigen, fahren, kaufen, klauen
  // ---------------------------------------------------------------------

  buildVehiclesState() {
    return {
      // Katalog enthaelt den Gebrauchtpreis; der Neuwagenaufschlag wird hier
      // ergaenzt, damit die Oberflaeche beide Preise zeigen kann.
      catalog: buildVehicleCatalog().map((t) => ({ ...t, newPrice: newVehiclePrice(t) })),
      vehicles: [...this.vehicles.values()].map((v) => ({
        id: v.id, typeId: v.typeId, x: v.x, y: v.y,
        ownerId: v.ownerId, driverId: v.driverId,
      })),
    };
  }

  /**
   * Steigt in ein Fahrzeug in Reichweite ein. Gehoert es jemand anderem, gilt das
   * als Diebstahl und erhoeht das Fahndungslevel - dadurch wird die Polizei
   * (Phase 4) automatisch auf den Spieler aufmerksam.
   */
  enterVehicle(playerId, vehicleId) {
    const player = this.players.get(playerId);
    const vehicle = this.vehicles.get(vehicleId);
    if (!player || !vehicle) return { ok: false, reason: 'not_found' };
    if (this.isJailed(player)) return { ok: false, reason: 'jailed' };
    if (this.isAwaitingReincarnation(player)) return { ok: false, reason: 'dead' };
    if (player.vehicleId != null) return { ok: false, reason: 'already_driving' };
    if (vehicle.driverId != null) return { ok: false, reason: 'occupied' };

    const dist = Math.hypot(player.position.x - vehicle.x, player.position.y - vehicle.y);
    if (dist > VEHICLE_ENTER_RANGE) return { ok: false, reason: 'too_far' };

    const isTheft = vehicle.ownerId != null && vehicle.ownerId !== playerId;
    if (isTheft) {
      player.wanted += VEHICLE_THEFT_WANTED;
      player.lastCrimeAt = Date.now();
    }

    vehicle.driverId = playerId;
    player.vehicleId = vehicle.id;
    // Geschwindigkeit zuruecksetzen, damit man nicht mit Fuss-Impuls losschiesst
    player.velocity.x = 0;
    player.velocity.y = 0;

    const type = findVehicleType(vehicle.typeId);
    return { ok: true, vehicle, wasTheft: isTheft, typeName: type ? type.name : 'Fahrzeug' };
  }

  /** Steigt aus. Das Fahrzeug bleibt dort stehen, wo man es verlaesst. */
  exitVehicle(playerId) {
    const player = this.players.get(playerId);
    if (!player) return { ok: false, reason: 'not_found' };
    if (player.vehicleId == null) return { ok: false, reason: 'not_driving' };

    const vehicle = this.vehicles.get(player.vehicleId);
    if (vehicle) {
      vehicle.driverId = null;
      vehicle.x = player.position.x;
      vehicle.y = player.position.y;
    }
    player.vehicleId = null;
    player.velocity.x = 0;
    player.velocity.y = 0;

    return { ok: true, vehicle };
  }

  /** Kauft ein herrenloses Fahrzeug, in dem man gerade sitzt oder das in Reichweite ist. */
  buyVehicle(playerId, vehicleId) {
    const player = this.players.get(playerId);
    const vehicle = this.vehicles.get(vehicleId);
    if (!player || !vehicle) return { ok: false, reason: 'not_found' };
    if (vehicle.ownerId === playerId) return { ok: false, reason: 'already_owned' };
    if (vehicle.ownerId != null) return { ok: false, reason: 'owned_by_other' };

    const type = findVehicleType(vehicle.typeId);
    if (!type) return { ok: false, reason: 'not_found' };
    if (player.cash < type.price) return { ok: false, reason: 'insufficient_funds' };
    // Gleiche Obergrenze wie beim Neuwagen: sonst koennte ein einzelner Spieler
    // den kompletten Strassenbestand aufkaufen und alle anderen aussperren.
    if (this.ownedVehicleCount(playerId) >= MAX_OWNED_VEHICLES) {
      return { ok: false, reason: 'too_many_vehicles' };
    }

    const dist = Math.hypot(player.position.x - vehicle.x, player.position.y - vehicle.y);
    if (player.vehicleId !== vehicle.id && dist > VEHICLE_ENTER_RANGE) {
      return { ok: false, reason: 'too_far' };
    }

    player.cash -= type.price;
    vehicle.ownerId = playerId;
    return { ok: true, vehicle, typeName: type.name, price: type.price };
  }

  /**
   * Holt den Spieler aus dem Fahrzeug, ohne eine Aktion des Spielers - fuer
   * Verhaftung und Tod. Ohne das wuerde man "im Auto sitzend" im Gefaengnis landen.
   */
  forceExitVehicle(player) {
    if (player.vehicleId == null) return;
    const vehicle = this.vehicles.get(player.vehicleId);
    if (vehicle) {
      vehicle.driverId = null;
      vehicle.x = player.position.x;
      vehicle.y = player.position.y;
    }
    player.vehicleId = null;
  }

  get playerCount() {
    return this.players.size;
  }

  isFull() {
    return this.playerCount >= MAX_PLAYERS;
  }

  /**
   * Spieler beitreten lassen. Mit gültigem Token innerhalb der Grace-Period
   * wird der bestehende Spieler reaktiviert (Reconnect), sonst neu erstellt.
   */
  joinPlayer(name, token, ws) {
    if (token && this.tokenIndex.has(token)) {
      const existingId = this.tokenIndex.get(token);
      const existing = this.players.get(existingId);
      if (existing && Date.now() - existing.lastSeen <= RECONNECT_GRACE_MS) {
        existing.connected = true;
        existing.ws = ws;
        existing.lastSeen = Date.now();
        existing.velocity.x = 0;
        existing.velocity.y = 0;
        if (existing.activeEvent) {
          // Event-Timer lief waehrend der Trennung nicht weiter - jetzt mit der
          // gemerkten Restzeit fortsetzen, damit niemand fuer's Offline-sein bestraft wird.
          const remaining = existing.activeEvent.remainingMs ?? existing.activeEvent.responseDurationMs;
          existing.activeEvent.expiresAt = Date.now() + remaining;
        }
        return { player: existing, reconnected: true };
      }
    }

    if (this.isFull()) {
      return { error: 'lobby_full' };
    }

    const newToken = token || crypto.randomBytes(16).toString('hex');
    const player = createPlayer(name, newToken);
    player.ws = ws;
    this.players.set(player.id, player);
    this.tokenIndex.set(newToken, player.id);
    return { player, reconnected: false };
  }

  disconnectPlayer(id) {
    const player = this.players.get(id);
    if (!player) return;
    player.connected = false;
    player.ws = null;
    player.velocity.x = 0;
    player.velocity.y = 0;
    player.lastSeen = Date.now();
    if (player.activeEvent) {
      player.activeEvent.remainingMs = Math.max(0, player.activeEvent.expiresAt - Date.now());
    }
  }

  /** Entfernt Spieler, die die Reconnect-Grace-Period überschritten haben. */
  removeStalePlayers() {
    const now = Date.now();
    for (const [id, player] of this.players) {
      if (!player.connected && now - player.lastSeen > RECONNECT_GRACE_MS) {
        // Fahrzeuge VOR dem Loeschen freigeben, sonst zeigt vehicle.ownerId
        // danach auf eine Spieler-ID, die es nicht mehr gibt: das Fahrzeug
        // waere fuer alle Zeit weder kaufbar noch auffindbar.
        this.releaseVehiclesOwnedBy(id);
        // Auch aus der Bande austragen - sonst zeigt gang.members auf eine
        // Spieler-ID, die es nicht mehr gibt, und eine verwaiste Bande hielte
        // ihr Gebiet fuer immer.
        if (player.gangId != null) this.leaveGang(id);
        this.players.delete(id);
        this.tokenIndex.delete(player.token);
        this.lastBroadcastMovement.delete(id);
      }
    }
  }

  /**
   * Gibt alle Fahrzeuge eines Spielers zurueck in den freien Bestand.
   *
   * Es gibt nur 8 Fahrzeuge in der ganzen Welt, und sie werden nie nachgebildet.
   * Jedes Fahrzeug, dessen Besitzer verschwindet, ohne dass der Besitz geloest
   * wird, ist dauerhaft aus dem Spiel - bei 20 moeglichen Mitspielern und
   * Reinkarnation als zentralem Wiederholungsmechanismus lief der Bestand so
   * strukturell gegen null.
   */
  releaseVehiclesOwnedBy(playerId) {
    for (const vehicle of [...this.vehicles.values()]) {
      // Auch den Fahrersitz raeumen: sonst gilt das Fahrzeug als besetzt und
      // niemand kann mehr einsteigen.
      if (vehicle.driverId === playerId) vehicle.driverId = null;
      if (vehicle.ownerId !== playerId) continue;

      if (vehicle.spawned) {
        // Neuwagen aus dem Autohaus verschwinden mit ihrem Besitzer. Wuerden
        // sie stattdessen frei im Bestand bleiben, wuechse die Flotte mit jeder
        // Reinkarnation weiter, bis MAX_VEHICLES erreicht ist und niemand mehr
        // einen Neuwagen kaufen koennte.
        if (vehicle.driverId != null) {
          // Faehrt gerade jemand anderes darin (geklaut), muss er erst raus -
          // sonst zeigt dessen vehicleId auf ein geloeschtes Fahrzeug.
          const driver = this.players.get(vehicle.driverId);
          if (driver) this.forceExitVehicle(driver);
        }
        this.vehicles.delete(vehicle.id);
      } else {
        vehicle.ownerId = null; // feste Weltausstattung: zurueck in den Bestand
      }
    }
  }

  /** Wie viele Fahrzeuge besitzt dieser Spieler gerade? */
  ownedVehicleCount(playerId) {
    let n = 0;
    for (const v of this.vehicles.values()) if (v.ownerId === playerId) n++;
    return n;
  }

  /**
   * Kauft einen NEUWAGEN im Autohaus. Anders als buyVehicle (das ein bereits
   * vorhandenes, herrenloses Fahrzeug uebernimmt) entsteht hier ein neues -
   * das ist der einzige Weg, den Bestand ueberhaupt zu vergroessern.
   */
  buyNewVehicle(playerId, typeId) {
    const player = this.players.get(playerId);
    if (!player) return { ok: false, reason: 'not_found' };
    if (this.isJailed(player)) return { ok: false, reason: 'jailed' };
    if (this.isAwaitingReincarnation(player)) return { ok: false, reason: 'dead' };

    const type = findVehicleType(typeId);
    if (!type) return { ok: false, reason: 'not_found' };

    if (this.ownedVehicleCount(playerId) >= MAX_OWNED_VEHICLES) {
      return { ok: false, reason: 'too_many_vehicles' };
    }
    if (this.vehicles.size >= MAX_VEHICLES) return { ok: false, reason: 'fleet_full' };

    const price = newVehiclePrice(type);
    if (player.cash < price) return { ok: false, reason: 'insufficient_funds' };

    const away = this.checkPlaceRequirement(player, 'buyNewVehicle');
    if (away) return away;

    const place = PLACES.find((pl) => pl.id === 'dealership');
    const slot = dealershipSlot(place.position, this.nextVehicleId);
    const id = this.nextVehicleId++;
    const vehicle = {
      id,
      typeId: type.id,
      x: slot.x,
      y: slot.y,
      ownerId: playerId,
      driverId: null,
      spawned: true,
    };
    this.vehicles.set(id, vehicle);

    player.cash -= price;
    return { ok: true, vehicle, typeName: type.name, price };
  }

  /**
   * Wendet eine Client-Eingabe an. Der Client sendet nur gedrückte Tasten,
   * niemals eine Position - die Bewegung wird ausschließlich hier berechnet.
   */
  applyInput(id, input) {
    const player = this.players.get(id);
    if (!player || !player.connected) return;
    if (this.isJailed(player)) return; // Gefaengnisinsassen koennen sich nicht bewegen
    if (this.isAwaitingReincarnation(player)) return; // Verstorbene warten auf die Weiterleben-Aktion

    const keys = input.keys || {};
    const { dx, dy } = keysToWorldDirection(keys, input.cameraYaw);

    // Nur die GEWUENSCHTE Richtung merken - die tatsaechliche Geschwindigkeit
    // wird in stepPositions schrittweise darauf zubewegt (Beschleunigung).
    player.inputDir.x = dx;
    player.inputDir.y = dy;
    player.lastInputAt = Date.now(); // fuer das Timeout-Sicherheitsnetz in stepPositions

    if (typeof input.seq === 'number') {
      player.lastProcessedInput = input.seq;
    }
    player.lastSeen = Date.now();
  }

  /** fastTick: bewegt alle verbundenen Spieler und begrenzt sie auf die Weltgrenzen. */
  stepPositions(dtMs) {
    const dtSec = dtMs / 1000;
    const now = Date.now();
    for (const player of this.players.values()) {
      if (!player.connected) continue;
      if (this.isJailed(player)) {
        // Fest an der Gefaengnis-Position halten, falls die Bewegung mitten im
        // Verhaften noch einen Rest-Impuls hatte.
        player.position.x = JAIL_POSITION.x;
        player.position.y = JAIL_POSITION.y;
        player.velocity.x = 0;
        player.velocity.y = 0;
        player.inputDir.x = 0;
        player.inputDir.y = 0;
        continue;
      }
      if (this.isAwaitingReincarnation(player)) {
        player.velocity.x = 0;
        player.velocity.y = 0;
        player.inputDir.x = 0;
        player.inputDir.y = 0;
        continue;
      }
      // SICHERHEITSNETZ gegen endloses Weiterlaufen: Kommen keine frischen
      // Eingaben mehr (Verbindungsaussetzer, Tab im Hintergrund, verpasstes
      // Tasten-Loslassen), gilt die gemerkte Richtung als veraltet und wird
      // verworfen. Die Figur bremst dann ueber die normale Reibung aus.
      if (player.lastInputAt == null || now - player.lastInputAt > INPUT_TIMEOUT_MS) {
        player.inputDir.x = 0;
        player.inputDir.y = 0;
      }

      // Faehrt der Spieler? Dann gelten die Werte des Fahrzeugs statt der Fusswerte.
      const vehicle = player.vehicleId != null ? this.vehicles.get(player.vehicleId) : null;
      const vType = vehicle ? findVehicleType(vehicle.typeId) : null;

      stepMovement(
        player.position,
        player.velocity,
        player.inputDir.x,
        player.inputDir.y,
        dtSec,
        WORLD_WIDTH,
        WORLD_HEIGHT,
        vType ? vType.speed : undefined,
        vType ? vType.acceleration : undefined,
        vType ? vType.friction : undefined
      );

      // Aus Gebaeuden herausschieben. MUSS im Client identisch passieren.
      resolveCollisions(player.position, player.velocity, this.collisionRects, PLAYER_COLLISION_RADIUS);

      // Das gefahrene Fahrzeug bewegt sich mit dem Fahrer
      if (vehicle) {
        vehicle.x = player.position.x;
        vehicle.y = player.position.y;
      }
    }
  }

  /** slowTick: erhöht die individuelle Lebensuhr nur für aktiv verbundene Spieler. */
  ageConnectedPlayers(dtMs) {
    for (const player of this.players.values()) {
      if (!player.connected) continue;
      player.ageProgress += dtMs * YEARS_PER_MS;
      while (player.ageProgress >= 1) {
        player.ageProgress -= 1;
        player.age += 1;
      }
    }
  }

  /**
   * slowTick: Gesundheit und Zufriedenheit verfallen langsam mit der Zeit -
   * nur fuer verbundene Spieler, genau wie die Alterung. Ohne eigenes Zutun
   * (Krankenhaus, Fitnessstudio) sinken beide Werte irgendwann auf 0; bei
   * Gesundheit ist das der Tod (siehe checkDeaths/DEATH_HEALTH_THRESHOLD).
   */
  applyHealthAndHappinessDecay() {
    for (const player of this.players.values()) {
      if (!player.connected) continue;

      // Freunde bremsen den Zufriedenheitsverfall - aber nur die gerade
      // VERBUNDENEN. Das war der Punkt: `friends` liess sich bisher fuellen,
      // ohne dass es irgendetwas bewirkte. So belohnt die Liste gemeinsames
      // Spielen statt blossem Sammeln von Namen.
      const friendsOnline = (player.friends || []).reduce((n, id) => {
        const f = this.players.get(id);
        return n + (f && f.connected ? 1 : 0);
      }, 0);
      const relief = Math.min(friendsOnline, MAX_FRIENDS_COUNTED) * HAPPINESS_DECAY_RELIEF_PER_FRIEND;
      // Nie unter 0: der Verfall soll sich bremsen lassen, aber nie umkehren.
      const happinessDecay = Math.max(0, HAPPINESS_DECAY_PER_TICK - relief);

      // Auf DREI Nachkommastellen runden, nicht zwei. Zwei genuegten, solange
      // der kleinste Abzug 0,02 war. Der Freundschaftsbonus erzeugt aber Werte
      // wie 0,006 - bei zwei Stellen wuerde 100 - 0,006 auf 99,99 gerundet, der
      // Spieler verloere also 0,01 statt 0,006 und der Bonus verpuffte
      // groesstenteils. Drei Stellen halten die Gleitkomma-Reste weiterhin
      // draussen und bilden alle vorkommenden Abzuege exakt ab.
      player.health = Math.max(0, Math.round((player.health - HEALTH_DECAY_PER_TICK) * 1000) / 1000);
      // Ein eigenes Zuhause haelt die Zufriedenheit ueber einer Untergrenze.
      // Das min() ist wichtig: wer beim Kauf schon DARUNTER liegt, wird nicht
      // sprunghaft hochgesetzt - der Verfall stoppt nur, wo er gerade steht.
      // Sonst waere ein Hauskauf ein sofortiger Zufriedenheitsschub.
      const floor = this.ownsHome(player)
        ? Math.min(player.happiness, HOME_HAPPINESS_FLOOR)
        : 0;
      player.happiness = Math.max(floor, Math.round((player.happiness - happinessDecay) * 1000) / 1000);
    }
  }

  /**
   * Baut die Liste der Bewegungs-Deltas für den fastTick-Broadcast.
   * Enthält NUR Spieler, deren Position/Geschwindigkeit sich seit dem
   * letzten Broadcast verändert hat - kein Full-State über die schnelle Loop.
   */
  buildMovementDeltas() {
    const deltas = [];
    for (const [id, player] of this.players) {
      const current = serializeMovement(player);
      const last = this.lastBroadcastMovement.get(id);
      if (
        !last ||
        last.x !== current.x ||
        last.y !== current.y ||
        last.vx !== current.vx ||
        last.vy !== current.vy
      ) {
        deltas.push({ ...current, lastProcessedInput: player.lastProcessedInput });
        this.lastBroadcastMovement.set(id, current);
      }
    }
    return deltas;
  }

  /** Voller öffentlicher State aller Spieler (für Join und slowTick-Statupdates). */
  buildFullPublicState() {
    const list = [];
    for (const player of this.players.values()) {
      list.push(serializePublic(player));
    }
    return list;
  }

  // ---------------------------------------------------------------------
  // PERSISTENZ: kompletter Zustand zum Speichern/Wiederherstellen über
  // Server-Neustarts hinweg (z.B. bei jedem Render-Deploy). Ohne das wäre
  // nach jedem Update der komplette Fortschritt aller Spieler verloren.
  // ---------------------------------------------------------------------

  /** Baut den vollstaendigen, wiederherstellbaren Weltzustand (fuer Disk-Speicherung). */
  buildFullSnapshot() {
    return {
      version: 1,
      savedAt: Date.now(),
      nextPlayerId: Math.max(0, ...[...this.players.keys()]) + 1,
      nextCompanyId: this.nextCompanyId,
      nextChildId: this.nextChildId,
      players: [...this.players.values()].map(serializeFull),
      properties: [...this.properties.values()].map((p) => ({
        id: p.id,
        ownerId: p.ownerId,
        disabledUntil: p.disabledUntil || null,
        hasAlarm: !!p.hasAlarm,
        insured: !!p.insured,
        level: p.level || 1,
        invested: p.invested || 0,
      })),
      insurancePool: this.insurancePool,
      politics: this.politics,
      market: this.market,
      // Nur das Wetter - die Tageszeit ergibt sich aus der Uhr und laeuft nach
      // einem Neustart nahtlos weiter.
      environment: this.environment,
      news: this.news,
      nextNewsId: this.nextNewsId,
      race: { pot: this.race.pot, seasonEndsAt: this.race.seasonEndsAt, bestTimes: this.race.bestTimes },
      gangs: [...this.gangs.values()],
      nextGangId: this.nextGangId,
      territory: this.territory,
      bankVault: this.bankVault,
      // Fahrzeuge fehlten hier bisher komplett: Besitz und Standort gingen bei
      // JEDEM Neustart verloren, also bei jedem Render-Deploy. Ein gekaufter
      // Sportwagen ($6000) war damit nach dem naechsten Commit weg.
      // driverId wird bewusst NICHT gespeichert - nach einem Neustart ist
      // niemand verbunden, also sitzt auch niemand am Steuer.
      vehicles: [...this.vehicles.values()].map((v) => ({
        id: v.id,
        typeId: v.typeId,
        x: v.x,
        y: v.y,
        ownerId: v.ownerId,
        spawned: !!v.spawned,
      })),
      nextVehicleId: this.nextVehicleId,
      companies: [...this.companies.values()],
      children: [...this.children.values()],
      chatLog: this.chatLog,
    };
  }

  /**
   * Stellt einen zuvor gespeicherten Weltzustand wieder her (beim Serverstart).
   * Alle wiederhergestellten Spieler starten als "nicht verbunden" mit frischem
   * lastSeen (= jetzt) - das gibt ihnen ab dem Moment des Serverstarts die volle
   * Reconnect-Schonfrist, unabhaengig davon, wie lange der Server offline war.
   * @returns {number} Anzahl wiederhergestellter Spieler
   */
  restoreFromSnapshot(snapshot) {
    if (!snapshot || !Array.isArray(snapshot.players)) return 0;

    for (const saved of snapshot.players) {
      const player = {
        ...saved,
        connected: false,
        lastSeen: Date.now(),
        ws: null,
        // Felder absichern, die es in aelteren Spielstaenden noch nicht gab -
        // sonst stuerzt die Bewegung beim ersten Tick ab.
        inputDir: saved.inputDir || { x: 0, y: 0 },
        velocity: saved.velocity || { x: 0, y: 0 },
        position: saved.position || { x: SPAWN_POSITION.x, y: SPAWN_POSITION.y },
        // Aeltere Spielstaende kannten das Fitnessstudio noch nicht - ohne
        // Absicherung waere lastGymAt hier undefined, was die Abklingzeit-
        // Rechnung (Date.now() - lastGymAt) zu NaN macht.
        lastGymAt: saved.lastGymAt || 0,
        lastBribeAt: saved.lastBribeAt || 0,
        // Aeltere Spielstaende hatten das Feld zwar, aber nie gefuellt - eine
        // fehlende Liste wuerde .push() und .length zum Absturz bringen.
        criminalRecord: Array.isArray(saved.criminalRecord) ? saved.criminalRecord : [],
        // Depot: ohne Absicherung waere es undefined und jeder Zugriff darauf
        // ein Absturz statt nur eines falschen Werts.
        portfolio: (saved.portfolio && typeof saved.portfolio === 'object') ? saved.portfolio : {},
        items: (saved.items && typeof saved.items === 'object') ? saved.items : {},
        // Haustier nur uebernehmen, wenn die Art noch existiert - sonst haette
        // der Spieler ein Tier, fuer das es kein Modell und keinen Preis gibt.
        pet: (saved.pet && findSpecies(saved.pet.species))
          ? { species: saved.pet.species, name: String(saved.pet.name || ''),
              lastFedAt: Number(saved.pet.lastFedAt) || Date.now() }
          : null,
        // Ein laufender Rennversuch ueberlebt den Neustart bewusst NICHT: die
        // Uhr lief waehrend der Ausfallzeit weiter und die Zeit waere wertlos.
        race: null,
        gangId: saved.gangId ?? null,
      };

      // Aeltere Spielstaende wurden gespeichert, BEVOR es Gebaeude gab - eine
      // damals gueltige Position kann heute in einer Wand liegen. Dann lieber
      // an den Startpunkt setzen, als den Spieler feststecken zu lassen.
      if (this.isPositionBlocked(player.position)) {
        player.position = { x: SPAWN_POSITION.x, y: SPAWN_POSITION.y };
        player.velocity = { x: 0, y: 0 };
      }

      this.players.set(player.id, player);
      if (player.token) this.tokenIndex.set(player.token, player.id);
    }

    if (typeof snapshot.nextPlayerId === 'number') setNextPlayerId(snapshot.nextPlayerId);
    if (Array.isArray(snapshot.vehicles)) {
      for (const saved of snapshot.vehicles) {
        let vehicle = this.vehicles.get(saved.id);
        if (!vehicle) {
          // Neuwagen aus dem Autohaus existieren in einer frischen Welt nicht -
          // createInitialVehicles legt nur die 8 festen an. Sie muessen beim
          // Laden neu erzeugt werden, sonst waeren gekaufte Autos nach jedem
          // Deploy verschwunden (genau der Fehler, den die Persistenz behebt).
          if (!saved.spawned || !findVehicleType(saved.typeId)) continue;
          vehicle = { id: saved.id, typeId: saved.typeId, x: 0, y: 0, ownerId: null, driverId: null, spawned: true };
          this.vehicles.set(saved.id, vehicle);
        }
        vehicle.ownerId = saved.ownerId ?? null;
        if (typeof saved.x === 'number') vehicle.x = saved.x;
        if (typeof saved.y === 'number') vehicle.y = saved.y;
        // Dieselbe Absicherung wie bei Spielerpositionen: hat ein Update die
        // Stadt veraendert (neue Gebaeude), kann ein gespeicherter Standort
        // jetzt IN einem Gebaeude liegen. Dann zurueck auf den urspruenglichen
        // Parkplatz, statt das Fahrzeug unerreichbar in einer Wand zu lassen.
        if (this.isPositionBlocked({ x: vehicle.x, y: vehicle.y })) {
          const spawn = VEHICLE_SPAWNS.find((sp) => sp.typeId === vehicle.typeId);
          if (spawn) {
            vehicle.x = spawn.x;
            vehicle.y = spawn.y;
          }
        }
        vehicle.driverId = null; // s. o.: nach dem Neustart faehrt niemand
      }
    }

    // Muss NACH dem Wiederherstellen der Fahrzeuge kommen und hoch genug sein,
    // sonst vergibt der Server eine bereits belegte Fahrzeug-ID neu.
    if (typeof snapshot.nextVehicleId === 'number') {
      this.nextVehicleId = Math.max(this.nextVehicleId, snapshot.nextVehicleId);
    }

    if (typeof snapshot.bankVault === 'number') this.bankVault = snapshot.bankVault;
    if (typeof snapshot.insurancePool === 'number') this.insurancePool = snapshot.insurancePool;
    if (Array.isArray(snapshot.gangs)) {
      for (const g of snapshot.gangs) {
        if (!g || typeof g.name !== 'string' || !Array.isArray(g.members)) continue;
        const treasury = Number(g.treasury);
        this.gangs.set(g.id, {
          id: g.id,
          name: g.name,
          leaderId: g.leaderId,
          members: g.members.slice(),
          treasury: Number.isFinite(treasury) && treasury >= 0 ? treasury : 0,
        });
      }
      const nextId = Number(snapshot.nextGangId);
      this.nextGangId = Number.isFinite(nextId) && nextId > 0
        ? nextId
        : Math.max(0, ...this.gangs.keys()) + 1;
    }
    if (snapshot.territory && typeof snapshot.territory === 'object') {
      for (const q of QUADRANTS) {
        const holder = snapshot.territory[q.id];
        // Nur uebernehmen, wenn es die Bande wirklich noch gibt - sonst bliebe
        // ein Gebiet dauerhaft von einer geloeschten Bande belegt und waere fuer
        // niemanden mehr zu beanspruchen.
        this.territory[q.id] = this.gangs.has(holder) ? holder : null;
      }
    }

    if (snapshot.race && typeof snapshot.race === 'object') {
      const pot = Number(snapshot.race.pot);
      this.race.pot = Number.isFinite(pot) && pot >= 0 ? pot : 0;
      const ends = Number(snapshot.race.seasonEndsAt);
      // Ein abgelaufenes Saisonende aus einem alten Spielstand wuerde die
      // Auswertung sofort ausloesen - das ist gewollt, aber ein unsinniger Wert
      // (NaN) wuerde sie fuer immer blockieren.
      this.race.seasonEndsAt = Number.isFinite(ends) ? ends : Date.now() + RACE_SEASON_MS;
      const bt = snapshot.race.bestTimes;
      this.race.bestTimes = (bt && typeof bt === 'object') ? bt : {};
    }

    if (Array.isArray(snapshot.news)) {
      // Nur wohlgeformte Eintraege uebernehmen: eine kaputte Meldung wuerde
      // sonst bei jedem Beitritt mitgeschickt und die Anzeige stoeren.
      this.news = snapshot.news
        .filter((n) => n && typeof n.text === 'string')
        .slice(-NEWS_LIMIT);
      const nextId = Number(snapshot.nextNewsId);
      this.nextNewsId = Number.isFinite(nextId) && nextId > 0
        ? nextId
        : this.news.length + 1;
    }

    if (snapshot.environment && typeof snapshot.environment === 'object') {
      const savedWeather = snapshot.environment.weather;
      // findWeather faellt bei Unbekanntem auf 'klar' zurueck - ein aus einem
      // alten Spielstand geladenes, inzwischen entferntes Wetter wuerde sonst
      // dauerhaft ohne Wirkung haengenbleiben.
      this.environment.weather = findWeather(savedWeather).id;
      const until = Number(snapshot.environment.weatherUntil);
      this.environment.weatherUntil = Number.isFinite(until) ? until : Date.now();
    }

    if (snapshot.market && typeof snapshot.market === 'object') {
      // Kurse einzeln uebernehmen: ein aelterer Spielstand kennt neu
      // hinzugekommene Papiere nicht, und ein fehlender Kurs wuerde jede
      // Rechnung damit zu NaN machen.
      const savedPrices = snapshot.market.prices || {};
      for (const stock of STOCKS) {
        const v = Number(savedPrices[stock.symbol]);
        if (Number.isFinite(v) && v > 0) this.market.prices[stock.symbol] = v;
      }
      const r = Number(snapshot.market.reserve);
      this.market.reserve = Number.isFinite(r) && r >= 0 ? r : 0;
    }

    if (snapshot.politics && typeof snapshot.politics === 'object') {
      // Felder einzeln uebernehmen statt das Objekt zu ersetzen: ein aelterer
      // Spielstand kennt neuere Felder nicht, und ein fehlendes phaseEndsAt
      // wuerde die Wahl fuer immer haengen lassen.
      const saved = snapshot.politics;
      const pol = this.politics;
      pol.phase = saved.phase === 'term' ? 'term' : 'campaign';
      pol.phaseEndsAt = typeof saved.phaseEndsAt === 'number'
        ? saved.phaseEndsAt
        : Date.now() + CAMPAIGN_DURATION_MS;
      pol.mayorId = saved.mayorId ?? null;
      pol.mayorName = saved.mayorName ?? null;
      pol.taxRate = isValidTaxRate(saved.taxRate) ? saved.taxRate : DEFAULT_TAX_RATE;
      pol.candidates = Array.isArray(saved.candidates) ? saved.candidates : [];
      pol.votes = saved.votes && typeof saved.votes === 'object' ? saved.votes : {};
    }
    if (typeof snapshot.nextCompanyId === 'number') this.nextCompanyId = snapshot.nextCompanyId;
    if (typeof snapshot.nextChildId === 'number') this.nextChildId = snapshot.nextChildId;

    if (Array.isArray(snapshot.properties)) {
      for (const saved of snapshot.properties) {
        const property = this.properties.get(saved.id);
        if (property) {
          property.ownerId = saved.ownerId;
          property.disabledUntil = saved.disabledUntil || null;
          property.hasAlarm = !!saved.hasAlarm;
          property.insured = !!saved.insured;
          // Stufe wiederherstellen UND daraus Ertrag/Unterhalt neu berechnen:
          // Immobilien werden beim Start aus den Grundwerten aufgebaut, der
          // Ausbau steckt also nur in dieser Zahl.
          const lvl = Number(saved.level);
          property.level = Number.isFinite(lvl) && lvl >= 1 && lvl <= PROPERTY_LEVELS.length ? lvl : 1;
          const inv = Number(saved.invested);
          property.invested = Number.isFinite(inv) && inv >= 0 ? inv : 0;
          this.applyPropertyLevel(property);
        }
      }
    }

    if (Array.isArray(snapshot.companies)) {
      for (const company of snapshot.companies) {
        // Sitz aus dem gespeicherten INDEX neu bestimmen. Die Stadt wird beim
        // Start deterministisch erzeugt, die Koordinaten koennten sich aber
        // nach einer Weltaenderung verschoben haben - der Index ist die
        // verlaessliche Groesse, die Position wird daraus abgeleitet.
        if (company.siteIndex != null) {
          const site = this.industrialSites.find((s) => s.index === company.siteIndex);
          if (site) company.site = { x: site.x, y: site.y };
          else { company.siteIndex = null; company.site = null; }
        }
        this.companies.set(company.id, company);
      }
    }

    if (Array.isArray(snapshot.children)) {
      for (const child of snapshot.children) this.children.set(child.id, child);
    }

    if (Array.isArray(snapshot.chatLog)) {
      this.chatLog = snapshot.chatLog;
      this.nextChatId = this.chatLog.reduce((max, m) => Math.max(max, m.id + 1), 1);
    }

    return snapshot.players.length;
  }

  /** Merkt sich ein aufgelöstes Event, um kurzfristige Wiederholungen zu vermeiden. */
  rememberEvent(player, eventId) {
    player.recentEventIds.push(eventId);
    if (player.recentEventIds.length > RECENT_EVENT_MEMORY) {
      player.recentEventIds.shift();
    }
  }

  /** Baut aus einer Event-Definition eine konkrete, eindeutige Instanz mit Ablaufzeit. */
  buildEventInstance(def) {
    return {
      instanceId: nextEventInstanceId++,
      eventId: def.id,
      title: def.title,
      text: def.text,
      choices: def.choices.map((c, i) => ({ index: i, label: c.label })),
      effectsByChoice: def.choices.map((c) => c.effects || {}),
      defaultChoiceIndex: def.defaultChoiceIndex || 0,
      responseDurationMs: def.responseDurationMs,
      expiresAt: Date.now() + def.responseDurationMs,
    };
  }

  /**
   * EVENT_TICK: würfelt für verbundene Spieler ohne volle Warteschlange
   * mit kleiner Wahrscheinlichkeit ein neues, altersgerechtes Ereignis.
   */
  rollEventsForConnectedPlayers() {
    for (const player of this.players.values()) {
      if (!player.connected) continue;
      if (player.eventQueue.length >= MAX_EVENT_QUEUE) continue;
      if (Math.random() >= EVENT_ROLL_CHANCE) continue;

      const def = pickEligibleEvent(player, player.recentEventIds);
      if (def) player.eventQueue.push(def);
    }
  }

  /**
   * Rückt für Spieler ohne aktives Event das nächste aus der Warteschlange nach.
   * @returns {Array<{player: object, instance: object}>} neu aktivierte Events
   */
  promoteQueuedEvents() {
    const promoted = [];
    for (const player of this.players.values()) {
      if (!player.connected) continue;
      if (!player.activeEvent && player.eventQueue.length > 0) {
        const def = player.eventQueue.shift();
        const instance = this.buildEventInstance(def);
        player.activeEvent = instance;
        promoted.push({ player, instance });
      }
    }
    return promoted;
  }

  /**
   * EVENT_TICK: prüft, ob aktive Events die Antwortzeit überschritten haben,
   * und wendet in diesem Fall serverseitig die hinterlegte Standardwahl an.
   * @returns {Array} aufgelöste Events (fuer Benachrichtigung des Clients)
   */
  checkExpiredEvents() {
    const now = Date.now();
    const resolved = [];
    for (const player of this.players.values()) {
      if (!player.connected || !player.activeEvent) continue;
      if (player.activeEvent.expiresAt > now) continue;

      const instance = player.activeEvent;
      const idx = instance.defaultChoiceIndex;
      const effects = instance.effectsByChoice[idx] || {};
      applyEffects(player, effects);
      this.rememberEvent(player, instance.eventId);
      player.activeEvent = null;
      resolved.push({
        player,
        instance,
        choiceIndex: idx,
        effects,
        choiceLabel: instance.choices[idx]?.label,
        timedOut: true,
      });
    }
    return resolved;
  }

  /**
   * Wendet eine vom Client gesendete Event-Wahl an. Validiert, dass das
   * Event noch aktiv und die Instanz-ID aktuell ist - der Client kann
   * niemals ein fremdes oder bereits aufgelöstes Event beeinflussen.
   */
  applyEventChoice(playerId, instanceId, choiceIndex) {
    const player = this.players.get(playerId);
    if (!player || !player.activeEvent) return { ok: false, reason: 'no_active_event' };
    if (player.activeEvent.instanceId !== instanceId) return { ok: false, reason: 'stale_event' };

    const instance = player.activeEvent;
    if (
      typeof choiceIndex !== 'number' ||
      choiceIndex < 0 ||
      choiceIndex >= instance.effectsByChoice.length
    ) {
      return { ok: false, reason: 'invalid_choice' };
    }

    const effects = instance.effectsByChoice[choiceIndex];
    applyEffects(player, effects);
    this.rememberEvent(player, instance.eventId);
    player.activeEvent = null;

    return {
      ok: true,
      instanceId,
      effects,
      choiceLabel: instance.choices[choiceIndex]?.label,
      timedOut: false,
    };
  }

  // ---------------------------------------------------------------------
  // WIRTSCHAFT: Immobilien, Firmen, Handel zwischen Spielern
  // ---------------------------------------------------------------------

  buildPropertiesState() {
    return [...this.properties.values()];
  }

  /**
   * Nur die 14 handgesetzten Objekte. Sie tragen als einzige KEIN `kind` -
   * darauf zu pruefen ist die einzige Variante, die auch bei einer weiteren
   * Klasse noch stimmt. Die erste Fassung filterte auf `kind !== 'shop'` und
   * lieferte nach Einfuehrung der Wohnhaeuser prompt 82 statt 14 Objekte.
   */
  curatedProperties() {
    return [...this.properties.values()].filter((p) => !p.kind);
  }

  buildCompaniesState() {
    return [...this.companies.values()].map((c) => ({
      id: c.id,
      ownerId: c.ownerId,
      name: c.name,
      level: c.level || 1,
      employees: (c.employees || []).slice(),
      maxEmployees: this.companyLevel(c).maxEmployees,
      income: this.companyLevel(c).income,
      upkeep: this.companyLevel(c).upkeep,
      upgradeCost: this.nextCompanyLevel(c) ? this.nextCompanyLevel(c).upgradeCost : null,
      // Der Sitz geht an ALLE: die Beschriftung am Gebaeude soll jeder sehen,
      // nicht nur der Besitzer - sonst waere die Stadt fuer Fremde weiterhin
      // anonym.
      site: c.site || null,
    }));
  }

  /** Die Stufendaten einer Firma. Faellt bei unbekannter Stufe auf Stufe 1 zurueck. */
  companyLevel(company) {
    return COMPANY_LEVELS[(company.level || 1) - 1] || COMPANY_LEVELS[0];
  }

  /** Die naechsthoehere Stufe, oder null wenn schon maximal ausgebaut. */
  nextCompanyLevel(company) {
    return COMPANY_LEVELS[(company.level || 1)] || null;
  }

  /** Baut eine eigene Firma eine Stufe aus. */
  upgradeCompany(playerId, companyId) {
    const player = this.players.get(playerId);
    const company = this.companies.get(companyId);
    if (!player || !company) return { ok: false, reason: 'not_found' };
    if (company.ownerId !== playerId) return { ok: false, reason: 'not_owner' };

    const next = this.nextCompanyLevel(company);
    if (!next) return { ok: false, reason: 'max_level' };
    if (player.cash < next.upgradeCost) return { ok: false, reason: 'insufficient_funds' };

    const away = this.checkPlaceRequirement(player, 'upgradeCompany');
    if (away) return away;


    player.cash -= next.upgradeCost;
    company.level = next.level;
    return { ok: true, company, newLevel: next.level, cost: next.upgradeCost };
  }

  /**
   * Bietet einem anderen Spieler eine Anstellung an. Der Angesprochene muss
   * zustimmen - niemand wird ungefragt eingestellt.
   */
  offerEmployment(ownerId, companyId, targetPlayerId) {
    const owner = this.players.get(ownerId);
    const target = this.players.get(targetPlayerId);
    const company = this.companies.get(companyId);
    if (!owner || !target || !company) return { ok: false, reason: 'not_found' };
    if (company.ownerId !== ownerId) return { ok: false, reason: 'not_owner' };
    if (ownerId === targetPlayerId) return { ok: false, reason: 'self_employment' };
    if (company.employees.includes(targetPlayerId)) return { ok: false, reason: 'already_employed_here' };
    if (target.employerCompanyId != null) return { ok: false, reason: 'target_has_employer' };
    if (target.job) return { ok: false, reason: 'target_has_job' };

    const level = this.companyLevel(company);
    if (company.employees.length >= level.maxEmployees) {
      return { ok: false, reason: 'no_free_position' };
    }

    const alreadyPending = [...this.employmentOffers.values()].some(
      (o) => o.companyId === companyId && o.toPlayerId === targetPlayerId
    );
    if (alreadyPending) return { ok: false, reason: 'already_pending' };

    const offer = {
      id: this.nextEmploymentOfferId++,
      companyId,
      fromPlayerId: ownerId,
      toPlayerId: targetPlayerId,
      expiresAt: Date.now() + EMPLOYMENT_OFFER_DURATION_MS,
    };
    this.employmentOffers.set(offer.id, offer);
    return { ok: true, offer, company };
  }

  /** Der Angesprochene nimmt an oder lehnt ab. */
  respondEmployment(playerId, offerId, accept) {
    const offer = this.employmentOffers.get(offerId);
    if (!offer) return { ok: false, reason: 'not_found' };
    if (offer.toPlayerId !== playerId) return { ok: false, reason: 'not_recipient' };

    this.employmentOffers.delete(offerId);
    if (!accept) return { ok: true, accepted: false, offer };

    const player = this.players.get(playerId);
    const company = this.companies.get(offer.companyId);
    if (!player || !company) return { ok: false, reason: 'not_found' };
    if (player.employerCompanyId != null) return { ok: false, reason: 'already_employed' };
    if (player.job) return { ok: false, reason: 'has_job' };

    const level = this.companyLevel(company);
    if (company.employees.length >= level.maxEmployees) {
      return { ok: false, reason: 'no_free_position' };
    }

    company.employees.push(playerId);
    player.employerCompanyId = company.id;
    return { ok: true, accepted: true, offer, company };
  }

  /** Mitarbeiter kuendigt selbst. */
  leaveEmployment(playerId) {
    const player = this.players.get(playerId);
    if (!player) return { ok: false, reason: 'not_found' };
    if (player.employerCompanyId == null) return { ok: false, reason: 'not_employed' };

    const company = this.companies.get(player.employerCompanyId);
    if (company) {
      company.employees = company.employees.filter((id) => id !== playerId);
    }
    player.employerCompanyId = null;
    return { ok: true, company };
  }

  /** Inhaber entlaesst einen Mitarbeiter. */
  dismissEmployee(ownerId, companyId, employeeId) {
    const company = this.companies.get(companyId);
    if (!company) return { ok: false, reason: 'not_found' };
    if (company.ownerId !== ownerId) return { ok: false, reason: 'not_owner' };
    if (!company.employees.includes(employeeId)) return { ok: false, reason: 'not_employed_here' };

    company.employees = company.employees.filter((id) => id !== employeeId);
    const emp = this.players.get(employeeId);
    if (emp) emp.employerCompanyId = null;
    return { ok: true, company, employeeId };
  }

  /** Loest alle Anstellungen einer Firma - beim Schliessen. */
  releaseAllEmployees(company) {
    for (const empId of company.employees || []) {
      const emp = this.players.get(empId);
      if (emp) emp.employerCompanyId = null;
    }
    company.employees = [];
  }

  /** Abgelaufene Anstellungsangebote verfallen lassen. */
  checkExpiredEmploymentOffers() {
    const now = Date.now();
    const expired = [];
    for (const [id, offer] of this.employmentOffers) {
      if (offer.expiresAt <= now) {
        this.employmentOffers.delete(id);
        expired.push(offer);
      }
    }
    return expired;
  }

  /** Kauft eine unbebaute/unbesetzte Immobilie direkt von der Bank. */
  buyProperty(playerId, propertyId) {
    const player = this.players.get(playerId);
    const property = this.properties.get(propertyId);
    if (!player || !property) return { ok: false, reason: 'not_found' };
    if (property.ownerId) return { ok: false, reason: 'already_owned' };
    if (player.cash < property.price) return { ok: false, reason: 'insufficient_funds' };

    if (property.kind === 'shop' && this.ownedShopCount(playerId) >= MAX_OWNED_SHOPS) {
      return { ok: false, reason: 'too_many_shops' };
    }
    if (property.kind === 'home' && this.ownedHomeCount(playerId) >= MAX_OWNED_HOMES) {
      return { ok: false, reason: 'already_has_home' };
    }

    const away = this.checkPlaceRequirement(player, 'buyProperty');
    if (away) return away;

    player.cash -= property.price;
    property.ownerId = playerId;
    return { ok: true, property };
  }

  /** Verkauft eine eigene Immobilie zurueck an die Bank (reduzierter Preis, kein Arbitrage-Exploit). */
  sellPropertyToBank(playerId, propertyId) {
    const player = this.players.get(playerId);
    const property = this.properties.get(propertyId);
    if (!player || !property) return { ok: false, reason: 'not_found' };
    if (property.ownerId !== playerId) return { ok: false, reason: 'not_owner' };

    const away = this.checkPlaceRequirement(player, 'sellProperty');
    if (away) return away;

    // Auch das Investierte anteilig erstatten - sonst waere jeder Ausbau beim
    // Verkauf ein Totalverlust.
    const refund = Math.round((property.price + (property.invested || 0)) * PROPERTY_SELL_BACK_RATIO);
    player.cash += refund;
    this.returnPropertyToBank(property);
    return { ok: true, refund, property };
  }

  /** Gründet eine neue Firma fuer den Spieler. Kein Limit an der Gesamtzahl - anders als Immobilien. */
  /** Der naechste unbesetzte Firmensitz, oder null wenn alle vergeben sind. */
  findFreeIndustrialSite() {
    const taken = new Set([...this.companies.values()].map((c) => c.siteIndex));
    return this.industrialSites.find((s) => !taken.has(s.index)) || null;
  }

  /** Wie viele Firmen besitzt dieser Spieler gerade? */
  ownedCompanyCount(playerId) {
    let n = 0;
    for (const c of this.companies.values()) if (c.ownerId === playerId) n++;
    return n;
  }

  foundCompany(playerId, name) {
    const player = this.players.get(playerId);
    if (!player) return { ok: false, reason: 'not_found' };
    if (player.cash < COMPANY_FOUNDING_COST) return { ok: false, reason: 'insufficient_funds' };
    if (this.ownedCompanyCount(playerId) >= MAX_OWNED_COMPANIES) {
      return { ok: false, reason: 'too_many_companies' };
    }

    const away = this.checkPlaceRequirement(player, 'foundCompany');
    if (away) return away;

    // Freien Firmensitz suchen. Ist keiner mehr da, kann auch keine Firma mehr
    // gegruendet werden - eine natuerliche Obergrenze aus der Welt selbst
    // statt einer weiteren Konstanten.
    const site = this.findFreeIndustrialSite();
    if (!site) return { ok: false, reason: 'no_site_left' };

    player.cash -= COMPANY_FOUNDING_COST;
    const company = {
      id: this.nextCompanyId++,
      ownerId: playerId,
      name: name && String(name).trim() ? String(name).trim().slice(0, 30) : 'Neue Firma',
      level: 1,
      employees: [], // Spieler-IDs
      siteIndex: site.index,
      site: { x: site.x, y: site.y },
    };
    this.companies.set(company.id, company);
    return { ok: true, company };
  }

  /** Schliesst eine eigene Firma, mit Teilrueckerstattung. */
  closeCompany(playerId, companyId) {
    const player = this.players.get(playerId);
    const company = this.companies.get(companyId);
    if (!player || !company) return { ok: false, reason: 'not_found' };
    if (company.ownerId !== playerId) return { ok: false, reason: 'not_owner' };

    this.releaseAllEmployees(company); // sonst haengen Mitarbeiter an einer Firma, die es nicht mehr gibt
    const refund = Math.round(COMPANY_FOUNDING_COST * COMPANY_CLOSE_REFUND_RATIO);
    player.cash += refund;
    this.companies.delete(companyId);
    return { ok: true, refund };
  }

  /**
   * Wird im slowTick aufgerufen: zieht Einnahmen minus Instandhaltung fuer alle
   * Immobilien und Firmen ein. Das ist die Geld-SENKE, die verhindert, dass
   * Vermoegen unbegrenzt waechst. Kann sich ein Spieler die Instandhaltung nicht
   * mehr leisten, wird die Immobilie zwangsversteigert (zurueck an die Bank, kein
   * Erloes) statt den Spieler ins Minus rutschen zu lassen.
   */
  collectEconomyIncome() {
    const repossessed = [];
    const quits = []; // Mitarbeiter, die wegen unbezahlter Loehne gehen

    for (const property of this.properties.values()) {
      if (!property.ownerId) continue;
      const owner = this.players.get(property.ownerId);
      if (!owner) {
        this.returnPropertyToBank(property); // Besitzer existiert nicht mehr (sollte selten vorkommen)
        continue;
      }
      // Nach einem Einbruch faellt der Ertrag zeitweise aus - die Instandhaltung
      // laeuft aber weiter. Genau dieser Ausfall ist die Beute des Einbrechers.
      const disabled = property.disabledUntil && property.disabledUntil > Date.now();

      // Schutzkosten laufen weiter, auch waehrend der Ertrag ausfaellt - sonst
      // waere ein Einbruch fuer den Besitzer teilweise ein Vorteil.
      const alarmCost = property.hasAlarm ? alarmUpkeep(property) : 0;
      const premium = property.insured ? insurancePremium(property) : 0;
      // Die Praemie verschwindet nicht, sie wandert in den Topf, aus dem
      // Entschaedigungen gezahlt werden.
      this.insurancePool += premium;

      const net = (disabled ? 0 : property.incomePerTick)
        - property.maintenancePerTick - alarmCost - premium;
      if (owner.cash + net < 0) {
        this.returnPropertyToBank(property);
        repossessed.push({ type: 'property', asset: property, player: owner });
        continue;
      }
      owner.cash += net;
    }

    for (const company of this.companies.values()) {
      const owner = this.players.get(company.ownerId);
      if (!owner) continue; // Firma bleibt bestehen, falls Besitzer (noch) nicht online

      const level = this.companyLevel(company);
      let net = level.income - level.upkeep;

      // Mitarbeiter bringen Ertrag, kosten aber Lohn. Kann der Inhaber die
      // Loehne nicht zahlen, kuendigen die Betroffenen von selbst - sonst
      // koennte man unbegrenzt Leute beschaeftigen, ohne sie zu bezahlen.
      const stillEmployed = [];
      for (const empId of company.employees) {
        const emp = this.players.get(empId);
        if (!emp) continue;

        const affordable = owner.cash + owner.bank >= EMPLOYEE_WAGE_PER_TICK;
        if (!affordable) {
          emp.employerCompanyId = null;
          quits.push({ employee: emp, company, reason: 'unpaid' });
          continue;
        }

        const fromCash = Math.min(owner.cash, EMPLOYEE_WAGE_PER_TICK);
        owner.cash -= fromCash;
        owner.bank -= (EMPLOYEE_WAGE_PER_TICK - fromCash);
        emp.cash += EMPLOYEE_WAGE_PER_TICK;

        net += EMPLOYEE_INCOME_PER_TICK;
        stillEmployed.push(empId);
      }
      company.employees = stillEmployed;

      owner.cash = Math.max(0, owner.cash + net);
    }

    return { repossessed, quits };
  }

  /**
   * Die eigentliche Geld-SENKE: kleine Steuer auf das Barvermoegen selbst,
   * unabhaengig von Immobilien-/Firmenbesitz. Ohne das wuerde Vermoegen bei
   * Besitz von profitablen Immobilien/Firmen unbegrenzt wachsen.
   */
  applyWealthTax() {
    for (const player of this.players.values()) {
      if (!player.connected) continue;
      // BEIDES besteuern - waere nur Bargeld betroffen, wuerden alle ihr Geld
      // einfach auf die Bank schieben und die Steuer liefe ins Leere.
      // Der Satz ist nicht mehr fest, sondern das, was der gewaehlte
      // Buergermeister eingestellt hat (ohne Amtsinhaber: der alte Festwert).
      const rate = this.currentTaxRate();

      let collected = 0;
      if (player.cash > 0) {
        const after = Math.max(0, Math.round(player.cash * (1 - rate)));
        collected += player.cash - after;
        player.cash = after;
      }
      if (player.bank > 0) {
        const after = Math.max(0, Math.round(player.bank * (1 - rate)));
        collected += player.bank - after;
        player.bank = after;
      }

      // DEPOTGEBUEHR - schliesst dasselbe Loch, wegen dem schon das Bankguthaben
      // besteuert wird: sonst schiebt man sein Vermoegen einfach dorthin, wo die
      // Steuer nicht hinreicht, und sie laeuft ins Leere. Nach Einfuehrung der
      // Boerse war das Depot genau so ein steuerfreier Tresor - mit Platz fuer
      // ein Vielfaches der teuersten Immobilie und jederzeit liquide.
      //
      // Die Gebuehr wird NICHT durch Zwangsverkauf beglichen: eine Auszahlung
      // haengt am Kassenbestand der Boerse und koennte gar nicht gedeckt sein.
      // Stattdessen aus Bargeld, dann Guthaben - und was dann noch fehlt, wird
      // zu Schulden. Damit kann sich niemand durch "alles in Aktien, kein Geld"
      // der Abgabe entziehen; die Schuld verzinst sich wie jede andere.
      const depotFee = Math.round(this.portfolioValue(player) * rate);
      if (depotFee > 0) {
        let owed = depotFee;
        const fromCash = Math.min(player.cash, owed);
        player.cash -= fromCash; owed -= fromCash;
        const fromBank = Math.min(player.bank, owed);
        player.bank -= fromBank; owed -= fromBank;
        if (owed > 0) player.debt += owed;
        collected += depotFee;
      }

      if (collected <= 0) continue;

      // Amtsbezuege zuerst - daher der Interessenkonflikt: der Buergermeister
      // verdient an einem hohen Satz, den alle anderen zahlen. Er selbst zahlt
      // ihn allerdings auch, sonst waere das Amt eine reine Gelddruckmaschine.
      let remaining = collected;
      const mayor = this.politics.mayorId != null ? this.players.get(this.politics.mayorId) : null;
      if (mayor) {
        const salary = Math.round(collected * MAYOR_TAX_SHARE);
        mayor.cash += salary;
        remaining -= salary;
      }

      // Vom Rest wandert ein Teil in den Banktresor (Beute fuer Ueberfaelle),
      // der Rest verschwindet als Geld-Senke.
      this.bankVault += Math.round(remaining * VAULT_TAX_SHARE);
    }
  }

  // ---------------------------------------------------------------------
  // BANDEN: Gruendung, Mitglieder, Kasse, Territorium
  // ---------------------------------------------------------------------

  gangOf(player) {
    if (!player || player.gangId == null) return null;
    return this.gangs.get(player.gangId) || null;
  }

  buildGangState(playerId) {
    const player = playerId != null ? this.players.get(playerId) : null;
    const mine = this.gangOf(player);
    return {
      // Alle Banden mit Namen und Groesse - man soll sehen, wem man beitreten
      // koennte und wer die Gebiete haelt. Die Kasse ist NUR fuer die eigenen
      // Mitglieder sichtbar, sonst waere jede Bande ein Preisschild fuer Diebe.
      gangs: [...this.gangs.values()].map((g) => ({
        id: g.id,
        name: g.name,
        leaderId: g.leaderId,
        memberCount: g.members.length,
        maxMembers: MAX_GANG_MEMBERS,
      })),
      myGang: mine ? {
        id: mine.id,
        name: mine.name,
        leaderId: mine.leaderId,
        treasury: Math.floor(mine.treasury),
        members: mine.members
          .map((id) => this.players.get(id))
          .filter(Boolean)
          .map((p) => ({ id: p.id, name: p.name, connected: p.connected })),
      } : null,
      territory: QUADRANTS.map((q) => {
        const holder = this.territory[q.id] != null ? this.gangs.get(this.territory[q.id]) : null;
        return { id: q.id, name: q.name, gangId: holder ? holder.id : null, gangName: holder ? holder.name : null };
      }),
      foundingCost: GANG_FOUNDING_COST,
      claimCost: TERRITORY_CLAIM_COST,
      upkeep: TERRITORY_UPKEEP_PER_TICK,
    };
  }

  foundGang(playerId, rawName) {
    const player = this.players.get(playerId);
    if (!player) return { ok: false, reason: 'not_found' };
    if (this.isJailed(player)) return { ok: false, reason: 'jailed' };
    if (player.gangId != null) return { ok: false, reason: 'already_in_gang' };

    const name = String(rawName || '').trim().slice(0, MAX_GANG_NAME_LENGTH);
    if (name.length < 3) return { ok: false, reason: 'invalid_name' };
    if ([...this.gangs.values()].some((g) => g.name.toLowerCase() === name.toLowerCase())) {
      return { ok: false, reason: 'name_taken' };
    }
    if (player.cash < GANG_FOUNDING_COST) return { ok: false, reason: 'insufficient_funds' };

    const away = this.checkPlaceRequirement(player, 'foundGang');
    if (away) return away;

    player.cash -= GANG_FOUNDING_COST;
    const id = this.nextGangId++;
    this.gangs.set(id, { id, name, leaderId: playerId, members: [playerId], treasury: 0 });
    player.gangId = id;
    return { ok: true, gang: this.gangs.get(id), player };
  }

  joinGang(playerId, gangId) {
    const player = this.players.get(playerId);
    const gang = this.gangs.get(gangId);
    if (!player || !gang) return { ok: false, reason: 'not_found' };
    if (player.gangId != null) return { ok: false, reason: 'already_in_gang' };
    if (gang.members.length >= MAX_GANG_MEMBERS) return { ok: false, reason: 'gang_full' };

    gang.members.push(playerId);
    player.gangId = gang.id;
    return { ok: true, gang, player };
  }

  /**
   * Austritt. Verlaesst der Anfuehrer, rueckt das aelteste verbleibende Mitglied
   * nach; ist niemand mehr da, wird die Bande aufgeloest UND ihr Territorium
   * freigegeben - sonst blieben Gebiete fuer immer von einer Bande gehalten,
   * die es nicht mehr gibt.
   */
  leaveGang(playerId) {
    const player = this.players.get(playerId);
    if (!player) return { ok: false, reason: 'not_found' };
    const gang = this.gangOf(player);
    if (!gang) return { ok: false, reason: 'not_in_gang' };

    gang.members = gang.members.filter((id) => id !== playerId);
    player.gangId = null;

    if (gang.members.length === 0) {
      this.disbandGang(gang.id);
      return { ok: true, disbanded: true, gangName: gang.name, player };
    }
    if (gang.leaderId === playerId) gang.leaderId = gang.members[0];
    return { ok: true, disbanded: false, gangName: gang.name, player };
  }

  /** Loest eine Bande auf und gibt ihre Gebiete frei. */
  disbandGang(gangId) {
    for (const q of QUADRANTS) {
      if (this.territory[q.id] === gangId) this.territory[q.id] = null;
    }
    for (const p of this.players.values()) {
      if (p.gangId === gangId) p.gangId = null;
    }
    this.gangs.delete(gangId);
  }

  /** Zahlt Bargeld in die Bandenkasse ein. Ortsungebunden - Einzahlen ist nie das Problem. */
  depositToGang(playerId, amount) {
    const player = this.players.get(playerId);
    if (!player) return { ok: false, reason: 'not_found' };
    const gang = this.gangOf(player);
    if (!gang) return { ok: false, reason: 'not_in_gang' };

    const amt = Math.floor(Number(amount));
    if (!Number.isFinite(amt) || amt <= 0) return { ok: false, reason: 'invalid_amount' };
    if (player.cash < amt) return { ok: false, reason: 'insufficient_funds' };

    player.cash -= amt;
    gang.treasury += amt;
    return { ok: true, amount: amt, treasury: gang.treasury, player };
  }

  /** Nimmt Geld aus der Kasse. NUR der Anfuehrer - sonst waere die Kasse eine Selbstbedienung. */
  withdrawFromGang(playerId, amount) {
    const player = this.players.get(playerId);
    if (!player) return { ok: false, reason: 'not_found' };
    const gang = this.gangOf(player);
    if (!gang) return { ok: false, reason: 'not_in_gang' };
    if (gang.leaderId !== playerId) return { ok: false, reason: 'not_leader' };

    const amt = Math.floor(Number(amount));
    if (!Number.isFinite(amt) || amt <= 0) return { ok: false, reason: 'invalid_amount' };
    if (gang.treasury < amt) return { ok: false, reason: 'insufficient_funds' };

    gang.treasury -= amt;
    player.cash += amt;
    return { ok: true, amount: amt, treasury: gang.treasury, player };
  }

  /** Beansprucht ein freies Gebiet. Bezahlt wird aus der Bandenkasse, nicht privat. */
  claimTerritory(playerId, quadrantId) {
    const player = this.players.get(playerId);
    if (!player) return { ok: false, reason: 'not_found' };
    const gang = this.gangOf(player);
    if (!gang) return { ok: false, reason: 'not_in_gang' };
    if (gang.leaderId !== playerId) return { ok: false, reason: 'not_leader' };

    const quad = findQuadrant(quadrantId);
    if (!quad) return { ok: false, reason: 'not_found' };
    if (this.territory[quad.id] != null) return { ok: false, reason: 'territory_taken' };
    if (gang.treasury < TERRITORY_CLAIM_COST) return { ok: false, reason: 'insufficient_funds' };

    const away = this.checkPlaceRequirement(player, 'claimTerritory');
    if (away) return away;

    gang.treasury -= TERRITORY_CLAIM_COST;
    this.territory[quad.id] = gang.id;
    return { ok: true, quadrant: quad.name, quadrantId: quad.id, gang, player };
  }

  /**
   * Zieht bei jedem langsamen Tick den Unterhalt aller gehaltenen Gebiete ein.
   * Reicht die Kasse nicht, geht das Gebiet verloren - das ist der einzige Weg,
   * wie Territorium den Besitzer wechselt, und er braucht keinen Kampf.
   */
  chargeTerritoryUpkeep() {
    const lost = [];
    for (const q of QUADRANTS) {
      const gangId = this.territory[q.id];
      if (gangId == null) continue;
      const gang = this.gangs.get(gangId);
      if (!gang) { this.territory[q.id] = null; continue; }

      if (gang.treasury < TERRITORY_UPKEEP_PER_TICK) {
        this.territory[q.id] = null;
        lost.push({ gangName: gang.name, quadrant: q.name });
        continue;
      }
      gang.treasury -= TERRITORY_UPKEEP_PER_TICK;
    }
    return lost;
  }

  /** Haelt die Bande dieses Spielers den Quadranten an dieser Position? */
  controlsPositionOf(player, x, y) {
    const gang = this.gangOf(player);
    if (!gang) return false;
    const quad = quadrantAt(x, y);
    // Ausserhalb des Stadtkerns gibt es kein Territorium - null als
    // Schluessel wuerde sonst undefined liefern und der Vergleich waere
    // zufaellig falsch statt bewusst falsch.
    if (!quad) return false;
    return this.territory[quad] === gang.id;
  }

  // ---------------------------------------------------------------------
  // RENNEN: Zeitfahren auf dem Rundkurs
  // ---------------------------------------------------------------------

  buildRaceState() {
    const board = Object.entries(this.race.bestTimes)
      .map(([id, r]) => ({ playerId: Number(id), name: r.name, ms: r.ms }))
      .sort((a, b) => a.ms - b.ms)
      .slice(0, 10);
    return {
      pot: Math.floor(this.race.pot),
      seasonEndsAt: this.race.seasonEndsAt,
      entryFee: RACE_ENTRY_FEE,
      checkpoints: CHECKPOINTS,
      checkpointRadius: CHECKPOINT_RADIUS,
      lapLength: lapLength(),
      board,
    };
  }

  /**
   * Meldet zum Zeitfahren an. Die Uhr laeuft NICHT sofort los, sondern erst am
   * ersten Kontrollpunkt - sonst muesste man beim Bezahlen schon an der Linie
   * stehen, und die Rennleitung liegt zwangslaeufig woanders (Orte sitzen auf
   * Blockmitten, die Strecke auf Strassen).
   */
  enterRace(playerId) {
    const player = this.players.get(playerId);
    if (!player) return { ok: false, reason: 'not_found' };
    if (this.isJailed(player)) return { ok: false, reason: 'jailed' };
    if (this.isAwaitingReincarnation(player)) return { ok: false, reason: 'dead' };
    if (player.race && player.race.armed) return { ok: false, reason: 'already_entered' };
    if (player.cash < RACE_ENTRY_FEE) return { ok: false, reason: 'insufficient_funds' };

    const away = this.checkPlaceRequirement(player, 'enterRace');
    if (away) return away;

    player.cash -= RACE_ENTRY_FEE;
    this.race.pot += RACE_ENTRY_FEE;
    player.race = { armed: true, armedAt: Date.now(), startedAt: null, nextCheckpoint: 0 };
    return { ok: true, fee: RACE_ENTRY_FEE, player };
  }

  /**
   * Prueft bei jedem schnellen Tick, ob angemeldete Fahrer einen Kontrollpunkt
   * erreicht haben. Gibt abgeschlossene Laeufe zurueck.
   *
   * Man MUSS im Fahrzeug sitzen - zu Fuss abzukuerzen waere sonst schneller als
   * jede Route ueber die Strassen.
   */
  updateRaces() {
    const now = Date.now();
    const finished = [];

    for (const player of this.players.values()) {
      const r = player.race;
      if (!r || !r.armed) continue;

      // Abgelaufene Anmeldung verfaellt - das Startgeld bleibt im Topf.
      if (now - r.armedAt > RACE_TIMEOUT_MS) {
        player.race = null;
        continue;
      }
      if (player.vehicleId == null) continue;

      // Ziel ist der naechste Kontrollpunkt; nach dem letzten zaehlt die
      // Startlinie erneut - erst dann ist es eine VOLLE Runde. Ohne diesen
      // Schlussabschnitt waere die gefahrene Strecke nur drei von vier Seiten
      // des Rundkurses, und die ausgewiesene Rundenlaenge stimmte nicht.
      const cp = CHECKPOINTS[r.nextCheckpoint % CHECKPOINTS.length];
      const dist = Math.hypot(player.position.x - cp.x, player.position.y - cp.y);
      if (dist > CHECKPOINT_RADIUS) continue;

      if (r.nextCheckpoint === 0 && r.startedAt == null) {
        // Erster Kontrollpunkt: die Uhr laeuft ab jetzt.
        r.startedAt = now;
        r.nextCheckpoint = 1;
        continue;
      }

      r.nextCheckpoint += 1;
      if (r.nextCheckpoint <= CHECKPOINTS.length) continue;

      const ms = now - r.startedAt;
      player.race = null;
      const previous = this.race.bestTimes[player.id];
      const improved = !previous || ms < previous.ms;
      if (improved) this.race.bestTimes[player.id] = { name: player.name, ms };
      finished.push({ player, ms, improved, previousMs: previous ? previous.ms : null });
    }

    return finished;
  }

  /**
   * Beendet eine Saison, wenn sie abgelaufen ist: der Topf geht an die
   * Bestzeit. Ohne Teilnehmer bleibt er stehen und waechst weiter - das macht
   * die naechste Saison umso lohnender.
   */
  advanceRaceSeason() {
    const now = Date.now();
    if (now < this.race.seasonEndsAt) return null;

    this.race.seasonEndsAt = now + RACE_SEASON_MS;

    const entries = Object.entries(this.race.bestTimes)
      .map(([id, r]) => ({ playerId: Number(id), name: r.name, ms: r.ms }))
      .sort((a, b) => a.ms - b.ms);

    if (entries.length === 0) return { type: 'no_winner', pot: Math.floor(this.race.pot) };

    const winner = entries[0];
    const prize = Math.floor(this.race.pot);
    this.race.bestTimes = {};
    this.race.pot = 0;

    const player = this.players.get(winner.playerId);
    if (player) player.cash += prize;
    // Ist der Sieger nicht mehr da, verfaellt der Topf - er kam aus
    // Startgeldern und darf nicht doppelt ausgeschuettet werden.
    return { type: 'winner', name: winner.name, ms: winner.ms, prize };
  }

  // ---------------------------------------------------------------------
  // HAUSTIERE
  // ---------------------------------------------------------------------

  buildPetState(playerId) {
    const player = playerId != null ? this.players.get(playerId) : null;
    const pet = player && player.pet ? player.pet : null;
    return {
      species: buildSpeciesCatalog(),
      feedCost: FEED_COST,
      pet: pet ? {
        species: pet.species,
        speciesName: (findSpecies(pet.species) || {}).name || pet.species,
        name: pet.name,
        lastFedAt: pet.lastFedAt,
        // Verbleibende Zeit bis zum Weglaufen - der Client kann daraus warnen,
        // statt dass das Tier eines Tages kommentarlos verschwindet.
        neglectAt: pet.lastFedAt + NEGLECT_TIMEOUT_MS,
      } : null,
    };
  }

  /** Kauft ein Haustier. Braucht ein eigenes Zuhause - wie ein Kind. */
  buyPet(playerId, speciesId, name) {
    const player = this.players.get(playerId);
    const species = findSpecies(speciesId);
    if (!player || !species) return { ok: false, reason: 'not_found' };
    if (this.isJailed(player)) return { ok: false, reason: 'jailed' };
    if (this.isAwaitingReincarnation(player)) return { ok: false, reason: 'dead' };
    if (player.pet) return { ok: false, reason: 'already_has_pet' };
    if (!this.ownsHome(player)) return { ok: false, reason: 'no_home' };
    if (player.cash < species.price) return { ok: false, reason: 'insufficient_funds' };

    const away = this.checkPlaceRequirement(player, 'buyPet');
    if (away) return away;

    player.cash -= species.price;
    player.pet = {
      species: species.id,
      name: name && String(name).trim()
        ? String(name).trim().slice(0, MAX_PET_NAME_LENGTH)
        : species.name,
      // Frisch gekauft gilt als gerade gefuettert, sonst liefe die Frist ab
      // dem Nullpunkt und das Tier waere sofort in Gefahr.
      lastFedAt: Date.now(),
    };
    return { ok: true, species: species.name, petName: player.pet.name, price: species.price, player };
  }

  /** Fuettern: kostet wenig, gibt Zufriedenheit, setzt die Frist zurueck. */
  feedPet(playerId) {
    const player = this.players.get(playerId);
    if (!player) return { ok: false, reason: 'not_found' };
    if (!player.pet) return { ok: false, reason: 'no_pet' };
    if (this.isAwaitingReincarnation(player)) return { ok: false, reason: 'dead' };

    const now = Date.now();
    if (now - player.pet.lastFedAt < FEED_COOLDOWN_MS) return { ok: false, reason: 'too_soon' };
    if (player.cash < FEED_COST) return { ok: false, reason: 'insufficient_funds' };

    player.cash -= FEED_COST;
    player.pet.lastFedAt = now;
    player.happiness = Math.min(100, player.happiness + FEED_HAPPINESS_GAIN);
    return { ok: true, cost: FEED_COST, petName: player.pet.name, newHappiness: player.happiness, player };
  }

  /**
   * Laufen lange nicht gefuetterte Tiere weg. Wird im langsamen Takt geprueft
   * und gibt die Betroffenen zurueck, damit sie benachrichtigt werden koennen.
   *
   * Bewusst auch fuer NICHT verbundene Spieler: sonst waere Abmelden die
   * bequemste Art, sich um die Verpflichtung zu druecken.
   */
  checkNeglectedPets() {
    const now = Date.now();
    const runaways = [];
    for (const player of this.players.values()) {
      if (!player.pet) continue;
      if (now - player.pet.lastFedAt < NEGLECT_TIMEOUT_MS) continue;
      runaways.push({ player, petName: player.pet.name });
      player.pet = null;
    }
    return runaways;
  }

  // ---------------------------------------------------------------------
  // SCHWARZMARKT: Waren kaufen und benutzen
  // ---------------------------------------------------------------------

  /** Katalog samt eigenem Bestand. */
  buildBlackmarketState(playerId) {
    const player = playerId != null ? this.players.get(playerId) : null;
    const owned = (player && player.items) || {};
    return {
      items: buildItemCatalog().map((i) => ({ ...i, owned: owned[i.id] || 0 })),
    };
  }

  /** Besitzt der Spieler diese Ware? */
  hasItem(player, itemId) {
    return !!(player && player.items && player.items[itemId] > 0);
  }

  /** Verbraucht eine Ware. Gibt false zurueck, wenn keine da war. */
  consumeItem(player, itemId) {
    if (!this.hasItem(player, itemId)) return false;
    player.items[itemId] -= 1;
    if (player.items[itemId] <= 0) delete player.items[itemId];
    return true;
  }

  /**
   * Kauft eine Ware. Der Einkauf ist selbst strafbar: mit BUST_CHANCE wird man
   * dabei beobachtet und das Fahndungslevel steigt - die Ware bekommt man
   * trotzdem, es ist ein Risikozuschlag und kein Fehlschlag.
   */
  buyIllegalItem(playerId, itemId) {
    const player = this.players.get(playerId);
    const item = findItem(itemId);
    if (!player || !item) return { ok: false, reason: 'not_found' };
    if (this.isJailed(player)) return { ok: false, reason: 'jailed' };
    if (this.isAwaitingReincarnation(player)) return { ok: false, reason: 'dead' };

    if (!player.items) player.items = {};
    // Dauerhafte Waren nur einmal - ein zweiter Scanner bringt nichts.
    if (!item.consumable && this.hasItem(player, itemId)) {
      return { ok: false, reason: 'already_owned' };
    }
    if (player.cash < item.price) return { ok: false, reason: 'insufficient_funds' };

    const away = this.checkPlaceRequirement(player, 'buyIllegalItem');
    if (away) return away;

    player.cash -= item.price;
    player.items[itemId] = (player.items[itemId] || 0) + 1;

    let busted = false;
    if (Math.random() < BUST_CHANCE) {
      busted = true;
      player.wanted += BUST_WANTED;
      player.lastCrimeAt = Date.now();
    }

    return { ok: true, item: item.name, itemId, price: item.price, busted, player };
  }

  /** Benutzt gefaelschte Papiere: Fahndung sofort auf 0, ohne Weg und ohne Risiko. */
  useForgedPapers(playerId) {
    const player = this.players.get(playerId);
    if (!player) return { ok: false, reason: 'not_found' };
    if (this.isAwaitingReincarnation(player)) return { ok: false, reason: 'dead' };
    if (player.wanted <= 0) return { ok: false, reason: 'not_wanted' };
    if (!this.hasItem(player, 'papers')) return { ok: false, reason: 'no_papers' };

    this.consumeItem(player, 'papers');
    player.wanted = 0;
    return { ok: true, player };
  }

  // ---------------------------------------------------------------------
  // STADTNACHRICHTEN
  // ---------------------------------------------------------------------

  /**
   * Traegt eine Meldung ein und gibt sie zurueck, damit der Aufrufer sie
   * verschicken kann. Aeltere fallen hinten raus.
   *
   * Taeternamen gehoeren NICHT hier hinein - siehe Kopfkommentar in news.js.
   */
  pushNews(kind, text) {
    const item = { id: this.nextNewsId++, at: Date.now(), kind, text };
    this.news.push(item);
    if (this.news.length > NEWS_LIMIT) this.news = this.news.slice(-NEWS_LIMIT);
    return item;
  }

  /** Die vorgehaltenen Meldungen, juengste zuletzt. */
  buildNewsState() {
    return { items: this.news.slice() };
  }

  // ---------------------------------------------------------------------
  // UMWELT: Tageszeit und Wetter
  // ---------------------------------------------------------------------

  /**
   * Wechselt bei Bedarf die Wetterlage. Gibt die neue Lage zurueck, wenn sich
   * etwas geaendert hat - sonst null, damit nicht bei jedem Tick gesendet wird.
   */
  updateWeather() {
    const now = Date.now();
    if (now < this.environment.weatherUntil) return null;
    const previous = this.environment.weather;
    this.environment.weather = pickWeather();
    this.environment.weatherUntil = now + WEATHER_DURATION_MS;
    return this.environment.weather !== previous ? this.environment.weather : null;
  }

  /** Aktueller Umweltzustand samt wirksamer Faktoren. */
  buildEnvironmentState() {
    const now = Date.now();
    const day = getDayPhase(now);
    const weather = findWeather(this.environment.weather);
    const effects = environmentEffects(day.phase, this.environment.weather);
    return {
      phase: day.phase,
      progress: Math.round(day.progress * 1000) / 1000,
      phaseEndsAt: day.endsAt,
      weather: weather.id,
      weatherName: weather.name,
      weatherUntil: this.environment.weatherUntil,
      // Mitschicken, damit die Oberflaeche erklaeren kann, WARUM die Polizei
      // gerade schlechter sieht - sonst wirkt der Unterschied zufaellig.
      policeRangeMult: effects.policeRangeMult,
      policeSpeedMult: effects.policeSpeedMult,
    };
  }

  // ---------------------------------------------------------------------
  // BOERSE: Kurse, Kauf, Verkauf
  // ---------------------------------------------------------------------

  /** Kurswert des Depots eines Spielers. */
  portfolioValue(player) {
    if (!player || !player.portfolio) return 0;
    let sum = 0;
    for (const [symbol, shares] of Object.entries(player.portfolio)) {
      const price = this.market.prices[symbol];
      if (Number.isFinite(price)) sum += price * shares;
    }
    return sum;
  }

  /** Kursschritt fuer alle Papiere. Laeuft bei jedem slowTick. */
  stepMarket() {
    for (const stock of STOCKS) {
      this.market.prices[stock.symbol] = stepPrice(stock, this.market.prices[stock.symbol]);
    }
  }

  /** Marktzustand fuer den Client, inkl. eigenem Bestand. */
  buildMarketState(playerId) {
    const player = playerId != null ? this.players.get(playerId) : null;
    const portfolio = (player && player.portfolio) || {};
    return {
      // Der Kassenbestand ist bewusst SICHTBAR: er begrenzt, was beim Verkauf
      // ueberhaupt ausgezahlt werden kann. Wer das nicht sieht, haelt eine
      // gekappte Auszahlung fuer einen Fehler.
      reserve: Math.floor(this.market.reserve),
      // Seit das Depot gebuehrenpflichtig ist, muss sein Wert ablesbar sein -
      // sonst ueberrascht die Abbuchung.
      portfolioValue: Math.round(this.portfolioValue(player)),
      stocks: STOCKS.map((s) => ({
        symbol: s.symbol,
        name: s.name,
        price: this.market.prices[s.symbol],
        basePrice: s.basePrice,
        volatility: s.volatility,
        owned: portfolio[s.symbol] || 0,
        maxShares: MAX_SHARES_PER_STOCK,
      })),
    };
  }

  /** Kauft Anteile. Das Geld wandert vollstaendig in den Kassenbestand. */
  buyShares(playerId, symbol, shares) {
    const player = this.players.get(playerId);
    const stock = findStock(symbol);
    if (!player || !stock) return { ok: false, reason: 'not_found' };
    if (this.isJailed(player)) return { ok: false, reason: 'jailed' };
    if (this.isAwaitingReincarnation(player)) return { ok: false, reason: 'dead' };

    const count = Math.floor(Number(shares));
    if (!Number.isFinite(count) || count <= 0) return { ok: false, reason: 'invalid_amount' };

    if (!player.portfolio) player.portfolio = {};
    const owned = player.portfolio[symbol] || 0;
    if (owned + count > MAX_SHARES_PER_STOCK) return { ok: false, reason: 'position_limit' };

    const price = this.market.prices[symbol];
    const cost = Math.round(price * count);
    if (player.cash < cost) return { ok: false, reason: 'insufficient_funds' };

    const away = this.checkPlaceRequirement(player, 'buyShares');
    if (away) return away;

    player.cash -= cost;
    this.market.reserve += cost;
    player.portfolio[symbol] = owned + count;
    this.market.prices[symbol] = applyTradeImpact(stock, price, count, true);

    return { ok: true, symbol, shares: count, cost, price, player };
  }

  /**
   * Verkauft Anteile. Die Auszahlung ist auf den Kassenbestand BEGRENZT - das
   * ist der Kern der Geldmengen-Garantie: Gewinne stammen immer aus den Kaeufen
   * anderer, nie aus dem Nichts. Ist die Kasse leer, gibt es entsprechend
   * weniger.
   */
  sellShares(playerId, symbol, shares) {
    const player = this.players.get(playerId);
    const stock = findStock(symbol);
    if (!player || !stock) return { ok: false, reason: 'not_found' };
    if (this.isJailed(player)) return { ok: false, reason: 'jailed' };
    if (this.isAwaitingReincarnation(player)) return { ok: false, reason: 'dead' };

    const count = Math.floor(Number(shares));
    if (!Number.isFinite(count) || count <= 0) return { ok: false, reason: 'invalid_amount' };

    if (!player.portfolio) player.portfolio = {};
    const owned = player.portfolio[symbol] || 0;
    if (owned < count) return { ok: false, reason: 'not_enough_shares' };

    const away = this.checkPlaceRequirement(player, 'sellShares');
    if (away) return away;

    const price = this.market.prices[symbol];
    const gross = Math.round(price * count);
    const payout = Math.min(gross, Math.floor(this.market.reserve));

    player.portfolio[symbol] = owned - count;
    if (player.portfolio[symbol] === 0) delete player.portfolio[symbol];
    this.market.reserve -= payout;
    player.cash += payout;
    this.market.prices[symbol] = applyTradeImpact(stock, price, count, false);

    return { ok: true, symbol, shares: count, payout, gross, capped: payout < gross, price, player };
  }

  // ---------------------------------------------------------------------
  // POLITIK: Wahl, Amtszeit, Steuerhoheit
  // ---------------------------------------------------------------------

  /** Der gerade gueltige Steuersatz. Ohne Buergermeister gilt der Standardwert. */
  currentTaxRate() {
    const { mayorId, taxRate } = this.politics;
    if (mayorId == null) return DEFAULT_TAX_RATE;
    return isValidTaxRate(taxRate) ? taxRate : DEFAULT_TAX_RATE;
  }

  /** Zustand fuer den Client - ohne die interne Stimmzuordnung. */
  buildPoliticsState() {
    const pol = this.politics;
    // Stimmen werden nur als ZAHL je Kandidat gemeldet, nie mit Waehlernamen:
    // eine geheime Wahl ist wenig wert, wenn jeder nachsehen kann, wer wen
    // gewaehlt hat.
    const tally = {};
    for (const candidateId of Object.values(pol.votes)) {
      tally[candidateId] = (tally[candidateId] || 0) + 1;
    }
    return {
      phase: pol.phase,
      phaseEndsAt: pol.phaseEndsAt,
      mayorId: pol.mayorId,
      mayorName: pol.mayorName,
      taxRate: this.currentTaxRate(),
      taxRateMin: TAX_RATE_MIN,
      taxRateMax: TAX_RATE_MAX,
      candidacyFee: CANDIDACY_FEE,
      candidates: pol.candidates.map((c) => ({
        playerId: c.playerId,
        name: c.name,
        votes: tally[c.playerId] || 0,
      })),
    };
  }

  /** Stellt sich zur Wahl. Nur waehrend der Wahlphase und gegen Gebuehr. */
  runForMayor(playerId) {
    const player = this.players.get(playerId);
    if (!player) return { ok: false, reason: 'not_found' };
    if (this.isJailed(player)) return { ok: false, reason: 'jailed' };
    if (this.isAwaitingReincarnation(player)) return { ok: false, reason: 'dead' };
    if (this.politics.phase !== 'campaign') return { ok: false, reason: 'no_election' };
    if (this.politics.candidates.some((c) => c.playerId === playerId)) {
      return { ok: false, reason: 'already_candidate' };
    }
    if (player.cash < CANDIDACY_FEE) return { ok: false, reason: 'insufficient_funds' };

    const away = this.checkPlaceRequirement(player, 'runForMayor');
    if (away) return away;

    player.cash -= CANDIDACY_FEE;
    this.politics.candidates.push({ playerId, name: player.name });
    return { ok: true, fee: CANDIDACY_FEE, player };
  }

  /** Gibt eine Stimme ab. Eine pro Spieler, aenderbar bis zum Ende der Wahlphase. */
  castVote(playerId, candidateId) {
    const player = this.players.get(playerId);
    if (!player) return { ok: false, reason: 'not_found' };
    if (this.isJailed(player)) return { ok: false, reason: 'jailed' };
    if (this.isAwaitingReincarnation(player)) return { ok: false, reason: 'dead' };
    if (this.politics.phase !== 'campaign') return { ok: false, reason: 'no_election' };
    if (!this.politics.candidates.some((c) => c.playerId === candidateId)) {
      return { ok: false, reason: 'not_a_candidate' };
    }

    const away = this.checkPlaceRequirement(player, 'castVote');
    if (away) return away;

    // Ueberschreiben ist erlaubt: umentscheiden bis zum Schluss gehoert dazu,
    // und es verhindert, dass ein Fehlklick die Stimme verbrennt.
    this.politics.votes[playerId] = candidateId;
    return { ok: true, candidateId, player };
  }

  /** Der Buergermeister aendert den Steuersatz. Nur er, nur im Band, nur im Rathaus. */
  setTaxRate(playerId, rate) {
    const player = this.players.get(playerId);
    if (!player) return { ok: false, reason: 'not_found' };
    if (this.politics.mayorId !== playerId) return { ok: false, reason: 'not_mayor' };
    if (!isValidTaxRate(rate)) return { ok: false, reason: 'rate_out_of_range' };

    const away = this.checkPlaceRequirement(player, 'setTaxRate');
    if (away) return away;

    this.politics.taxRate = rate;
    return { ok: true, taxRate: rate, player };
  }

  /**
   * Treibt Wahlphase und Amtszeit voran. Wird bei jedem slowTick aufgerufen und
   * gibt zurueck, ob sich etwas geaendert hat - nur dann muss der Zustand an
   * alle geschickt werden.
   */
  advancePolitics() {
    const now = Date.now();
    const pol = this.politics;
    if (now < pol.phaseEndsAt) return null;

    if (pol.phase === 'campaign') {
      // Auszaehlen. Bei Gleichstand gewinnt, wer zuerst kandidiert hat - eine
      // Stichwahl waere hier mehr Mechanik als Nutzen.
      const tally = new Map();
      for (const candidateId of Object.values(pol.votes)) {
        tally.set(candidateId, (tally.get(candidateId) || 0) + 1);
      }
      let winner = null;
      let best = 0;
      for (const cand of pol.candidates) {
        const v = tally.get(cand.playerId) || 0;
        if (v > best) { best = v; winner = cand; }
      }

      pol.phase = 'term';
      pol.phaseEndsAt = now + TERM_DURATION_MS;
      pol.votes = {};
      pol.candidates = [];

      if (winner && best > 0) {
        pol.mayorId = winner.playerId;
        pol.mayorName = winner.name;
        // Der neue Amtsinhaber startet beim Standardsatz und muss selbst
        // taetig werden - sonst erbte er stillschweigend die Politik seines
        // Vorgaengers.
        pol.taxRate = DEFAULT_TAX_RATE;
        return { type: 'elected', mayorName: winner.name, votes: best };
      }

      // Keine Kandidaten oder keine Stimmen: Amt bleibt unbesetzt.
      pol.mayorId = null;
      pol.mayorName = null;
      pol.taxRate = DEFAULT_TAX_RATE;
      return { type: 'no_mayor' };
    }

    // Amtszeit vorbei -> neue Wahlphase
    pol.phase = 'campaign';
    pol.phaseEndsAt = now + CAMPAIGN_DURATION_MS;
    pol.mayorId = null;
    pol.mayorName = null;
    pol.taxRate = DEFAULT_TAX_RATE;
    pol.candidates = [];
    pol.votes = {};
    return { type: 'campaign_started' };
  }

  // ---------------------------------------------------------------------
  // BANK: Sparkonto und Kredite
  // ---------------------------------------------------------------------

  /** Wie viel darf dieser Spieler insgesamt schulden? Haengt an seinen Sicherheiten. */
  creditLimit(player) {
    let propertyValue = 0;
    for (const prop of this.properties.values()) {
      // Investiertes zaehlt als Sicherheit mit - es steckt genauso im Objekt.
      if (prop.ownerId === player.id) propertyValue += prop.price + (prop.invested || 0);
    }
    const jobBonus = player.job ? LOAN_LIMIT_PER_JOB_LEVEL * (player.jobLevel + 1) : 0;
    return Math.round(LOAN_BASE_LIMIT + propertyValue * LOAN_LIMIT_PER_PROPERTY_VALUE + jobBonus);
  }

  buildBankState(playerId) {
    const player = this.players.get(playerId);
    if (!player) return null;
    return {
      cash: player.cash,
      savings: player.bank,
      debt: player.debt,
      creditLimit: this.creditLimit(player),
      savingsRate: SAVINGS_INTEREST_RATE,
      loanRate: LOAN_INTEREST_RATE,
      // Tresorstand ist bewusst fuer ALLE sichtbar: er waechst mit der Steuer,
      // die alle zahlen, und macht den Ueberfall planbar statt zum Gluecksspiel.
      // Das erzeugt ausserdem einen Wettlauf, wer zuerst zugreift.
      vault: this.bankVault,
    };
  }

  /** Bargeld aufs Sparkonto - dort ist es vor Diebstahl sicher. */
  depositToBank(playerId, amount) {
    const player = this.players.get(playerId);
    if (!player) return { ok: false, reason: 'not_found' };
    const amt = Math.floor(Number(amount));
    if (!Number.isFinite(amt) || amt <= 0) return { ok: false, reason: 'invalid_amount' };
    if (player.cash < amt) return { ok: false, reason: 'insufficient_funds' };

    const away = this.checkPlaceRequirement(player, 'deposit');
    if (away) return away;

    player.cash -= amt;
    player.bank += amt;
    return { ok: true, amount: amt };
  }

  /** Guthaben abheben. */
  withdrawFromBank(playerId, amount) {
    const player = this.players.get(playerId);
    if (!player) return { ok: false, reason: 'not_found' };
    const amt = Math.floor(Number(amount));
    if (!Number.isFinite(amt) || amt <= 0) return { ok: false, reason: 'invalid_amount' };
    if (player.bank < amt) return { ok: false, reason: 'insufficient_savings' };

    const away = this.checkPlaceRequirement(player, 'withdraw');
    if (away) return away;

    player.bank -= amt;
    player.cash += amt;
    return { ok: true, amount: amt };
  }

  /** Kredit aufnehmen, begrenzt durch den Kreditrahmen. */
  takeLoan(playerId, amount) {
    const player = this.players.get(playerId);
    if (!player) return { ok: false, reason: 'not_found' };
    const amt = Math.floor(Number(amount));
    if (!Number.isFinite(amt) || amt <= 0) return { ok: false, reason: 'invalid_amount' };

    const limit = this.creditLimit(player);
    if (player.debt + amt > limit) return { ok: false, reason: 'over_credit_limit', limit };

    const away = this.checkPlaceRequirement(player, 'takeLoan');
    if (away) return away;

    player.debt += amt;
    player.cash += amt;
    return { ok: true, amount: amt, debt: player.debt, limit };
  }

  /** Schulden tilgen - zuerst vom Bargeld, dann vom Sparkonto. */
  repayLoan(playerId, amount) {
    const player = this.players.get(playerId);
    if (!player) return { ok: false, reason: 'not_found' };
    if (player.debt <= 0) return { ok: false, reason: 'no_debt' };

    let amt = Math.floor(Number(amount));
    if (!Number.isFinite(amt) || amt <= 0) return { ok: false, reason: 'invalid_amount' };
    amt = Math.min(amt, player.debt);

    const available = player.cash + player.bank;
    if (available < amt) return { ok: false, reason: 'insufficient_funds' };

    const fromCash = Math.min(player.cash, amt);
    player.cash -= fromCash;
    player.bank -= (amt - fromCash);
    player.debt -= amt;

    return { ok: true, amount: amt, debt: player.debt };
  }

  /**
   * slowTick: Sparzinsen gutschreiben, Kreditzinsen abbuchen.
   * Reicht das Geld fuer die Zinsen nicht, waechst die Schuld weiter - das ist
   * die Schuldenspirale. Wird sie zu gross, verwertet die Bank eine Immobilie.
   * @returns {Array} Ereignisse fuer Benachrichtigungen
   */
  applyBankInterest() {
    const events = [];

    for (const player of this.players.values()) {
      if (!player.connected) continue;

      if (player.bank > 0) {
        player.bank += Math.round(player.bank * SAVINGS_INTEREST_RATE);
      }

      if (player.debt > 0) {
        const interest = Math.max(1, Math.round(player.debt * LOAN_INTEREST_RATE));

        // Zuerst Bargeld, dann Guthaben. Reicht beides nicht, waechst die Schuld.
        let remaining = interest;
        const fromCash = Math.min(player.cash, remaining);
        player.cash -= fromCash;
        remaining -= fromCash;
        const fromBank = Math.min(player.bank, remaining);
        player.bank -= fromBank;
        remaining -= fromBank;
        if (remaining > 0) player.debt += remaining;

        // Zwangsverwertung, wenn die Schuld den Rahmen deutlich sprengt
        const limit = this.creditLimit(player);
        if (player.debt > limit * FORECLOSURE_THRESHOLD) {
          const owned = [...this.properties.values()].filter((p) => p.ownerId === player.id);
          if (owned.length > 0) {
            // Teuerste zuerst verwerten, damit eine Verwertung meist reicht
            owned.sort((a, b) => b.price - a.price);
            const seized = owned[0];
            seized.ownerId = null;
            player.debt = Math.max(0, player.debt - seized.price);
            events.push({ type: 'foreclosure', player, property: seized });
          }
        }
      }
    }

    return events;
  }

  // ---------------------------------------------------------------------
  // HANDEL: ein Spieler bietet einem anderen eine eigene Immobilie zum Kauf an
  // ---------------------------------------------------------------------

  /** Bietet einem anderen Spieler eine eigene Immobilie zu einem Preis an. */
  proposeTrade(fromPlayerId, toPlayerId, propertyId, price) {
    const fromPlayer = this.players.get(fromPlayerId);
    const toPlayer = this.players.get(toPlayerId);
    const property = this.properties.get(propertyId);
    if (!fromPlayer || !toPlayer || !property) return { ok: false, reason: 'not_found' };
    if (property.ownerId !== fromPlayerId) return { ok: false, reason: 'not_owner' };
    if (fromPlayerId === toPlayerId) return { ok: false, reason: 'self_trade' };
    if (typeof price !== 'number' || price < 0) return { ok: false, reason: 'invalid_price' };

    const trade = {
      id: this.nextTradeId++,
      fromPlayerId,
      toPlayerId,
      propertyId,
      price: Math.round(price),
      expiresAt: Date.now() + TRADE_RESPONSE_DURATION_MS,
    };
    this.trades.set(trade.id, trade);
    return { ok: true, trade };
  }

  /** Empfaenger nimmt an oder lehnt ab. Bei Annahme wird serverseitig alles geprueft und uebertragen. */
  respondTrade(playerId, tradeId, accept) {
    const trade = this.trades.get(tradeId);
    if (!trade) return { ok: false, reason: 'not_found' };
    if (trade.toPlayerId !== playerId) return { ok: false, reason: 'not_recipient' };

    this.trades.delete(tradeId);

    if (!accept) {
      return { ok: true, accepted: false, trade };
    }

    const buyer = this.players.get(trade.toPlayerId);
    const seller = this.players.get(trade.fromPlayerId);
    const property = this.properties.get(trade.propertyId);
    if (!buyer || !seller || !property) return { ok: false, reason: 'not_found' };
    if (property.ownerId !== trade.fromPlayerId) return { ok: false, reason: 'no_longer_owned' };
    if (buyer.cash < trade.price) return { ok: false, reason: 'insufficient_funds' };

    buyer.cash -= trade.price;
    seller.cash += trade.price;
    property.ownerId = buyer.id;

    return { ok: true, accepted: true, trade, property };
  }

  /** Handelsangebote, die niemand rechtzeitig beantwortet hat, verfallen automatisch. */
  checkExpiredTrades() {
    const now = Date.now();
    const expired = [];
    for (const [id, trade] of this.trades) {
      if (trade.expiresAt <= now) {
        this.trades.delete(id);
        expired.push(trade);
      }
    }
    return expired;
  }

  // ---------------------------------------------------------------------
  // KRIMINALITÄT: Diebstahl, Polizei-KI, Gefängnis, Fahndungslevel
  // ---------------------------------------------------------------------

  isJailed(player) {
    return player.jailedUntil != null && player.jailedUntil > Date.now();
  }

  isAwaitingReincarnation(player) {
    return player.pendingReincarnation != null;
  }

  buildCopsState() {
    return this.cops.map((cop) => ({ id: cop.id, x: cop.position.x, y: cop.position.y }));
  }

  /**
   * Versucht, einem anderen Spieler in Reichweite Bargeld zu stehlen.
   * Server prueft ALLES selbst - Entfernung, Cooldown, Erfolgschance - der
   * Client kann hier nichts vortaeuschen.
   */
  attemptSteal(thiefId, victimId) {
    const thief = this.players.get(thiefId);
    const victim = this.players.get(victimId);
    if (!thief || !victim || thiefId === victimId) return { ok: false, reason: 'not_found' };
    if (this.isJailed(thief)) return { ok: false, reason: 'jailed' };
    if (this.isJailed(victim)) return { ok: false, reason: 'victim_jailed' };

    const now = Date.now();
    if (now - thief.lastStealAttemptAt < STEAL_COOLDOWN_MS) {
      return { ok: false, reason: 'cooldown' };
    }

    const dist = Math.hypot(thief.position.x - victim.position.x, thief.position.y - victim.position.y);
    if (dist > STEAL_RANGE) return { ok: false, reason: 'too_far' };

    thief.lastStealAttemptAt = now;
    thief.lastCrimeAt = now;
    thief.wanted += STEAL_WANTED_ON_ATTEMPT;

    const success = Math.random() < STEAL_SUCCESS_CHANCE;
    if (!success) {
      return { ok: true, success: false, thief, victim };
    }

    const percent = STEAL_MIN_PERCENT + Math.random() * (STEAL_MAX_PERCENT - STEAL_MIN_PERCENT);
    const amount = Math.min(STEAL_MAX_AMOUNT, Math.round(victim.cash * percent));
    victim.cash = Math.max(0, victim.cash - amount);
    thief.cash += amount;
    thief.wanted += STEAL_WANTED_ON_SUCCESS_BONUS;

    return { ok: true, success: true, amount, thief, victim };
  }

  /**
   * Steckt einen Spieler ins Gefaengnis und traegt die Tat in die Vorstrafen ein.
   *
   * Vorher stand dieser Ablauf an zwei Stellen doppelt (Verhaftung durch die
   * Polizei, gescheiterter Bankueberfall) - und an keiner davon wurde
   * criminalRecord gefuellt. Hier zentral, damit jede Inhaftierung dieselbe
   * Wirkung hat und keine Stelle vergessen wird.
   *
   * Die Haftdauer steigt mit der Zahl der Vorstrafen: Wiederholungstaeter sitzen
   * laenger. Der Deckel verhindert, dass jemand irgendwann minutenlang weg ist.
   */
  jailPlayer(player, offence) {
    const now = Date.now();
    player.criminalRecord.push({ offence, at: now });
    // Nur die juengsten Eintraege behalten - sonst waechst das Feld unbegrenzt
    // und landet in voller Laenge in jedem Spielstand.
    if (player.criminalRecord.length > CRIMINAL_RECORD_LIMIT) {
      player.criminalRecord = player.criminalRecord.slice(-CRIMINAL_RECORD_LIMIT);
    }

    // -1: die gerade eingetragene Tat soll die eigene Strafe nicht schon verlaengern
    const priors = Math.max(0, player.criminalRecord.length - 1);
    const duration = Math.min(
      JAIL_MAX_DURATION_MS,
      JAIL_DURATION_MS + priors * JAIL_EXTRA_PER_RECORD_MS,
    );

    this.forceExitVehicle(player); // nicht "im Auto sitzend" im Gefaengnis landen
    player.jailedUntil = now + duration;
    player.wanted = 0;
    player.position = { x: JAIL_POSITION.x, y: JAIL_POSITION.y };
    player.velocity = { x: 0, y: 0 };
    return duration;
  }

  /** Was kostet es gerade, sich freizukaufen? Steigt mit Restzeit und Vorstrafen. */
  bailCost(player) {
    const remainingMs = Math.max(0, (player.jailedUntil || 0) - Date.now());
    return Math.round(
      BAIL_BASE_COST
      + (remainingMs / 1000) * BAIL_COST_PER_SECOND
      + player.criminalRecord.length * BAIL_COST_PER_RECORD,
    );
  }

  /** Kaution stellen: sofort raus. Die Vorstrafe bleibt - man kauft Zeit, keine Unschuld. */
  postBail(playerId) {
    const player = this.players.get(playerId);
    if (!player) return { ok: false, reason: 'not_found' };
    if (!this.isJailed(player)) return { ok: false, reason: 'not_jailed' };

    const cost = this.bailCost(player);
    if (player.cash < cost) return { ok: false, reason: 'insufficient_funds' };

    player.cash -= cost;
    player.jailedUntil = null;
    player.position = { x: SPAWN_POSITION.x, y: SPAWN_POSITION.y };
    player.velocity = { x: 0, y: 0 };
    return { ok: true, cost, player };
  }

  /** Was kostet die Bestechung gerade? */
  bribeCost(player) {
    return Math.round(Math.max(1, player.wanted) * BRIBE_COST_PER_WANTED);
  }

  /**
   * Bestechung: schnell und ueberall moeglich, aber illegal. Geht sie schief,
   * steht man schlechter da als vorher - der Preis dafuer, sich den Weg zur
   * Kanzlei zu sparen.
   */
  bribePolice(playerId) {
    const player = this.players.get(playerId);
    if (!player) return { ok: false, reason: 'not_found' };
    if (this.isJailed(player)) return { ok: false, reason: 'jailed' };
    if (this.isAwaitingReincarnation(player)) return { ok: false, reason: 'dead' };
    if (player.wanted <= 0) return { ok: false, reason: 'not_wanted' };

    const now = Date.now();
    if (now - (player.lastBribeAt || 0) < BRIBE_COOLDOWN_MS) return { ok: false, reason: 'cooldown' };

    const cost = this.bribeCost(player);
    if (player.cash < cost) return { ok: false, reason: 'insufficient_funds' };

    player.lastBribeAt = now;
    player.cash -= cost;

    if (Math.random() >= BRIBE_SUCCESS_CHANCE) {
      // Fehlschlag: Geld weg UND hoehere Fahndung. Kein Gefaengnis - sonst waere
      // die Bestechung schlechter als gar nichts zu tun.
      player.wanted += BRIBE_WANTED_ON_FAILURE;
      player.lastCrimeAt = now;
      return { ok: true, success: false, cost, player };
    }

    player.wanted = Math.max(0, player.wanted - BRIBE_WANTED_REDUCTION);
    return { ok: true, success: true, cost, player };
  }

  /** Was kostet der Anwalt gerade? Steigt mit der Zahl der Vorstrafen. */
  lawyerCost(player) {
    return Math.round(LAWYER_BASE_COST + player.criminalRecord.length * LAWYER_COST_PER_RECORD);
  }

  /**
   * Anwalt beauftragen: setzt die Fahndung auf 0 UND raeumt die Vorstrafen ab -
   * damit sinkt auch die kuenftige Haftdauer wieder auf das Grundmass.
   * Teuer und ortsgebunden, dafuer ohne Risiko.
   */
  hireLawyer(playerId) {
    const player = this.players.get(playerId);
    if (!player) return { ok: false, reason: 'not_found' };
    if (this.isJailed(player)) return { ok: false, reason: 'jailed' };
    if (this.isAwaitingReincarnation(player)) return { ok: false, reason: 'dead' };
    if (player.wanted <= 0 && player.criminalRecord.length === 0) {
      return { ok: false, reason: 'nothing_to_clear' };
    }

    const cost = this.lawyerCost(player);
    if (player.cash < cost) return { ok: false, reason: 'insufficient_funds' };

    const away = this.checkPlaceRequirement(player, 'hireLawyer');
    if (away) return away;

    const cleared = player.criminalRecord.length;
    player.cash -= cost;
    player.wanted = 0;
    player.criminalRecord = [];
    return { ok: true, cost, cleared, player };
  }

  /**
   * Erzeugt die Laeden aus den Gewerbegebaeuden (Bezirk x>=2800, y<2800).
   *
   * Preis und Name werden DETERMINISTISCH aus der Position abgeleitet
   * (Grundsatz 4): so sieht jeder Client dieselben Laeden mit denselben
   * Preisen, ohne dass etwas uebertragen werden muss - und nach einem Neustart
   * ist alles unveraendert.
   *
   * Es werden bewusst KEINE eigenen Kollisionsflaechen angelegt: die Gebaeude
   * stehen bereits als Stadtdeko und haben ihre Flaeche schon. Ein zweites
   * Rechteck an derselben Stelle waere wirkungslos, aber irrefuehrend.
   */
  generateShops() {
    const shops = [];
    let n = 0;
    for (const b of this.cityLayout.buildings) {
      if (!(b.x >= 2800 && b.y < 2800)) continue;

      const seed = Math.abs(Math.round(b.x * 73 + b.y * 31));
      const span = SHOP_MAX_PRICE - SHOP_MIN_PRICE;
      // Auf 50 gerundet, damit die Preise nicht wie Zufallszahlen aussehen.
      const price = SHOP_MIN_PRICE + Math.round((seed % (span + 1)) / 50) * 50;
      const incomePerTick = Math.max(1, Math.round(price * SHOP_INCOME_RATIO));
      const maintenancePerTick = Math.max(1, Math.round(incomePerTick * SHOP_MAINTENANCE_RATIO));

      const name = `${SHOP_NAMES[seed % SHOP_NAMES.length]} ${SHOP_STREETS[(seed >> 3) % SHOP_STREETS.length]}`;
      shops.push({
        id: `shop_${n++}`,
        kind: 'shop',
        name,
        price,
        incomePerTick,
        maintenancePerTick,
        position: { x: b.x, y: b.y },
        ownerId: null,
        level: 1,
        invested: 0,
        baseIncome: incomePerTick,
        baseMaintenance: maintenancePerTick,
      });
    }
    return shops;
  }

  /**
   * Erzeugt die Wohnhaeuser aus den Vorstadtgebaeuden (x<2800, y>=2800).
   * Gleiches Verfahren wie bei den Laeden, aber OHNE Ertrag.
   */
  generateHomes() {
    const homes = [];
    let n = 0;
    for (const b of this.cityLayout.buildings) {
      if (!(b.x < 2800 && b.y >= 2800)) continue;

      const seed = Math.abs(Math.round(b.x * 53 + b.y * 97));
      const span = HOME_MAX_PRICE - HOME_MIN_PRICE;
      const price = HOME_MIN_PRICE + Math.round((seed % (span + 1)) / 50) * 50;
      const maintenancePerTick = Math.max(1, Math.round(price * HOME_MAINTENANCE_RATIO));

      const name = `${HOME_NAMES[seed % HOME_NAMES.length]} ${HOME_STREETS[(seed >> 3) % HOME_STREETS.length]}`;
      homes.push({
        id: `home_${n++}`,
        kind: 'home',
        name,
        price,
        incomePerTick: 0,
        maintenancePerTick,
        position: { x: b.x, y: b.y },
        ownerId: null,
        level: 1,
        invested: 0,
        baseIncome: 0,
        baseMaintenance: maintenancePerTick,
      });
    }
    return homes;
  }

  /** Besitzt dieser Spieler ein Zuhause? */
  ownsHome(player) {
    if (!player) return false;
    for (const p of this.properties.values()) {
      if (p.kind === 'home' && p.ownerId === player.id) return true;
    }
    return false;
  }

  /** Wie viele Wohnhaeuser besitzt dieser Spieler? */
  ownedHomeCount(playerId) {
    let n = 0;
    for (const p of this.properties.values()) {
      if (p.kind === 'home' && p.ownerId === playerId) n++;
    }
    return n;
  }

  /** Wie viele Laeden besitzt dieser Spieler? */
  ownedShopCount(playerId) {
    let n = 0;
    for (const p of this.properties.values()) {
      if (p.kind === 'shop' && p.ownerId === playerId) n++;
    }
    return n;
  }

  /** Setzt Ertrag und Unterhalt gemaess der Ausbaustufe neu. */
  applyPropertyLevel(property) {
    const def = PROPERTY_LEVELS[(property.level || 1) - 1] || PROPERTY_LEVELS[0];
    property.incomePerTick = Math.round(property.baseIncome * def.incomeMult);
    property.maintenancePerTick = Math.round(property.baseMaintenance * def.maintenanceMult);
  }

  /**
   * Gibt eine Immobilie an die Bank zurueck: herrenlos UND im Grundzustand.
   *
   * Drei Wege fuehren hierher - Rueckverkauf, Zwangsverwertung und ein
   * verschwundener Besitzer. Ohne gemeinsame Stelle muesste jeder von ihnen an
   * den Ausbau denken, und der naechste Kaeufer bekaeme den Luxusausbau seines
   * Vorgaengers zum Grundpreis geschenkt.
   */
  returnPropertyToBank(property) {
    property.ownerId = null;
    property.level = 1;
    property.invested = 0;
    property.hasAlarm = false;
    property.insured = false;
    this.applyPropertyLevel(property);
  }

  /** Die naechsthoehere Ausbaustufe, oder null wenn schon maximal. */
  nextPropertyLevel(property) {
    return PROPERTY_LEVELS[(property.level || 1)] || null;
  }

  /** Kosten des naechsten Ausbaus, oder null. */
  propertyUpgradeCost(property) {
    const next = this.nextPropertyLevel(property);
    return next ? Math.round(property.price * next.upgradeCostRatio) : null;
  }

  /** Baut eine eigene Immobilie eine Stufe aus. Ortsgebunden ans Maklerbuero. */
  upgradeProperty(playerId, propertyId) {
    const player = this.players.get(playerId);
    const property = this.properties.get(propertyId);
    if (!player || !property) return { ok: false, reason: 'not_found' };
    if (this.isJailed(player)) return { ok: false, reason: 'jailed' };
    if (property.ownerId !== playerId) return { ok: false, reason: 'not_owner' };

    const next = this.nextPropertyLevel(property);
    if (!next) return { ok: false, reason: 'max_level' };

    const cost = this.propertyUpgradeCost(property);
    if (player.cash < cost) return { ok: false, reason: 'insufficient_funds' };

    const away = this.checkPlaceRequirement(player, 'upgradeProperty');
    if (away) return away;

    player.cash -= cost;
    property.level = next.level;
    // Investiertes mitfuehren: es zaehlt zum Vermoegen, erhoeht den
    // Kreditrahmen und wird beim Rueckverkauf anteilig erstattet.
    property.invested = (property.invested || 0) + cost;
    this.applyPropertyLevel(property);

    return { ok: true, cost, level: property.level, levelName: next.name, property };
  }

  // ---------------------------------------------------------------------
  // SCHUTZ: Alarmanlage und Versicherung (Gegenseite zum Einbruch)
  // ---------------------------------------------------------------------

  /**
   * Baut eine Alarmanlage in eine eigene Immobilie ein. Einmalige Anschaffung,
   * danach laufende Kosten bei jedem Ertragszyklus (siehe collectEconomyIncome).
   */
  buyAlarm(playerId, propertyId) {
    const player = this.players.get(playerId);
    const property = this.properties.get(propertyId);
    if (!player || !property) return { ok: false, reason: 'not_found' };
    if (this.isJailed(player)) return { ok: false, reason: 'jailed' };
    if (property.ownerId !== playerId) return { ok: false, reason: 'not_owner' };
    if (property.hasAlarm) return { ok: false, reason: 'already_protected' };

    const cost = alarmInstallCost(property);
    if (player.cash < cost) return { ok: false, reason: 'insufficient_funds' };

    const away = this.checkPlaceRequirement(player, 'buyAlarm');
    if (away) return away;

    player.cash -= cost;
    property.hasAlarm = true;
    return { ok: true, cost, property };
  }

  /**
   * Schliesst eine Versicherung ab oder kuendigt sie. Kuendigen ist bewusst
   * ortsungebunden erlaubt (wie alle Ausstiege, siehe places.js) - abschliessen
   * dagegen nur im Maklerbuero.
   */
  setInsurance(playerId, propertyId, on) {
    const player = this.players.get(playerId);
    const property = this.properties.get(propertyId);
    if (!player || !property) return { ok: false, reason: 'not_found' };
    if (property.ownerId !== playerId) return { ok: false, reason: 'not_owner' };

    if (!on) {
      if (!property.insured) return { ok: false, reason: 'not_insured' };
      property.insured = false;
      return { ok: true, insured: false, property };
    }

    if (this.isJailed(player)) return { ok: false, reason: 'jailed' };
    if (property.insured) return { ok: false, reason: 'already_protected' };

    const away = this.checkPlaceRequirement(player, 'setInsurance');
    if (away) return away;

    property.insured = true;
    return { ok: true, insured: true, premium: insurancePremium(property), property };
  }

  /**
   * Einbruch in eine fremde Immobilie. Greift den ERTRAGSSTROM an, nicht das
   * gespeicherte Geld: die Immobilie wirft fuer BURGLARY_DISABLE_MS nichts mehr
   * ab, und genau dieser entgangene Ertrag ist die Beute.
   *
   * Dadurch bleibt das Sparkonto weiterhin diebstahlsicher (sein Hauptzweck),
   * reiche Spieler sind aber trotzdem angreifbar - und lohnendere Ziele als arme,
   * weil teure Objekte mehr abwerfen.
   *
   * Es entsteht KEIN neues Geld: der Besitzer verliert exakt, was der Einbrecher
   * bekommt.
   */
  attemptBurglary(burglarId, propertyId) {
    const burglar = this.players.get(burglarId);
    const property = this.properties.get(propertyId);
    if (!burglar || !property) return { ok: false, reason: 'not_found' };
    if (this.isJailed(burglar)) return { ok: false, reason: 'jailed' };
    if (this.isAwaitingReincarnation(burglar)) return { ok: false, reason: 'dead' };
    if (!property.ownerId) return { ok: false, reason: 'not_owned' };
    if (property.ownerId === burglarId) return { ok: false, reason: 'own_property' };

    const now = Date.now();
    if (now - (burglar.lastBurglaryAt || 0) < BURGLARY_COOLDOWN_MS) {
      return { ok: false, reason: 'cooldown' };
    }
    // Zweimal dieselbe Immobilie hintereinander bringt nichts - der Ertrag
    // faellt ja ohnehin schon aus. Sonst koennte man denselben Ausfall
    // mehrfach kassieren.
    if (property.disabledUntil && property.disabledUntil > now) {
      return { ok: false, reason: 'already_burgled' };
    }

    const dist = Math.hypot(burglar.position.x - property.position.x, burglar.position.y - property.position.y);
    if (dist > BURGLARY_RANGE) return { ok: false, reason: 'too_far' };

    const owner = this.players.get(property.ownerId);

    burglar.lastBurglaryAt = now;
    burglar.lastCrimeAt = now;
    burglar.wanted += BURGLARY_WANTED_ON_ATTEMPT;

    // Die Alarmanlage senkt die Erfolgschance deutlich (0,45 -> 0,2).
    // Ein Dietrich hebt sie wieder an und wird dabei verbraucht - auch bei
    // einem Fehlschlag, sonst waere er risikolos.
    const lockpick = findItem('lockpick');
    const usedLockpick = this.consumeItem(burglar, 'lockpick');
    const chance = usedLockpick
      ? (property.hasAlarm ? lockpick.burglaryChanceAlarmed : lockpick.burglaryChance)
      : (property.hasAlarm ? ALARM_BURGLARY_SUCCESS_CHANCE : BURGLARY_SUCCESS_CHANCE);

    if (Math.random() >= chance) {
      // Scheitert der Versuch an einer Anlage, geht zusaetzlich die Meldung an
      // die Polizei raus. Damit ist die Anlage nicht nur passiver Schutz,
      // sondern macht das Ziel aktiv unattraktiv.
      if (property.hasAlarm) burglar.wanted += ALARM_WANTED_BONUS_ON_FAILURE;
      return { ok: true, success: false, alarmTriggered: !!property.hasAlarm, usedLockpick, burglar, owner, property };
    }

    // Beute = entgangener Ertrag ueber die Ausfallzeit, in slowTicks gerechnet.
    const ticks = BURGLARY_DISABLE_MS / SLOW_TICK_MS;
    // Im eigenen Bandengebiet faellt die Beute hoeher aus. Bewusst nur die
    // BEUTE und nicht die Erfolgschance: sonst waere Gebietskontrolle ein
    // Freibrief, und Alarmanlagen - die an der Chance ansetzen - waeren
    // gegenueber der kontrollierenden Bande wertlos.
    const territoryBonus = this.controlsPositionOf(burglar, property.position.x, property.position.y)
      ? TERRITORY_LOOT_BONUS : 0;
    const loot = Math.max(1, Math.round(property.incomePerTick * ticks * (1 + territoryBonus)));

    property.disabledUntil = now + BURGLARY_DISABLE_MS;
    burglar.cash += loot;
    burglar.wanted += BURGLARY_WANTED_ON_SUCCESS_BONUS;

    // Entschaedigung, falls versichert - begrenzt auf den Topfinhalt. Ist der
    // Topf leer, gibt es weniger oder nichts: das Geld muss vorher von jemandem
    // eingezahlt worden sein.
    let payout = 0;
    if (property.insured && owner) {
      const claim = insurancePayout(property, ticks);
      payout = Math.min(claim, Math.floor(this.insurancePool));
      if (payout > 0) {
        this.insurancePool -= payout;
        owner.cash += payout;
      }
    }

    return { ok: true, success: true, loot, payout, usedLockpick, territoryBonus: territoryBonus > 0, burglar, owner, property };
  }

  /**
   * Bankueberfall auf die Bankfiliale. Der Tresor speist sich aus der
   * Vermoegenssteuer (VAULT_TAX_SHARE) - das Geld war also bereits aus dem
   * Umlauf gezogen und kehrt bei Erfolg zurueck, statt neu zu entstehen.
   *
   * Deutlich riskanter als alles andere: niedrige Erfolgschance, hohes
   * Fahndungslevel und bei Fehlschlag SOFORT Gefaengnis statt nur Fahndung.
   * Die Ortsbindung an die Bankfiliale kommt aus places.js.
   */
  attemptBankRobbery(playerId) {
    const player = this.players.get(playerId);
    if (!player) return { ok: false, reason: 'not_found' };
    if (this.isJailed(player)) return { ok: false, reason: 'jailed' };
    if (this.isAwaitingReincarnation(player)) return { ok: false, reason: 'dead' };

    const now = Date.now();
    if (now - (player.lastRobberyAt || 0) < ROBBERY_COOLDOWN_MS) {
      return { ok: false, reason: 'cooldown' };
    }
    if (this.bankVault < ROBBERY_MIN_VAULT) {
      return { ok: false, reason: 'vault_empty', vault: this.bankVault };
    }

    const away = this.checkPlaceRequirement(player, 'robBank');
    if (away) return away;

    player.lastRobberyAt = now;
    player.lastCrimeAt = now;
    player.wanted += ROBBERY_WANTED_ON_ATTEMPT;

    if (Math.random() >= ROBBERY_SUCCESS_CHANCE) {
      // Fehlschlag: direkt ins Gefaengnis, ueber denselben Weg wie eine Verhaftung.
      this.jailPlayer(player, 'bank_robbery');
      return { ok: true, success: false, jailed: true, player };
    }

    const loot = Math.round(this.bankVault * ROBBERY_LOOT_SHARE);
    this.bankVault -= loot;
    player.cash += loot;
    player.wanted += ROBBERY_WANTED_ON_SUCCESS_BONUS;

    return { ok: true, success: true, loot, vault: this.bankVault, player };
  }

  /**
   * EVENT_TICK: bewegt Polizei-NPCs. Gesuchte Spieler in Sichtweite werden
   * verfolgt, sonst patrouilliert die Polizei ziellos. Wird ein gesuchter
   * Spieler eingeholt, geht es direkt ins Gefaengnis.
   * @returns {Array} frisch verhaftete Spieler, fuer Benachrichtigungen
   */
  updateCops(dtMs) {
    const dtSec = dtMs / 1000;
    const now = Date.now();
    const arrests = [];

    // Tageszeit und Wetter wirken NUR auf die Polizei - sie wird rein
    // serverseitig bewegt. Die Spielerbewegung bleibt unberuehrt, weil sie im
    // Client vorhergesagt wird (Grundprinzip 2); ein Faktor, der dort fehlt,
    // wuerde sich als dauerhaftes Ruckeln zeigen.
    const { policeRangeMult, policeSpeedMult } = environmentEffects(
      getDayPhase(now).phase,
      this.environment.weather,
    );
    const chaseRange = POLICE_CHASE_RANGE * policeRangeMult;
    const chaseSpeed = POLICE_CHASE_SPEED * policeSpeedMult;

    // Spieler mit Polizeiscanner, die neu ins Visier geraten sind.
    const pursued = [];

    const wantedPlayers = [...this.players.values()].filter(
      (p) => p.connected && p.wanted > 0 && !this.isJailed(p)
    );

    for (const cop of this.cops) {
      let target = null;
      let bestDist = Infinity;
      for (const player of wantedPlayers) {
        const dist = Math.hypot(cop.position.x - player.position.x, cop.position.y - player.position.y);
        if (dist <= chaseRange && dist < bestDist) {
          bestDist = dist;
          target = player;
        }
      }

      if (target) {
        // Scanner-Warnung nur beim NEUEN Ziel, nicht in jedem Tick - sonst
        // waere es eine Dauermeldung statt einer Warnung.
        if (cop.targetPlayerId !== target.id && this.hasItem(target, 'scanner')) {
          pursued.push(target);
        }
        cop.targetPlayerId = target.id;
        const dx = target.position.x - cop.position.x;
        const dy = target.position.y - cop.position.y;
        const len = Math.hypot(dx, dy) || 1;
        cop.velocity.x = (dx / len) * chaseSpeed;
        cop.velocity.y = (dy / len) * chaseSpeed;

        if (bestDist <= POLICE_CATCH_RANGE) {
          // Erledigt Aussteigen, Haftdauer (steigt mit Vorstrafen), Position
          // und den Eintrag ins Vorstrafenregister an einer Stelle.
          this.jailPlayer(target, 'arrest');
          cop.targetPlayerId = null;
          cop.velocity.x = 0;
          cop.velocity.y = 0;
          arrests.push(target);
        }
      } else {
        cop.targetPlayerId = null;
        if (now > cop.patrolChangeAt) {
          const angle = Math.random() * Math.PI * 2;
          cop.velocity.x = Math.cos(angle) * POLICE_PATROL_SPEED;
          cop.velocity.y = Math.sin(angle) * POLICE_PATROL_SPEED;
          cop.patrolChangeAt = now + 2000 + Math.random() * 3000;
        }
      }

      cop.position.x = Math.max(0, Math.min(WORLD_WIDTH, cop.position.x + cop.velocity.x * dtSec));
      cop.position.y = Math.max(0, Math.min(WORLD_HEIGHT, cop.position.y + cop.velocity.y * dtSec));
    }

    // Frueher wurde nur `arrests` zurueckgegeben. Der Scanner braucht
    // zusaetzlich die neu Verfolgten - deshalb jetzt ein Objekt. Der einzige
    // Aufrufer in index.js ist entsprechend angepasst.
    return { arrests, pursued };
  }

  /** Entlaesst Spieler, deren Haftzeit abgelaufen ist. */
  checkJailReleases() {
    const now = Date.now();
    const released = [];
    for (const player of this.players.values()) {
      if (player.jailedUntil != null && player.jailedUntil <= now) {
        player.jailedUntil = null;
        player.position.x = SPAWN_POSITION.x;
        player.position.y = SPAWN_POSITION.y;
        released.push(player);
      }
    }
    return released;
  }

  /** Fahndungslevel sinkt langsam, wenn eine Weile keine neue Straftat begangen wurde. */
  decayWanted() {
    const now = Date.now();
    for (const player of this.players.values()) {
      if (!player.connected || player.wanted <= 0) continue;
      if (now - player.lastCrimeAt >= WANTED_DECAY_INTERVAL_MS) {
        player.wanted = Math.max(0, player.wanted - WANTED_DECAY_AMOUNT);
        player.lastCrimeAt = now; // Timer neu starten fuer die naechste Abklingstufe
      }
    }
  }

  // ---------------------------------------------------------------------
  // SOZIALES: Chat, Freundschaften, Ranglisten
  // ---------------------------------------------------------------------

  /** Sendet eine Chat-Nachricht. Text wird serverseitig gekuerzt/geprueft - der Client bestimmt hier nichts. */
  sendChatMessage(playerId, text) {
    const player = this.players.get(playerId);
    if (!player) return { ok: false, reason: 'not_found' };

    const trimmed = typeof text === 'string' ? text.trim() : '';
    if (!trimmed) return { ok: false, reason: 'empty' };

    const message = {
      id: this.nextChatId++,
      playerId,
      name: player.name,
      text: trimmed.slice(0, MAX_CHAT_LENGTH),
      timestamp: Date.now(),
    };
    this.chatLog.push(message);
    if (this.chatLog.length > CHAT_HISTORY_LIMIT) this.chatLog.shift();
    return { ok: true, message };
  }

  buildChatHistory() {
    return [...this.chatLog];
  }

  /** Schickt einem anderen Spieler eine Freundschaftsanfrage. */
  proposeFriendship(fromPlayerId, toPlayerId) {
    const fromPlayer = this.players.get(fromPlayerId);
    const toPlayer = this.players.get(toPlayerId);
    if (!fromPlayer || !toPlayer) return { ok: false, reason: 'not_found' };
    if (fromPlayerId === toPlayerId) return { ok: false, reason: 'self_request' };
    if (fromPlayer.friends.includes(toPlayerId)) return { ok: false, reason: 'already_friends' };

    const alreadyPending = [...this.friendRequests.values()].some(
      (r) => r.fromPlayerId === fromPlayerId && r.toPlayerId === toPlayerId
    );
    if (alreadyPending) return { ok: false, reason: 'already_pending' };

    const request = { id: this.nextFriendRequestId++, fromPlayerId, toPlayerId };
    this.friendRequests.set(request.id, request);
    return { ok: true, request };
  }

  /** Empfaenger nimmt eine Freundschaftsanfrage an oder lehnt sie ab. */
  respondFriendRequest(playerId, requestId, accept) {
    const request = this.friendRequests.get(requestId);
    if (!request) return { ok: false, reason: 'not_found' };
    if (request.toPlayerId !== playerId) return { ok: false, reason: 'not_recipient' };

    this.friendRequests.delete(requestId);
    if (!accept) return { ok: true, accepted: false, request };

    const fromPlayer = this.players.get(request.fromPlayerId);
    const toPlayer = this.players.get(request.toPlayerId);
    if (!fromPlayer || !toPlayer) return { ok: false, reason: 'not_found' };

    if (!fromPlayer.friends.includes(toPlayer.id)) fromPlayer.friends.push(toPlayer.id);
    if (!toPlayer.friends.includes(fromPlayer.id)) toPlayer.friends.push(fromPlayer.id);

    return { ok: true, accepted: true, request };
  }

  /** Top-Listen nach Vermoegen und Fahndungslevel - rein aus dem bestehenden Spielerstate abgeleitet. */
  buildLeaderboards() {
    const all = [...this.players.values()].filter((p) => p.connected);

    // Bewusst nach GESAMTVERMOEGEN, nicht nach Bargeld: sonst fuehrt an, wer
    // sein Geld herumtraegt, statt wer wirklich am meisten hat - und ausgerechnet
    // die diebstahlsichere Bank waere fuer die Rangliste unsichtbar.
    // Depot MUSS mitzaehlen: sonst erscheint ausgerechnet der als arm, der sein
    // Vermoegen in Aktien haelt - derselbe Fehler, wegen dem die Kategorie
    // urspruenglich von Bargeld auf Gesamtvermoegen umgestellt wurde.
    const netWorth = (p) => p.cash + p.bank - p.debt
      + this.portfolioValue(p)
      + [...this.properties.values()].reduce(
        (sum, prop) => sum + (prop.ownerId === p.id ? prop.price + (prop.invested || 0) : 0), 0);

    const top = (list, value) => list
      .slice()
      .sort((a, b) => value(b) - value(a))
      .slice(0, LEADERBOARD_LIMIT)
      .map((p) => ({ id: p.id, name: p.name, value: Math.round(value(p)) }));

    const richest = top(all, netWorth);

    const mostWanted = top(all.filter((p) => p.wanted > 0), (p) => p.wanted);

    // Die folgenden drei Kategorien lenken Ehrgeiz auf etwas anderes als Geld.
    // Alle drei nutzen Werte, die es laengst gibt - es war nur nie etwas
    // sichtbar, wofuer sich Bildung oder ein langes Leben "lohnt".
    const smartest = top(all.filter((p) => p.smarts > 0), (p) => p.smarts);

    const oldest = top(all, (p) => p.age);

    const landlords = top(
      all.filter((p) => [...this.properties.values()].some((prop) => prop.ownerId === p.id)),
      (p) => [...this.properties.values()].filter((prop) => prop.ownerId === p.id).length,
    );

    return { richest, mostWanted, smartest, oldest, landlords };
  }

  // ---------------------------------------------------------------------
  // FAMILIE: Ehe, Kinder, Tod und Vererbung
  // ---------------------------------------------------------------------

  /** Schickt einem anderen Spieler einen Heiratsantrag. */
  proposeMarriage(fromPlayerId, toPlayerId) {
    const fromPlayer = this.players.get(fromPlayerId);
    const toPlayer = this.players.get(toPlayerId);
    if (!fromPlayer || !toPlayer) return { ok: false, reason: 'not_found' };
    if (fromPlayerId === toPlayerId) return { ok: false, reason: 'self_request' };
    if (fromPlayer.spouseId != null) return { ok: false, reason: 'already_married' };
    if (toPlayer.spouseId != null) return { ok: false, reason: 'target_already_married' };

    const alreadyPending = [...this.marriageRequests.values()].some(
      (r) => r.fromPlayerId === fromPlayerId && r.toPlayerId === toPlayerId
    );
    if (alreadyPending) return { ok: false, reason: 'already_pending' };

    const request = { id: this.nextMarriageRequestId++, fromPlayerId, toPlayerId };
    this.marriageRequests.set(request.id, request);
    return { ok: true, request };
  }

  /** Empfaenger nimmt einen Heiratsantrag an oder lehnt ab. */
  respondMarriageRequest(playerId, requestId, accept) {
    const request = this.marriageRequests.get(requestId);
    if (!request) return { ok: false, reason: 'not_found' };
    if (request.toPlayerId !== playerId) return { ok: false, reason: 'not_recipient' };

    this.marriageRequests.delete(requestId);
    if (!accept) return { ok: true, accepted: false, request };

    const fromPlayer = this.players.get(request.fromPlayerId);
    const toPlayer = this.players.get(request.toPlayerId);
    if (!fromPlayer || !toPlayer) return { ok: false, reason: 'not_found' };
    if (fromPlayer.spouseId != null || toPlayer.spouseId != null) {
      return { ok: false, reason: 'already_married' };
    }

    fromPlayer.spouseId = toPlayer.id;
    toPlayer.spouseId = fromPlayer.id;
    fromPlayer.happiness = Math.min(100, fromPlayer.happiness + MARRIAGE_HAPPINESS_BONUS);
    toPlayer.happiness = Math.min(100, toPlayer.happiness + MARRIAGE_HAPPINESS_BONUS);

    return { ok: true, accepted: true, request };
  }

  /** Beendet die Ehe. Kann von jedem der beiden Partner ausgeloest werden. */
  divorce(playerId) {
    const player = this.players.get(playerId);
    if (!player) return { ok: false, reason: 'not_found' };
    if (player.spouseId == null) return { ok: false, reason: 'not_married' };

    const spouse = this.players.get(player.spouseId);
    const exSpouseId = player.spouseId;
    player.spouseId = null;
    player.happiness = Math.max(0, player.happiness - DIVORCE_HAPPINESS_PENALTY);
    if (spouse) {
      spouse.spouseId = null;
      spouse.happiness = Math.max(0, spouse.happiness - DIVORCE_HAPPINESS_PENALTY);
    }
    return { ok: true, exSpouseId };
  }

  /** Ein verheiratetes Paar bekommt ein Kind. Kosten traegt der handelnde Spieler. */
  haveChild(playerId, name) {
    const player = this.players.get(playerId);
    if (!player) return { ok: false, reason: 'not_found' };
    if (player.spouseId == null) return { ok: false, reason: 'not_married' };
    // Ohne Zuhause kein Kind. Das gibt den Vorstadthaeusern einen Zweck, der
    // ueber eine Zahl hinausgeht, und verbindet zwei Systeme, die bisher
    // nebeneinander herliefen.
    if (!this.ownsHome(player)) return { ok: false, reason: 'no_home' };
    if (player.cash < CHILD_COST) return { ok: false, reason: 'insufficient_funds' };

    const spouse = this.players.get(player.spouseId);
    player.cash -= CHILD_COST;

    const child = {
      id: this.nextChildId++,
      name: name && String(name).trim() ? String(name).trim().slice(0, CHILD_NAME_MAX_LENGTH) : 'Kind',
      parentIds: spouse ? [player.id, spouse.id] : [player.id],
      bornAt: Date.now(),
      inheritedCash: 0,
      claimed: false,
    };
    this.children.set(child.id, child);

    player.happiness = Math.min(100, player.happiness + CHILD_HAPPINESS_BONUS);
    if (spouse) spouse.happiness = Math.min(100, spouse.happiness + CHILD_HAPPINESS_BONUS);

    return { ok: true, child };
  }

  /** Alle (noch nicht als Erbe beanspruchten) Kinder eines Spielers. */
  buildChildrenForPlayer(playerId) {
    return [...this.children.values()].filter((c) => c.parentIds.includes(playerId));
  }

  /** Sucht ein noch nicht beanspruchtes Kind, das dieser Spieler als Erbe antreten koennte. */
  findUnclaimedHeirChild(playerId) {
    const candidates = [...this.children.values()].filter(
      (c) => c.parentIds.includes(playerId) && !c.claimed
    );
    if (candidates.length === 0) return null;
    // Juengstes Kind zuerst - narrativ das naheliegendste Erbe
    candidates.sort((a, b) => b.bornAt - a.bornAt);
    return candidates[0];
  }

  /**
   * EVENT_TICK: prueft, ob ein Spieler durch Gesundheit <= 0 gestorben ist.
   * Verteilt das Erbe und markiert den Spieler als wartend auf Wiedergeburt.
   * @returns {Array} Informationen ueber frisch Verstorbene, fuer Benachrichtigungen
   */
  checkDeaths() {
    const deaths = [];
    for (const player of this.players.values()) {
      if (!player.connected) continue;
      if (this.isAwaitingReincarnation(player)) continue; // schon verarbeitet
      if (player.health > DEATH_HEALTH_THRESHOLD) continue;

      deaths.push(this.processDeath(player));
    }
    return deaths;
  }

  /** Verteilt das Erbe eines verstorbenen Spielers und setzt ihn auf "wartet auf Wiedergeburt". */
  processDeath(player) {
    const spouse = player.spouseId != null ? this.players.get(player.spouseId) : null;
    const heirChild = this.findUnclaimedHeirChild(player.id);
    const estate = player.cash;

    let ratios = null;
    if (heirChild && spouse) ratios = INHERITANCE_CHILD_AND_SPOUSE;
    else if (heirChild) ratios = INHERITANCE_CHILD_ONLY;
    else if (spouse) ratios = INHERITANCE_SPOUSE_ONLY;

    if (heirChild && ratios && ratios.child) {
      heirChild.inheritedCash += Math.round(estate * ratios.child);
    }
    if (spouse && ratios && ratios.spouse) {
      spouse.cash += Math.round(estate * ratios.spouse);
    }

    player.cash = 0;
    this.forceExitVehicle(player); // Fahrzeug bleibt am Sterbeort stehen
    player.pendingReincarnation = { heirChildId: heirChild ? heirChild.id : null };

    if (spouse) {
      spouse.spouseId = null; // verwitwet - die Ehe endet mit dem Tod
    }

    return {
      player,
      spouse,
      heirChild,
      estate,
    };
  }

  /**
   * Der Spieler entscheidet sich weiterzuleben: entweder als das Erbkind (falls vorhanden)
   * oder als komplett neues Leben. Bleibt dieselbe Verbindung/ID - kein erneuter Beitritt noetig.
   */
  reincarnate(playerId) {
    const player = this.players.get(playerId);
    if (!player) return { ok: false, reason: 'not_found' };
    if (!this.isAwaitingReincarnation(player)) return { ok: false, reason: 'not_pending' };

    const heirChildId = player.pendingReincarnation.heirChildId;
    const child = heirChildId ? this.children.get(heirChildId) : null;

    player.name = child ? child.name : player.name;
    player.age = 18;
    player.ageProgress = 0;
    player.health = 100;
    player.happiness = 70;
    player.smarts = 50;
    player.looks = 50;
    player.cash = child ? child.inheritedCash : STARTING_CASH;
    player.bank = 0;
    player.debt = 0;
    player.wanted = 0;
    player.jailedUntil = null;
    player.criminalRecord = [];
    player.job = null;      // ein neues Leben startet arbeitslos, erbt nicht die Stelle
    if (player.employerCompanyId != null) this.leaveEmployment(player.id);
    player.jobLevel = 0;
    player.jobXp = 0;
    player.vehicleId = null;      // neues Leben startet zu Fuss
    // ...und das alte Auto gehoert der alten Identitaet, nicht der neuen. Ohne
    // diese Freigabe bliebe vehicle.ownerId auf dem Verstorbenen stehen und das
    // Fahrzeug waere dauerhaft verloren - bei Reinkarnation als zentralem
    // Mechanismus des Spiels waeren nach wenigen Sitzungen alle 8 Fahrzeuge weg.
    this.releaseVehiclesOwnedBy(player.id);
    player.education = null;      // Abschluesse werden nicht vererbt
    player.enrolledCourse = null;
    player.courseProgress = 0;
    player.spouseId = null;
    player.activeEvent = null;
    player.eventQueue = [];
    player.recentEventIds = [];
    player.pendingReincarnation = null;
    player.position = { x: SPAWN_POSITION.x, y: SPAWN_POSITION.y };
    player.velocity = { x: 0, y: 0 };

    if (child) this.children.delete(heirChildId); // als Erbe "aufgebraucht"

    return { ok: true, player, becameChild: !!child };
  }

  // ---------------------------------------------------------------------
  // GESUNDHEIT & FREIZEIT: Krankenhaus (Gesundheit kaufen), Fitnessstudio
  // (Zufriedenheit kaufen)
  // ---------------------------------------------------------------------

  /**
   * Heilt vollstaendig auf. Kosten proportional zum Fehlbetrag - siehe
   * HOSPITAL_COST_PER_HEALTH in wellbeing.js fuer die Begruendung.
   */
  treatHealth(playerId) {
    const player = this.players.get(playerId);
    if (!player) return { ok: false, reason: 'not_found' };
    if (this.isJailed(player)) return { ok: false, reason: 'jailed' };
    if (this.isAwaitingReincarnation(player)) return { ok: false, reason: 'dead' };
    if (player.health >= 100) return { ok: false, reason: 'already_full' };

    const missing = 100 - player.health;
    const cost = Math.max(1, Math.round(missing * HOSPITAL_COST_PER_HEALTH));
    if (player.cash < cost) return { ok: false, reason: 'insufficient_funds' };

    const away = this.checkPlaceRequirement(player, 'treatHealth');
    if (away) return away;

    player.cash -= cost;
    player.health = 100;
    return { ok: true, cost, newHealth: player.health };
  }

  /**
   * Fester Preis, fester Zufriedenheits-Gewinn, dazu eine Abklingzeit gegen
   * Spam-Kaeufe (siehe GYM_COOLDOWN_MS in wellbeing.js).
   */
  relax(playerId) {
    const player = this.players.get(playerId);
    if (!player) return { ok: false, reason: 'not_found' };
    if (this.isJailed(player)) return { ok: false, reason: 'jailed' };
    if (this.isAwaitingReincarnation(player)) return { ok: false, reason: 'dead' };
    // Seit das Training auch das Aussehen hebt, darf volle Zufriedenheit den
    // Besuch NICHT mehr blockieren - sonst kaeme niemand mit 100 Zufriedenheit
    // noch ins Studio, um looks fuer den Medienberuf aufzubauen. Abgelehnt wird
    // nur, wenn BEIDES bereits am Anschlag ist.
    if (player.happiness >= 100 && player.looks >= 100) return { ok: false, reason: 'already_happy' };
    if (player.cash < GYM_COST) return { ok: false, reason: 'insufficient_funds' };

    const now = Date.now();
    if (now - (player.lastGymAt || 0) < GYM_COOLDOWN_MS) return { ok: false, reason: 'too_soon' };

    const away = this.checkPlaceRequirement(player, 'relax');
    if (away) return away;

    player.cash -= GYM_COST;
    player.happiness = Math.min(100, player.happiness + GYM_HAPPINESS_GAIN);
    player.looks = Math.min(100, player.looks + GYM_LOOKS_GAIN);
    player.lastGymAt = now;
    return { ok: true, cost: GYM_COST, newHappiness: player.happiness, newLooks: player.looks };
  }

  // ---------------------------------------------------------------------
  // BERUF: Bewerben, Gehalt, Befoerderung
  // ---------------------------------------------------------------------

  buildJobCatalogState() {
    return buildJobCatalog();
  }

  /** Liefert die aktuelle Stufen-Definition eines Spielers, oder null wenn arbeitslos. */
  getCurrentJobLevel(player) {
    if (!player.job) return null;
    const def = findJobDefinition(player.job);
    if (!def) return null;
    return def.levels[player.jobLevel] || null;
  }

  /**
   * Bewerbung auf einen Beruf. Anforderungen werden AUSSCHLIESSLICH hier geprueft -
   * der Client kann keine Qualifikation vortaeuschen.
   */
  applyForJob(playerId, jobId) {
    const player = this.players.get(playerId);
    if (!player) return { ok: false, reason: 'not_found' };
    if (this.isJailed(player)) return { ok: false, reason: 'jailed' };
    if (this.isAwaitingReincarnation(player)) return { ok: false, reason: 'dead' };
    if (player.job) return { ok: false, reason: 'already_employed' };
    // Nicht gleichzeitig bei einem Mitspieler angestellt sein
    if (player.employerCompanyId != null) return { ok: false, reason: 'employed_by_player' };

    const def = findJobDefinition(jobId);
    if (!def) return { ok: false, reason: 'unknown_job' };
    if (player.smarts < def.minSmarts) return { ok: false, reason: 'not_smart_enough' };
    if (player.looks < (def.minLooks || 0)) return { ok: false, reason: 'not_pretty_enough' };
    if (player.wanted > def.maxWanted) return { ok: false, reason: 'criminal_record' };

    const away = this.checkPlaceRequirement(player, 'applyForJob');
    if (away) return away;

    player.job = def.id;
    player.jobLevel = 0;
    player.jobXp = 0;

    return { ok: true, jobName: def.name, title: def.levels[0].title, salary: def.levels[0].salary };
  }

  /** Kuendigt den aktuellen Beruf. Erfahrung ist damit verloren. */
  quitJob(playerId) {
    const player = this.players.get(playerId);
    if (!player) return { ok: false, reason: 'not_found' };
    if (!player.job) return { ok: false, reason: 'not_employed' };

    player.job = null;
    player.jobLevel = 0;
    player.jobXp = 0;
    player.happiness = Math.max(0, player.happiness - QUIT_HAPPINESS_PENALTY);

    return { ok: true };
  }

  /**
   * slowTick: zahlt Gehalt an alle arbeitenden Spieler und sammelt Berufserfahrung.
   * Im Gefaengnis oder nach dem Tod gibt es kein Gehalt und keine Erfahrung.
   * @returns {Array} Befoerderungen, fuer Benachrichtigungen
   */
  payAndProgressJobs() {
    const promotions = [];

    for (const player of this.players.values()) {
      if (!player.connected || !player.job) continue;
      if (this.isJailed(player) || this.isAwaitingReincarnation(player)) continue;

      const def = findJobDefinition(player.job);
      const level = def ? def.levels[player.jobLevel] : null;
      if (!def || !level) {
        // Beruf existiert nicht mehr (z.B. nach einem Update) - sauber freistellen,
        // statt den Spieler in einem kaputten Zustand haengen zu lassen.
        player.job = null;
        player.jobLevel = 0;
        player.jobXp = 0;
        continue;
      }

      // Krank draengt aufs Gehalt, unmotiviert auf den Aufstieg - zwei
      // unterschiedliche Wirkungen, damit man am Ergebnis erkennt, wohin man
      // laufen muss (Krankenhaus vs. Fitnessstudio). Ohne diese Kopplung waeren
      // Gesundheit und Zufriedenheit nur kosmetische HUD-Zahlen.
      const salary = player.health < HEALTH_SICK_THRESHOLD
        ? Math.round(level.salary * HEALTH_SICK_SALARY_MULT)
        : level.salary;
      const xpGain = player.happiness < HAPPINESS_LOW_THRESHOLD
        ? XP_PER_TICK * HAPPINESS_LOW_XP_MULT
        : XP_PER_TICK;

      player.cash += salary;
      player.jobXp += xpGain;

      if (level.xpToPromote != null && player.jobXp >= level.xpToPromote) {
        player.jobLevel += 1;
        player.jobXp = 0;
        const newLevel = def.levels[player.jobLevel];
        promotions.push({
          player,
          jobName: def.name,
          newTitle: newLevel.title,
          newSalary: newLevel.salary,
        });
      }
    }

    return promotions;
  }

  // ---------------------------------------------------------------------
  // BILDUNG: Kurse belegen, lernen, Intelligenz dauerhaft steigern
  // ---------------------------------------------------------------------

  buildCourseCatalogState() {
    return buildCourseCatalog();
  }

  /**
   * Schreibt einen Spieler in einen Kurs ein. Kosten werden SOFORT abgebucht -
   * Abbrechen gibt kein Geld zurueck, das macht die Entscheidung verbindlich.
   */
  enrollInCourse(playerId, courseId) {
    const player = this.players.get(playerId);
    if (!player) return { ok: false, reason: 'not_found' };
    if (this.isJailed(player)) return { ok: false, reason: 'jailed' };
    if (this.isAwaitingReincarnation(player)) return { ok: false, reason: 'dead' };
    if (player.enrolledCourse) return { ok: false, reason: 'already_enrolled' };

    const course = findCourse(courseId);
    if (!course) return { ok: false, reason: 'unknown_course' };

    // Bereits abgeschlossene oder uebersprungene Stufen verhindern
    if (player.education === course.id) return { ok: false, reason: 'already_completed' };
    if (course.requires && player.education !== course.requires) {
      return { ok: false, reason: 'missing_prerequisite' };
    }

    if (player.cash < course.cost) return { ok: false, reason: 'insufficient_funds' };

    const away = this.checkPlaceRequirement(player, 'enrollInCourse');
    if (away) return away;

    player.cash -= course.cost;
    player.enrolledCourse = course.id;
    player.courseProgress = 0;

    return { ok: true, course };
  }

  /** Bricht den laufenden Kurs ab. Bereits gezahlte Gebuehren sind verloren. */
  dropCourse(playerId) {
    const player = this.players.get(playerId);
    if (!player) return { ok: false, reason: 'not_found' };
    if (!player.enrolledCourse) return { ok: false, reason: 'not_enrolled' };

    player.enrolledCourse = null;
    player.courseProgress = 0;
    return { ok: true };
  }

  /**
   * Wie viele Lern-Ticks ein Kurs fuer diesen Spieler tatsaechlich braucht.
   * Wer nebenbei arbeitet, kommt langsamer voran.
   */
  requiredTicksFor(player, course) {
    return player.job ? course.durationTicks * EMPLOYED_STUDY_SLOWDOWN : course.durationTicks;
  }

  /**
   * slowTick: Lernfortschritt sammeln und abgeschlossene Kurse auswerten.
   * Im Gefaengnis oder nach dem Tod wird nicht gelernt.
   * @returns {Array} abgeschlossene Kurse, fuer Benachrichtigungen
   */
  progressCourses() {
    const completions = [];

    for (const player of this.players.values()) {
      if (!player.connected || !player.enrolledCourse) continue;
      if (this.isJailed(player) || this.isAwaitingReincarnation(player)) continue;

      const course = findCourse(player.enrolledCourse);
      if (!course) {
        // Kurs existiert nicht mehr (z.B. nach einem Update) - sauber ausbuchen,
        // statt den Spieler in einem kaputten Zustand haengen zu lassen.
        player.enrolledCourse = null;
        player.courseProgress = 0;
        continue;
      }

      player.courseProgress += 1;

      const required = this.requiredTicksFor(player, course);
      if (player.courseProgress >= required) {
        const smartsBefore = player.smarts;
        player.smarts = Math.min(MAX_SMARTS, player.smarts + course.smartsGain);
        player.education = course.id;
        player.enrolledCourse = null;
        player.courseProgress = 0;

        completions.push({
          player,
          courseName: course.name,
          smartsGained: player.smarts - smartsBefore,
          newSmarts: player.smarts,
        });
      }
    }

    return completions;
  }
}

module.exports = {
  GameWorld,
  MAX_PLAYERS,
  FAST_TICK_MS,
  SLOW_TICK_MS,
  EVENT_TICK_MS,
  COPS_TICK_MS,
  SNAPSHOT_INTERVAL_MS,
  SNAPSHOT_PATH,
  PLAYER_SPEED,
  PLAYER_ACCELERATION,
  PLAYER_FRICTION,
};
