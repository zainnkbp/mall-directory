/*
 * MapView3D — MapView with real 3D floors wherever data/3d/floors.json has a model for the floor.
 *  - The camera stays MapView's {cx, cy, s} in floor-SVG units, so kiosk.js / phone.js, routes, pins, dots,
 *    gestures and floor transitions are unchanged.
 *  - On a 3D floor toScreen/toMap go: floor units -> metres -> orthographic view of the floor plane at the current
 *    turn and tilt. A floor with "frame": "plan" keeps its CMS coordinates in the drawing's artboard units, so metres
 *    come straight from the model (origin, m_per_unit); older floors use the registry's fitted "toMetres". That chain
 *    is affine, so a 2x2 matrix A per floor replaces MapView's uniform scale; a WebGL canvas replaces the SVG.
 *  - Roofs follow the CMS: a tenant's unitShape links it to a building (its name and logo on the roof, tap opens it),
 *    floors[].unitsHidden blanks buildings whose tenant is switched off, and facility icons open their facility.
 *  - 360: the view turns all the way round (two-finger twist, right-drag or shift-drag with a mouse, rotateBy())
 *    and tilts (vertical right-drag, tiltBy()); names and logos stay put on the roofs, laid out once for the floor's
 *    default view, as if printed there.
 *  - Layers (floor, buildings, names, logos, facility icons) are switched with setLayers().
 *  - BSB_CONFIG.map3dOnly: floors without a model stay empty (a short note) instead of showing the old SVG.
 *  - Lite devices, BSB_CONFIG.map3d === false and browsers without WebGL keep the 2D SVG maps.
 */
