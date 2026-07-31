'use strict';

// server/economy.js
// Wirtschaftsdaten: eine FEST begrenzte Liste von Immobilien (echte Konkurrenz,
// da nur wenige existieren) sowie Konstanten fuer das Firmensystem.

// Positionen liegen bewusst in den Mitten der Stadtblöcke (Raster alle 400
// Einheiten, also Blockmitten bei 200/600/1000/1400/1800) - so stehen die
// Gebaeude nicht in den Strassen, die server/world.js erzeugt.
const PROPERTIES = [
  { id: 'prop_1', name: 'Altbauwohnung Zentrum', price: 800, incomePerTick: 12, maintenancePerTick: 3, position: { x: 1000, y: 1000 } },
  { id: 'prop_2', name: 'Reihenhaus Vorort', price: 1200, incomePerTick: 16, maintenancePerTick: 4, position: { x: 1400, y: 600 } },
  { id: 'prop_3', name: 'Loft am Fluss', price: 2000, incomePerTick: 24, maintenancePerTick: 6, position: { x: 600, y: 1400 } },
  { id: 'prop_4', name: 'Villa am Stadtrand', price: 3500, incomePerTick: 38, maintenancePerTick: 10, position: { x: 1800, y: 1800 } },
  { id: 'prop_5', name: 'Ladenlokal Hauptstraße', price: 1500, incomePerTick: 22, maintenancePerTick: 5, position: { x: 1000, y: 200 } },
  { id: 'prop_6', name: 'Bürofläche City', price: 2600, incomePerTick: 30, maintenancePerTick: 8, position: { x: 1000, y: 1800 } },
  { id: 'prop_7', name: 'Dachgeschoss Innenstadt', price: 2200, incomePerTick: 27, maintenancePerTick: 7, position: { x: 600, y: 1000 } },
  { id: 'prop_8', name: 'Studio Altstadt', price: 700, incomePerTick: 11, maintenancePerTick: 3, position: { x: 200, y: 600 } },
  { id: 'prop_9', name: 'Werkstatt Industriegebiet', price: 1100, incomePerTick: 17, maintenancePerTick: 5, position: { x: 200, y: 1800 } },
  { id: 'prop_10', name: 'Café am Marktplatz', price: 1700, incomePerTick: 25, maintenancePerTick: 7, position: { x: 1400, y: 1000 } },
  { id: 'prop_11', name: 'Doppelhaushälfte', price: 1400, incomePerTick: 19, maintenancePerTick: 5, position: { x: 1800, y: 600 } },
  { id: 'prop_12', name: 'Penthouse Skyline', price: 4200, incomePerTick: 45, maintenancePerTick: 13, position: { x: 1000, y: 600 } },
  { id: 'prop_13', name: 'Lagerhalle Hafen', price: 900, incomePerTick: 14, maintenancePerTick: 4, position: { x: 200, y: 1400 } },
  { id: 'prop_14', name: 'Stadthaus Nordviertel', price: 1900, incomePerTick: 26, maintenancePerTick: 7, position: { x: 600, y: 200 } },
];

// Obergrenze fuer Firmen pro Spieler. Anders als bei Fahrzeugen (endliche
// Weltausstattung) gibt es hier KEINE natuerliche Bremse: eine Firma amortisiert
// sich auf Stufe 3 in gut zwei Minuten, ohne Deckel koennte ein einzelner Spieler
// beliebig viele gruenden und die Wirtschaft aushebeln.
const MAX_OWNED_COMPANIES = 3;

