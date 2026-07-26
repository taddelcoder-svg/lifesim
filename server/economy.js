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

const COMPANY_FOUNDING_COST = 500;
const COMPANY_INCOME_PER_TICK = 14;
const COMPANY_UPKEEP_PER_TICK = 5;

const PROPERTY_SELL_BACK_RATIO = 0.7; // Rueckverkauf an die Bank zu 70% des Kaufpreises
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
  COMPANY_INCOME_PER_TICK,
  COMPANY_UPKEEP_PER_TICK,
  PROPERTY_SELL_BACK_RATIO,
  COMPANY_CLOSE_REFUND_RATIO,
  WEALTH_TAX_RATE,
  TRADE_RESPONSE_DURATION_MS,
};
