'use strict';

// client/hud.js
// Alles, was UEBER der 3D-Welt liegt und nicht zu einem bestimmten Menue
// gehoert: Statuskarte, naechstes Lebensziel, Minimap, grosse Karte mit
// Wegpunkt, Ortsknopf, Lebensziele-Panel, Erfolgsmeldung, Joystick und
// Tastenkuerzel.
//
// Wird NACH dem Skript in index.html geladen und benutzt dessen globale
// Funktionen (setMarketTab, showToast) und Elemente. Der Renderer ruft
// update() zehnmal und drawMinimap() dreissigmal pro Sekunde auf.

// Welcher Reiter im Markt-Menue zu welchem Ort gehoert. So oeffnet der
// Ortsknopf direkt das Richtige, statt dass man suchen muss.
const PLACE_TAB = {
  jobcenter: 'geld', university: 'geld', bank: 'geld', exchange: 'geld',
  realestate: 'besitz', cityhall: 'besitz', dealership: 'besitz',
  hospital: 'ich', gym: 'ich', petshop: 'ich',
  lawoffice: 'stadt', townhall: 'stadt', raceoffice: 'stadt', blackmarket: 'stadt',
};

const PLACE_DOT = {
  jobcenter: '#57b36a', university: '#7a7ae0', bank: '#3fb0c0', realestate: '#d4a04a',
  cityhall: '#c05a86', hospital: '#e05a5a', gym: '#4fc0a0', dealership: '#b8b84a',
  lawoffice: '#8a8aa8', townhall: '#c09a5a', exchange: '#4ac088', blackmarket: '#555560',
  raceoffice: '#e07a4a', petshop: '#e0a0c0',
};

const MINIMAP_RANGE = 650;   // Server-Einheiten vom Mittelpunkt bis zum Rand
const METERS_PER_UNIT = 1 / 10;

