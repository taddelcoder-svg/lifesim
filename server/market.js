'use strict';

// server/market.js
// Wertpapierhandel. Bisher gab es genau eine passive Einkommensquelle
// (Immobilien) und eine aktive (Firmen) - beide teuer, beide traege. Die Boerse
// ist die dritte: billig einzusteigen, jederzeit liquide, dafuer ohne garantierte
// Rendite.
//
// DAS ZENTRALE PROBLEM WAR DIE GELDMENGE. Ein naiver Aktienmarkt erzeugt Geld
// aus dem Nichts: steigt ein Kurs und alle verkaufen, entsteht Gewinn, den nie
// jemand eingezahlt hat. Loesung wie beim Banktresor (Steuer) und beim
// Versicherungstopf (Praemien): ein KASSENBESTAND. Jeder Kauf zahlt hinein,
// jeder Verkauf daraus - und es wird nie mehr ausgezahlt, als drin ist. Damit
// stammt jeder Gewinn nachweislich aus den Kaeufen anderer Spieler.

// Vier Papiere, bewusst mit unterschiedlichem Charakter: wer Sicherheit will,
// nimmt HAFEN, wer Bewegung sucht, nimmt QUANT. Ohne diesen Unterschied waere
// die Wahl zwischen ihnen beliebig.
const STOCKS = [
  { symbol: 'HAFEN', name: 'Hafenlogistik AG',   basePrice: 40,  volatility: 0.010 },
  { symbol: 'STROM', name: 'Stadtwerke Union',   basePrice: 75,  volatility: 0.018 },
  { symbol: 'BAUCO', name: 'Baucon Holding',     basePrice: 120, volatility: 0.030 },
  { symbol: 'QUANT', name: 'Quantum Dynamics',   basePrice: 210, volatility: 0.055 },
];

// Kurse bewegen sich bei jedem slowTick (10s).
//
// Rueckkehr zum Ausgangswert: ohne sie waeren die Kurse ein reiner Zufallslauf
// und trieben irgendwann gegen 0 oder ins Unendliche - ein Papier bei 4000 waere
// fuer neue Spieler unkaufbar, eins bei 0,3 sinnlos. Der Wert zieht also stets
// leicht zu seinem Ausgangsniveau zurueck.
const MEAN_REVERSION = 0.04;

// Handel bewegt den Kurs: wer viel kauft, treibt ihn hoch und zahlt fuer die
// spaeteren Stuecke mehr. Das verhindert, dass jemand mit grossem Vermoegen
// risikolos den gesamten Bestand billig aufkauft.
const TRADE_IMPACT_PER_SHARE = 0.0015;

// Harte Grenzen, damit kein Kurs ins Absurde laeuft.
const MIN_PRICE_RATIO = 0.25; // nie unter 25% des Ausgangswerts
const MAX_PRICE_RATIO = 4;    // nie ueber 400%

// Obergrenze je Papier und Spieler. Ohne sie koennte ein einzelner Reicher den
// Kurs beliebig hochkaufen und beim Verkauf die gesamte Kasse leeren.
const MAX_SHARES_PER_STOCK = 200;

/** Startzustand der Kurse. */
function createInitialMarket() {
  const prices = {};
  for (const s of STOCKS) prices[s.symbol] = s.basePrice;
  return { prices, reserve: 0 };
}

function findStock(symbol) {
  return STOCKS.find((s) => s.symbol === symbol) || null;
}

/**
 * Ein Kursschritt: Zufallsbewegung plus Rueckkehr zum Ausgangswert, danach
 * begrenzt. `random` wird hereingereicht, damit sich der Schritt testen laesst.
 */
function stepPrice(stock, current, random = Math.random) {
  const shock = (random() * 2 - 1) * stock.volatility;
  const pull = (stock.basePrice - current) / stock.basePrice * MEAN_REVERSION;
  const next = current * (1 + shock + pull);
  const min = stock.basePrice * MIN_PRICE_RATIO;
  const max = stock.basePrice * MAX_PRICE_RATIO;
  return Math.round(Math.min(max, Math.max(min, next)) * 100) / 100;
}

/**
 * Kurswirkung eines Handels. Kauf treibt hoch, Verkauf drueckt - beides
 * proportional zur Stueckzahl.
 */
function applyTradeImpact(stock, current, shares, isBuy) {
  const factor = 1 + (isBuy ? 1 : -1) * shares * TRADE_IMPACT_PER_SHARE;
  const min = stock.basePrice * MIN_PRICE_RATIO;
  const max = stock.basePrice * MAX_PRICE_RATIO;
  return Math.round(Math.min(max, Math.max(min, current * factor)) * 100) / 100;
}

module.exports = {
  STOCKS,
  MEAN_REVERSION,
  TRADE_IMPACT_PER_SHARE,
  MIN_PRICE_RATIO,
  MAX_PRICE_RATIO,
  MAX_SHARES_PER_STOCK,
  createInitialMarket,
  findStock,
  stepPrice,
  applyTradeImpact,
};
