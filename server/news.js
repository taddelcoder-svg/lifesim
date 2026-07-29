'use strict';

// server/news.js
// Stadtnachrichten. Von den rund 66 Broadcasts im Server ging bisher praktisch
// keiner an Unbeteiligte: Ueberfaelle, Einbrueche, Verhaftungen, Todesfaelle und
// Wahlergebnisse erfuhren nur die direkt Betroffenen. Fuer alle anderen war die
// Stadt still - man spielte nebeneinander statt miteinander.
//
// WAS GEMELDET WIRD UND WAS NICHT: Die Nachrichten berichten, was oeffentlich
// wahrnehmbar waere - nicht, was nur Server und Opfer wissen.
//
//   Straftaten werden OHNE Taeternamen gemeldet ("Einbruch in der Villa am
//   Park"). Wer es war, ist Sache der Polizei - genau dafuer gibt es
//   Fahndungslevel und Verfolgung. Wuerde die Zeitung den Namen nennen, waere
//   jedes Verbrechen sofort und ohne Ermittlung aufgeklaert, und das gesamte
//   Kriminalitaetssystem verloere seinen Sinn.
//
//   Verhaftungen dagegen MIT Namen: die sind oeffentlich, und sie sind der
//   Moment, in dem sich die Anonymitaet des Taeters aufloest. Ebenso Heirat,
//   Geburt, Tod und Wahlergebnis.

// Wie viele Meldungen vorgehalten werden. Genug fuer ein paar Minuten
// Rueckschau, wenig genug, dass die Liste nicht unbegrenzt waechst und in jedem
// Spielstand landet.
const NEWS_LIMIT = 40;

// Nur zur Einfaerbung in der Oberflaeche.
const NEWS_KINDS = ['crime', 'police', 'life', 'politics', 'economy'];

module.exports = {
  NEWS_LIMIT,
  NEWS_KINDS,
};
