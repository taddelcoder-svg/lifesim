'use strict';

// server/economy.js
// Wirtschaftsdaten: eine FEST begrenzte Liste von Immobilien (echte Konkurrenz,
// da nur wenige existieren) sowie Konstanten fuer das Firmensystem.

const PROPERTIES = [
  { id: 'prop_1', name: 'Altbauwohnung Zentrum', price: 800, incomePerTick: 12, maintenancePerTick: 3, position: { x: 400, y: 400 } },
  { id: 'prop_2', name: 'Reihenhaus Vorort', price: 1200, incomePerTick: 16, maintenancePerTick: 4, position: { x: 1600, y: 400 } },
  { id: 'prop_3', name: 'Loft am Fluss', price: 2000, incomePerTick: 24, maintenancePerTick: 6, position: { x: 400, y: 1600 } },
  { id: 'prop_4', name: 'Villa am Stadtrand', price: 3500, incomePerTick: 38, maintenancePerTick: 10, position: { x: 1600, y: 1600 } },
  { id: 'prop_5', name: 'Ladenlokal Hauptstraße', price: 1500, incomePerTick: 22, maintenancePerTick: 5, position: { x: 1000, y: 300 } },
  { id: 'prop_6', name: 'Bürofläche City', price: 2600, incomePerTick: 30, maintenancePerTick: 8, position: { x: 1000, y: 1700 } },
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
