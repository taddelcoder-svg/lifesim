'use strict';

// server/social.js
// Konstanten fuer Chat und Ranglisten.

const MAX_CHAT_LENGTH = 200;
const CHAT_HISTORY_LIMIT = 50; // wie viele Nachrichten neu beigetretene Spieler rueckwirkend sehen
const LEADERBOARD_LIMIT = 10;  // Top-N pro Rangliste

module.exports = {
  MAX_CHAT_LENGTH,
  CHAT_HISTORY_LIMIT,
  LEADERBOARD_LIMIT,
};
