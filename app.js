/* ============================================================
   Conste — Constellation Notes
   ============================================================ */
(() => {
  'use strict';

  // --- Constants ---
  const COLORS = ['#7C5CFC','#38BDF8','#34D399','#F472B6','#FB923C','#A78BFA','#22D3EE','#FBBF24'];
  const STORAGE_KEY = 'conste_data';
  const ONBOARDED_KEY = 'conste_onboarded';
  const TAP_THRESHOLD = 10;
  const TAP_TIMEOUT = 280;
  const OVERLAP_DIST = 90;
  const NODE_W_DEFAULT = 140; // fallback for nodes not yet measured
  const MIN_SCALE = 0.25;
  const MAX_SCALE = 3;

  // --- Util ---
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const hypot = (ax, ay, bx, by) => Math.hypot(bx - ax, by - ay);
  const pick = arr => arr[Math.floor(Math.random() * arr.length)];

  // ============================================================
  // Store — data persistence
  // ============================================================
  class Store {
    constructor() {
      this.data = { nodes: [], links: [] };
      this._load();
    }
    _load() {
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) this.data = JSON.parse(raw);
      } catch (e) { /* ignore */ }
    }
    save() {
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(this.data)); } catch (e) { /* ignore */ }
    }

    // Nodes
    addNode(n) { this.data.nodes.push(n); this.save(); return n; }
    getNode(id) { return this.data.nodes.find(n => n.id === id); }
    updateNode(id, u) {
      const n = this.getNode(id);
      if (n) { Object.assign(n, u, { updatedAt: Date.now() }); this.save(); }
      return n;
    }
    deleteNode(id) {
      this.data.nodes = this.data.nodes.filter(n => n.id !== id);
      this.data.links = this.data.links.filter(l => l.s !== id && l.t !== id);
      this.save();
    }

    // Links
    hasLink(a, b) {
      return this.data.links.some(l =>
        (l.s === a && l.t === b) || (l.s === b && l.t === a));
    }
    toggleLink(a, b) {
      const i = this.data.links.findIndex(l =>
        (l.s === a && l.t === b) || (l.s === b && l.t === a));
      if (i >= 0) { this.data.links.splice(i, 1); this.save(); return false; }
      this.data.links.push({ s: a, t: b }); this.save(); return true;
    }
    linksOf(id) { return this.data.links.filter(l => l.s === id || l.t === id); }
  }

  // ============================================================
  // StarField — animated background
  // ============================================================
  class StarField {
    constructor(canvas) {
      this.c = canvas;
      this.ctx = canvas.getContext('2d');
      this.stars = [];
      this.shooting = [];
      this.lastShoot = 0;
      this.vpx = 0;
      this.vpy = 0;
      this.bhParticles = [];
      this._resize();
      this._generate();
      this._generateBH();
      window.addEventListener('resize', () => { this._resize(); this._generate(); this._generateBH(); });
      this._loop();
    }
    setViewport(x, y) {
      this.vpx = x;
      this.vpy = y;
    }
    _resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      this.w = window.innerWidth;
      this.h = window.innerHeight;
      this.c.width = this.w * dpr;
      this.c.height = this.h * dpr;
      this.c.style.width = this.w + 'px';
      this.c.style.height = this.h + 'px';
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    _generate() {
      const count = Math.floor(this.w * this.h / 2000);
      this.stars = [];
      for (let i = 0; i < count; i++) {
        const layer = i < count * 0.6 ? 0 : i < count * 0.85 ? 1 : 2;
        const r = layer === 0 ? Math.random() * 0.8 + 0.2
                : layer === 1 ? Math.random() * 1.0 + 0.5
                : Math.random() * 1.5 + 0.8;
        const a = layer === 0 ? Math.random() * 0.3 + 0.08
                : layer === 1 ? Math.random() * 0.4 + 0.15
                : Math.random() * 0.5 + 0.2;
        const pf = layer === 0 ? 0.02 : layer === 1 ? 0.05 : 0.1;
        this.stars.push({
          x: Math.random() * this.w * 1.4 - this.w * 0.2,
          y: Math.random() * this.h * 1.4 - this.h * 0.2,
          r, a,
          sp: Math.random() * 1.5 + 0.3,
          ph: Math.random() * Math.PI * 2,
          pf, layer,
          color: layer === 2 && Math.random() > 0.6
            ? COLORS[Math.floor(Math.random() * COLORS.length)]
            : null,
        });
      }
    }

    // --- Black Hole ---
    _generateBH() {
      this.bhParticles = [];
      // Accretion disk particles
      for (let i = 0; i < 80; i++) {
        this.bhParticles.push({
          angle: Math.random() * Math.PI * 2,
          dist: 20 + Math.random() * 55,
          speed: (0.4 + Math.random() * 0.8),
          size: Math.random() * 1.4 + 0.3,
          alpha: Math.random() * 0.7 + 0.2,
          colorIdx: Math.floor(Math.random() * COLORS.length),
          z: (Math.random() - 0.5) * 0.6, // vertical offset for 3D disk
        });
      }
    }

    _bhPos() {
      // Upper-right area with subtle parallax
      return {
        x: this.w * 0.78 + this.vpx * 0.025,
        y: this.h * 0.2 + this.vpy * 0.025,
      };
    }

    _drawBlackHole(ctx, t) {
      const bh = this._bhPos();
      const bx = bh.x, by = bh.y;
      const ehR = 16; // event horizon radius
      const influenceR = 120; // gravitational influence radius

      // 1. Gravitational glow — very subtle large halo
      const haloG = ctx.createRadialGradient(bx, by, ehR, bx, by, influenceR);
      haloG.addColorStop(0, 'rgba(80, 50, 180, 0.06)');
      haloG.addColorStop(0.4, 'rgba(60, 30, 140, 0.03)');
      haloG.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.beginPath();
      ctx.arc(bx, by, influenceR, 0, 6.284);
      ctx.fillStyle = haloG;
      ctx.fill();

      // 2. Accretion disk — behind the black hole (back half)
      this._drawAccretionHalf(ctx, t, bx, by, ehR, false);

      // 3. Event horizon — pure darkness with soft edge
      const ehG = ctx.createRadialGradient(bx, by, ehR * 0.5, bx, by, ehR * 2.5);
      ehG.addColorStop(0, 'rgba(0, 0, 0, 0.97)');
      ehG.addColorStop(0.4, 'rgba(0, 0, 0, 0.85)');
      ehG.addColorStop(0.7, 'rgba(0, 0, 0, 0.3)');
      ehG.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.beginPath();
      ctx.arc(bx, by, ehR * 2.5, 0, 6.284);
      ctx.fillStyle = ehG;
      ctx.fill();

      // 4. Photon ring — bright thin ellipse at Schwarzschild radius
      const ringPulse = 0.7 + 0.3 * Math.sin(t * 1.5);
      ctx.save();
      ctx.translate(bx, by);
      ctx.rotate(t * 0.08); // very slow rotation
      ctx.scale(1, 0.38); // flatten into disk perspective
      ctx.beginPath();
      ctx.arc(0, 0, ehR * 1.8, 0, 6.284);
      ctx.strokeStyle = `rgba(180, 160, 255, ${0.25 * ringPulse})`;
      ctx.lineWidth = 1.5;
      ctx.stroke();
      // Inner bright ring
      ctx.beginPath();
      ctx.arc(0, 0, ehR * 1.3, 0, 6.284);
      ctx.strokeStyle = `rgba(220, 200, 255, ${0.35 * ringPulse})`;
      ctx.lineWidth = 0.8;
      ctx.stroke();
      ctx.restore();

      // 5. Accretion disk — front half (over the black hole)
      this._drawAccretionHalf(ctx, t, bx, by, ehR, true);

      // 6. Photon sphere glow — tiny hot glow at edge
      const psG = ctx.createRadialGradient(bx, by, ehR * 0.8, bx, by, ehR * 1.6);
      psG.addColorStop(0, 'rgba(160, 130, 255, 0.0)');
      psG.addColorStop(0.5, 'rgba(160, 130, 255, 0.08)');
      psG.addColorStop(1, 'rgba(160, 130, 255, 0.0)');
      ctx.beginPath();
      ctx.arc(bx, by, ehR * 1.6, 0, 6.284);
      ctx.fillStyle = psG;
      ctx.fill();
    }

    _drawAccretionHalf(ctx, t, bx, by, ehR, front) {
      for (const p of this.bhParticles) {
        // Determine if this particle is in front or behind
        const isFront = Math.sin(p.angle + t * 0.08) > 0;
        if (isFront !== front) continue;

        // Orbit
        p.angle += p.speed * 0.012 * (30 / Math.max(p.dist, 15));
        // Slowly spiral inward
        p.dist -= 0.008;
        if (p.dist < 12) {
          p.dist = 25 + Math.random() * 50;
          p.angle = Math.random() * Math.PI * 2;
          p.colorIdx = Math.floor(Math.random() * COLORS.length);
        }

        // 3D disk projection (elliptical orbit seen at angle)
        const orbitAngle = p.angle + t * 0.08;
        const x = bx + Math.cos(orbitAngle) * p.dist;
        const y = by + Math.sin(orbitAngle) * p.dist * 0.35 + p.z * p.dist * 0.1;

        // Don't draw inside event horizon
        const dFromCenter = Math.hypot(x - bx, y - by);
        if (dFromCenter < ehR * 0.7) continue;

        // Doppler-like brightness — brighter on approaching side
        const doppler = 0.5 + 0.5 * Math.cos(orbitAngle + Math.PI * 0.3);
        const hex = COLORS[p.colorIdx];
        const ri = parseInt(hex.slice(1,3),16);
        const gi = parseInt(hex.slice(3,5),16);
        const bi = parseInt(hex.slice(5,7),16);
        const a = p.alpha * doppler * (0.6 + 0.4 * Math.sin(t * 3 + p.angle * 2));

        ctx.beginPath();
        ctx.arc(x, y, p.size * (0.7 + doppler * 0.5), 0, 6.284);
        ctx.fillStyle = `rgba(${ri},${gi},${bi},${a})`;
        ctx.fill();

        // Glow trail for brighter particles
        if (doppler > 0.6 && p.alpha > 0.4) {
          ctx.beginPath();
          ctx.arc(x, y, p.size * 2.5, 0, 6.284);
          ctx.fillStyle = `rgba(${ri},${gi},${bi},${a * 0.15})`;
          ctx.fill();
        }
      }
    }

    // Gravitational lensing — bend star positions toward black hole
    _lenseStar(wx, wy) {
      const bh = this._bhPos();
      const dx = bh.x - wx, dy = bh.y - wy;
      const dist = Math.hypot(dx, dy);
      const influenceR = 130;
      if (dist > influenceR || dist < 5) return { x: wx, y: wy, dim: 0 };
      // Gravitational pull strength (inverse square, capped)
      const strength = Math.pow(1 - dist / influenceR, 2) * 18;
      const nx = dx / dist, ny = dy / dist;
      // How much to dim (absorbed near event horizon)
      const dim = dist < 30 ? Math.pow(1 - dist / 30, 2) : 0;
      return {
        x: wx + nx * strength,
        y: wy + ny * strength,
        dim,
      };
    }

    _loop() {
      const ctx = this.ctx;
      ctx.clearRect(0, 0, this.w, this.h);
      const t = performance.now() / 1000;

      // Stars with parallax + gravitational lensing
      for (const s of this.stars) {
        const tw = 0.5 + 0.5 * Math.sin(t * s.sp + s.ph);
        let alpha = s.a * (0.3 + 0.7 * tw);
        const px = s.x + this.vpx * s.pf;
        const py = s.y + this.vpy * s.pf;
        let wx = ((px % (this.w * 1.4)) + this.w * 1.4) % (this.w * 1.4) - this.w * 0.2;
        let wy = ((py % (this.h * 1.4)) + this.h * 1.4) % (this.h * 1.4) - this.h * 0.2;
        if (wx < -10 || wx > this.w + 10 || wy < -10 || wy > this.h + 10) continue;

        // Gravitational lensing
        const lens = this._lenseStar(wx, wy);
        wx = lens.x;
        wy = lens.y;
        alpha *= (1 - lens.dim); // dim near event horizon
        if (alpha < 0.01) continue;

        ctx.beginPath();
        ctx.arc(wx, wy, s.r, 0, 6.284);
        if (s.color) {
          const hex = s.color;
          const ri = parseInt(hex.slice(1,3),16);
          const gi = parseInt(hex.slice(3,5),16);
          const bi = parseInt(hex.slice(5,7),16);
          ctx.fillStyle = `rgba(${ri},${gi},${bi},${alpha * 0.6})`;
        } else {
          ctx.fillStyle = `rgba(190,200,240,${alpha})`;
        }
        ctx.fill();
      }

      // Black hole (between stars and shooting stars for depth)
      this._drawBlackHole(ctx, t);

      // Shooting stars
      if (t - this.lastShoot > 4 + Math.random() * 8) {
        this.lastShoot = t;
        this.shooting.push({
          x: Math.random() * this.w, y: Math.random() * this.h * 0.4,
          vx: (Math.random() - 0.2) * 7, vy: 2 + Math.random() * 3,
          life: 1, len: 25 + Math.random() * 35,
        });
      }
      for (let i = this.shooting.length - 1; i >= 0; i--) {
        const s = this.shooting[i];
        s.x += s.vx; s.y += s.vy; s.life -= 0.018;
        if (s.life <= 0) { this.shooting.splice(i, 1); continue; }
        const g = ctx.createLinearGradient(s.x, s.y,
          s.x - s.vx * s.len / 8, s.y - s.vy * s.len / 8);
        g.addColorStop(0, `rgba(255,255,255,${s.life * 0.7})`);
        g.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.beginPath();
        ctx.moveTo(s.x, s.y);
        ctx.lineTo(s.x - s.vx * s.len / 8, s.y - s.vy * s.len / 8);
        ctx.strokeStyle = g;
        ctx.lineWidth = 1.2;
        ctx.stroke();
      }
      requestAnimationFrame(() => this._loop());
    }
  }

  // ============================================================
  // Minimal Markdown Renderer
  // ============================================================
  function renderMD(text) {
    const esc = s => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    const lines = text.split('\n');
    let html = '', inCode = false, inList = '';
    for (let i = 0; i < lines.length; i++) {
      let line = lines[i];
      // Code block
      if (line.startsWith('```')) {
        if (inCode) { html += '</code></pre>'; inCode = false; }
        else { html += '<pre><code>'; inCode = true; }
        continue;
      }
      if (inCode) { html += esc(line) + '\n'; continue; }
      // Close list if needed
      if (inList && !line.match(/^[-*]\s/) && !line.match(/^\d+\.\s/)) {
        html += inList === 'ul' ? '</ul>' : '</ol>'; inList = '';
      }
      // Heading
      if (line.startsWith('### ')) { html += `<h3>${inline(line.slice(4))}</h3>`; continue; }
      if (line.startsWith('## ')) { html += `<h2>${inline(line.slice(3))}</h2>`; continue; }
      if (line.startsWith('# ')) { html += `<h1>${inline(line.slice(2))}</h1>`; continue; }
      // HR
      if (line.match(/^---+$/)) { html += '<hr>'; continue; }
      // Blockquote
      if (line.startsWith('> ')) { html += `<blockquote><p>${inline(line.slice(2))}</p></blockquote>`; continue; }
      // Unordered list
      if (line.match(/^[-*]\s/)) {
        if (inList !== 'ul') { html += '<ul>'; inList = 'ul'; }
        html += `<li>${inline(line.slice(2))}</li>`; continue;
      }
      // Ordered list
      const olMatch = line.match(/^(\d+)\.\s(.*)/);
      if (olMatch) {
        if (inList !== 'ol') { html += '<ol>'; inList = 'ol'; }
        html += `<li>${inline(olMatch[2])}</li>`; continue;
      }
      // Empty line
      if (!line.trim()) { html += ''; continue; }
      // Paragraph
      html += `<p>${inline(line)}</p>`;
    }
    if (inCode) html += '</code></pre>';
    if (inList) html += inList === 'ul' ? '</ul>' : '</ol>';
    return html;

    function inline(s) {
      s = esc(s);
      s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
      s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
      s = s.replace(/\*([^*]+)\*/g, '<em>$1</em>');
      s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
      return s;
    }
  }

  // ============================================================
  // App — main controller
  // ============================================================
  class App {
    constructor() {
      this.store = new Store();
      this.vp = { x: 0, y: 0, s: 1 };

      // State
      this.dragging = null;     // { node, el, sx, sy, ox, oy }
      this.panning = null;      // { vpx, vpy, tx, ty }
      this.pinching = null;     // { dist, scale, cx, cy, vpx, vpy }
      this.touchInfo = null;    // { x, y, time, nodeEl, moved }
      this.overlapTarget = null;
      this.editorNodeId = null;
      this._lastTouchTime = 0;  // guard against synthetic mouse events
      this._undoStack = [];
      this._redoStack = [];
      this._longPressTimer = null;
      this._ctxNodeId = null;

      // DOM
      this.$container = document.getElementById('canvas-container');
      this.$world = document.getElementById('world');
      this.$nodes = document.getElementById('nodes');
      this.$svg = document.getElementById('connections');
      this.$editorSheet = document.getElementById('editor-sheet');
      this.$editorOverlay = document.getElementById('editor-overlay');
      this.$editorTitle = document.getElementById('editor-title');
      this.$editorContent = document.getElementById('editor-content');
      this.$editorLinks = document.getElementById('editor-links');
      this.$editorMeta = document.getElementById('editor-meta');
      this.$btnUndo = document.getElementById('btn-undo');
      this.$btnRedo = document.getElementById('btn-redo');
      this.$settingsSheet = document.getElementById('settings-sheet');
      this.$settingsOverlay = document.getElementById('settings-overlay');
      this.$importFile = document.getElementById('import-file');
      this.$minimap = document.getElementById('minimap');
      this._minimapCtx = this.$minimap.getContext('2d');
      this.$tagFilter = document.getElementById('tag-filter');
      this.$editorTags = document.getElementById('editor-tag-list');
      this.$editorTagInput = document.getElementById('editor-tag-input');
      this._activeTagFilter = null;
      this.$contextMenu = document.getElementById('context-menu');
      this.$searchInput = document.getElementById('search-input');
      this.$searchClear = document.getElementById('search-clear');
      this.$searchResults = document.getElementById('search-results');
      this.$reminderToggle = document.getElementById('editor-reminder-toggle');
      this.$reminderLabel = document.getElementById('editor-reminder-label');
      this.$reminderPicker = document.getElementById('editor-reminder-picker');
      this.$reminderDate = document.getElementById('editor-reminder-date');
      this.$reminderTime = document.getElementById('editor-reminder-time');
      this.$reminderClear = document.getElementById('editor-reminder-clear');
      this.$editorPreview = document.getElementById('editor-preview');
      this.$editorPreviewToggle = document.getElementById('editor-preview-toggle');
      this.$toast = document.getElementById('toast');
      this.$hint = document.getElementById('link-hint');
      this.$nodeCount = document.getElementById('node-count');
      this.$onboarding = document.getElementById('onboarding');

      this._initSVG();
      this._bindEvents();
      this._render();
      this._centerViewport();
      this._checkOnboarding();

      this._starfield = new StarField(document.getElementById('starfield'));
      this._startReminderCheck();
    }

    // --- SVG Defs ---
    _initSVG() {
      const ns = 'http://www.w3.org/2000/svg';
      const defs = document.createElementNS(ns, 'defs');
      const filter = document.createElementNS(ns, 'filter');
      filter.id = 'glow';
      filter.setAttribute('x', '-50%'); filter.setAttribute('y', '-50%');
      filter.setAttribute('width', '200%'); filter.setAttribute('height', '200%');
      filter.innerHTML = '<feGaussianBlur stdDeviation="4" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>';
      defs.appendChild(filter);
      this.$svg.appendChild(defs);
    }

    // --- Node Width ---
    _getNodeWidth(n) {
      const el = this.$nodes.querySelector(`[data-id="${n.id}"]`);
      if (el) return el.offsetWidth || NODE_W_DEFAULT;
      return NODE_W_DEFAULT;
    }

    // --- Events ---
    _bindEvents() {
      const c = this.$container;
      // Touch
      c.addEventListener('touchstart', e => this._onTouchStart(e), { passive: false });
      c.addEventListener('touchmove', e => this._onTouchMove(e), { passive: false });
      c.addEventListener('touchend', e => this._onTouchEnd(e));
      c.addEventListener('touchcancel', e => this._onTouchEnd(e));
      // Mouse (with touch guard to prevent ghost clicks on iOS)
      c.addEventListener('mousedown', e => {
        if (Date.now() - this._lastTouchTime < 500) return;
        this._onPointerDown(e.clientX, e.clientY, e.target, e);
      });
      window.addEventListener('mousemove', e => {
        if (this.touchInfo && Date.now() - this._lastTouchTime > 500) this._onPointerMove(e.clientX, e.clientY);
      });
      window.addEventListener('mouseup', e => {
        if (this.touchInfo && Date.now() - this._lastTouchTime > 500) this._onPointerUp();
      });
      c.addEventListener('wheel', e => this._onWheel(e), { passive: false });
      // UI buttons
      document.getElementById('fab-add').addEventListener('click', () => this._createAtCenter());
      document.getElementById('btn-fit').addEventListener('click', () => this._fitView());
      document.getElementById('editor-back').addEventListener('click', () => this._closeEditor());
      document.getElementById('editor-delete').addEventListener('click', () => this._deleteCurrent());
      this.$editorOverlay.addEventListener('click', () => this._closeEditor());
      this.$editorTitle.addEventListener('input', () => this._saveEditor());
      this.$editorContent.addEventListener('input', () => this._saveEditor());
      this.$editorPreviewToggle.addEventListener('click', () => this._togglePreview());
      this.$reminderToggle.addEventListener('click', () => this._toggleReminderPicker());
      this.$reminderDate.addEventListener('change', () => this._saveReminder());
      this.$reminderTime.addEventListener('change', () => this._saveReminder());
      this.$reminderClear.addEventListener('click', () => this._clearReminder());
      this.$editorTagInput.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ',') {
          e.preventDefault();
          this._addTagFromInput();
        }
      });
      this.$btnUndo.addEventListener('click', () => this._undo());
      this.$btnRedo.addEventListener('click', () => this._redo());
      document.addEventListener('keydown', e => {
        if ((e.metaKey || e.ctrlKey) && e.key === 'z') {
          e.preventDefault();
          e.shiftKey ? this._redo() : this._undo();
        }
      });
      document.getElementById('onboarding-start').addEventListener('click', () => this._startApp());
      // Minimap
      this.$minimap.addEventListener('click', e => this._onMinimapClick(e));
      // Settings
      document.getElementById('btn-settings').addEventListener('click', () => this._toggleSettings());
      this.$settingsOverlay.addEventListener('click', () => this._closeSettings());
      document.getElementById('btn-export').addEventListener('click', () => this._exportData());
      document.getElementById('btn-import').addEventListener('click', () => this.$importFile.click());
      this.$importFile.addEventListener('change', e => this._importData(e));
      document.getElementById('btn-auto-layout').addEventListener('click', () => { this._closeSettings(); this._autoLayout(); });
      document.getElementById('btn-export-md').addEventListener('click', () => this._exportMD());
      // Context menu
      document.getElementById('ctx-duplicate').addEventListener('click', () => this._duplicateNode());
      document.getElementById('ctx-delete').addEventListener('click', () => this._ctxDeleteNode());
      document.addEventListener('click', e => {
        if (!e.target.closest('#context-menu')) this._hideContextMenu();
      });
      // Search
      this.$searchInput.addEventListener('input', () => this._onSearch());
      this.$searchClear.addEventListener('click', () => this._clearSearch());
      this.$searchInput.addEventListener('focus', () => this._onSearch());
      document.addEventListener('click', e => {
        if (!e.target.closest('#search-bar') && !e.target.closest('#search-results')) {
          this.$searchResults.classList.remove('open');
        }
      });
      // Resize
      window.addEventListener('resize', () => this._render());
    }

    // --- Touch Handlers ---
    _onTouchStart(e) {
      if (e.touches.length === 2) {
        e.preventDefault();
        const t0 = e.touches[0], t1 = e.touches[1];
        this.pinching = {
          dist: hypot(t0.clientX, t0.clientY, t1.clientX, t1.clientY),
          scale: this.vp.s,
          cx: (t0.clientX + t1.clientX) / 2,
          cy: (t0.clientY + t1.clientY) / 2,
          vpx: this.vp.x, vpy: this.vp.y,
        };
        this.dragging = null;
        this.panning = null;
        return;
      }
      if (e.touches.length !== 1) return;
      e.preventDefault();
      this._lastTouchTime = Date.now();
      const t = e.touches[0];
      this._onPointerDown(t.clientX, t.clientY, t.target, e);
    }

    _onTouchMove(e) {
      if (this.pinching && e.touches.length === 2) {
        e.preventDefault();
        const t0 = e.touches[0], t1 = e.touches[1];
        const d = hypot(t0.clientX, t0.clientY, t1.clientX, t1.clientY);
        const ratio = d / this.pinching.dist;
        const ns = clamp(this.pinching.scale * ratio, MIN_SCALE, MAX_SCALE);
        const cx = (t0.clientX + t1.clientX) / 2;
        const cy = (t0.clientY + t1.clientY) / 2;
        const sr = ns / this.pinching.scale;
        this.vp.x = cx - (this.pinching.cx - this.pinching.vpx) * sr;
        this.vp.y = cy - (this.pinching.cy - this.pinching.vpy) * sr;
        this.vp.s = ns;
        this._applyVP();
        return;
      }
      if (e.touches.length !== 1) return;
      e.preventDefault();
      this._onPointerMove(e.touches[0].clientX, e.touches[0].clientY);
    }

    _onTouchEnd(e) {
      if (this.pinching) { this.pinching = null; return; }
      this._onPointerUp();
    }

    // --- Unified Pointer ---
    _onPointerDown(px, py, target) {
      const nodeEl = target.closest?.('.node');
      this.touchInfo = { x: px, y: py, time: Date.now(), nodeEl, moved: false };
      clearTimeout(this._longPressTimer);
      if (nodeEl) {
        const n = this.store.getNode(nodeEl.dataset.id);
        if (n) {
          this.dragging = { node: n, el: nodeEl, sx: n.x, sy: n.y, ox: px, oy: py };
          this._longPressTimer = setTimeout(() => {
            if (this.touchInfo && !this.touchInfo.moved) {
              this._showContextMenu(n.id, px, py);
              this.dragging = null;
              this.touchInfo = null;
              if (navigator.vibrate) navigator.vibrate(15);
            }
          }, 500);
        }
      } else {
        this.panning = { vpx: this.vp.x, vpy: this.vp.y, tx: px, ty: py };
      }
    }

    _onPointerMove(px, py) {
      if (!this.touchInfo) return;
      const dx = px - this.touchInfo.x;
      const dy = py - this.touchInfo.y;
      if (Math.hypot(dx, dy) > TAP_THRESHOLD) {
        this.touchInfo.moved = true;
        clearTimeout(this._longPressTimer);
      }

      if (this.dragging && this.touchInfo.moved) {
        const d = this.dragging;
        if (!d.el.classList.contains('dragging')) d.el.classList.add('dragging');
        d.node.x = d.sx + (px - d.ox) / this.vp.s;
        d.node.y = d.sy + (py - d.oy) / this.vp.s;
        this._positionNode(d.node, d.el);
        this._renderLinks();
        this._checkOverlap(d.node);
      } else if (this.panning && this.touchInfo.moved) {
        this.vp.x = this.panning.vpx + (px - this.panning.tx);
        this.vp.y = this.panning.vpy + (py - this.panning.ty);
        this._applyVP();
      }
    }

    _onPointerUp() {
      if (!this.touchInfo) return;
      const wasTap = !this.touchInfo.moved && (Date.now() - this.touchInfo.time < TAP_TIMEOUT);

      if (this.dragging && this.touchInfo.moved) {
        const d = this.dragging;
        d.el.classList.remove('dragging');
        if (this.overlapTarget) {
          this._pushUndo();
          const linked = this.store.toggleLink(d.node.id, this.overlapTarget.id);
          this._showToast(linked ? 'Linked' : 'Unlinked');
          // Snap back
          d.node.x = d.sx; d.node.y = d.sy;
          d.el.classList.add('snap-back');
          this._positionNode(d.node, d.el);
          setTimeout(() => d.el.classList.remove('snap-back'), 350);
          this._clearOverlap();
          if (navigator.vibrate) navigator.vibrate(20);
        }
        this.store.save();
        this._render();
      } else if (wasTap) {
        if (this.touchInfo.nodeEl) {
          this._openEditor(this.touchInfo.nodeEl.dataset.id);
        } else {
          const wp = this._s2w(this.touchInfo.x, this.touchInfo.y);
          this._createNode(wp.x - NODE_W_DEFAULT / 2, wp.y - 28);
        }
      }

      this.dragging = null;
      this.panning = null;
      this.touchInfo = null;
    }

    // --- Wheel Zoom ---
    _onWheel(e) {
      e.preventDefault();
      const d = -e.deltaY * 0.001;
      const os = this.vp.s;
      const ns = clamp(os * (1 + d), MIN_SCALE, MAX_SCALE);
      this.vp.x = e.clientX - (e.clientX - this.vp.x) * (ns / os);
      this.vp.y = e.clientY - (e.clientY - this.vp.y) * (ns / os);
      this.vp.s = ns;
      this._applyVP();
    }

    // --- Coordinate Transform ---
    _s2w(sx, sy) { return { x: (sx - this.vp.x) / this.vp.s, y: (sy - this.vp.y) / this.vp.s }; }

    // --- Viewport ---
    _applyVP() {
      this.$world.style.transform = `translate(${this.vp.x}px,${this.vp.y}px) scale(${this.vp.s})`;
      if (this._starfield) this._starfield.setViewport(this.vp.x, this.vp.y);
      this._renderMinimap();
    }

    _centerViewport() {
      const nodes = this.store.data.nodes;
      if (!nodes.length) {
        this.vp.x = window.innerWidth / 2;
        this.vp.y = window.innerHeight / 2;
      } else {
        const ax = nodes.reduce((s, n) => s + n.x + this._getNodeWidth(n) / 2, 0) / nodes.length;
        const ay = nodes.reduce((s, n) => s + n.y + 30, 0) / nodes.length;
        this.vp.x = window.innerWidth / 2 - ax * this.vp.s;
        this.vp.y = window.innerHeight / 2 - ay * this.vp.s;
      }
      this._applyVP();
    }

    _fitView() {
      const nodes = this.store.data.nodes;
      if (!nodes.length) { this._centerViewport(); return; }
      const pad = 80;
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const n of nodes) {
        minX = Math.min(minX, n.x);
        minY = Math.min(minY, n.y);
        maxX = Math.max(maxX, n.x + this._getNodeWidth(n));
        maxY = Math.max(maxY, n.y + 80);
      }
      const cw = window.innerWidth - pad * 2;
      const ch = window.innerHeight - pad * 2;
      const bw = maxX - minX || 1;
      const bh = maxY - minY || 1;
      this.vp.s = clamp(Math.min(cw / bw, ch / bh), MIN_SCALE, MAX_SCALE);
      this.vp.x = (window.innerWidth - bw * this.vp.s) / 2 - minX * this.vp.s;
      this.vp.y = (window.innerHeight - bh * this.vp.s) / 2 - minY * this.vp.s;
      this._applyVP();
    }

    // --- Overlap Detection ---
    _checkOverlap(dragNode) {
      let closest = null, closestD = Infinity;
      const cx1 = dragNode.x + this._getNodeWidth(dragNode) / 2;
      const cy1 = dragNode.y + 30;
      for (const n of this.store.data.nodes) {
        if (n.id === dragNode.id) continue;
        const d = hypot(cx1, cy1, n.x + this._getNodeWidth(n) / 2, n.y + 30);
        if (d < OVERLAP_DIST && d < closestD) { closest = n; closestD = d; }
      }
      if (closest !== this.overlapTarget) {
        this._clearOverlap();
        this.overlapTarget = closest;
        if (closest) {
          const isLinked = this.store.hasLink(dragNode.id, closest.id);
          this._highlightOverlap(dragNode, closest, isLinked);
          if (navigator.vibrate) navigator.vibrate(8);
        }
      }
    }

    _highlightOverlap(a, b, isLinked) {
      const cls = isLinked ? 'overlap-unlink' : 'overlap-link';
      const elA = this.$nodes.querySelector(`[data-id="${a.id}"]`);
      const elB = this.$nodes.querySelector(`[data-id="${b.id}"]`);
      if (elA) elA.classList.add(cls);
      if (elB) elB.classList.add(cls);
      // Hint
      this.$hint.textContent = isLinked ? 'Release to unlink' : 'Release to link';
      this.$hint.className = isLinked ? 'hint-unlink' : 'hint-link';
    }

    _clearOverlap() {
      this.overlapTarget = null;
      this.$nodes.querySelectorAll('.overlap-link,.overlap-unlink').forEach(el => {
        el.classList.remove('overlap-link', 'overlap-unlink');
      });
      this.$hint.className = 'hint-hidden';
    }

    // --- Node CRUD ---
    _createNode(x, y) {
      this._pushUndo();
      const n = this.store.addNode({
        id: uid(), x, y,
        title: '', content: '',
        color: pick(COLORS),
        createdAt: Date.now(), updatedAt: Date.now(),
      });
      this._render();
      const el = this.$nodes.querySelector(`[data-id="${n.id}"]`);
      if (el) {
        el.classList.add('entering');
        el.addEventListener('animationend', () => el.classList.remove('entering'), { once: true });
      }
      setTimeout(() => this._openEditor(n.id), 320);
      return n;
    }

    _createAtCenter() {
      const c = this._s2w(window.innerWidth / 2, window.innerHeight / 2);
      this._createNode(c.x - NODE_W_DEFAULT / 2, c.y - 28);
    }

    _deleteCurrent() {
      if (!this.editorNodeId) return;
      this._pushUndo();
      const id = this.editorNodeId;
      this._closeEditor();
      // Animate removal
      const el = this.$nodes.querySelector(`[data-id="${id}"]`);
      if (el) {
        el.classList.add('removing');
        setTimeout(() => { this.store.deleteNode(id); this._render(); }, 250);
      } else {
        this.store.deleteNode(id);
        this._render();
      }
      this._showToast('Deleted');
    }

    // --- Editor ---
    _openEditor(id) {
      const n = this.store.getNode(id);
      if (!n) return;
      this._pushUndo();
      this.editorNodeId = id;
      this.$editorTitle.value = n.title;
      this.$editorContent.value = n.content;

      // Linked nodes chips
      const links = this.store.linksOf(id);
      this.$editorLinks.innerHTML = links.map(l => {
        const oid = l.s === id ? l.t : l.s;
        const o = this.store.getNode(oid);
        if (!o) return '';
        return `<span class="editor-link-chip" data-link-id="${oid}"><span class="editor-link-dot" style="background:${o.color}"></span>${o.title || 'Untitled'}</span>`;
      }).join('');
      // Link navigation
      this.$editorLinks.querySelectorAll('.editor-link-chip').forEach(chip => {
        chip.addEventListener('click', () => {
          const targetId = chip.dataset.linkId;
          this._closeEditor();
          setTimeout(() => this._zoomToNode(targetId), 300);
        });
      });

      // Meta
      const d = new Date(n.createdAt);
      this.$editorMeta.textContent = `Created ${d.toLocaleDateString('ja-JP')} ${d.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })}`;

      this._renderEditorTags();
      this._setupReminderEditor();
      this.$editorSheet.classList.add('open');
      this.$editorOverlay.classList.add('open');
      setTimeout(() => { if (!n.title) this.$editorTitle.focus(); }, 380);
    }

    _closeEditor() {
      this._saveEditor();
      this.editorNodeId = null;
      if (document.activeElement) document.activeElement.blur();
      this.$editorSheet.classList.remove('open');
      this.$editorOverlay.classList.remove('open');
      this.$editorPreview.classList.remove('open');
      this.$editorPreviewToggle.classList.remove('active');
      this.$editorContent.style.display = '';
      this.$reminderPicker.classList.add('reminder-picker-hidden');
      this._render();
    }

    _togglePreview() {
      const on = this.$editorPreview.classList.toggle('open');
      this.$editorPreviewToggle.classList.toggle('active', on);
      this.$editorContent.style.display = on ? 'none' : '';
      if (on) {
        this.$editorPreview.innerHTML = renderMD(this.$editorContent.value);
      }
    }

    // --- Reminder ---
    _toggleReminderPicker() {
      const hidden = this.$reminderPicker.classList.toggle('reminder-picker-hidden');
      if (!hidden && this.editorNodeId) {
        const n = this.store.getNode(this.editorNodeId);
        if (n && n.reminder) {
          const d = new Date(n.reminder);
          this.$reminderDate.value = d.toISOString().slice(0, 10);
          this.$reminderTime.value = d.toTimeString().slice(0, 5);
        } else {
          // Default: 1 hour from now
          const d = new Date(Date.now() + 3600000);
          this.$reminderDate.value = d.toISOString().slice(0, 10);
          this.$reminderTime.value = d.toTimeString().slice(0, 5);
        }
      }
    }

    _saveReminder() {
      if (!this.editorNodeId) return;
      const dateVal = this.$reminderDate.value;
      const timeVal = this.$reminderTime.value;
      if (!dateVal || !timeVal) return;
      const ts = new Date(`${dateVal}T${timeVal}`).getTime();
      if (isNaN(ts)) return;
      this.store.updateNode(this.editorNodeId, { reminder: ts });
      this.$reminderLabel.textContent = this._formatReminder(ts);
      this.$reminderToggle.classList.add('reminder-active');
      this._render();
    }

    _clearReminder() {
      if (!this.editorNodeId) return;
      const n = this.store.getNode(this.editorNodeId);
      if (n) { n.reminder = null; this.store.save(); }
      this.$reminderLabel.textContent = 'Add reminder';
      this.$reminderToggle.classList.remove('reminder-active');
      this.$reminderPicker.classList.add('reminder-picker-hidden');
      this._render();
    }

    _setupReminderEditor() {
      if (!this.editorNodeId) return;
      const n = this.store.getNode(this.editorNodeId);
      if (n && n.reminder) {
        this.$reminderLabel.textContent = this._formatReminder(n.reminder);
        this.$reminderToggle.classList.add('reminder-active');
        const d = new Date(n.reminder);
        this.$reminderDate.value = d.toISOString().slice(0, 10);
        this.$reminderTime.value = d.toTimeString().slice(0, 5);
      } else {
        this.$reminderLabel.textContent = 'Add reminder';
        this.$reminderToggle.classList.remove('reminder-active');
      }
      this.$reminderPicker.classList.add('reminder-picker-hidden');
    }

    _checkReminders() {
      const now = Date.now();
      const overdue = this.store.data.nodes.filter(n => n.reminder && n.reminder <= now);
      if (!overdue.length) return;
      // Request notification permission
      if ('Notification' in window && Notification.permission === 'default') {
        Notification.requestPermission();
      }
      for (const n of overdue) {
        // Only notify once per reminder (mark as notified)
        if (n._notified) continue;
        n._notified = true;
        if ('Notification' in window && Notification.permission === 'granted') {
          new Notification('Conste Reminder', {
            body: n.title || 'Untitled note',
            icon: 'icons/icon.svg',
          });
        }
      }
      if (overdue.length) {
        this._showToast(`${overdue.length} reminder${overdue.length > 1 ? 's' : ''} overdue`);
      }
      this._render();
    }

    _startReminderCheck() {
      this._checkReminders();
      this._reminderInterval = setInterval(() => this._checkReminders(), 60000);
    }

    _saveEditor() {
      if (!this.editorNodeId) return;
      this.store.updateNode(this.editorNodeId, {
        title: this.$editorTitle.value,
        content: this.$editorContent.value,
      });
      const el = this.$nodes.querySelector(`[data-id="${this.editorNodeId}"]`);
      if (el) {
        el.querySelector('.node-title').textContent = this.$editorTitle.value || 'Untitled';
        const preview = this.$editorContent.value.slice(0, 50);
        el.querySelector('.node-preview').textContent = preview;
      }
    }

    // --- Auto-layout (Force-directed) ---
    _autoLayout() {
      const nodes = this.store.data.nodes;
      if (nodes.length < 2) return;
      this._pushUndo();

      // Initialize positions
      const pos = nodes.map(n => ({ id: n.id, x: n.x, y: n.y }));
      const links = this.store.data.links;
      const k = 200; // ideal spring length
      const repulsion = 5000;
      const damping = 0.85;
      const dt = 0.3;

      // Run simulation
      for (let iter = 0; iter < 120; iter++) {
        const forces = pos.map(() => ({ fx: 0, fy: 0 }));

        // Repulsion between all pairs
        for (let i = 0; i < pos.length; i++) {
          for (let j = i + 1; j < pos.length; j++) {
            let dx = pos[j].x - pos[i].x;
            let dy = pos[j].y - pos[i].y;
            let dist = Math.hypot(dx, dy) || 1;
            const f = repulsion / (dist * dist);
            const fx = (dx / dist) * f;
            const fy = (dy / dist) * f;
            forces[i].fx -= fx;
            forces[i].fy -= fy;
            forces[j].fx += fx;
            forces[j].fy += fy;
          }
        }

        // Spring attraction for linked pairs
        for (const lk of links) {
          const ai = pos.findIndex(p => p.id === lk.s);
          const bi = pos.findIndex(p => p.id === lk.t);
          if (ai < 0 || bi < 0) continue;
          let dx = pos[bi].x - pos[ai].x;
          let dy = pos[bi].y - pos[ai].y;
          let dist = Math.hypot(dx, dy) || 1;
          const f = (dist - k) * 0.05;
          const fx = (dx / dist) * f;
          const fy = (dy / dist) * f;
          forces[ai].fx += fx;
          forces[ai].fy += fy;
          forces[bi].fx -= fx;
          forces[bi].fy -= fy;
        }

        // Apply forces
        for (let i = 0; i < pos.length; i++) {
          pos[i].x += forces[i].fx * dt;
          pos[i].y += forces[i].fy * dt;
          forces[i].fx *= damping;
          forces[i].fy *= damping;
        }
      }

      // Animate to new positions
      const startPos = nodes.map(n => ({ x: n.x, y: n.y }));
      const startTime = performance.now();
      const duration = 800;

      const animate = () => {
        const t = Math.min((performance.now() - startTime) / duration, 1);
        const ease = 1 - Math.pow(1 - t, 3); // ease-out cubic
        for (let i = 0; i < nodes.length; i++) {
          nodes[i].x = startPos[i].x + (pos[i].x - startPos[i].x) * ease;
          nodes[i].y = startPos[i].y + (pos[i].y - startPos[i].y) * ease;
        }
        this._render();
        if (t < 1) requestAnimationFrame(animate);
        else {
          this.store.save();
          this._fitView();
        }
      };
      requestAnimationFrame(animate);
      this._showToast('Layout applied');
    }

    // --- Minimap ---
    _renderMinimap() {
      const nodes = this.store.data.nodes;
      const ctx = this._minimapCtx;
      const mw = 120, mh = 90;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      this.$minimap.width = mw * dpr;
      this.$minimap.height = mh * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, mw, mh);

      if (!nodes.length) return;

      // Compute bounds
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const n of nodes) {
        const nw = this._getNodeWidth(n);
        minX = Math.min(minX, n.x);
        minY = Math.min(minY, n.y);
        maxX = Math.max(maxX, n.x + nw);
        maxY = Math.max(maxY, n.y + 80);
      }
      const pad = 20;
      const bw = (maxX - minX) || 1;
      const bh = (maxY - minY) || 1;
      const scale = Math.min((mw - pad * 2) / bw, (mh - pad * 2) / bh);
      const ox = (mw - bw * scale) / 2 - minX * scale;
      const oy = (mh - bh * scale) / 2 - minY * scale;
      this._minimapTransform = { scale, ox, oy, minX, minY, bw, bh };

      // Links
      ctx.lineWidth = 0.5;
      for (const lk of this.store.data.links) {
        const a = this.store.getNode(lk.s);
        const b = this.store.getNode(lk.t);
        if (!a || !b) continue;
        ctx.strokeStyle = 'rgba(255,255,255,0.15)';
        ctx.beginPath();
        ctx.moveTo(a.x * scale + ox + this._getNodeWidth(a) * scale / 2, a.y * scale + oy + 5);
        ctx.lineTo(b.x * scale + ox + this._getNodeWidth(b) * scale / 2, b.y * scale + oy + 5);
        ctx.stroke();
      }

      // Nodes
      for (const n of nodes) {
        const nx = n.x * scale + ox;
        const ny = n.y * scale + oy;
        ctx.beginPath();
        ctx.arc(nx + this._getNodeWidth(n) * scale / 2, ny + 5, 2.5, 0, 6.284);
        ctx.fillStyle = n.color;
        ctx.fill();
      }

      // Viewport rect
      const vl = (0 - this.vp.x) / this.vp.s;
      const vt = (0 - this.vp.y) / this.vp.s;
      const vr = (window.innerWidth - this.vp.x) / this.vp.s;
      const vb = (window.innerHeight - this.vp.y) / this.vp.s;
      ctx.strokeStyle = 'rgba(124, 92, 252, 0.5)';
      ctx.lineWidth = 1;
      ctx.strokeRect(vl * scale + ox, vt * scale + oy, (vr - vl) * scale, (vb - vt) * scale);
    }

    _onMinimapClick(e) {
      if (!this._minimapTransform) return;
      const rect = this.$minimap.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const { scale, ox, oy } = this._minimapTransform;
      const wx = (mx - ox) / scale;
      const wy = (my - oy) / scale;
      this.vp.x = window.innerWidth / 2 - wx * this.vp.s;
      this.vp.y = window.innerHeight / 2 - wy * this.vp.s;
      this._applyVP();
      this._renderMinimap();
    }

    // --- Tags ---
    _addTagFromInput() {
      if (!this.editorNodeId) return;
      const tag = this.$editorTagInput.value.trim().replace(/,/g, '');
      if (!tag) return;
      const n = this.store.getNode(this.editorNodeId);
      if (!n) return;
      if (!n.tags) n.tags = [];
      if (!n.tags.includes(tag)) {
        n.tags.push(tag);
        this.store.save();
      }
      this.$editorTagInput.value = '';
      this._renderEditorTags();
      this._renderTagFilter();
    }

    _removeTag(tag) {
      if (!this.editorNodeId) return;
      const n = this.store.getNode(this.editorNodeId);
      if (!n || !n.tags) return;
      n.tags = n.tags.filter(t => t !== tag);
      this.store.save();
      this._renderEditorTags();
      this._renderTagFilter();
    }

    _renderEditorTags() {
      if (!this.editorNodeId) return;
      const n = this.store.getNode(this.editorNodeId);
      const tags = (n && n.tags) || [];
      this.$editorTags.innerHTML = tags.map(t =>
        `<span class="editor-tag">${t}<span class="editor-tag-remove" data-tag="${t}">&times;</span></span>`
      ).join('');
      this.$editorTags.querySelectorAll('.editor-tag-remove').forEach(el => {
        el.addEventListener('click', () => this._removeTag(el.dataset.tag));
      });
    }

    _getAllTags() {
      const tags = new Set();
      for (const n of this.store.data.nodes) {
        if (n.tags) n.tags.forEach(t => tags.add(t));
      }
      return [...tags].sort();
    }

    _renderTagFilter() {
      const tags = this._getAllTags();
      if (!tags.length) { this.$tagFilter.innerHTML = ''; return; }
      this.$tagFilter.innerHTML = tags.map(t =>
        `<span class="tag-chip${t === this._activeTagFilter ? ' active' : ''}" data-tag="${t}">${t}</span>`
      ).join('');
      this.$tagFilter.querySelectorAll('.tag-chip').forEach(el => {
        el.addEventListener('click', () => {
          this._activeTagFilter = this._activeTagFilter === el.dataset.tag ? null : el.dataset.tag;
          this._renderTagFilter();
          this._render();
        });
      });
    }

    // --- Settings ---
    _toggleSettings() {
      const open = this.$settingsSheet.classList.toggle('open');
      this.$settingsOverlay.classList.toggle('open', open);
    }

    _closeSettings() {
      this.$settingsSheet.classList.remove('open');
      this.$settingsOverlay.classList.remove('open');
    }

    _exportData() {
      const blob = new Blob([JSON.stringify(this.store.data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `conste-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      this._showToast('Exported');
      this._closeSettings();
    }

    _importData(e) {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const data = JSON.parse(reader.result);
          if (!data.nodes || !data.links) throw new Error('Invalid format');
          this._pushUndo();
          this.store.data = data;
          this.store.save();
          this._render();
          this._fitView();
          this._showToast('Imported');
          this._closeSettings();
        } catch (err) {
          this._showToast('Invalid file');
        }
      };
      reader.readAsText(file);
      e.target.value = '';
    }

    // --- MD Export ---
    _exportMD() {
      const nodes = this.store.data.nodes;
      if (!nodes.length) { this._showToast('No notes'); this._closeSettings(); return; }

      // Try File System Access API
      if (window.showDirectoryPicker) {
        this._exportMDToDir().catch(() => this._exportMDAsZip());
      } else {
        this._exportMDAsZip();
      }
      this._closeSettings();
    }

    async _exportMDToDir() {
      const dir = await window.showDirectoryPicker({ mode: 'readwrite' });
      for (const n of this.store.data.nodes) {
        const md = this._nodeToMD(n);
        const name = (n.title || 'Untitled').replace(/[/\\:*?"<>|]/g, '_') + '.md';
        const file = await dir.getFileHandle(name, { create: true });
        const writable = await file.createWritable();
        await writable.write(md);
        await writable.close();
      }
      this._showToast(`Exported ${this.store.data.nodes.length} files`);
    }

    _exportMDAsZip() {
      // Fallback: download individual files
      for (const n of this.store.data.nodes) {
        const md = this._nodeToMD(n);
        const name = (n.title || 'Untitled').replace(/[/\\:*?"<>|]/g, '_') + '.md';
        const blob = new Blob([md], { type: 'text/markdown' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = name;
        a.click();
        URL.revokeObjectURL(url);
      }
      this._showToast(`Exported ${this.store.data.nodes.length} files`);
    }

    _nodeToMD(n) {
      const links = this.store.linksOf(n.id).map(l => {
        const oid = l.s === n.id ? l.t : l.s;
        const o = this.store.getNode(oid);
        return o ? (o.title || 'Untitled') : null;
      }).filter(Boolean);
      let md = '---\n';
      md += `title: "${(n.title || 'Untitled').replace(/"/g, '\\"')}"\n`;
      if (n.tags && n.tags.length) md += `tags: [${n.tags.map(t => `"${t}"`).join(', ')}]\n`;
      if (links.length) md += `links: [${links.map(t => `"${t}"`).join(', ')}]\n`;
      md += `created: ${new Date(n.createdAt).toISOString()}\n`;
      md += `color: "${n.color}"\n`;
      md += '---\n\n';
      md += n.content || '';
      return md;
    }

    // --- Context Menu ---
    _showContextMenu(nodeId, px, py) {
      this._ctxNodeId = nodeId;
      const n = this.store.getNode(nodeId);
      if (!n) return;
      // Build color buttons
      const colorsEl = this.$contextMenu.querySelector('.ctx-colors');
      colorsEl.innerHTML = COLORS.map(c =>
        `<div class="ctx-color${c === n.color ? ' active' : ''}" data-color="${c}" style="background:${c}"></div>`
      ).join('');
      colorsEl.querySelectorAll('.ctx-color').forEach(el => {
        el.addEventListener('click', () => {
          this._pushUndo();
          this.store.updateNode(nodeId, { color: el.dataset.color });
          this._render();
          this._hideContextMenu();
        });
      });
      // Position
      const x = clamp(px - 80, 8, window.innerWidth - 176);
      const y = clamp(py + 10, 8, window.innerHeight - 200);
      this.$contextMenu.style.left = x + 'px';
      this.$contextMenu.style.top = y + 'px';
      this.$contextMenu.classList.add('open');
    }

    _hideContextMenu() {
      this.$contextMenu.classList.remove('open');
      this._ctxNodeId = null;
    }

    _duplicateNode() {
      if (!this._ctxNodeId) return;
      const n = this.store.getNode(this._ctxNodeId);
      if (!n) return;
      this._pushUndo();
      const dup = this.store.addNode({
        id: uid(), x: n.x + 30, y: n.y + 30,
        title: n.title + ' (copy)', content: n.content,
        color: n.color, tags: n.tags ? [...n.tags] : [],
        createdAt: Date.now(), updatedAt: Date.now(),
      });
      this._hideContextMenu();
      this._render();
      this._showToast('Duplicated');
    }

    _ctxDeleteNode() {
      if (!this._ctxNodeId) return;
      this._pushUndo();
      const id = this._ctxNodeId;
      this._hideContextMenu();
      const el = this.$nodes.querySelector(`[data-id="${id}"]`);
      if (el) {
        el.classList.add('removing');
        setTimeout(() => { this.store.deleteNode(id); this._render(); }, 250);
      } else {
        this.store.deleteNode(id); this._render();
      }
      this._showToast('Deleted');
    }

    // --- Undo/Redo ---
    _pushUndo() {
      this._undoStack.push(JSON.stringify(this.store.data));
      if (this._undoStack.length > 50) this._undoStack.shift();
      this._redoStack.length = 0;
      this._updateUndoButtons();
    }

    _undo() {
      if (!this._undoStack.length) return;
      this._redoStack.push(JSON.stringify(this.store.data));
      this.store.data = JSON.parse(this._undoStack.pop());
      this.store.save();
      this._render();
      this._updateUndoButtons();
      this._showToast('Undo');
    }

    _redo() {
      if (!this._redoStack.length) return;
      this._undoStack.push(JSON.stringify(this.store.data));
      this.store.data = JSON.parse(this._redoStack.pop());
      this.store.save();
      this._render();
      this._updateUndoButtons();
      this._showToast('Redo');
    }

    _updateUndoButtons() {
      this.$btnUndo.disabled = !this._undoStack.length;
      this.$btnRedo.disabled = !this._redoStack.length;
    }

    // --- Search ---
    _onSearch() {
      const q = this.$searchInput.value.trim().toLowerCase();
      this.$searchClear.classList.toggle('search-clear-hidden', !q);
      if (!q) {
        this.$searchResults.classList.remove('open');
        this.$nodes.querySelectorAll('.node').forEach(el => el.classList.remove('search-dim', 'search-highlight'));
        return;
      }
      const matches = this.store.data.nodes.filter(n =>
        (n.title || '').toLowerCase().includes(q) ||
        (n.content || '').toLowerCase().includes(q) ||
        (n.tags || []).some(t => t.toLowerCase().includes(q))
      );
      // Highlight on canvas
      this.$nodes.querySelectorAll('.node').forEach(el => {
        const hit = matches.some(m => m.id === el.dataset.id);
        el.classList.toggle('search-highlight', hit);
        el.classList.toggle('search-dim', !hit);
      });
      // Dropdown
      if (matches.length) {
        this.$searchResults.innerHTML = matches.slice(0, 10).map(n =>
          `<div class="search-result" data-id="${n.id}">
            <div class="search-result-dot" style="background:${n.color}"></div>
            <span class="search-result-title">${n.title || 'Untitled'}</span>
            <span class="search-result-preview">${(n.content || '').slice(0, 40)}</span>
          </div>`
        ).join('');
        this.$searchResults.classList.add('open');
        this.$searchResults.querySelectorAll('.search-result').forEach(el => {
          el.addEventListener('click', () => {
            this._zoomToNode(el.dataset.id);
            this._clearSearch();
          });
        });
      } else {
        this.$searchResults.innerHTML = '<div class="search-result"><span class="search-result-title" style="color:var(--text-muted)">No results</span></div>';
        this.$searchResults.classList.add('open');
      }
    }

    _clearSearch() {
      this.$searchInput.value = '';
      this.$searchInput.blur();
      this.$searchClear.classList.add('search-clear-hidden');
      this.$searchResults.classList.remove('open');
      this.$nodes.querySelectorAll('.node').forEach(el => el.classList.remove('search-dim', 'search-highlight'));
    }

    _zoomToNode(id) {
      const n = this.store.getNode(id);
      if (!n) return;
      const nw = this._getNodeWidth(n);
      this.vp.s = clamp(this.vp.s, 0.8, 1.5);
      this.vp.x = window.innerWidth / 2 - (n.x + nw / 2) * this.vp.s;
      this.vp.y = window.innerHeight / 2 - (n.y + 30) * this.vp.s;
      this._applyVP();
      // Flash highlight
      const el = this.$nodes.querySelector(`[data-id="${id}"]`);
      if (el) {
        el.classList.add('search-highlight');
        setTimeout(() => el.classList.remove('search-highlight'), 1200);
      }
    }

    // --- Toast ---
    _showToast(msg) {
      this.$toast.textContent = msg;
      this.$toast.classList.add('show');
      clearTimeout(this._toastTimer);
      this._toastTimer = setTimeout(() => this.$toast.classList.remove('show'), 1800);
    }

    // --- Onboarding ---
    _checkOnboarding() {
      if (!localStorage.getItem(ONBOARDED_KEY) && !this.store.data.nodes.length) {
        this.$onboarding.style.display = '';
      } else {
        this.$onboarding.style.display = 'none';
      }
    }

    _startApp() {
      localStorage.setItem(ONBOARDED_KEY, '1');
      this.$onboarding.classList.add('dismissed');
      setTimeout(() => { this.$onboarding.style.display = 'none'; }, 400);
      this._createDemoContent();
    }

    _createDemoContent() {
      const cx = -NODE_W_DEFAULT / 2, cy = -30;
      const w = this.store.addNode({
        id: uid(), x: cx, y: cy,
        title: 'Welcome!', content: 'Drag me onto another note to create a link.\nTap me to edit.',
        color: '#7C5CFC', createdAt: Date.now(), updatedAt: Date.now(),
      });
      const i = this.store.addNode({
        id: uid(), x: cx + 180, y: cy - 130,
        title: 'Ideas', content: 'Capture your fleeting thoughts.',
        color: '#38BDF8', createdAt: Date.now(), updatedAt: Date.now(),
      });
      const p = this.store.addNode({
        id: uid(), x: cx + 190, y: cy + 110,
        title: 'Projects', content: 'Track what you are working on.',
        color: '#34D399', createdAt: Date.now(), updatedAt: Date.now(),
      });
      const r = this.store.addNode({
        id: uid(), x: cx - 180, y: cy - 100,
        title: 'Reading', content: 'Books and articles to explore.',
        color: '#F472B6', createdAt: Date.now(), updatedAt: Date.now(),
      });
      this.store.toggleLink(w.id, i.id);
      this.store.toggleLink(w.id, p.id);
      this.store.toggleLink(i.id, r.id);
      this._render();
      this._centerViewport();
    }

    // --- Rendering ---
    _render() {
      this._renderNodes();
      this._renderLinks();
      this._updateCount();
      this._renderTagFilter();
      this._renderMinimap();
    }

    _renderNodes() {
      const existing = new Set();
      for (const n of this.store.data.nodes) {
        existing.add(n.id);
        let el = this.$nodes.querySelector(`[data-id="${n.id}"]`);
        if (!el) {
          el = document.createElement('div');
          el.className = 'node';
          el.dataset.id = n.id;
          el.innerHTML = `<div class="node-star"></div><div class="node-title"></div><div class="node-preview"></div><div class="node-reminder-badge"></div><div class="node-link-badge"></div>`;
          this.$nodes.appendChild(el);
        } else {
          // Clean up stale animation classes
          el.classList.remove('entering', 'snap-back');
        }
        this._updateNodeEl(n, el);
        // Tag filter
        if (this._activeTagFilter) {
          const match = n.tags && n.tags.includes(this._activeTagFilter);
          el.style.opacity = match ? '' : '0.15';
        } else {
          el.style.opacity = '';
        }
      }
      // Remove stale
      this.$nodes.querySelectorAll('.node').forEach(el => {
        if (!existing.has(el.dataset.id)) el.remove();
      });
    }

    _updateNodeEl(n, el) {
      this._positionNode(n, el);
      el.style.setProperty('--node-color', n.color);
      const star = el.querySelector('.node-star');
      star.style.background = n.color;
      star.style.boxShadow = `0 0 10px ${n.color}90`;
      el.querySelector('.node-title').textContent = n.title || 'Untitled';
      el.querySelector('.node-preview').textContent = n.content ? n.content.slice(0, 50) : '';
      const lc = this.store.linksOf(n.id).length;
      const badge = el.querySelector('.node-link-badge');
      badge.textContent = lc;
      el.classList.toggle('has-links', lc > 0);
      // Reminder
      const rb = el.querySelector('.node-reminder-badge');
      if (n.reminder) {
        const now = Date.now();
        const diff = n.reminder - now;
        const overdue = diff < 0;
        const soon = !overdue && diff < 3600000; // within 1 hour
        el.classList.toggle('reminder-overdue', overdue);
        el.classList.toggle('reminder-soon', soon);
        rb.textContent = overdue ? 'Overdue' : this._formatReminder(n.reminder);
        rb.style.display = '';
      } else {
        el.classList.remove('reminder-overdue', 'reminder-soon');
        rb.style.display = 'none';
      }
    }

    _formatReminder(ts) {
      const d = new Date(ts);
      const now = new Date();
      const diff = ts - Date.now();
      if (diff < 0) return 'Overdue';
      if (diff < 3600000) return Math.ceil(diff / 60000) + 'm';
      if (diff < 86400000) return Math.ceil(diff / 3600000) + 'h';
      if (d.toDateString() === new Date(now.getTime() + 86400000).toDateString()) {
        return 'Tomorrow ' + d.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
      }
      return d.toLocaleDateString('ja-JP', { month: 'short', day: 'numeric' });
    }

    _positionNode(n, el) {
      el.style.transform = `translate(${n.x}px, ${n.y}px)`;
    }

    _renderLinks() {
      const ns = 'http://www.w3.org/2000/svg';
      // Keep defs
      const defs = this.$svg.querySelector('defs');
      while (this.$svg.lastChild && this.$svg.lastChild !== defs) {
        this.$svg.removeChild(this.$svg.lastChild);
      }

      for (const lk of this.store.data.links) {
        const a = this.store.getNode(lk.s);
        const b = this.store.getNode(lk.t);
        if (!a || !b) continue;

        const x1 = a.x + this._getNodeWidth(a) / 2, y1 = a.y + 12;
        const x2 = b.x + this._getNodeWidth(b) / 2, y2 = b.y + 12;

        // Glow line
        const glow = document.createElementNS(ns, 'line');
        glow.setAttribute('x1', x1); glow.setAttribute('y1', y1);
        glow.setAttribute('x2', x2); glow.setAttribute('y2', y2);
        glow.setAttribute('class', 'connection-glow');
        glow.setAttribute('stroke', a.color);
        glow.setAttribute('stroke-opacity', '0.12');
        glow.setAttribute('stroke-width', '6');
        this.$svg.appendChild(glow);

        // Main line
        const line = document.createElementNS(ns, 'line');
        line.setAttribute('x1', x1); line.setAttribute('y1', y1);
        line.setAttribute('x2', x2); line.setAttribute('y2', y2);
        line.setAttribute('class', 'connection-line');
        line.setAttribute('stroke', a.color);
        line.setAttribute('stroke-opacity', '0.4');
        line.setAttribute('stroke-width', '1.2');
        this.$svg.appendChild(line);
      }
    }

    _updateCount() {
      const nc = this.store.data.nodes.length;
      const lc = this.store.data.links.length;
      this.$nodeCount.textContent = `${nc} node${nc !== 1 ? 's' : ''} · ${lc} link${lc !== 1 ? 's' : ''}`;
    }
  }

  // --- Boot ---
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => { window.conste = new App(); });
  } else {
    window.conste = new App();
  }
})();
