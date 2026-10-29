/*
 * MapView — shared by kiosk and phone.
 *  - Floor SVGs are cached (B.loadFloorSvg) and inlined once; switching floors just toggles layers.
 *  - Camera = {cx, cy, s}: svg point (cx,cy) at stage centre, s = screen px per svg unit.
 *  - Floors move with a CSS transform (will-change only while moving -> crisp after settle).
 *  - Overlay (route, markers, labels) is drawn in SCREEN space, so sizes stay constant at any zoom.
 */
window.BSB = window.BSB || {};
(function (B) {
  var NS = 'http://www.w3.org/2000/svg';
  function el(tag, attrs, parent) {
    var e = document.createElementNS(NS, tag);
    if (attrs) for (var k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function lite() { return !!(B.perf && B.perf.lite); }
  var MAX_LITE_LAYERS = 3; // lite: keep at most 3 floor SVGs in the DOM

  var CAT_COLORS = {
    'food-beverage': '#D9822B', 'fashion': '#3B5BDB', 'beauty-health': '#C2417A', 'electronics': '#0B8A8A',
    'kids-family': '#E0A800', 'entertainment': '#7B4FD6', 'department-store': '#2F9E44', 'services': '#6B7280'
  };
  B.CAT_COLORS = CAT_COLORS;

  function MapView(container, opts) {
    this.opts = opts || {};
    this.D = B.D;
    this.cfg = window.BSB_CONFIG || {};
    this.root = container;
    container.classList.add('map-stage');
    this.floorsEl = document.createElement('div'); this.floorsEl.className = 'map-floors';
    container.appendChild(this.floorsEl);
    this.ov = el('svg', { class: 'map-overlay' }, container);
    var defs = el('defs', null, this.ov);
    defs.innerHTML =
      '<filter id="mvShadow" x="-50%" y="-50%" width="200%" height="200%"><feDropShadow dx="0" dy="3" stdDeviation="4" flood-color="#2a2118" flood-opacity=".28"/></filter>' +
      '<radialGradient id="mvCone" cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="scale(64)"><stop offset="0" stop-color="#2F5BEA" stop-opacity=".45"/><stop offset="1" stop-color="#2F5BEA" stop-opacity="0"/></radialGradient>';
    this.gDots = el('g', { class: 'mv-dots' }, this.ov);
    this.gAmen = el('g', { class: 'mv-amen' }, this.ov);
    this.gRoute = el('g', { class: 'mv-route' }, this.ov);
    this.pGlow = el('path', { class: 'r-glow', pathLength: 1 }, this.gRoute);
    this.pCase = el('path', { class: 'r-case', pathLength: 1 }, this.gRoute);
    this.pCore = el('path', { class: 'r-core', pathLength: 1 }, this.gRoute);
    this.pAnts = el('path', { class: 'r-ants' }, this.gRoute);
    this.gRun = el('g', { class: 'mv-run' }, this.gRoute);
    this.gRun.innerHTML = '<circle r="9"/>'; this.gRun.style.display = 'none';
    this.gPins = el('g', { class: 'mv-pins' }, this.ov);
    this.gConn = el('g', { class: 'mv-conn' }, this.gPins);
    this.gStart = el('g', { class: 'mv-start' }, this.gPins);
    this.gYah = el('g', { class: 'mv-yah' }, this.gPins);
    this.gDest = el('g', { class: 'mv-dest' }, this.gPins);
    this.gDot = el('g', { class: 'mv-dot' }, this.gPins);
    this._buildPins();

    this.layers = {};
    this.floor = null;
    this.cam = { cx: 960, cy: 540, s: 0.5 };
    this.route = null; this.routeP = 0;
    this.kiosk = null; this.origin = null; this.dest = null; this.dot = null; this.connectors = [];
    this.closed = { nodes: {}, amen: {} }; this._lru = [];
    this.W = container.clientWidth || 800; this.H = container.clientHeight || 600;
    this.pad = this.opts.pad || { l: 60, r: 60, t: 60, b: 60 };
    var self = this;
    if (window.ResizeObserver) new ResizeObserver(function () { self._resize(); }).observe(container);
    if (this.opts.interactive !== false) this._bindGestures();
  }

  MapView.prototype._resize = function () {
    var W = this.root.clientWidth, H = this.root.clientHeight;
    if (!W || !H) return;
    if (this.floor && this.W && this.H && (W !== this.W || H !== this.H)) {
      this.W = W; this.H = H; this.apply();
    } else { this.W = W; this.H = H; }
    this.ov.setAttribute('width', W); this.ov.setAttribute('height', H);
  };

  MapView.prototype._buildPins = function () {
    var t = B.t;
    // You are here
    this.gYah.innerHTML =
      '<circle class="yah-pulse" r="18"/><circle class="yah-pulse yah-pulse2" r="18"/>' +
      '<circle r="15" fill="#fff" filter="url(#mvShadow)"/><circle r="10" class="yah-core"/>' +
      '<g class="pin-label yah-label" transform="translate(0,-34)"><rect rx="16" ry="16" height="32" y="-16"/><text text-anchor="middle" dy="6"></text></g>';
    // destination pin
    this.gDest.innerHTML =
      '<g class="dest-bounce"><ellipse class="dest-shadow" rx="12" ry="4" cy="2"/>' +
      '<path class="dest-pin" filter="url(#mvShadow)" d="M0 0 C -6 -14 -26 -26 -26 -46 A 26 26 0 1 1 26 -46 C 26 -26 6 -14 0 0 Z"/>' +
      '<circle class="dest-face" cy="-46" r="20"/><clipPath id="mvDestClip"><circle cy="-46" r="19"/></clipPath>' +
      '<image class="dest-logo" x="-19" y="-65" width="38" height="38" clip-path="url(#mvDestClip)" preserveAspectRatio="xMidYMid meet"/>' +
      '<text class="dest-ini" y="-40" text-anchor="middle"></text>' +
      '<g class="pin-label dest-label" transform="translate(0,-92)"><rect rx="16" ry="16" height="34" y="-17"/><text text-anchor="middle" dy="6"></text></g></g>';
    // moving dot (phone)
    this.gDot.innerHTML = '<path class="dot-cone" d="M0 0 L -30 -60 A 67 67 0 0 1 30 -60 Z" fill="url(#mvCone)"/>' +
      '<circle r="20" class="dot-halo"/><circle r="11" fill="#fff" filter="url(#mvShadow)"/><circle r="8" class="dot-core"/>';
    this.gStart.innerHTML = '<circle r="11" fill="#fff" filter="url(#mvShadow)"/><circle r="6" class="start-core"/>';
    this.gYah.style.display = this.gDest.style.display = this.gDot.style.display = this.gStart.style.display = 'none';
  };

  // --------------- floors ---------------
  MapView.prototype.preload = function (ids) {
    var self = this;
    return Promise.all(ids.map(function (id) { return self._layer(id); }));
  };
  MapView.prototype._touch = function (floorId) {
    var i = this._lru.indexOf(floorId); if (i >= 0) this._lru.splice(i, 1); this._lru.push(floorId);
    if (!lite()) return;
    var self = this;
    while (this._lru.length > MAX_LITE_LAYERS) {
      var victim = null;
      for (var k = 0; k < this._lru.length; k++) { var id = this._lru[k]; if (id !== this.floor && id !== floorId && this.layers[id]) { victim = id; break; } }
      if (!victim) break;
      this._lru.splice(this._lru.indexOf(victim), 1);
      var L = this.layers[victim]; if (L && L.outer.parentNode) L.outer.parentNode.removeChild(L.outer);
      delete this.layers[victim];
      if (B.evictFloorSvg) B.evictFloorSvg(victim);
      if (this._hl && !document.contains(this._hl)) this._hl = null;
    }
  };
  MapView.prototype._layer = function (floorId) {
    var self = this;
    if (this.layers[floorId]) { this._touch(floorId); return Promise.resolve(this.layers[floorId]); }
    return B.loadFloorSvg(floorId).then(function (svg) {
      if (self.layers[floorId]) return self.layers[floorId];
      var f = self.D.floorById[floorId];
      var outer = document.createElement('div'); outer.className = 'map-floor'; outer.dataset.floor = floorId;
      var cam = document.createElement('div'); cam.className = 'map-cam';
      cam.style.width = f.viewBox[2] + 'px'; cam.style.height = f.viewBox[3] + 'px';
      // A floor SVG element can only live in one DOM place; the phone and kiosk are separate pages so this is fine.
      cam.appendChild(svg);
      svg.setAttribute('width', f.viewBox[2]); svg.setAttribute('height', f.viewBox[3]);
      outer.appendChild(cam);
      outer.style.visibility = 'hidden';
      self.floorsEl.appendChild(outer);
      self.layers[floorId] = { outer: outer, cam: cam, svg: svg };
      self._touch(floorId);
      return self.layers[floorId];
    });
  };

  MapView.prototype.boxFor = function (floorId, building) {
    var f = this.D.floorById[floorId], fo = f.focus || {};
    if (building && fo[building]) return fo[building];
    var keys = Object.keys(fo);
    if (!keys.length) return f.viewBox;
    var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    keys.forEach(function (k) { var b = fo[k]; x0 = Math.min(x0, b[0]); y0 = Math.min(y0, b[1]); x1 = Math.max(x1, b[0] + b[2]); y1 = Math.max(y1, b[1] + b[3]); });
    return [x0, y0, x1 - x0, y1 - y0];
  };

  MapView.prototype.camFor = function (box, pad) {
    pad = pad || this.pad;
    var W = this.W - pad.l - pad.r, H = this.H - pad.t - pad.b;
    var s = Math.min(W / box[2], H / box[3]);
    s = clamp(s, this._sMin(), this._sMax());
    // centre of box placed at centre of padded area
    var cx = box[0] + box[2] / 2 - ((pad.l - pad.r) / 2) / s;
    var cy = box[1] + box[3] / 2 - ((pad.t - pad.b) / 2) / s;
    return { cx: cx, cy: cy, s: s };
  };
  MapView.prototype._sMax = function () {
    var f = this.D.floorById[this.floor || 'gf'];
    return 16 * (f.unitScale || 1) * this.cfg.metersPerUnit; // max 16 px per metre
  };
  MapView.prototype._sMin = function () {
    var f = this.D.floorById[this.floor || 'gf'];
    return Math.min(this.W / f.viewBox[2], this.H / f.viewBox[3]) * 0.9;
  };

  // show a floor; opts: {building, box, dir:'up'|'down'|null, animate, duration}
  MapView.prototype.showFloor = function (floorId, opts) {
    opts = opts || {};
    var self = this;
    return this._layer(floorId).then(function (L) {
      var prev = self.floor, prevL = prev && self.layers[prev];
      self.floor = floorId;
      var target = self.camFor(opts.box || self.boxFor(floorId, opts.building), opts.pad);
      if (prev === floorId) return self.flyTo(target, opts.animate === false ? 0 : (opts.duration || 0.9));
      if (self._tw) self._tw.kill(); // a camera flight still running on the previous floor would drag this floor's camera back
      self.cam = target;
      Object.keys(self.layers).forEach(function (k) { if (k !== floorId && k !== prev) self.layers[k].outer.style.visibility = 'hidden'; });
      L.outer.style.visibility = 'visible';
      self.apply();
      if (self.onFloor) self.onFloor(floorId);
      var dur = opts.animate === false || !prev || !window.gsap ? 0 : 0.75;
      if (dur && lite()) { // lite: plain crossfade, 250 ms
        self._moving(true);
        return new Promise(function (res) {
          gsap.fromTo(L.outer, { opacity: 0 }, { opacity: 1, duration: 0.25, ease: 'none', onComplete: function () {
            if (prevL) { prevL.outer.style.visibility = 'hidden'; prevL.outer.style.opacity = ''; }
            self._moving(false); res();
          } });
        });
      }
      if (!dur) {
        if (prevL) prevL.outer.style.visibility = 'hidden';
        L.outer.style.opacity = 1; L.outer.style.transform = '';
        return Promise.resolve();
      }
      var dy = opts.dir === 'down' ? -1 : 1; // going up: new floor drops in from above
      self._moving(true);
      if (self._flTl) self._flTl.kill();
      return new Promise(function (res) {
        var tl = gsap.timeline({ onComplete: function () {
          self._flTl = null;
          if (prevL) { prevL.outer.style.visibility = 'hidden'; gsap.set(prevL.outer, { clearProps: 'transform,opacity' }); }
          gsap.set(L.outer, { clearProps: 'transform' });
          self._moving(false); res();
        }, onInterrupt: function () {
          self._flTl = null;
          self._moving(false); res();
        } });
        self._flTl = tl;
        if (prevL) tl.to(prevL.outer, { opacity: 0, y: 70 * dy, scale: 0.94, duration: dur * 0.8, ease: 'power2.in' }, 0);
        tl.fromTo(L.outer, { opacity: 0, y: -70 * dy, scale: 1.06 }, { opacity: 1, y: 0, scale: 1, duration: dur, ease: 'power3.out' }, dur * 0.35);
        tl.fromTo(self.ov, { opacity: 0 }, { opacity: 1, duration: 0.4 }, dur * 0.8);
      });
    });
  };

  MapView.prototype._moving = function (on) {
    var self = this;
    clearTimeout(this._mt);
    if (on) this.root.classList.add('moving');
    else this._mt = setTimeout(function () { self.root.classList.remove('moving'); }, 120);
  };

  MapView.prototype.flyTo = function (target, duration) {
    var self = this;
    if (this._tw) this._tw.kill();
    if (!duration || !window.gsap) { this.cam = target; this.apply(); return Promise.resolve(); }
    if (lite()) { // lite: jump + 150 ms fade instead of a per-frame camera tween
      this.cam = target; this.apply();
      var Lf = this.floor && this.layers[this.floor];
      if (Lf && duration > 0.3) gsap.fromTo([Lf.outer, this.ov], { opacity: 0.45 }, { opacity: 1, duration: 0.15, ease: 'none' });
      return Promise.resolve();
    }
    this._moving(true);
    var from = { cx: this.cam.cx, cy: this.cam.cy, ls: Math.log(this.cam.s) };
    var to = { cx: target.cx, cy: target.cy, ls: Math.log(target.s) };
    var o = { t: 0 };
    return new Promise(function (res) {
      self._tw = gsap.to(o, { t: 1, duration: duration, ease: 'power2.inOut', onUpdate: function () {
        var k = o.t;
        self.cam = { cx: from.cx + (to.cx - from.cx) * k, cy: from.cy + (to.cy - from.cy) * k, s: Math.exp(from.ls + (to.ls - from.ls) * k) };
        self.apply();
      }, onComplete: function () { self._moving(false); res(); }, onInterrupt: function () { self._moving(false); res(); } });
    });
  };
  MapView.prototype.fitBox = function (box, duration, pad) { return this.flyTo(this.camFor(box, pad), duration == null ? 1 : duration); };
  MapView.prototype.fitPoints = function (pts, minMeters, duration, pad) {
    var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    pts.forEach(function (p) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); });
    var f = this.D.floorById[this.floor], minU = (minMeters || 30) / ((f.unitScale || 1) * this.cfg.metersPerUnit);
    var w = Math.max(x1 - x0, minU), h = Math.max(y1 - y0, minU * 0.6);
    var cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    return this.fitBox([cx - w / 2, cy - h / 2, w, h], duration, pad);
  };
  MapView.prototype.zoomBy = function (k) {
    var s = clamp(this.cam.s * k, this._sMin(), this._sMax());
    return this.flyTo({ cx: this.cam.cx, cy: this.cam.cy, s: s }, 0.35);
  };

  MapView.prototype.toScreen = function (x, y) {
    var c = this.cam;
    return { x: (x - c.cx) * c.s + this.W / 2, y: (y - c.cy) * c.s + this.H / 2 };
  };
  MapView.prototype.toMap = function (X, Y) {
    var c = this.cam;
    return { x: (X - this.W / 2) / c.s + c.cx, y: (Y - this.H / 2) / c.s + c.cy };
  };

  MapView.prototype.apply = function () {
    var L = this.floor && this.layers[this.floor];
    var c = this.cam;
    if (L) {
      var tx = this.W / 2 - c.cx * c.s, ty = this.H / 2 - c.cy * c.s;
      L.cam.style.transform = 'translate3d(' + tx.toFixed(2) + 'px,' + ty.toFixed(2) + 'px,0) scale(' + c.s.toFixed(5) + ')';
    }
    this.renderOverlay();
    if (this.onCamera) this.onCamera(this.cam);
  };

  // --------------- overlay ---------------
  MapView.prototype.setTenantDots = function (on) { this.showDots = on; this._dotsFloor = null; this.renderOverlay(); };
  MapView.prototype._ensureDots = function () {
    if (this._dotsFloor === this.floor) return;
    this._dotsFloor = this.floor;
    var self = this, html = '';
    this.dotList = this.showDots ? this.D.tenants.filter(function (t) { return t.floor === self.floor; }) : [];
    this.gDots.textContent = '';
    this.dotEls = this.dotList.map(function (t) {
      var g = el('g', { class: 'tdot', 'data-id': t.id }, self.gDots);
      el('circle', { r: 7.5, fill: (B.catColor ? B.catColor(t.category) : CAT_COLORS[t.category]) || '#555' }, g);
      return g;
    });
    // amenities
    this.gAmen.textContent = '';
    this.amenList = this.D.amenities.filter(function (a) { return a.floor === self.floor && (a.kind === 'poi' || (a.toFloors || []).length); });
    var types = this.D.amenityTypeById || {};
    this.amenEls = this.amenList.map(function (a) {
      var g;
      if (a.kind === 'poi') { // POI: coloured tile + Lucide icon of its type
        var at = types[a.type] || {};
        g = el('g', { class: 'poi poi-' + a.type, 'data-id': a.id }, self.gAmen);
        el('rect', { x: -15, y: -15, width: 30, height: 30, rx: 9, fill: at.color || '#4A433C' }, g);
        var ic = el('svg', { x: -10, y: -10, width: 20, height: 20, viewBox: '0 0 24 24', fill: 'none', stroke: '#fff', 'stroke-width': 2.2,
          'stroke-linecap': 'round', 'stroke-linejoin': 'round', class: 'poi-ic' }, g);
        ic.innerHTML = (B.ICONS && B.ICONS[a.icon || at.icon]) || (B.ICONS && B.ICONS.info) || '';
      } else {
        g = el('g', { class: 'amen amen-' + a.type, 'data-node': a.node }, self.gAmen);
        el('rect', { x: -14, y: -14, width: 28, height: 28, rx: 8 }, g);
        var p = el('path', { d: a.type === 'lift' ? 'M-6 -2 L0 -8 L6 -2 M-6 2 L0 8 L6 2' :
          a.type === 'crossing' ? 'M-8 3 Q0 -7 8 3 M-8 3 H8' : 'M-8 7 H-3 L4 -6 H8' }, g);
        p.setAttribute('class', 'amen-ic');
      }
      // "closed / under maintenance" badge (wrench), toggled by setClosures()
      var x = el('g', { class: 'amen-x', transform: 'translate(13,-13)' }, g);
      el('circle', { r: 9 }, x);
      var w = el('svg', { x: -6, y: -6, width: 12, height: 12, viewBox: '0 0 24 24' }, x);
      w.innerHTML = (B.ICONS && B.ICONS.wrench) || '';
      return g;
    });
    this._markClosed();
  };
  // closures from status.json: nodes = {node:'all'|'partial'} (connector stops), amen = {amenityId:true} (POIs)
  MapView.prototype.setClosures = function (nodes, amenIds) {
    var a = {}; (amenIds || []).forEach(function (id) { a[id] = true; });
    this.closed = { nodes: nodes || {}, amen: a };
    this._markClosed();
  };
  MapView.prototype._markClosed = function () {
    var c = this.closed || { nodes: {}, amen: {} };
    for (var i = 0; i < (this.amenEls || []).length; i++) {
      var a = this.amenList[i], g = this.amenEls[i];
      var on = a.kind === 'poi' ? !!c.amen[a.id] : !!c.nodes[a.node];
      var cls = g.getAttribute('class').replace(/ closed\b/, '');
      g.setAttribute('class', on ? cls + ' closed' : cls);
    }
  };

  MapView.prototype.renderOverlay = function () {
    if (!this.floor) return;
    this._ensureDots();
    var self = this, i, p;
    var showDots = this.showDots;
    for (i = 0; i < (this.dotEls || []).length; i++) {
      var t = this.dotList[i]; p = this.toScreen(t.x, t.y);
      this.dotEls[i].setAttribute('transform', 'translate(' + p.x.toFixed(1) + ',' + p.y.toFixed(1) + ')');
    }
    for (i = 0; i < (this.amenEls || []).length; i++) {
      var a = this.amenList[i]; p = this.toScreen(a.x, a.y);
      this.amenEls[i].setAttribute('transform', 'translate(' + p.x.toFixed(1) + ',' + p.y.toFixed(1) + ')');
    }
    // route
    var r = this.route;
    if (r && r.floor === this.floor && r.pts.length > 1) {
      var d = r.pts.map(function (q, k) { var s = self.toScreen(q.x, q.y); return (k ? 'L' : 'M') + s.x.toFixed(1) + ' ' + s.y.toFixed(1); }).join('');
      this.pGlow.setAttribute('d', d); this.pCase.setAttribute('d', d); this.pCore.setAttribute('d', d); this.pAnts.setAttribute('d', d);
      this.gRoute.style.display = '';
      var off = String(1 - this.routeP);
      this.pGlow.style.strokeDashoffset = off; this.pCase.style.strokeDashoffset = off; this.pCore.style.strokeDashoffset = off;
      this.pAnts.style.opacity = this.routeP >= 1 ? 1 : 0;
      // start marker for legs not starting at the kiosk
      if (r.startMarker) { p = this.toScreen(r.pts[0].x, r.pts[0].y); this.gStart.style.display = ''; this.gStart.setAttribute('transform', 'translate(' + p.x + ',' + p.y + ')'); }
      else this.gStart.style.display = 'none';
    } else { this.gRoute.style.display = 'none'; this.gStart.style.display = 'none'; }
    // connectors (end-of-leg chips)
    for (i = 0; i < this.connectors.length; i++) {
      var c = this.connectors[i];
      c.g.style.display = c.floor === this.floor ? '' : 'none';
      if (c.floor === this.floor) { p = this.toScreen(c.x, c.y); c.g.setAttribute('transform', 'translate(' + p.x.toFixed(1) + ',' + p.y.toFixed(1) + ')'); }
    }
    // origin / you are here
    var k = this.origin || this.kiosk;
    if (k && k.floor === this.floor) { p = this.toScreen(k.x, k.y); this.gYah.style.display = ''; this.gYah.setAttribute('transform', 'translate(' + p.x.toFixed(1) + ',' + p.y.toFixed(1) + ')'); }
    else this.gYah.style.display = 'none';
    var dt = this.dest;
    if (dt && dt.floor === this.floor) { p = this.toScreen(dt.x, dt.y); this.gDest.style.display = ''; this.gDest.setAttribute('transform', 'translate(' + p.x.toFixed(1) + ',' + p.y.toFixed(1) + ')'); }
    else this.gDest.style.display = 'none';
    var dot = this.dot;
    if (dot && dot.floor === this.floor) {
      p = this.toScreen(dot.x, dot.y); this.gDot.style.display = '';
      this.gDot.setAttribute('transform', 'translate(' + p.x.toFixed(1) + ',' + p.y.toFixed(1) + ')');
      var cone = this.gDot.firstChild;
      if (dot.heading == null) cone.style.display = 'none';
      else { cone.style.display = ''; cone.setAttribute('transform', 'rotate(' + dot.heading.toFixed(1) + ')'); }
    } else this.gDot.style.display = 'none';
  };

  MapView.prototype.setOrigin = function (orig) {
    this.origin = orig || null;
    var k = this.origin || this.kiosk;
    if (!k) { this.renderOverlay(); return; }
    var lbl = this.origin ? (this.origin.name || B.t('startPoint')) : B.t('youAreHere');
    this.gYah.querySelector('.yah-label text').textContent = lbl;
    this._sizeLabel(this.gYah.querySelector('.yah-label'));
    this.gYah.classList.toggle('custom-origin', !!this.origin);
    this.renderOverlay();
  };

  MapView.prototype.setKiosk = function (k) {
    this.kiosk = k;
    if (this.origin) { this.setOrigin(this.origin); return; }
    if (!k) { this.renderOverlay(); return; }
    this.gYah.querySelector('.yah-label text').textContent = B.t('youAreHere');
    this._sizeLabel(this.gYah.querySelector('.yah-label'));
    this.gYah.classList.remove('custom-origin');
    this.renderOverlay();
  };
  MapView.prototype._sizeLabel = function (g) {
    var tx = g.querySelector('text'), rc = g.querySelector('rect');
    var w = 0; try { w = tx.getComputedTextLength(); } catch (e) {}
    if (!w) w = tx.textContent.length * 8.5;
    rc.setAttribute('width', w + 28); rc.setAttribute('x', -(w + 28) / 2);
  };

  MapView.prototype.setDest = function (t, opts) {
    var prevId = this.dest && this.dest.id;
    if (this._hl) { this._hl.classList.remove('unit-hl'); this._hl = null; }
    this.dest = t;
    if (!t) { this.renderOverlay(); return; }
    var img = this.gDest.querySelector('.dest-logo'), ini = this.gDest.querySelector('.dest-ini');
    if (t.logo) { img.setAttribute('href', B.ROOT + t.logo); img.style.display = ''; ini.textContent = ''; }
    else { img.style.display = 'none'; ini.textContent = B.initials(t.name); }
    var lbl = this.gDest.querySelector('.dest-label');
    lbl.querySelector('text').textContent = t.name;
    this._sizeLabel(lbl);
    lbl.style.display = opts && opts.noLabel ? 'none' : '';
    var self = this;
    this._layer(t.floor).then(function (L) {
      var u = L.svg.querySelector('#unit-' + (window.CSS && CSS.escape ? CSS.escape(t.id) : t.id));
      if (u && self.dest === t) { u.classList.add('unit-hl'); self._hl = u; }
    });
    this.renderOverlay();
    if (window.gsap && (prevId !== t.id || (opts && opts.bounce))) this.bounceDest();
  };
  MapView.prototype.bounceDest = function () {
    if (!window.gsap) return;
    if (lite()) { gsap.fromTo(this.gDest.querySelector('.dest-bounce'), { opacity: 0 }, { opacity: 1, duration: 0.2 }); return; }
    var b = this.gDest.querySelector('.dest-bounce');
    gsap.fromTo(b, { y: -60, opacity: 0 }, { y: 0, opacity: 1, duration: 0.9, ease: 'bounce.out' });
  };

  MapView.prototype.setDot = function (d) { this.dot = d; this.renderOverlay(); };

  MapView.prototype.setRoute = function (floor, pts, opts) {
    opts = opts || {};
    if (this._rtw) this._rtw.kill();
    if (!floor) { this.route = null; this.renderOverlay(); return Promise.resolve(); }
    this.route = { floor: floor, pts: pts, startMarker: !!opts.startMarker };
    var self = this;
    this.gRun.style.display = 'none';
    if (!opts.animate || !window.gsap) { this.routeP = 1; this.renderOverlay(); return Promise.resolve(); }
    if (lite()) {
      // lite: the polyline is drawn complete at once; only a small marker travels along it (one transform per frame)
      this.routeP = 1; this.renderOverlay();
      var L = 0, cum = [0];
      for (var i = 1; i < pts.length; i++) { L += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y); cum.push(L); }
      if (!L) return Promise.resolve();
      var run = this.gRun, o = { p: 0 };
      run.style.display = '';
      return new Promise(function (res) {
        self._rtw = gsap.to(o, { p: 1, duration: Math.min(opts.duration || 1.6, 2), ease: 'none',
          onUpdate: function () {
            var m = o.p * L, k = 1; while (k < cum.length - 1 && cum[k] < m) k++;
            var t = (m - cum[k - 1]) / ((cum[k] - cum[k - 1]) || 1);
            var q = self.toScreen(pts[k - 1].x + t * (pts[k].x - pts[k - 1].x), pts[k - 1].y + t * (pts[k].y - pts[k - 1].y));
            run.setAttribute('transform', 'translate(' + q.x.toFixed(1) + ',' + q.y.toFixed(1) + ')');
          },
          onComplete: function () { run.style.display = 'none'; res(); }, onInterrupt: function () { run.style.display = 'none'; res(); } });
      });
    }
    this.routeP = 0; this.renderOverlay();
    var o = { p: 0 };
    return new Promise(function (res) {
      self._rtw = gsap.to(o, { p: 1, duration: opts.duration || 1.6, ease: 'power1.inOut',
        onUpdate: function () { self.routeP = o.p; self.renderOverlay(); },
        onComplete: res, onInterrupt: res });
    });
  };

  MapView.prototype.setConnectors = function (list) {
    this.gConn.textContent = '';
    var self = this;
    this.connectors = (list || []).map(function (c) {
      var g = el('g', { class: 'conn conn-' + c.kind }, self.gConn);
      var w = Math.max(56, c.label.length * 9 + 44);
      el('rect', { x: -w / 2, y: -50, width: w, height: 34, rx: 17 }, g);
      el('path', { d: c.dir === 'down' ? 'M0 -8 L-7 -16 H7 Z' : 'M0 -16 L-7 -8 H7 Z', class: 'conn-tip' }, g);
      var tx = el('text', { x: 0, y: -27, 'text-anchor': 'middle' }, g);
      tx.textContent = c.label;
      el('circle', { r: 7, class: 'conn-dot' }, g);
      return { g: g, floor: c.floor, x: c.x, y: c.y };
    });
    this.renderOverlay();
  };

  // --------------- gestures: pan / pinch / wheel / tap ---------------
  MapView.prototype._bindGestures = function () {
    var self = this, root = this.root, ptrs = {}, start = null, last = null, raf = 0, moved = false;
    function pts() { return Object.keys(ptrs).map(function (k) { return ptrs[k]; }); }
    function sched() { if (!raf) raf = requestAnimationFrame(function () { raf = 0; self.apply(); }); }
    // pointer → local map px; robust to page scaling (CSS zoom/transform) of the kiosk stage
    function loc(e) {
      var r = root.getBoundingClientRect(), kx = r.width / (root.clientWidth || r.width || 1), ky = r.height / (root.clientHeight || r.height || 1);
      return { x: (e.clientX - r.left) / kx, y: (e.clientY - r.top) / ky };
    }
    root.addEventListener('pointerdown', function (e) {
      if (e.target.closest && e.target.closest('.map-ui')) return;
      root.setPointerCapture && root.setPointerCapture(e.pointerId);
      ptrs[e.pointerId] = loc(e);
      if (self._tw) self._tw.kill();
      var p = pts();
      if (p.length === 1) { start = { x: ptrs[e.pointerId].x, y: ptrs[e.pointerId].y, t: Date.now() }; moved = false; }
      last = snapshot(p);
      self._moving(true);
      if (self.onInteract) self.onInteract();
    });
    function snapshot(p) {
      if (p.length >= 2) return { x: (p[0].x + p[1].x) / 2, y: (p[0].y + p[1].y) / 2, d: Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y) };
      return { x: p[0].x, y: p[0].y, d: 0 };
    }
    root.addEventListener('pointermove', function (e) {
      if (!ptrs[e.pointerId]) return;
      ptrs[e.pointerId] = loc(e);
      var p = pts(), cur = snapshot(p);
      if (start && Math.hypot(ptrs[e.pointerId].x - start.x, ptrs[e.pointerId].y - start.y) > 10) moved = true;
      if (!moved && p.length < 2) return;
      if (p.length >= 2 && last.d && cur.d) {
        var k = cur.d / last.d;
        var ns = clamp(self.cam.s * k, self._sMin(), self._sMax());
        var before = self.toMap(last.x, last.y);
        self.cam.s = ns;
        var after = self.toMap(cur.x, cur.y);
        self.cam.cx += before.x - after.x; self.cam.cy += before.y - after.y;
        moved = true;
      } else {
        var a = self.toMap(last.x, last.y), b = self.toMap(cur.x, cur.y); // any floor projection (2D or 3D)
        self.cam.cx += a.x - b.x; self.cam.cy += a.y - b.y;
      }
      self._clampCam();
      last = cur; sched();
    });
    function up(e) {
      if (!ptrs[e.pointerId]) return;
      delete ptrs[e.pointerId];
      var p = pts();
      if (p.length) { last = snapshot(p); return; }
      self._moving(false);
      if (start && !moved && Date.now() - start.t < 600) {
        var q = loc(e);
        self._tap(q.x, q.y);
      }
      start = null;
    }
    root.addEventListener('pointerup', up);
    root.addEventListener('pointercancel', up);
    root.addEventListener('wheel', function (e) {
      e.preventDefault();
      var q = loc(e), X = q.x, Y = q.y;
      var before = self.toMap(X, Y);
      self.cam.s = clamp(self.cam.s * Math.exp(-e.deltaY * 0.0015), self._sMin(), self._sMax());
      var after = self.toMap(X, Y);
      self.cam.cx += before.x - after.x; self.cam.cy += before.y - after.y;
      self._clampCam(); self._moving(true); self._moving(false); sched();
    }, { passive: false });
  };
  MapView.prototype._clampCam = function () {
    var f = this.D.floorById[this.floor]; if (!f) return;
    var vb = f.viewBox;
    this.cam.cx = clamp(this.cam.cx, vb[0], vb[0] + vb[2]);
    this.cam.cy = clamp(this.cam.cy, vb[1], vb[1] + vb[3]);
  };
  MapView.prototype._tap = function (X, Y) {
    if (!this.onTenantTap || !this.dotList) return;
    var best = null, bd = 34;
    for (var i = 0; i < this.dotList.length; i++) {
      var t = this.dotList[i], p = this.toScreen(t.x, t.y), d = Math.hypot(p.x - X, p.y - Y);
      if (d < bd) { bd = d; best = t; }
    }
    if (best) this.onTenantTap(best);
  };

  B.MapView = MapView;
})(window.BSB);
