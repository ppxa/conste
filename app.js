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
  const NODE_W = 140;
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
      this._resize();
      this._generate();
      window.addEventListener('resize', () => { this._resize(); this._generate(); });
      this._loop();
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
      const count = Math.floor(this.w * this.h / 2500);
      this.stars = [];
      for (let i = 0; i < count; i++) {
        this.stars.push({
          x: Math.random() * this.w,
          y: Math.random() * this.h,
          r: Math.random() * 1.3 + 0.3,
          a: Math.random() * 0.5 + 0.15,
          sp: Math.random() * 1.5 + 0.3,
          ph: Math.random() * Math.PI * 2,
        });
      }
    }
    _loop() {
      const ctx = this.ctx;
      ctx.clearRect(0, 0, this.w, this.h);
      const t = performance.now() / 1000;

      // Stars
      for (const s of this.stars) {
        const tw = 0.5 + 0.5 * Math.sin(t * s.sp + s.ph);
        const alpha = s.a * (0.3 + 0.7 * tw);
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.r, 0, 6.284);
        ctx.fillStyle = `rgba(190,200,240,${alpha})`;
        ctx.fill();
      }

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
      this.$toast = document.getElementById('toast');
      this.$hint = document.getElementById('link-hint');
      this.$nodeCount = document.getElementById('node-count');
      this.$onboarding = document.getElementById('onboarding');

      this._initSVG();
      this._bindEvents();
      this._render();
      this._centerViewport();
      this._checkOnboarding();

      new StarField(document.getElementById('starfield'));
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

    // --- Events ---
    _bindEvents() {
      const c = this.$container;
      // Touch
      c.addEventListener('touchstart', e => this._onTouchStart(e), { passive: false });
      c.addEventListener('touchmove', e => this._onTouchMove(e), { passive: false });
      c.addEventListener('touchend', e => this._onTouchEnd(e));
      c.addEventListener('touchcancel', e => this._onTouchEnd(e));
      // Mouse
      c.addEventListener('mousedown', e => this._onPointerDown(e.clientX, e.clientY, e.target, e));
      window.addEventListener('mousemove', e => { if (this.touchInfo) this._onPointerMove(e.clientX, e.clientY); });
      window.addEventListener('mouseup', e => { if (this.touchInfo) this._onPointerUp(); });
      c.addEventListener('wheel', e => this._onWheel(e), { passive: false });
      // UI buttons
      document.getElementById('fab-add').addEventListener('click', () => this._createAtCenter());
      document.getElementById('btn-fit').addEventListener('click', () => this._fitView());
      document.getElementById('editor-back').addEventListener('click', () => this._closeEditor());
      document.getElementById('editor-delete').addEventListener('click', () => this._deleteCurrent());
      this.$editorOverlay.addEventListener('click', () => this._closeEditor());
      this.$editorTitle.addEventListener('input', () => this._saveEditor());
      this.$editorContent.addEventListener('input', () => this._saveEditor());
      document.getElementById('onboarding-start').addEventListener('click', () => this._startApp());
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
      if (nodeEl) {
        const n = this.store.getNode(nodeEl.dataset.id);
        if (n) this.dragging = { node: n, el: nodeEl, sx: n.x, sy: n.y, ox: px, oy: py };
      } else {
        this.panning = { vpx: this.vp.x, vpy: this.vp.y, tx: px, ty: py };
      }
    }

    _onPointerMove(px, py) {
      if (!this.touchInfo) return;
      const dx = px - this.touchInfo.x;
      const dy = py - this.touchInfo.y;
      if (Math.hypot(dx, dy) > TAP_THRESHOLD) this.touchInfo.moved = true;

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
          this._createNode(wp.x - NODE_W / 2, wp.y - 28);
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
    }

    _centerViewport() {
      const nodes = this.store.data.nodes;
      if (!nodes.length) {
        this.vp.x = window.innerWidth / 2;
        this.vp.y = window.innerHeight / 2;
      } else {
        const ax = nodes.reduce((s, n) => s + n.x + NODE_W / 2, 0) / nodes.length;
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
        maxX = Math.max(maxX, n.x + NODE_W);
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
      const cx1 = dragNode.x + NODE_W / 2;
      const cy1 = dragNode.y + 30;
      for (const n of this.store.data.nodes) {
        if (n.id === dragNode.id) continue;
        const d = hypot(cx1, cy1, n.x + NODE_W / 2, n.y + 30);
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
      const n = this.store.addNode({
        id: uid(), x, y,
        title: '', content: '',
        color: pick(COLORS),
        createdAt: Date.now(), updatedAt: Date.now(),
      });
      this._render();
      const el = this.$nodes.querySelector(`[data-id="${n.id}"]`);
      if (el) el.classList.add('entering');
      setTimeout(() => this._openEditor(n.id), 320);
      return n;
    }

    _createAtCenter() {
      const c = this._s2w(window.innerWidth / 2, window.innerHeight / 2);
      this._createNode(c.x - NODE_W / 2, c.y - 28);
    }

    _deleteCurrent() {
      if (!this.editorNodeId) return;
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
      this.editorNodeId = id;
      this.$editorTitle.value = n.title;
      this.$editorContent.value = n.content;

      // Linked nodes chips
      const links = this.store.linksOf(id);
      this.$editorLinks.innerHTML = links.map(l => {
        const oid = l.s === id ? l.t : l.s;
        const o = this.store.getNode(oid);
        if (!o) return '';
        return `<span class="editor-link-chip"><span class="editor-link-dot" style="background:${o.color}"></span>${o.title || 'Untitled'}</span>`;
      }).join('');

      // Meta
      const d = new Date(n.createdAt);
      this.$editorMeta.textContent = `Created ${d.toLocaleDateString('ja-JP')} ${d.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })}`;

      this.$editorSheet.classList.add('open');
      this.$editorOverlay.classList.add('open');
      setTimeout(() => { if (!n.title) this.$editorTitle.focus(); }, 380);
    }

    _closeEditor() {
      this._saveEditor();
      this.editorNodeId = null;
      this.$editorSheet.classList.remove('open');
      this.$editorOverlay.classList.remove('open');
      this._render();
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
      const cx = -NODE_W / 2, cy = -30;
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
          el.innerHTML = `<div class="node-star"></div><div class="node-title"></div><div class="node-preview"></div><div class="node-link-badge"></div>`;
          this.$nodes.appendChild(el);
        }
        this._updateNodeEl(n, el);
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

        const x1 = a.x + NODE_W / 2, y1 = a.y + 12;
        const x2 = b.x + NODE_W / 2, y2 = b.y + 12;

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
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => { window.conste = new App(); });
  } else {
    window.conste = new App();
  }
})();