window.BSB = window.BSB || {};
(function (B) {
  var Base = B.MapView, THREE = window.THREE;
  if (!Base) return;
  var DEG = Math.PI / 180, TILT_MIN = 22, TILT_MAX = 72;
  var reg = null, regP = null;
  var models = {}; // floorId -> {model, edits}
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function wrap(a) { return ((a % 360) + 540) % 360 - 180; } // -> [-180, 180)
  function cfg() { return window.BSB_CONFIG || {}; }
  function canGL() {
    try { var c = document.createElement('canvas'); return !!(window.WebGLRenderingContext && (c.getContext('webgl2') || c.getContext('webgl'))); }
    catch (e) { return false; }
  }
  function enabled() { return !!(THREE && B.Scene3D && cfg().map3d !== false && !(B.perf && B.perf.lite) && canGL()); }
  function emptyMode() { return enabled() && !!cfg().map3dOnly; }
  function getJSON(url, optional) {
    return fetch(url, { cache: 'no-cache' }).then(function (r) {
      if (!r.ok) { if (optional) return null; throw new Error('HTTP ' + r.status + ' ' + url); }
      return r.json();
    }).catch(function (e) { if (optional) return null; throw e; });
  }
  // tenant -> its building; the first wins, so a tenant with a second building keeps the one linked in the CMS
  function invert(o) { var r = {}; Object.keys(o || {}).forEach(function (k) { if (!(o[k] in r)) r[o[k]] = k; }); return r; }
  function dummySvg() { return document.createElementNS('http://www.w3.org/2000/svg', 'svg'); } // keeps #unit-<id> lookups harmless
  // registry of 3D floors: {floorId: {model, edits, frame: 'plan' | toMetres:[[a,b,c],[d,e,f]], view:{azimuth, polar},
  // tenants:{unitId: tenantId} (older floors only)}. Plan-frame floors read their model here: it defines the frame.
  B.load3d = function () {
    if (!regP) regP = (enabled() ? getJSON(B.ROOT + 'data/3d/floors.json', true) : Promise.resolve(null))
      .then(function (j) {
        var r = (j && j.floors) || {};
        return Promise.all(Object.keys(r).map(function (fid) {
          var e = r[fid];
          if (e.frame !== 'plan') { if (!e.toMetres) delete r[fid]; return null; }
          return getJSON(B.ROOT + e.model, true).then(function (m) {
            if (!m || !m.m_per_unit || !m.origin) { delete r[fid]; return; }
            var s = m.m_per_unit;
            e.toMetres = [[s, 0, -m.origin[0] * s], [0, s, -m.origin[1] * s]];
            models[fid] = { model: m, edits: null };
          });
        })).then(function () { reg = r; return reg; });
      });
    return regP;
  };
  B.load3d();

  // ---------- 3D models read together with the directory ----------
  // Before the kiosk/phone builds search and routing: linked tenants are placed in the middle of their building, and
  // named 3D units the directory doesn't know yet become map tenants (tappable, searchable, routable).
  function fromMetres(fid, mx, my) {
    var M = reg[fid].toMetres, det = M[0][0] * M[1][1] - M[0][1] * M[1][0], u = mx - M[0][2], v = my - M[1][2];
    return [(M[1][1] * u - M[0][1] * v) / det, (-M[1][0] * u + M[0][0] * v) / det];
  }
  function toMetres(fid, x, y) {
    var M = reg[fid].toMetres;
    return [M[0][0] * x + M[0][1] * y + M[0][2], M[1][0] * x + M[1][1] * y + M[1][2]];
  }
  function roofMiddle(u) {
    if (u.label) return [u.label.x, u.label.y];
    var x = 0, y = 0; u.poly.forEach(function (p) { x += p[0]; y += p[1]; });
    return [x / u.poly.length, y / u.poly.length];
  }
  function distToPoly(p, poly) { // metres from a point to a polygon's outline
    var best = Infinity;
    for (var i = 0; i < poly.length; i++) {
      var a = poly[i], b = poly[(i + 1) % poly.length], dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy || 1;
      var t = clamp(((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2, 0, 1);
      best = Math.min(best, Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy));
    }
    return best;
  }
  // what a map tenant shows: the editor's name/logo/category over the plan's
  function mapTenantInfo(u, ov) {
    var name = (ov.name && ov.name.trim()) || u.name;
    if (name && (name === name.toUpperCase() || name === name.toLowerCase())) name = B.Scene3D.titleCase(name);
    return { name: name, logo: ov.logo === '' ? null : (ov.logo || u.logo || null), category: ov.category || B.Scene3D.guessCategory(name) };
  }
  // names compared like the CMS (Map3d::nameKey): case, punctuation and number words ignored
  var NUM_WORDS = { one: '1', two: '2', three: '3', four: '4', five: '5', satu: '1', dua: '2', tiga: '3', empat: '4', lima: '5' };
  function nameKey(s) {
    return String(s || '').toLowerCase().replace(/&/g, 'and').replace(/[a-z]+/g, function (w) { return NUM_WORDS[w] || w; }).replace(/[^a-z0-9]/g, '');
  }
  // the name a roof shows for a directory tenant: the brand, without the " · E-Walk LG" a multi-outlet brand gets
  function roofName(t) {
    return t.brand && t.name && t.name.indexOf(t.brand + ' · ') === 0 ? t.brand : t.name;
  }
  // drawn facility types (Illustrator layer "Fasilitas") <-> directory facility / connector types
  var FAC_AMEN = { toilet: ['toilet', 'toilet-accessible'], prayer: ['musholla'], atm: ['atm'], info: ['info-desk'], parking: ['parking-entrance'],
    firstaid: ['first-aid'], nursery: ['nursery'], lift: ['lift'], escalator: ['escalator'], stairs: ['stairs'] };
  var AMEN_FAC = {};
  Object.keys(FAC_AMEN).forEach(function (k) { FAC_AMEN[k].forEach(function (a) { AMEN_FAC[a] = k; }); });
  // Icons of a 3D floor: each drawn facility is matched to the nearest directory facility of its kind (within 25 m) so
  // a tap can open it; facilities that exist only in the CMS get an icon of their own at their pin.
  function facilities3d(D, fid, model) {
    var list = (D.amenities || []).filter(function (a) { return a.floor === fid && (a.kind === 'poi' || (a.toFloors || []).length); }), used = {};
    var out = (model.facilities || []).map(function (f) {
      var types = FAC_AMEN[f.type] || [], best = null, bd = 25;
      list.forEach(function (a) {
        if (used[a.id] || types.indexOf(a.type) < 0) return;
        var p = toMetres(fid, a.x, a.y), d = Math.hypot(p[0] - f.x, p[1] - f.y);
        if (d < bd) { bd = d; best = a; }
      });
      if (best) used[best.id] = 1;
      return Object.assign({}, f, { amenity: best ? best.id : null });
    });
    list.forEach(function (a) {
      if (used[a.id]) return;
      var p = toMetres(fid, a.x, a.y);
      out.push({ id: 'cms:' + a.id, name: a.nameId || a.name, type: AMEN_FAC[a.type] || 'info', icon: a.icon || null, x: p[0], y: p[1], poly: null, amenity: a.id });
    });
    return out;
  }
  function merge3d(D) {
    Object.keys(models).forEach(function (fid) {
      var e = reg[fid], md = models[fid], f = D.floorById[fid];
      if (!e || !md || !f) return;
      var E = (md.edits && md.edits.units) || {}, units = {}, links = {}, hidden = {}, cms = {};
      md.model.units.forEach(function (u) { units[u.id] = u; u.display = u.logoCms = u.off = undefined; });
      // links: the CMS first (tenant.unitShape), then the registry's from register_floor.py for tenants the CMS hasn't linked
      D.tenants.forEach(function (t) { if (t.floor === fid && t.unitShape && units[t.unitShape]) { cms[t.id] = 1; links[t.unitShape] = t.id; } }); // (a 2D shape id from the old drawing doesn't count)
      Object.keys(e.tenants || {}).forEach(function (uid) {
        var tid = e.tenants[uid];
        if (units[uid] && !links[uid] && !cms[tid] && D.tenantById[tid]) links[uid] = tid;
      });
      (f.unitsHidden || []).forEach(function (uid) { if (!links[uid]) hidden[uid] = 1; });
      // a second building drawn with the same name as a linked tenant (e.g. two Solaria units) shows that tenant too;
      // on a floor both buildings share, only within the same building (units carry "building")
      var byName = {}, sameKey = function (b, s) { return (b || '') + '|' + nameKey(s); };
      Object.keys(links).forEach(function (uid) { var t = D.tenantById[links[uid]], b = units[uid].building; if (t) { byName[sameKey(b, t.name)] = t; if (t.brand) byName[sameKey(b, t.brand)] = t; } });
      var used = {}; D.tenants.forEach(function (t) { if (t.node) used[t.node] = 1; });
      (D.amenities || []).forEach(function (a) { if (a.node) used[a.node] = 1; });
      var corridor = D.graph.nodes.filter(function (n) { return n.floor === fid && !used[n.id]; });
      md.model.units.forEach(function (u) {
        var c = roofMiddle(u), p = fromMetres(fid, c[0], c[1]), t = links[u.id] && D.tenantById[links[u.id]];
        if (t) { // directory tenant: its name and logo on the roof; pin and framing go to the middle of its building
          u.display = roofName(t); u.logoCms = t.logo || null;
          if (t.x0 == null) { t.x0 = t.x; t.y0 = t.y; }
          t.x = p[0]; t.y = p[1];
          return;
        }
        var same = u.name && byName[sameKey(u.building, u.name)];
        if (same) { links[u.id] = same.id; u.display = roofName(same); u.logoCms = same.logo || null; return; }
        if (hidden[u.id]) { u.off = true; return; } // its tenant is switched off in the CMS: a blank roof
        var info = mapTenantInfo(u, E[u.id] || {});
        if (!info.name || !u.label) return;
        var best = null, bd = Infinity; // routes end at the corridor node closest to the shop
        corridor.forEach(function (n) {
          var d = distToPoly(toMetres(fid, n.x, n.y), u.poly);
          if (d < bd) { bd = d; best = n; }
        });
        if (!best) return;
        var id = '3d:' + fid + ':' + u.id, cat = D.catById[info.category] ? info.category : B.Scene3D.guessCategory(info.name);
        var nt = D.tenantById[id] || { id: id, from3d: true, unit: u.id, status: 'open', social: {} };
        nt.name = nt.brand = info.name; nt.category = cat; nt.floor = fid; nt.logo = info.logo; nt.node = best.id;
        nt.building = f.building !== 'both' ? f.building : u.building || (D.tenants.filter(function (x) { return x.floor === fid && x.building !== 'both'; })[0] || {}).building || 'ewalk';
        nt.x = p[0]; nt.y = p[1]; nt.keywords = [info.name.toLowerCase(), f.short ? f.short.toLowerCase() : ''];
        if (!D.tenantById[id]) { D.tenants.push(nt); D.tenantById[id] = nt; if (D.catById[cat]) D.catById[cat].count = (D.catById[cat].count || 0) + 1; }
        links[u.id] = id;
      });
      e.links = links;
      md.facilities = facilities3d(D, fid, md.model);
    });
  }
  B.load3dData = function () {
    return B.load3d().then(function (r) {
      return Promise.all(Object.keys(r).map(function (fid) {
        var e = r[fid], have = models[fid];
        return Promise.all([have ? have.model : getJSON(B.ROOT + e.model, true), e.edits ? getJSON(B.ROOT + e.edits, true) : null])
          .then(function (x) { if (x[0]) models[fid] = { model: x[0], edits: x[1] }; });
      }));
    });
  };
  if (B.loadData) {
    var baseLoad = B.loadData;
    B.loadData = function () {
      return baseLoad.apply(this, arguments).then(function (D) {
        return B.load3dData().then(function () { merge3d(D); return D; }, function () { return D; });
      });
    };
  }

  function MapView3D(container, opts) {
    this._geo = {}; this._gv = 0; this._pend3d = {};
    this.v3 = { rot: 0, tilt: null }; // user turn (deg, added to each floor's drawing azimuth) and tilt (polar, null = drawing's)
    this.layerVis = { slab: true, units: true, names: true, logos: true, fac: true };
    Base.call(this, container, opts);
    if (this.opts.interactive !== false) this._bindTurn();
    // names/logos edited in the 3D editor (or the design web) reach a running kiosk without a reload
    var self = this, every = (cfg().map3dEditsPollSec != null ? cfg().map3dEditsPollSec : 60) * 1000;
    if (every > 0) setInterval(function () { self._pollEdits(); }, every);
  }
  MapView3D.prototype = Object.create(Base.prototype);
  MapView3D.prototype.constructor = MapView3D;
  var P = MapView3D.prototype, BP = Base.prototype;

  P.is3d = function (fid) { return !!(reg && fid && reg[fid] && this.D.floorById[fid]); };
  P.is3dShown = function () { var L = this.floor && this.layers[this.floor]; return !!(L && L.three); };
  // Projection of floor units onto the screen at s = 1: A = P(view) . L(toMetres) / k0. k0 comes from the drawing's
  // own view, so s keeps meaning "screen px per floor unit" and screen px per metre stays s / k0 while turning.
  P.geo = function (fid) {
    if (!this.is3d(fid)) return null;
    var g = this._geo[fid];
    if (g && g.v === this._gv) return g;
    var e = reg[fid], M = e.toMetres, v = e.view || {};
    var az0 = v.azimuth != null ? v.azimuth : 45, pol0 = v.polar != null ? v.polar : 54.736;
    var az = az0 + this.v3.rot, pol = this.v3.tilt != null ? this.v3.tilt : pol0;
    function proj(az, pol) {
      var th = az * DEG, ph = pol * DEG;
      var p00 = Math.cos(th), p01 = -Math.sin(th), p10 = Math.cos(ph) * Math.sin(th), p11 = Math.cos(ph) * Math.cos(th);
      return [p00 * M[0][0] + p01 * M[1][0], p00 * M[0][1] + p01 * M[1][1], p10 * M[0][0] + p11 * M[1][0], p10 * M[0][1] + p11 * M[1][1]];
    }
    var A0 = proj(az0, pol0), k0 = Math.sqrt(Math.abs(A0[0] * A0[3] - A0[1] * A0[2]));
    var A = proj(az, pol).map(function (x) { return x / k0; });
    var det = A[0] * A[3] - A[1] * A[2];
    return (this._geo[fid] = { v: this._gv, az: az, polar: pol, baseAz: az0, basePolar: pol0, k0: k0, A: A, Ai: [A[3] / det, -A[1] / det, -A[2] / det, A[0] / det] });
  };
  P.toMetres = function (fid, x, y) {
    var M = reg[fid].toMetres;
    return [M[0][0] * x + M[0][1] * y + M[0][2], M[1][0] * x + M[1][1] * y + M[1][2]];
  };
  P.fromMetres = function (fid, mx, my) {
    var M = reg[fid].toMetres, det = M[0][0] * M[1][1] - M[0][1] * M[1][0], u = mx - M[0][2], v = my - M[1][2];
    return [(M[1][1] * u - M[0][1] * v) / det, (-M[1][0] * u + M[0][0] * v) / det];
  };
  // on-screen direction from floor point a to b (degrees clockwise from screen-up), whatever the turn and tilt
  P.screenBearing = function (a, b) {
    var g = this.geo(this.floor), A = g ? g.A : [1, 0, 0, 1], dx = b.x - a.x, dy = b.y - a.y;
    var X = A[0] * dx + A[1] * dy, Y = A[2] * dx + A[3] * dy;
    return (Math.atan2(X, -Y) / DEG + 360) % 360;
  };

  P.toScreen = function (x, y) {
    var g = this.geo(this.floor);
    if (!g) return BP.toScreen.call(this, x, y);
    var c = this.cam, dx = x - c.cx, dy = y - c.cy, A = g.A;
    return { x: (A[0] * dx + A[1] * dy) * c.s + this.W / 2, y: (A[2] * dx + A[3] * dy) * c.s + this.H / 2 };
  };
  P.toMap = function (X, Y) {
    var g = this.geo(this.floor);
    if (!g) return BP.toMap.call(this, X, Y);
    var c = this.cam, u = (X - this.W / 2) / c.s, v = (Y - this.H / 2) / c.s, Ai = g.Ai;
    return { x: c.cx + Ai[0] * u + Ai[1] * v, y: c.cy + Ai[2] * u + Ai[3] * v };
  };
  function extents(A, box) { // on-screen size (at s = 1) of a box given in floor units
    var xs = [], ys = [];
    [[box[0], box[1]], [box[0] + box[2], box[1]], [box[0], box[1] + box[3]], [box[0] + box[2], box[1] + box[3]]].forEach(function (p) {
      xs.push(A[0] * p[0] + A[1] * p[1]); ys.push(A[2] * p[0] + A[3] * p[1]);
    });
    return [Math.max.apply(null, xs) - Math.min.apply(null, xs), Math.max.apply(null, ys) - Math.min.apply(null, ys)];
  }
  P.camFor = function (box, pad) {
    var g = this.geo(this.floor);
    if (!g) return BP.camFor.call(this, box, pad);
    pad = pad || this.pad;
    var W = this.W - pad.l - pad.r, H = this.H - pad.t - pad.b, e = extents(g.A, box);
    var s = clamp(Math.min(W / Math.max(e[0], 1e-6), H / Math.max(e[1], 1e-6)), this._sMin(), this._sMax());
    // box centre lands on the centre of the padded area
    var ox = (pad.l - pad.r) / 2 / s, oy = (pad.t - pad.b) / 2 / s, Ai = g.Ai;
    return { cx: box[0] + box[2] / 2 - (Ai[0] * ox + Ai[1] * oy), cy: box[1] + box[3] / 2 - (Ai[2] * ox + Ai[3] * oy), s: s };
  };
  P._sMax = function () { var g = this.geo(this.floor); return g ? 16 * g.k0 : BP._sMax.call(this); }; // 16 px per metre
  P._sMin = function () {
    var g = this.geo(this.floor);
    if (!g) return BP._sMin.call(this);
    var e = extents(g.A, this.D.floorById[this.floor].viewBox);
    return Math.min(this.W / e[0], this.H / e[1]) * 0.6;
  };

  // --------------- layers ---------------
  P._layer = function (fid) {
    var self = this;
    if (this.layers[fid]) return BP._layer.call(this, fid);
    return B.load3d().then(function () {
      if (self.layers[fid]) return self.layers[fid];
      if (self.is3d(fid)) return self._layer3d(fid);
      return emptyMode() ? self._layerEmpty(fid) : BP._layer.call(self, fid);
    });
  };
  // a floor without a 3D model while the 3D maps are being drawn: nothing but a short note
  P._layerEmpty = function (fid) {
    var outer = document.createElement('div'); outer.className = 'map-floor map-floor-empty'; outer.dataset.floor = fid;
    outer.style.visibility = 'hidden';
    var note = document.createElement('div'); note.className = 'map-empty-note';
    note.textContent = B.t ? B.t('floorSoon') : '';
    outer.appendChild(note);
    var L = { outer: outer, cam: null, svg: dummySvg(), empty: true, note: note };
    this.floorsEl.appendChild(outer);
    this.layers[fid] = L;
    return Promise.resolve(L);
  };
  P._layer3d = function (fid) {
    var self = this, e = reg[fid];
    if (this._pend3d[fid]) return this._pend3d[fid];
    var have = models[fid];
    this._pend3d[fid] = (have ? Promise.resolve([have.model, have.edits]) : Promise.all([getJSON(B.ROOT + e.model), e.edits ? getJSON(B.ROOT + e.edits, true) : null])).then(function (r) {
      delete self._pend3d[fid];
      if (self.layers[fid]) return self.layers[fid];
      var g = self.geo(fid);
      var renderer = new THREE.WebGLRenderer({ antialias: !(B.perf && B.perf.lite), alpha: true });
      renderer.setClearColor(0x000000, 0);
      renderer.domElement.className = 'map-3d';
      var outer = document.createElement('div'); outer.className = 'map-floor map-floor-3d'; outer.dataset.floor = fid;
      outer.style.visibility = 'hidden';
      outer.appendChild(renderer.domElement);
      var scene = new B.Scene3D({ root: B.ROOT, az: g.baseAz, polar: g.basePolar, aniso: Math.min(4, renderer.capabilities.getMaxAnisotropy()),
        labelPpm: self.W < 700 ? 32 : 56, onChange: function () { self._redraw(fid); } });
      var md = models[fid], model = r[0], links = e.links || e.tenants || {};
      if (md && md.facilities && md.model === model) model = Object.assign({}, model, { facilities: md.facilities });
      scene.build(model, r[1], links);
      scene.setVisible(self.layerVis);
      scene.setView(g.az, g.polar, false); // names and logos keep the layout of the floor's default view
      var L = {
        outer: outer, cam: null, svg: dummySvg(),
        three: { renderer: renderer, scene: scene, camera: new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 6000), links: links, byTenant: invert(links) }
      };
      self.floorsEl.appendChild(outer);
      self.layers[fid] = L;
      self._hl3d();
      return L;
    }, function (err) { // broken model: this floor falls back to empty / 2D
      delete self._pend3d[fid];
      if (window.console) console.warn('3D floor unavailable:', fid, err);
      delete reg[fid]; delete self._geo[fid];
      return emptyMode() ? self._layerEmpty(fid) : BP._layer.call(self, fid);
    });
    return this._pend3d[fid];
  };

  // --------------- rendering ---------------
  P.apply = function () {
    var L = this.floor && this.layers[this.floor];
    this.root.classList.toggle('is-3d', !!(L && (L.three || L.empty)));
    if (!(L && (L.three || L.empty))) return BP.apply.call(this);
    if (L.three) this._render3d(L);
    else if (B.t) L.note.textContent = B.t('floorSoon'); // follows the language switch
    this.renderOverlay();
    if (this.onCamera) this.onCamera(this.cam);
  };
  P._render3d = function (L) {
    var T = L.three, g = this.geo(this.floor), c = this.cam, W = this.W, H = this.H;
    if (!g) return;
    var dpr = Math.min(window.devicePixelRatio || 1, (B.perf && B.perf.dprCap) || 2);
    if (T.w !== W || T.h !== H || T.dpr !== dpr) { T.renderer.setPixelRatio(dpr); T.renderer.setSize(W, H, false); T.w = W; T.h = H; T.dpr = dpr; }
    var cam = T.camera;
    cam.left = -W / 2; cam.right = W / 2; cam.top = H / 2; cam.bottom = -H / 2;
    cam.zoom = c.s / g.k0; // screen px per metre
    cam.updateProjectionMatrix();
    var m = this.toMetres(this.floor, c.cx, c.cy), target = new THREE.Vector3(m[0], B.Scene3D.SLAB_H, m[1]);
    cam.position.copy(target).add(new THREE.Vector3().setFromSpherical(new THREE.Spherical(1500, g.polar * DEG, g.az * DEG)));
    cam.lookAt(target);
    cam.updateMatrixWorld();
    T.scene.setView(g.az, g.polar, false); // lights follow the turn; names and logos stay put
    T.scene.setIconSize(clamp(34 / cam.zoom, 2.5, 14)); // facility icons stay about 34 px tall
    T.renderer.render(T.scene.scene, cam);
  };
  // async content (logos) finished loading: draw once more if that floor is on screen
  P._redraw = function (fid) {
    var self = this;
    if (fid !== this.floor || this._rq) return;
    this._rq = requestAnimationFrame(function () {
      self._rq = 0;
      var L = self.floor && self.layers[self.floor];
      if (L && L.three) self._render3d(L);
    });
  };

  // --------------- 360: turn and tilt ---------------
  P._setTurn = function (rot, tilt) {
    this.v3.rot = wrap(rot);
    if (tilt !== undefined) this.v3.tilt = tilt == null ? null : clamp(tilt, TILT_MIN, TILT_MAX);
    this._gv++;
  };
  // turn (degrees, + = clockwise on screen) around the middle of the map
  P.rotateBy = function (deg, duration) {
    if (!this.is3dShown()) return Promise.resolve();
    var self = this, from = this.v3.rot, to = from + deg;
    if (this._rtwn) this._rtwn.kill();
    if (!window.gsap || duration === 0 || (B.perf && B.perf.lite)) { this._setTurn(to); this.apply(); return Promise.resolve(); }
    var o = { r: from };
    return new Promise(function (res) {
      self._rtwn = gsap.to(o, { r: to, duration: duration || 0.6, ease: 'power2.inOut',
        onUpdate: function () { self._setTurn(o.r); self.apply(); },
        onComplete: res, onInterrupt: res });
    });
  };
  P.tiltBy = function (deg) {
    if (!this.is3dShown()) return;
    var g = this.geo(this.floor);
    this._setTurn(this.v3.rot, g.polar + deg); this.apply();
  };
  // back to the drawing's own direction and tilt (the "north-up" view of the kiosk)
  P.resetView = function (animate) {
    var self = this, back = -this.v3.rot;
    this.v3.tilt = null; this._gv++;
    if (!animate || !this.is3dShown()) { this._setTurn(0); this.apply(); return Promise.resolve(); }
    return this.rotateBy(back, 0.6).then(function () { self._setTurn(0); self.apply(); });
  };
  // turn so the way from floor point a to b points up the screen (walking navigation)
  P.faceDirection = function (a, b, duration) {
    if (!this.is3dShown()) return Promise.resolve();
    var d = this.screenBearing(a, b);
    d = d > 180 ? d - 360 : d;
    return Math.abs(d) < 4 ? Promise.resolve() : this.rotateBy(-d, duration == null ? 0.8 : duration);
  };
  P._bindTurn = function () {
    var self = this, root = this.root, pts = {}, twist = null, drag = null, raf = 0;
    function loc(e) {
      var r = root.getBoundingClientRect(), kx = r.width / (root.clientWidth || r.width || 1), ky = r.height / (root.clientHeight || r.height || 1);
      return { x: (e.clientX - r.left) / kx, y: (e.clientY - r.top) / ky };
    }
    function sched() { if (!raf) raf = requestAnimationFrame(function () { raf = 0; self.apply(); }); }
    // mouse: right button or shift+drag turns (left-right) and tilts (up-down) instead of panning
    root.addEventListener('pointerdown', function (e) {
      if (!self.is3dShown() || e.pointerType !== 'mouse' || !(e.button === 2 || e.shiftKey)) return;
      if (e.target.closest && e.target.closest('.map-ui')) return;
      e.stopImmediatePropagation(); e.preventDefault();
      if (root.setPointerCapture) root.setPointerCapture(e.pointerId);
      if (self._tw) self._tw.kill();
      drag = { id: e.pointerId, p: loc(e) };
      self._moving(true);
      if (self.onInteract) self.onInteract();
    }, true);
    root.addEventListener('contextmenu', function (e) { if (self.is3dShown()) e.preventDefault(); });
    // touch: two-finger twist turns the map around the fingers (pinch/pan stay with MapView)
    root.addEventListener('pointerdown', function (e) {
      if (e.pointerType === 'mouse') return;
      pts[e.pointerId] = loc(e);
      twist = null;
    });
    root.addEventListener('pointermove', function (e) {
      if (drag && e.pointerId === drag.id) {
        var p = loc(e), g = self.geo(self.floor);
        if (g) self._setTurn(self.v3.rot + (p.x - drag.p.x) * 0.35, g.polar + (p.y - drag.p.y) * 0.25);
        drag.p = p; sched();
        return;
      }
      if (!pts[e.pointerId]) return;
      pts[e.pointerId] = loc(e);
      var ids = Object.keys(pts);
      if (ids.length !== 2 || !self.is3dShown()) return;
      var a = pts[ids[0]], b = pts[ids[1]], ang = Math.atan2(b.y - a.y, b.x - a.x) / DEG;
      if (!twist) { twist = { ang: ang, acc: 0, on: false }; return; }
      var d = wrap(ang - twist.ang);
      twist.ang = ang;
      if (!twist.on) { twist.acc += d; if (Math.abs(twist.acc) < 8) return; twist.on = true; d = twist.acc; } // ignore jitter while pinching
      var mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2, before = self.toMap(mx, my);
      self._setTurn(self.v3.rot + d);
      var after = self.toMap(mx, my);
      self.cam.cx += before.x - after.x; self.cam.cy += before.y - after.y;
      sched();
    });
    function up(e) {
      if (drag && e.pointerId === drag.id) { drag = null; self._moving(false); return; }
      if (!pts[e.pointerId]) return;
      delete pts[e.pointerId];
      twist = null;
    }
    root.addEventListener('pointerup', up);
    root.addEventListener('pointercancel', up);
  };

  P._pollEdits = function () {
    var self = this;
    Object.keys(this.layers).forEach(function (fid) {
      var L = self.layers[fid], e = reg && reg[fid];
      if (!L.three || !e || !e.edits) return;
      getJSON(B.ROOT + e.edits, true).then(function (j) {
        var txt = JSON.stringify((j && j.units) || {});
        if (txt === JSON.stringify(L.three.scene.edits.units)) return;
        L.three.scene.setEdits(j);
        if (models[fid]) models[fid].edits = j;
        self.D.tenants.forEach(function (t) { // map tenants follow renamed units / new logos / categories
          if (!t.from3d || t.floor !== fid) return;
          var u = L.three.scene.unit(t.unit);
          if (!u) return;
          var info = mapTenantInfo(u, ((j && j.units) || {})[u.id] || {});
          t.name = t.brand = info.name; t.logo = info.logo;
          if (self.D.catById[info.category]) t.category = info.category;
        });
        self._redraw(fid);
      });
    });
  };

  // --------------- layers ---------------
  P.setLayers = function (vis) {
    var self = this;
    for (var k in vis) this.layerVis[k] = !!vis[k];
    Object.keys(this.layers).forEach(function (fid) {
      var L = self.layers[fid];
      if (L.three) { L.three.scene.setVisible(self.layerVis); self._redraw(fid); }
    });
  };

  // --------------- route on 3D floors: a ribbon on the floor, under the shops' walls ---------------
  P.setRoute = function (floor, pts, opts) {
    opts = opts || {};
    var self = this;
    if (this._rib) { this._rib.kill(); this._rib = null; }
    Object.keys(this.layers).forEach(function (fid) { var L = self.layers[fid]; if (L.three) { L.three.scene.clearRoute(); self._redraw(fid); } });
    var L = floor && this.layers[floor];
    if (!(L && L.three)) return BP.setRoute.call(this, floor, pts, opts);
    if (this._rtw) this._rtw.kill();
    this.route = { floor: floor, pts: pts, startMarker: !!opts.startMarker }; this.routeP = 1; // start marker stays in the overlay
    this.gRun.style.display = 'none';
    var sc = L.three.scene;
    sc.setRoute(pts.map(function (p) { return self.toMetres(floor, p.x, p.y); }));
    if (!opts.animate || !window.gsap) { this._redraw(floor); this.renderOverlay(); return Promise.resolve(); }
    sc.setRouteProgress(0); this.renderOverlay(); this._redraw(floor);
    var o = { p: 0 };
    return new Promise(function (res) {
      self._rib = gsap.to(o, { p: 1, duration: Math.min(opts.duration || 1.6, B.perf && B.perf.lite ? 1 : 6), ease: 'power1.inOut',
        onUpdate: function () { sc.setRouteProgress(o.p); if (self.floor === floor) self._render3d(L); },
        onComplete: res, onInterrupt: function () { sc.setRouteProgress(1); res(); } });
    });
  };
  P.renderOverlay = function () {
    BP.renderOverlay.call(this);
    var L = this.floor && this.layers[this.floor], T = L && L.three;
    if (!T) return;
    this.gRoute.style.display = 'none'; // drawn in 3D instead
    // the destination pin stands on its building's roof
    var t = this.dest, uid = t && t.floor === this.floor && T.byTenant[t.id], top = uid && T.scene.roofTop(uid);
    if (top) {
      var v = new THREE.Vector3(top.x, B.Scene3D.SLAB_H + top.h, top.y).project(T.camera);
      this.gDest.setAttribute('transform', 'translate(' + ((v.x + 1) / 2 * this.W).toFixed(1) + ',' + ((1 - v.y) / 2 * this.H).toFixed(1) + ')');
    }
    // the phone's heading cone: a direction on the floor, shown in screen terms
    var d = this.dot;
    if (d && d.floor === this.floor && d.heading != null) {
      var h = d.heading * DEG, A = this.geo(this.floor).A, sx = Math.sin(h), sy = -Math.cos(h);
      var ang = Math.atan2(A[0] * sx + A[1] * sy, -(A[2] * sx + A[3] * sy)) / DEG;
      this.gDot.firstChild.setAttribute('transform', 'rotate(' + ang.toFixed(1) + ')');
    }
  };

  // --------------- tenants on 3D floors ---------------
  P.setDest = function (t, opts) {
    BP.setDest.call(this, t, opts);
    this._hl3d();
  };
  P._hl3d = function () {
    var self = this, t = this.dest;
    Object.keys(this.layers).forEach(function (fid) {
      var L = self.layers[fid];
      if (!L.three) return;
      L.three.scene.highlight(t && t.floor === fid ? L.three.byTenant[t.id] || null : null);
      self._redraw(fid);
    });
  };
  // a tap on a building opens its tenant, on a facility icon its facility (onAmenityTap); elsewhere the nearest tenant dot
  P._tap = function (X, Y) {
    var L = this.floor && this.layers[this.floor];
    if (L && L.three) {
      var ray = new THREE.Raycaster();
      ray.setFromCamera(new THREE.Vector2(X / this.W * 2 - 1, -(Y / this.H * 2 - 1)), L.three.camera);
      var hit = L.three.scene.pick(ray);
      if (hit && hit.fac) {
        var a = hit.fac.amenity && this.D.amenityById[hit.fac.amenity];
        if (a && this.onAmenityTap) this.onAmenityTap(a);
        else if (this.onFacilityTap) this.onFacilityTap(hit.fac); // drawn, but not (yet) a facility in the CMS
        return;
      }
      if (hit && hit.unit && hit.unit.off) return; // its tenant is switched off
      var tid = hit && hit.unit && L.three.links[hit.unit.id], t = tid && this.D.tenantById[tid];
      if (t && this.onTenantTap) { this.onTenantTap(t); return; }
    }
    if (L && L.empty) return;
    BP._tap.call(this, X, Y);
  };
  // names/logos sit on the roofs, so tenant dots (and the 2D lift/escalator chips, drawn as 3D icons) are hidden on
  // 3D and empty floors. A closed connector keeps its chip (wrench badge).
  P._ensureDots = function () {
    var was = this._dotsFloor;
    BP._ensureDots.call(this);
    if (was === this.floor) return;
    var L = this.floor && this.layers[this.floor], T = L && L.three, empty = !!(L && L.empty);
    (this.dotEls || []).forEach(function (g) { g.classList.toggle('in3d', empty || !!T); });
    (this.amenEls || []).forEach(function (g) { g.classList.toggle('in3d', empty || !!(T && T.scene.icons.length)); });
  };

  B.MapView3D = MapView3D;
})(window.BSB);