// --- Laeden (Gewerbebezirk) ---
//
// Die 68 Gewerbegebaeude werden kaufbar. Sie sind eine EIGENE Preisklasse und
// treten nicht in Konkurrenz zu den 14 kuratierten Immobilien - deren Knappheit
// ist oben ausdruecklich als Absicht vermerkt und wuerde durch 68 zusaetzliche
// Objekte zunichtegemacht.
//
// Der Unterschied liegt in der Rendite, nicht im Preis: kuratierte Objekte
// amortisieren in 15-22 Minuten, Laeden in 39-50. Wer Kapital hat, kauft
// weiterhin lieber ein gutes Objekt; Laeden sind der Einstieg und die Menge.
const SHOP_MIN_PRICE = 500;
const SHOP_MAX_PRICE = 1500;
const SHOP_INCOME_RATIO = 0.007;
const SHOP_MAINTENANCE_RATIO = 0.45; // Anteil AM ERTRAG, nicht am Preis

// Obergrenze je Spieler. Ohne sie koennte ein Vermoegender alle 68 aufkaufen -
// bei den kuratierten 14 uebernimmt der Preis diese Rolle, bei billigen Laeden
// nicht.
const MAX_OWNED_SHOPS = 5;

// Deterministische Namensteile: aus der Position abgeleitet, damit jeder Client
// dieselben Namen sieht, ohne dass sie uebertragen werden muessen (Grundsatz 4).
// --- Wohnhaeuser (Vorstadt) ---
//
// Die 68 Vorstadthaeuser sind die dritte und letzte Klasse - und die einzige,
// die KEIN Geld einbringt. Ein Zuhause ist eine laufende Ausgabe mit einem
// nicht-monetaeren Gegenwert: es haelt die Zufriedenheit ueber einer
// Untergrenze und ist Voraussetzung fuer Kinder.
//
// Dass sie nichts abwerfen, macht sie nebenbei uninteressant fuer Einbrecher -
// die Beute richtet sich nach dem Ertrag. Das ist beabsichtigt: aus einer
// Privatwohnung ist mechanisch nichts zu holen, aus einem Laden schon.
const HOME_MIN_PRICE = 600;
const HOME_MAX_PRICE = 1800;
const HOME_MAINTENANCE_RATIO = 0.004; // Anteil am Preis, pro Zyklus
const MAX_OWNED_HOMES = 1;            // man wohnt an einem Ort

// Untergrenze, unter die die Zufriedenheit mit eigenem Zuhause nicht weiter
// faellt. Bewusst kein Bonus obendrauf: ein Zuhause ist Sicherheit, kein
// Rausch - und ein zusaetzlicher Abzug auf den Verfall koennte diesen zusammen
// mit drei Freunden online auf null bringen und die ganze Verfallsmechanik
// aushebeln.
const HOME_HAPPINESS_FLOOR = 45;

const HOME_NAMES = [
  'Reihenhaus', 'Doppelhaus', 'Bungalow', 'Stadtvilla', 'Siedlerhaus', 'Eckhaus',
];
const HOME_STREETS = [
  'Amselweg', 'Birkenring', 'Am Anger', 'Erlengrund', 'Wiesenpfad', 'Talstraße',
];

const SHOP_NAMES = [
  'Bäckerei', 'Kiosk', 'Friseur', 'Buchladen', 'Blumen', 'Apotheke',
  'Eisdiele', 'Werkstatt', 'Café', 'Schneiderei', 'Optiker', 'Imbiss',
];
const SHOP_STREETS = [
  'am Markt', 'Nordseite', 'Hafenweg', 'Lindenhof', 'Ostring', 'Ecke West',
];

// Ausbaustufen fuer Immobilien - dieselbe Idee wie bei den Firmen, aber als
// FAKTOREN statt fester Werte, weil jede Immobilie einen eigenen Ertrag hat.
//
// Der Unterhalt steigt bewusst mit: ein Ausbau soll den Ertrag erhoehen, nicht
// die Marge verdoppeln. Und weil Einbruchsbeute, Alarmkosten und
// Versicherungspraemie alle am Ertrag haengen, macht jeder Ausbau das Objekt
// automatisch auch zum lohnenderen Ziel und teurer im Schutz - Reichtum wird
// dadurch sichtbar riskanter, ohne dass dafuer eine Extraregel noetig waere.
//
// upgradeCostRatio bezieht sich auf den KAUFPREIS der Immobilie.
const PROPERTY_LEVELS = [
  { level: 1, upgradeCostRatio: null, incomeMult: 1,   maintenanceMult: 1,   name: 'Grundzustand' },
  { level: 2, upgradeCostRatio: 0.6,  incomeMult: 1.5, maintenanceMult: 1.3, name: 'renoviert' },
  { level: 3, upgradeCostRatio: 1.2,  incomeMult: 2.2, maintenanceMult: 1.8, name: 'luxussaniert' },
];