function hudEsc(text) {
  return String(text == null ? '' : text).replace(/[&<>"']/g, (z) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[z]));
}

function formatMoney(n) {
  return '$' + Math.round(n || 0).toLocaleString('de-DE');
}

function formatDistance(units) {
  const m = units * METERS_PER_UNIT;
  return m >= 1000 ? (m / 1000).toFixed(1).replace('.', ',') + ' km' : Math.round(m) + ' m';
}

class GameHud {
  constructor(net, renderer) {
    this.net = net;
    this.renderer = renderer;
    this.hudEl = document.getElementById('hud');
    this.lastHudKey = '';
    this.lastGoalKey = '';
    this.waypoint = null;        // vom Spieler auf der Karte gesetzt
    this.popQueue = [];
    this.popActive = false;
    this.isTouch = (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) || 'ontouchstart' in window;
    if (this.isTouch) document.body.classList.add('touch');

    this.buildTopBar();
    this.buildGoalCard();
    this.buildMinimap();
    this.buildMap();
    this.buildPlacePrompt();
    this.buildGoalsPanel();
    this.buildAchievementPop();
    this.buildJoystick();
    this.buildControlsHint();
    this.bindCameraGestures();
    this.bindHotkeys();

    net.onAchievementsState = () => {
      this.lastGoalKey = '';
      this.updateGoalCard();
      if (this.goalsPanel.style.display === 'block') this.renderGoalsPanel();
      this.updateGoalsBadge();
    };
    net.onAchievementUnlocked = (msg) => this.queueAchievementPop(msg);
  }

  // -----------------------------------------------------------------------
  // Aufbau
  // -----------------------------------------------------------------------

  buildTopBar() {
    const bar = document.createElement('div');
    bar.id = 'topBar';

    this.goalsBtn = document.createElement('button');
    this.goalsBtn.innerHTML = '🏆 <span class="lbl">Ziele</span><span class="badge"></span>';
    this.goalsBtn.title = 'Lebensziele (Z)';
    this.goalsBtn.addEventListener('click', () => this.toggleGoalsPanel());

    this.mapBtn = document.createElement('button');
    this.mapBtn.innerHTML = '🗺️ <span class="lbl">Karte</span>';
    this.mapBtn.title = 'Stadtkarte (M)';
    this.mapBtn.addEventListener('click', () => this.toggleMap());

    this.socialBtnEl = document.getElementById('socialBtn');
    this.marketBtnEl = document.getElementById('marketBtn');
    this.socialBtnEl.innerHTML = '👥 <span class="lbl">Sozial</span>';
    this.marketBtnEl.innerHTML = '📋 <span class="lbl">Menü</span>';
    this.marketBtnEl.title = 'Geld, Beruf, Besitz, Stadt';

    bar.append(this.goalsBtn, this.mapBtn, this.socialBtnEl, this.marketBtnEl);
    document.body.appendChild(bar);

    // Die Panels liegen alle an derselben Stelle - nie zwei gleichzeitig.
    this.marketPanelEl = document.getElementById('marketPanel');
    this.socialPanelEl = document.getElementById('socialPanel');
    this.marketBtnEl.addEventListener('click', () => {
      if (this.marketPanelEl.style.display !== 'none') this.closePanels('market');
      this.syncTopBarState();
    });
    this.socialBtnEl.addEventListener('click', () => {
      if (this.socialPanelEl.style.display !== 'none') this.closePanels('social');
      this.syncTopBarState();
    });
  }

  closePanels(except) {
    if (except !== 'market') this.marketPanelEl.style.display = 'none';
    if (except !== 'social') this.socialPanelEl.style.display = 'none';
    if (except !== 'goals') this.goalsPanel.style.display = 'none';
    this.syncTopBarState();
  }

  syncTopBarState() {
    this.marketBtnEl.classList.toggle('active', this.marketPanelEl.style.display !== 'none');
    this.socialBtnEl.classList.toggle('active', this.socialPanelEl.style.display !== 'none');
    this.goalsBtn.classList.toggle('active', this.goalsPanel && this.goalsPanel.style.display === 'block');
  }

  buildGoalCard() {
    this.goalCard = document.createElement('div');
    this.goalCard.id = 'goalCard';
    this.goalCard.addEventListener('click', () => this.toggleGoalsPanel(true));
    document.body.appendChild(this.goalCard);
  }

  buildMinimap() {
    this.mini = document.createElement('canvas');
    this.mini.id = 'minimap';
    this.mini.title = 'Karte öffnen (M)';
    this.mini.addEventListener('click', () => this.toggleMap(true));
    document.body.appendChild(this.mini);
    this.miniNorth = document.createElement('div');
    this.miniNorth.id = 'minimapNorth';
    this.miniNorth.textContent = 'N';
    document.body.appendChild(this.miniNorth);
  }

  buildMap() {
    this.mapOverlay = document.createElement('div');
    this.mapOverlay.id = 'mapOverlay';
    this.mapOverlay.innerHTML =
      '<button id="mapClose">✕ Schließen</button>' +
      '<canvas id="mapCanvas"></canvas>' +
      '<div id="mapHint">Tippe auf einen Ort, um einen Wegpunkt zu setzen. Nochmal tippen entfernt ihn.</div>';
    document.body.appendChild(this.mapOverlay);
    this.mapCanvas = this.mapOverlay.querySelector('#mapCanvas');
    this.mapOverlay.querySelector('#mapClose').addEventListener('click', () => this.toggleMap(false));
    this.mapOverlay.addEventListener('click', (e) => { if (e.target === this.mapOverlay) this.toggleMap(false); });
    this.mapCanvas.addEventListener('click', (e) => this.onMapClick(e));
  }

  buildPlacePrompt() {
    this.prompt = document.createElement('div');
    this.prompt.id = 'placePrompt';
    this.prompt.innerHTML = '<div><div class="pp-name"></div><div class="pp-sub"></div></div><button></button>';
    this.promptBtn = this.prompt.querySelector('button');
    this.promptBtn.addEventListener('click', () => this.openCurrentPlace());
    document.body.appendChild(this.prompt);
  }

  buildGoalsPanel() {
    this.goalsPanel = document.createElement('div');
    this.goalsPanel.id = 'goalsPanel';
    document.body.appendChild(this.goalsPanel);
  }

  buildAchievementPop() {
    this.pop = document.createElement('div');
    this.pop.id = 'achievementPop';
    document.body.appendChild(this.pop);
  }

  buildControlsHint() {
    if (this.isTouch) return;
    const h = document.createElement('div');
    h.id = 'controlsHint';
    h.innerHTML = '<kbd>WASD</kbd>/<kbd>Pfeile</kbd> laufen · Maus ziehen: Kamera · Rad: Zoom · ' +
      '<kbd>E</kbd> Ort · <kbd>F</kbd> Auto · <kbd>M</kbd> Karte · <kbd>Z</kbd> Ziele · <kbd>Enter</kbd> Chat';
    document.body.appendChild(h);
    this.controlsHint = h;
    setTimeout(() => { h.style.opacity = '0'; }, 30000);
  }

  /**
   * Joystick fuer Touch-Geraete. Setzt dieselben Tasten wie WASD - der Server
   * kennt nur diese vier, also wird der Winkel auf acht Richtungen abgebildet.
   */
  buildJoystick() {
    const base = document.createElement('div');
    base.id = 'joystick';
    const knob = document.createElement('div');
    knob.id = 'joystickKnob';
    base.appendChild(knob);
    document.body.appendChild(base);

    let pointerId = null;
    const R = 44;
    const set = (w, a, s, d) => {
      this.net.setKey('w', w); this.net.setKey('a', a);
      this.net.setKey('s', s); this.net.setKey('d', d);
    };
    const move = (e) => {
      const rect = base.getBoundingClientRect();
      let dx = e.clientX - (rect.left + rect.width / 2);
      let dy = e.clientY - (rect.top + rect.height / 2);
      const len = Math.hypot(dx, dy);
      if (len > R) { dx = dx / len * R; dy = dy / len * R; }
      knob.style.transform = `translate(${dx}px, ${dy}px)`;
      if (len < 14) { set(false, false, false, false); return; }
      const nx = dx / len;
      const ny = dy / len;
      const t = 0.38; // sin(22,5 Grad): Grenze zwischen gerade und schraeg
      set(ny < -t, nx < -t, ny > t, nx > t);
    };
    const end = (e) => {
      if (e.pointerId !== pointerId) return;
      pointerId = null;
      knob.style.transform = '';
      set(false, false, false, false);
    };
    base.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      pointerId = e.pointerId;
      try { base.setPointerCapture(e.pointerId); } catch (err) { /* aeltere Browser */ }
      move(e);
    });
    base.addEventListener('pointermove', (e) => { if (e.pointerId === pointerId) move(e); });
    base.addEventListener('pointerup', end);
    base.addEventListener('pointercancel', end);
    window.addEventListener('blur', () => { if (pointerId != null) end({ pointerId }); });
  }

  /**
   * Zoom und Neigung der Kamera. Die waagerechte Drehung macht weiterhin
   * index.html - hier kommen nur Mausrad, senkrechtes Ziehen und Pinch dazu.
   */
  bindCameraGestures() {
    const canvas = document.getElementById('gameCanvas');
    if (!canvas || !this.renderer) return;
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.renderer.zoomCamera(Math.sign(e.deltaY) * Math.min(2, Math.abs(e.deltaY) * 0.01));
    }, { passive: false });

    const pointers = new Map();
    let pinchStart = null;
    canvas.addEventListener('pointerdown', (e) => {
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        pinchStart = Math.hypot(a.x - b.x, a.y - b.y);
      }
    });
    canvas.addEventListener('pointermove', (e) => {
      const prev = pointers.get(e.pointerId);
      if (!prev) return;
      const dy = e.clientY - prev.y;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 1) {
        this.renderer.tiltCamera(dy * 0.004);
      } else if (pointers.size === 2 && pinchStart) {
        const [a, b] = [...pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        this.renderer.zoomCamera((pinchStart - d) * 0.03);
        pinchStart = d;
      }
    });
    const up = (e) => {
      pointers.delete(e.pointerId);
      if (pointers.size < 2) pinchStart = null;
    };
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);
    canvas.addEventListener('pointerleave', up);
  }

  bindHotkeys() {
    window.addEventListener('keydown', (e) => {
      const t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) {
        if (e.key === 'Escape') t.blur();
        return;
      }
      if (!this.net.localPlayer) return;
      const k = e.key.toLowerCase();
      if (k === 'e') { this.openCurrentPlace(); }
      else if (k === 'm') { this.toggleMap(); }
      else if (k === 'z' || k === 'y') { this.toggleGoalsPanel(); }
      else if (k === 'f') {
        const btn = document.getElementById('vehicleBtn');
        if (btn && !btn.disabled) btn.click();
      } else if (k === 'enter') {
        this.closePanels('social');
        if (this.socialPanelEl.style.display === 'none') this.socialBtnEl.click();
        const chatTab = document.querySelector('.social-tab[data-section="chatSection"]');
        if (chatTab) chatTab.click();
        const input = document.getElementById('chatInput');
        if (input) setTimeout(() => input.focus(), 0);
        e.preventDefault();
      } else if (k === 'escape') {
        if (this.mapOverlay.classList.contains('open')) this.toggleMap(false);
        else this.closePanels(null);
      } else if (k === '+' || k === '=') { this.renderer && this.renderer.zoomCamera(-1); }
      else if (k === '-') { this.renderer && this.renderer.zoomCamera(1); }
    });
  }

  // -----------------------------------------------------------------------
  // Laufende Aktualisierung
  // -----------------------------------------------------------------------

  update() {
    const me = this.net.localPlayer;
    if (!me) return;
    this.updateStatusCard(me);
    this.updateGoalCard();
    this.updatePlacePrompt();
    this.updateWaypoint(me);
    if (this.mapOverlay.classList.contains('open') && this.renderer && this.renderer.frameCount % 18 === 0) {
      this.drawMap();
    }
  }

  jobTitle(me) {
    if (me.employerCompanyId != null) {
      const c = this.net.companies && this.net.companies.get(me.employerCompanyId);
      return 'Angestellt' + (c ? ' bei ' + c.name : '');
    }
    if (!me.job) return 'Arbeitslos';
    const jobDef = (this.net.jobCatalog || []).find((j) => j.id === me.job);
    const level = jobDef ? jobDef.levels[me.jobLevel] : null;
    return level ? level.title : 'Angestellt';
  }

  updateStatusCard(me) {
    const env = this.net.environment || {};
    const online = [...this.net.players.values()].filter((p) => p.connected !== false).length;
    const jailed = me.jailedUntil != null && me.jailedUntil > Date.now();

    let travel = '🚶 zu Fuß';
    if (me.vehicleId != null) {
      const v = this.net.vehicles.get(me.vehicleId);
      const type = v ? this.net.vehicleCatalog.find((t) => t.id === v.typeId) : null;
      travel = '🚗 ' + (type ? type.name : 'Fahrzeug');
    }

    let study = '';
    if (me.enrolledCourse) {
      const course = (this.net.courseCatalog || []).find((c) => c.id === me.enrolledCourse);
      const required = course ? (me.job ? course.durationTicks * 2 : course.durationTicks) : 0;
      study = `🎓 ${course ? course.name : 'Kurs'} ${me.courseProgress ?? 0}/${required}`;
    }

    const stats = [
      ['❤️', 'Gesundheit', me.health ?? 100, '#ff6b6b', true],
      ['😊', 'Laune', me.happiness ?? 70, '#ffd35a', true],
      ['🧠', 'Grips', me.smarts ?? 50, '#6fa8ff', false],
      ['✨', 'Aussehen', me.looks ?? 50, '#ff8ad8', false],
    ].map(([i, n, v, c, warnLow]) => [i, n, Math.max(0, Math.min(100, Math.round(v))), c, warnLow]);

    const key = JSON.stringify([me.name, me.age, me.cash, me.bank, me.debt, me.wanted, this.jobTitle(me),
      stats.map((s) => s[2]), env.phase, env.weather, env.policeRangeMult, online, travel, study, jailed]);
    if (key === this.lastHudKey) return;
    this.lastHudKey = key;

    const chips = [];
    if (me.wanted > 0) chips.push(`<span class="hud-chip warn">🚨 ${'⭐'.repeat(Math.min(me.wanted, 5))}</span>`);
    if (jailed) chips.push('<span class="hud-chip warn">🚔 Gefängnis</span>');
    const envIcon = env.phase === 'night' ? '🌙 Nacht' : '☀️ Tag';
    const wIcon = env.weather === 'rain' ? ' · 🌧️' : env.weather === 'fog' ? ' · 🌫️' : '';
    chips.push(`<span class="hud-chip">${envIcon}${wIcon}</span>`);
    if (env.policeRangeMult != null && env.policeRangeMult < 1) chips.push('<span class="hud-chip good">👀 Polizei sieht schlechter</span>');
    chips.push(`<span class="hud-chip">${hudEsc(travel)}</span>`);
    if (study) chips.push(`<span class="hud-chip">${hudEsc(study)}</span>`);
    chips.push(`<span class="hud-chip">👥 ${online} online</span>`);

    const bars = stats.map(([icon, name, v, color, warnLow]) =>
      `<div class="hud-bar${warnLow && v < 25 ? ' low' : ''}"><div class="row"><span>${icon} ${name}</span><b>${v}</b></div>` +
      `<div class="track"><div class="fill" style="width:${v}%;background:${color}"></div></div></div>`).join('');

    this.hudEl.innerHTML =
      `<div class="hud-top"><div class="hud-avatar">${hudEsc((me.name || '?').charAt(0).toUpperCase())}</div>` +
      `<div style="min-width:0"><div class="hud-name">${hudEsc(me.name)}</div>` +
      `<div class="hud-sub">${me.age} Jahre · ${hudEsc(this.jobTitle(me))}</div></div></div>` +
      `<div class="hud-money"><span class="cash" title="Bargeld">💵 ${formatMoney(me.cash)}</span>` +
      ((me.bank ?? 0) > 0 ? `<span class="bank" title="Bankkonto">🏦 ${formatMoney(me.bank)}</span>` : '') +
      ((me.debt ?? 0) > 0 ? `<span class="debt" title="Schulden">−${formatMoney(me.debt)}</span>` : '') +
      `</div><div class="hud-bars">${bars}</div><div class="hud-chips">${chips.join('')}</div>`;

    this.positionGoalCard();
  }

  positionGoalCard() {
    const r = this.hudEl.getBoundingClientRect();
    this.goalCard.style.top = (r.bottom + 8) + 'px';
  }

  nextGoal() {
    const list = this.net.achievements || [];
    return list.find((a) => !a.doneAt) || null;
  }

  placeById(id) {
    return (this.net.places || []).find((p) => p.id === id) || null;
  }

  updateGoalCard() {
    const me = this.net.localPlayer;
    const goal = this.nextGoal();
    if (!me || !goal) {
      this.goalCard.style.display = 'none';
      return;
    }
    const place = goal.place ? this.placeById(goal.place) : null;
    const dist = place ? Math.hypot(place.position.x - me.x, place.position.y - me.y) : null;
    const distText = place
      ? (dist <= place.range ? `📍 ${place.name} · du bist da!` : `📍 ${place.name} · ${formatDistance(dist)}`)
      : '';
    const pct = goal.progress ? Math.round(goal.progress[0] / goal.progress[1] * 100) : null;
    const reward = this.rewardText(goal.reward);

    const key = [goal.id, distText, pct, reward].join('|');
    if (key !== this.lastGoalKey) {
      this.lastGoalKey = key;
      this.goalCard.innerHTML =
        '<div class="goal-label">Nächstes Ziel</div>' +
        `<div class="goal-title">${goal.icon} ${hudEsc(goal.title)}</div>` +
        `<div class="goal-desc">${hudEsc(goal.desc)}</div>` +
        (pct != null ? `<div class="goal-track"><div class="goal-fill" style="width:${pct}%"></div></div>` : '') +
        `<div class="goal-meta"><span>${hudEsc(distText)}</span><span>${hudEsc(reward)}</span></div>`;
    }
    this.goalCard.style.display = 'block';
    this.positionGoalCard();
  }

  rewardText(r) {
    if (!r) return '';
    const parts = [];
    if (r.cash) parts.push('+' + formatMoney(r.cash));
    if (r.happiness) parts.push('+' + r.happiness + ' 😊');
    return parts.join(' ');
  }

  /**
   * Wegmarke in der 3D-Welt: der selbst gesetzte Wegpunkt hat Vorrang,
   * sonst der Ort des naechsten Lebensziels.
   */
  updateWaypoint(me) {
    if (!this.renderer) return;
    if (this.waypoint) {
      const d = Math.hypot(this.waypoint.x - me.x, this.waypoint.y - me.y);
      if (d < (this.waypoint.range || 120)) {
        if (typeof showToast === 'function') showToast(`📍 Angekommen: ${this.waypoint.name}`);
        this.waypoint = null;
      }
    }
    let target = null;
    if (this.waypoint) target = { position: { x: this.waypoint.x, y: this.waypoint.y } };
    else {
      const goal = this.nextGoal();
      const place = goal && goal.place ? this.placeById(goal.place) : null;
      if (place) target = place;
    }
    const key = target ? target.position.x + ',' + target.position.y : '';
    if (key !== this._markerKey) {
      this._markerKey = key;
      this.renderer.setGoalMarker(target);
    }
  }

  markerTarget() {
    if (this.waypoint) return { x: this.waypoint.x, y: this.waypoint.y };
    const goal = this.nextGoal();
    const place = goal && goal.place ? this.placeById(goal.place) : null;
    return place ? { x: place.position.x, y: place.position.y } : null;
  }

  updatePlacePrompt() {
    const place = this.net.currentPlace();
    const busy = this.marketPanelEl.style.display !== 'none' || this.mapOverlay.classList.contains('open');
    if (!place || busy) {
      this.prompt.classList.remove('show');
      this._promptId = null;
      return;
    }
    if (this._promptId !== place.id) {
      this._promptId = place.id;
      this.prompt.querySelector('.pp-name').textContent = `${place.icon} ${place.name}`;
      this.prompt.querySelector('.pp-sub').textContent = 'Du stehst hier – was möchtest du tun?';
      this.promptBtn.innerHTML = (this.isTouch ? '' : '<kbd>E</kbd>') + 'Öffnen';
    }
    this.prompt.classList.add('show');
  }

  openCurrentPlace() {
    const place = this.net.currentPlace();
    if (!place) return;
    this.openMarket(PLACE_TAB[place.id] || null);
  }

  openMarket(tab) {
    this.closePanels('market');
    if (this.marketPanelEl.style.display === 'none') this.marketBtnEl.click();
    if (tab && typeof setMarketTab === 'function') setMarketTab(tab);
    this.syncTopBarState();
  }

  // -----------------------------------------------------------------------
  // Lebensziele
  // -----------------------------------------------------------------------

  toggleGoalsPanel(force) {
    const open = force != null ? force : this.goalsPanel.style.display !== 'block';
    if (open) {
      this.closePanels('goals');
      this.goalsPanel.style.display = 'block';
      this.net.requestAchievements();
      this.renderGoalsPanel();
    } else {
      this.goalsPanel.style.display = 'none';
    }
    this.syncTopBarState();
  }

  updateGoalsBadge() {
    const list = this.net.achievements || [];
    const done = list.filter((a) => a.doneAt).length;
    const badge = this.goalsBtn.querySelector('.badge');
    const neu = this.unseenAchievements || 0;
    badge.style.display = neu > 0 ? 'block' : 'none';
    badge.textContent = String(neu);
    this.goalsBtn.title = `Lebensziele: ${done}/${list.length} (Z)`;
  }

  renderGoalsPanel() {
    this.unseenAchievements = 0;
    this.updateGoalsBadge();
    const list = this.net.achievements || [];
    const done = list.filter((a) => a.doneAt).length;
    const next = this.nextGoal();
    const pct = list.length ? Math.round(done / list.length * 100) : 0;

    let html = '<h4>🏆 Lebensziele</h4>' +
      `<div class="gp-sum">${done} von ${list.length} erreicht – jedes Ziel bringt eine Belohnung.</div>` +
      `<div class="gp-total"><div style="width:${pct}%"></div></div>`;
    for (const a of list) {
      const cls = a.doneAt ? 'done' : (next && a.id === next.id ? 'next' : '');
      const p = a.progress ? Math.round(a.progress[0] / a.progress[1] * 100) : null;
      const reward = this.rewardText(a.reward);
      html += `<div class="gp-item ${cls}"><div class="gp-icon">${a.icon}</div><div class="gp-body">` +
        `<div class="gp-title">${hudEsc(a.title)}</div><div class="gp-desc">${hudEsc(a.desc)}</div>` +
        (reward ? `<div class="gp-reward">Belohnung: ${hudEsc(reward)}</div>` : '') +
        (p != null ? `<div class="gp-track"><div style="width:${p}%"></div></div>` : '') +
        '</div>' +
        (a.doneAt ? '<div class="gp-check">✓</div>'
          : (a.place ? `<button class="gp-go" data-place="${hudEsc(a.place)}">📍 Hin</button>` : '')) +
        '</div>';
    }
    this.goalsPanel.innerHTML = html;
    for (const btn of this.goalsPanel.querySelectorAll('.gp-go')) {
      btn.addEventListener('click', () => {
        const place = this.placeById(btn.dataset.place);
        if (place) this.setWaypointToPlace(place);
        this.toggleGoalsPanel(false);
      });
    }
  }

  setWaypointToPlace(place) {
    this.waypoint = { x: place.position.x, y: place.position.y, name: place.name, range: place.range };
    if (typeof showToast === 'function') showToast(`📍 Wegpunkt: ${place.icon} ${place.name} – folge der goldenen Lichtsäule`);
  }

  queueAchievementPop(msg) {
    this.popQueue.push(msg);
    this.unseenAchievements = (this.unseenAchievements || 0) + 1;
    this.updateGoalsBadge();
    if (!this.popActive) this.showNextPop();
  }

  showNextPop() {
    const msg = this.popQueue.shift();
    if (!msg) { this.popActive = false; return; }
    this.popActive = true;
    const reward = this.rewardText(msg.reward);
    this.pop.innerHTML = '<div class="ap-kicker">Lebensziel erreicht</div>' +
      `<div class="ap-icon">${msg.icon}</div><div class="ap-title">${hudEsc(msg.title)}</div>` +
      (reward ? `<div class="ap-reward">${hudEsc(reward)}</div>` : '');
    this.pop.classList.add('show');
    this.chime();
    setTimeout(() => {
      this.pop.classList.remove('show');
      setTimeout(() => this.showNextPop(), 450);
    }, 3200);
  }

  /** Kurzer Dreiklang mit WebAudio - keine Tondatei noetig. */
  chime() {
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      if (!this.audio) this.audio = new Ctx();
      const ac = this.audio;
      const t0 = ac.currentTime;
      [523.25, 659.25, 783.99].forEach((f, i) => {
        const o = ac.createOscillator();
        const g = ac.createGain();
        o.type = 'triangle';
        o.frequency.value = f;
        g.gain.setValueAtTime(0, t0 + i * 0.09);
        g.gain.linearRampToValueAtTime(0.12, t0 + i * 0.09 + 0.02);
        g.gain.exponentialRampToValueAtTime(0.001, t0 + i * 0.09 + 0.6);
        o.connect(g).connect(ac.destination);
        o.start(t0 + i * 0.09);
        o.stop(t0 + i * 0.09 + 0.65);
      });
    } catch (err) { /* ohne Ton ist es auch gut */ }
  }

  // -----------------------------------------------------------------------
  // Minimap - dreht sich mit der Kamera, "oben" ist immer die Blickrichtung
  // -----------------------------------------------------------------------

  drawMinimap() {
    const me = this.net.localPlayer;
    if (!me) return;
    const cssSize = this.mini.clientWidth;
    if (!cssSize) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const size = Math.round(cssSize * dpr);
    if (this.mini.width !== size) { this.mini.width = size; this.mini.height = size; }
    const ctx = this.mini.getContext('2d');
    const c = size / 2;
    const scale = c / MINIMAP_RANGE;
    const yaw = this.net.cameraYaw || 0;
    const fx = Math.sin(yaw), fy = Math.cos(yaw);   // vorwaerts
    const rx = -Math.cos(yaw), ry = Math.sin(yaw);  // rechts
    const tx = (x, y) => {
      const dx = x - me.x, dy = y - me.y;
      return [c + (dx * rx + dy * ry) * scale, c - (dx * fx + dy * fy) * scale];
    };

    ctx.save();
    ctx.clearRect(0, 0, size, size);
    ctx.beginPath();
    ctx.arc(c, c, c, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = '#26331f';
    ctx.fillRect(0, 0, size, size);

    // Weltflaeche
    const W = WORLD_WIDTH;
    this.polygon(ctx, [tx(0, 0), tx(W, 0), tx(W, W), tx(0, W)], '#4d6e36');

    // Strassen
    ctx.strokeStyle = '#b9bec7';
    ctx.lineCap = 'butt';
    for (const r of this.net.worldRoads || []) {
      ctx.lineWidth = Math.max(2, r.width * scale);
      const a = r.orientation === 'vertical' ? tx(r.center, 0) : tx(0, r.center);
      const b = r.orientation === 'vertical' ? tx(r.center, W) : tx(W, r.center);
      ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
    }

    // Gebaeude
    const reach = MINIMAP_RANGE * 1.5;
    for (const b of this.net.worldBuildings || []) {
      if (Math.abs(b.x - me.x) > reach || Math.abs(b.y - me.y) > reach) continue;
      this.rect(ctx, tx, b.x, b.y, b.w, b.d, '#6f7a86');
    }
    for (const p of this.net.properties.values()) {
      if (Math.abs(p.position.x - me.x) > reach || Math.abs(p.position.y - me.y) > reach) continue;
      const col = !p.ownerId ? '#8a8f99' : (p.ownerId === this.net.myId ? '#5b8cff' : '#d86a6a');
      this.rect(ctx, tx, p.position.x, p.position.y, 70, 70, col);
    }

    // Orte
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `${Math.round(12 * dpr)}px system-ui, sans-serif`;
    for (const pl of this.net.places || []) {
      const [x, y] = tx(pl.position.x, pl.position.y);
      if (x < -20 || y < -20 || x > size + 20 || y > size + 20) continue;
      ctx.fillStyle = PLACE_DOT[pl.id] || '#999';
      ctx.beginPath(); ctx.arc(x, y, 9 * dpr, 0, Math.PI * 2); ctx.fill();
      ctx.fillText(pl.icon, x, y + dpr);
    }

    // Polizei und andere Spieler
    for (const cop of this.net.cops.values()) {
      const [x, y] = tx(cop.x, cop.y);
      ctx.fillStyle = (Math.floor(Date.now() / 300) % 2) ? '#ff4d4d' : '#4d7bff';
      ctx.beginPath(); ctx.arc(x, y, 3.5 * dpr, 0, Math.PI * 2); ctx.fill();
    }
    for (const p of this.net.players.values()) {
      if (p.id === this.net.myId || p.connected === false) continue;
      const [x, y] = tx(p.x, p.y);
      ctx.fillStyle = '#ffffff';
      ctx.strokeStyle = '#1b2230';
      ctx.lineWidth = 1.5 * dpr;
      ctx.beginPath(); ctx.arc(x, y, 4 * dpr, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    }

    // Ziel: am Rand festhalten, wenn es ausserhalb liegt
    const target = this.markerTarget();
    if (target) {
      let [x, y] = tx(target.x, target.y);
      const dx = x - c, dy = y - c;
      const d = Math.hypot(dx, dy);
      const max = c - 10 * dpr;
      if (d > max) { x = c + dx / d * max; y = c + dy / d * max; }
      ctx.fillStyle = '#ffd35a';
      ctx.strokeStyle = '#3a2d05';
      ctx.lineWidth = 2 * dpr;
      this.star(ctx, x, y, 8 * dpr);
    }

    // Eigene Figur: Pfeil in Laufrichtung
    const facing = this.renderer ? (this.renderer.facingById.get(this.net.myId) || 0) : 0;
    const wx = Math.sin(facing), wy = Math.cos(facing);
    const ang = Math.atan2(wx * rx + wy * ry, wx * fx + wy * fy);
    ctx.translate(c, c);
    ctx.rotate(ang);
    ctx.fillStyle = '#5b8cff';
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2 * dpr;
    ctx.beginPath();
    ctx.moveTo(0, -9 * dpr); ctx.lineTo(7 * dpr, 7 * dpr); ctx.lineTo(0, 3 * dpr); ctx.lineTo(-7 * dpr, 7 * dpr);
    ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.restore();

    // Nordmarke am Rand: Norden ist -y auf der Karte
    const nAng = Math.atan2(-ry, -fy);
    const rect = this.mini.getBoundingClientRect();
    const rr = rect.width / 2;
    this.miniNorth.style.left = (rect.left + rr + Math.sin(nAng) * (rr - 2)) + 'px';
    this.miniNorth.style.top = (rect.top + rr - Math.cos(nAng) * (rr - 2)) + 'px';
  }

  polygon(ctx, pts, fill) {
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.closePath();
    ctx.fill();
  }

  rect(ctx, tx, x, y, w, d, fill) {
    this.polygon(ctx, [tx(x - w / 2, y - d / 2), tx(x + w / 2, y - d / 2), tx(x + w / 2, y + d / 2), tx(x - w / 2, y + d / 2)], fill);
  }

  star(ctx, x, y, r) {
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + i * Math.PI / 5;
      const rad = i % 2 === 0 ? r : r * 0.45;
      ctx.lineTo(x + Math.cos(a) * rad, y + Math.sin(a) * rad);
    }
    ctx.closePath();
    ctx.stroke();
    ctx.fill();
  }

  // -----------------------------------------------------------------------
  // Grosse Karte - Norden oben, ganze Stadt
  // -----------------------------------------------------------------------

  toggleMap(force) {
    const open = force != null ? force : !this.mapOverlay.classList.contains('open');
    this.mapOverlay.classList.toggle('open', open);
    if (open) this.drawMap();
  }

  drawMap() {
    const me = this.net.localPlayer;
    const cssSize = Math.floor(Math.min(window.innerWidth * 0.92, window.innerHeight - 110, 820));
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const size = Math.round(cssSize * dpr);
    const cv = this.mapCanvas;
    cv.style.width = cssSize + 'px';
    cv.style.height = cssSize + 'px';
    if (cv.width !== size) { cv.width = size; cv.height = size; }
    const ctx = cv.getContext('2d');
    const W = WORLD_WIDTH;
    const s = size / W;
    const tx = (x, y) => [x * s, y * s];
    this.mapScale = s;
    this.mapDpr = dpr;

    ctx.fillStyle = '#4d6e36';
    ctx.fillRect(0, 0, size, size);
    // Bezirke leicht einfaerben, damit man sie wiedererkennt
    const core = 2800 * s;
    ctx.fillStyle = 'rgba(91,140,255,0.08)'; ctx.fillRect(core, 0, size - core, core);
    ctx.fillStyle = 'rgba(111,220,140,0.08)'; ctx.fillRect(0, core, core, size - core);
    ctx.fillStyle = 'rgba(255,160,67,0.08)'; ctx.fillRect(core, core, size - core, size - core);

    ctx.strokeStyle = '#c3c8d0';
    for (const r of this.net.worldRoads || []) {
      ctx.lineWidth = Math.max(2, r.width * s);
      ctx.beginPath();
      if (r.orientation === 'vertical') { ctx.moveTo(r.center * s, 0); ctx.lineTo(r.center * s, size); }
      else { ctx.moveTo(0, r.center * s); ctx.lineTo(size, r.center * s); }
      ctx.stroke();
    }
    for (const b of this.net.worldBuildings || []) this.rect(ctx, tx, b.x, b.y, b.w, b.d, '#6f7a86');
    for (const p of this.net.properties.values()) {
      const col = !p.ownerId ? '#8a8f99' : (p.ownerId === this.net.myId ? '#5b8cff' : '#d86a6a');
      this.rect(ctx, tx, p.position.x, p.position.y, 80, 80, col);
    }

    ctx.font = `600 ${Math.round(11 * dpr)}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const pl of this.net.places || []) {
      const [x, y] = tx(pl.position.x, pl.position.y);
      ctx.fillStyle = PLACE_DOT[pl.id] || '#999';
      ctx.beginPath(); ctx.arc(x, y, 11 * dpr, 0, Math.PI * 2); ctx.fill();
      ctx.font = `${Math.round(13 * dpr)}px system-ui, sans-serif`;
      ctx.fillText(pl.icon, x, y + dpr);
      ctx.font = `600 ${Math.round(11 * dpr)}px system-ui, sans-serif`;
      const label = pl.name;
      const w = ctx.measureText(label).width + 8 * dpr;
      ctx.fillStyle = 'rgba(12,16,24,0.75)';
      ctx.fillRect(x - w / 2, y + 13 * dpr, w, 15 * dpr);
      ctx.fillStyle = '#fff';
      ctx.fillText(label, x, y + 20.5 * dpr);
    }

    for (const p of this.net.players.values()) {
      if (p.connected === false || p.id === this.net.myId) continue;
      const [x, y] = tx(p.x, p.y);
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.arc(x, y, 4 * dpr, 0, Math.PI * 2); ctx.fill();
      ctx.fillText(p.name, x, y - 10 * dpr);
    }
    for (const cop of this.net.cops.values()) {
      const [x, y] = tx(cop.x, cop.y);
      ctx.fillStyle = '#ff4d4d';
      ctx.beginPath(); ctx.arc(x, y, 3.5 * dpr, 0, Math.PI * 2); ctx.fill();
    }

    const target = this.markerTarget();
    if (target) {
      const [x, y] = tx(target.x, target.y);
      ctx.fillStyle = '#ffd35a';
      ctx.strokeStyle = '#3a2d05';
      ctx.lineWidth = 2 * dpr;
      this.star(ctx, x, y - 16 * dpr, 9 * dpr);
    }
    if (me) {
      const [x, y] = tx(me.x, me.y);
      ctx.fillStyle = '#5b8cff';
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 3 * dpr;
      ctx.beginPath(); ctx.arc(x, y, 7 * dpr, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#fff';
      ctx.fillText('Du', x, y - 16 * dpr);
    }
  }

  onMapClick(e) {
    const rect = this.mapCanvas.getBoundingClientRect();
    const px = (e.clientX - rect.left) * this.mapDpr;
    const py = (e.clientY - rect.top) * this.mapDpr;
    const wx = px / this.mapScale;
    const wy = py / this.mapScale;

    // Erneut auf den bestehenden Wegpunkt: entfernen
    if (this.waypoint && Math.hypot(this.waypoint.x - wx, this.waypoint.y - wy) * this.mapScale < 24 * this.mapDpr) {
      this.waypoint = null;
      this.drawMap();
      return;
    }
    // Naechsten Ort in Reichweite des Fingers suchen
    let best = null;
    let bestD = Infinity;
    for (const pl of this.net.places || []) {
      const d = Math.hypot(pl.position.x - wx, pl.position.y - wy) * this.mapScale;
      if (d < bestD) { bestD = d; best = pl; }
    }
    if (best && bestD < 26 * this.mapDpr) {
      this.setWaypointToPlace(best);
    } else {
      this.waypoint = { x: wx, y: wy, name: 'Wegpunkt', range: 100 };
    }
    this.drawMap();
  }
}
