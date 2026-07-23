'use strict';

// client/render.js
// Zeichnet die Welt aus Sicht des lokalen Spielers (zentrierte Kamera)
// und aktualisiert das HUD. Reine Darstellung - keine Spiellogik.

const GRID_SIZE = 100;
const PLAYER_RADIUS = 14;

class Renderer {
  constructor(canvas, net) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.net = net;
    this.lastFrame = performance.now();
    this.running = false;
    this.hud = document.getElementById('hud');
  }

  start() {
    this.running = true;
    this.lastFrame = performance.now();
    requestAnimationFrame((t) => this.loop(t));
  }

  loop(now) {
    if (!this.running) return;
    const dt = now - this.lastFrame;
    this.lastFrame = now;

    this.net.update(dt);
    this.draw();
    this.updateHud();

    requestAnimationFrame((t) => this.loop(t));
  }

  draw() {
    const ctx = this.ctx;
    const { width, height } = this.canvas;
    ctx.fillStyle = '#1a1d23';
    ctx.fillRect(0, 0, width, height);

    const me = this.net.localPlayer;
    if (!me) return;

    // Kamera zentriert auf eigenen Spieler
    const camX = me.x - width / 2;
    const camY = me.y - height / 2;

    ctx.strokeStyle = '#2a2f3a';
    ctx.lineWidth = 1;
    const offsetX = ((camX % GRID_SIZE) + GRID_SIZE) % GRID_SIZE;
    const offsetY = ((camY % GRID_SIZE) + GRID_SIZE) % GRID_SIZE;
    for (let x = -offsetX; x < width; x += GRID_SIZE) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
    }
    for (let y = -offsetY; y < height; y += GRID_SIZE) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }

    for (const p of this.net.players.values()) {
      if (p.connected === false) continue;
      const sx = p.x - camX;
      const sy = p.y - camY;
      if (sx < -50 || sx > width + 50 || sy < -50 || sy > height + 50) continue;

      const isMe = p.id === this.net.myId;
      ctx.fillStyle = isMe ? '#4a7cff' : '#e05a5a';
      ctx.beginPath();
      ctx.arc(sx, sy, PLAYER_RADIUS, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#e8e8e8';
      ctx.font = '12px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(`${p.name} (${p.age})`, sx, sy - PLAYER_RADIUS - 6);
    }
  }

  updateHud() {
    const me = this.net.localPlayer;
    if (!me) return;
    const online = [...this.net.players.values()].filter((p) => p.connected !== false).length;
    this.hud.innerHTML =
      `Name: ${me.name} &nbsp;|&nbsp; Alter: ${me.age} &nbsp;|&nbsp; Cash: $${me.cash ?? 0}<br>` +
      `Spieler online: ${online} / 20 &nbsp;|&nbsp; Steuerung: WASD`;
  }
}