const COMPANY_FOUNDING_COST = 500;

// Ausbaustufen. Stufe 1 bekommt man beim Gruenden, hoehere kosten Geld und
// bringen mehr Ertrag sowie Platz fuer mehr Mitarbeiter.
const COMPANY_LEVELS = [
  { level: 1, upgradeCost: null, income: 14, upkeep: 5,  maxEmployees: 1 },
  { level: 2, upgradeCost: 1200, income: 24, upkeep: 9,  maxEmployees: 2 },
  { level: 3, upgradeCost: 3000, income: 40, upkeep: 15, maxEmployees: 4 },
];

// Mitarbeiter: Was ein Angestellter der Firma einbringt und was er kostet.
// Der Lohn liegt bewusst ueber dem Einstiegsgehalt im Einzelhandel (18), damit
// eine Anstellung bei einem Mitspieler fuer Neulinge attraktiv ist. Die Differenz
// bleibt beim Firmeninhaber - so lohnt sich Einstellen fuer beide Seiten.
const EMPLOYEE_INCOME_PER_TICK = 40;
const EMPLOYEE_WAGE_PER_TICK = 25;
const EMPLOYMENT_OFFER_DURATION_MS = 60000;

const PROPERTY_SELL_BACK_RATIO = 0.7;   // Rueckverkauf an die Bank zu 70% des Kaufpreises
const COMPANY_CLOSE_REFUND_RATIO = 0.5; // Teilrueckerstattung bei Firmenschliessung

// WICHTIG: Immobilien/Firmen werfen bewusst mehr ab als sie an Unterhalt kosten
// (sonst waere niemand motiviert, welche zu kaufen). Damit Vermoegen trotzdem
// nicht unbegrenzt waechst, gibt es zusaetzlich eine kleine Vermoegenssteuer auf
// das Barvermoegen selbst - DAS ist die eigentliche Geld-Senke der Wirtschaft.
const WEALTH_TAX_RATE = 0.01; // 1% des Bargeldes pro slowTick

const TRADE_RESPONSE_DURATION_MS = 60000; // 60s Zeit, ein Handelsangebot anzunehmen/abzulehnen

module.exports = {
  PROPERTIES,
  COMPANY_FOUNDING_COST,
  COMPANY_LEVELS,
  MAX_OWNED_COMPANIES,
  SHOP_MIN_PRICE,
  SHOP_MAX_PRICE,
  SHOP_INCOME_RATIO,
  SHOP_MAINTENANCE_RATIO,
  MAX_OWNED_SHOPS,
  HOME_MIN_PRICE,
  HOME_MAX_PRICE,
  HOME_MAINTENANCE_RATIO,
  MAX_OWNED_HOMES,
  HOME_HAPPINESS_FLOOR,
  HOME_NAMES,
  HOME_STREETS,
  SHOP_NAMES,
  SHOP_STREETS,
  PROPERTY_LEVELS,
  EMPLOYEE_INCOME_PER_TICK,
  EMPLOYEE_WAGE_PER_TICK,
  EMPLOYMENT_OFFER_DURATION_MS,
  PROPERTY_SELL_BACK_RATIO,
  COMPANY_CLOSE_REFUND_RATIO,
  WEALTH_TAX_RATE,
  TRADE_RESPONSE_DURATION_MS,
};
