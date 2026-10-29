/*
 * Route engine — faithful JS port of tools/verify_routes.py (Dijkstra) + leg splitting + turn-by-turn text.
 * Edge semantics: walk / lift / stairs / crossing undirected; escalator-up / escalator-down directed (edge[0] -> edge[1]).
 * Accessible mode drops escalator* and stairs edges.
 */
window.BSB = window.BSB || {};
(function (B) {
  function MinHeap() { this.a = []; }
  MinHeap.prototype.push = function (d, v) {
    var a = this.a, i = a.length; a.push([d, v]);
    while (i > 0) { var p = (i - 1) >> 1; if (a[p][0] <= a[i][0]) break; var t = a[p]; a[p] = a[i]; a[i] = t; i = p; }
  };
  MinHeap.prototype.pop = function () {
    var a = this.a, top = a[0], last = a.pop();
    if (a.length) {
      a[0] = last; var i = 0, n = a.length;
      for (;;) {
        var l = 2 * i + 1, r = l + 1, m = i;
        if (l < n && a[l][0] < a[m][0]) m = l;
        if (r < n && a[r][0] < a[m][0]) m = r;
        if (m === i) break; var t = a[m]; a[m] = a[i]; a[i] = t; i = m;
      }
    }
    return top;
  };

  // Router(D, opts) — opts.status = parsed status.json (may be null). Backward compatible with snapshots
  // that have no 5th edge element and no graph.rules (then edgeOpen() is always true -> identical costs).
  function Router(D, opts) {
    this.D = D;
    this.cfg = window.BSB_CONFIG || {};
    this.status = (opts && opts.status) || null;
    this.clock = (opts && opts.clock) || function () { return Date.now(); }; // injectable for tests
    this.tz = ((D.meta && D.meta.tzOffsetMin) != null ? D.meta.tzOffsetMin : 480) * 60000;
    this._keyed = D.graph.edges.filter(function (e) { return !!e[4]; });
    this._rebuild((opts && opts.now) || this.clock());
  }

  Router.prototype._rebuild = function (now) {
    this.now = now;
    this.closedSig = this._closedSignature(now);
    this.adj = {
      false: this._build(false, true),
      true: this._build(true, true),
      best: this._build(false, true, 'best'),
      lift: this._build(false, true, 'lift'),
      accessible: this._build(true, true, 'accessible')
    };
    this.adjAll = {
      false: this._build(false, false),
      true: this._build(true, false),
      best: this._build(false, false, 'best'),
      lift: this._build(false, false, 'lift'),
      accessible: this._build(true, false, 'accessible')
    }; // ignores schedules/closures (failure reasons)
    this.cache = {};
  };
  // call every 60 s and before plan(); rebuilds only when the set of closed edges changed
  Router.prototype.refresh = function (now) {
    now = now || this.clock();
    var sig = this._closedSignature(now);
    if (sig !== this.closedSig) { this._rebuild(now); return true; }
    this.now = now;
    return false;
  };
  Router.prototype.setStatus = function (status, now) { this.status = status || null; this._rebuild(now || this.clock()); };

  Router.prototype._closedSignature = function (now) {
    var out = [], st = this.status, i;
    for (i = 0; i < this._keyed.length; i++) if (!this.edgeOpen(this._keyed[i], now)) out.push(this._keyed[i][4] + ':' + this._keyed[i][3]);
    if (st && st.edgeOverrides && st.edgeOverrides.length) out.push('ov:' + JSON.stringify(st.edgeOverrides));
    if (st && st.amenityClosures && st.amenityClosures.length) out.push('am:' + st.amenityClosures.join(','));
    return out.join('|');
  };

  function edgeDir(t) { return t === 'escalator-up' ? 'up' : t === 'escalator-down' ? 'down' : 'both'; }
  function parseTime(s) { var v = Date.parse(s); return isNaN(v) ? 0 : v; }
  // hours: {"1":[["10:00","22:00"]],...} (1 = Monday ... 7 = Sunday); t = epoch ms already shifted to local (WITA) -> getUTC*
  function inHours(hours, t) {
    var d = new Date(t), dow = d.getUTCDay() || 7, m = d.getUTCHours() * 60 + d.getUTCMinutes();
    var prevDow = dow === 1 ? 7 : dow - 1;
    var iv = hours[String(dow)] || [], i, a, b;
    for (i = 0; i < iv.length; i++) {
      a = toMin(iv[i][0]); b = toMin(iv[i][1]);
      if (b > a ? (m >= a && m < b) : (m >= a)) return true;           // b<a = runs past midnight (evening part)
    }
    iv = hours[String(prevDow)] || [];                                    // early-morning tail of yesterday's overnight interval
    for (i = 0; i < iv.length; i++) { a = toMin(iv[i][0]); b = toMin(iv[i][1]); if (b < a && m < b) return true; }
    return false;
  }
  function toMin(s) { var p = String(s).split(':'); return +p[0] * 60 + +(p[1] || 0) + (p[2] ? 1 : 0); }
  B.inHours = inHours;

  Router.prototype._closureFor = function (e, now) {
    var key = e[4], st = this.status, cl = (st && st.closures) || [];
    if (!key) return null;
    for (var j = 0; j < cl.length; j++) {
      var c = cl[j]; if (c.key !== key) continue;
      var from = c.from ? parseTime(c.from) : 0, to = c.to ? parseTime(c.to) : Infinity;
      if (now >= from && now < to && (!c.dir || c.dir === 'both' || edgeDir(e[3]) === 'both' || c.dir === edgeDir(e[3]))) return c;
    }
    return null;
  };
  Router.prototype.edgeOpen = function (e, now) {
    if (now == null) now = this.now;
    var key = e[4], rules = this.D.graph.rules || {}, st = this.status;
    if (st && st.edgeOverrides) for (var i = 0; i < st.edgeOverrides.length; i++) {
      var o = st.edgeOverrides[i]; if ((o[0] === e[0] && o[1] === e[1]) || (o[0] === e[1] && o[1] === e[0])) return false;
    }
    if (!key) return true;
    var r = rules[key];
    if (r && r.hours && !inHours(r.hours, now + this.tz)) return false;
    return !this._closureFor(e, now);
  };
  // why is this edge closed right now? -> {label, reason} (localised strings) or null
  Router.prototype.closedInfo = function (e, lang) {
    var now = this.now, key = e[4], rules = this.D.graph.rules || {}, r = key && rules[key];
    var L = function (o) { return o ? (typeof o === 'string' ? o : (o[lang === 'en' ? 'en' : 'id'] || o.en || o.id || '')) : ''; };
    var c = this._closureFor(e, now);
    var label = L((c && c.label) || (r && r.label));
    if (!label) {
      var am = this.D.amenityByNode && (this.D.amenityByNode[e[0]] || this.D.amenityByNode[e[1]]);
      label = am ? (B.amenityName ? B.amenityName(am) : am.name) : (e[3] === 'walk' ? (lang === 'en' ? 'A corridor' : 'Koridor') : e[3]);
    }
    if (c) return { key: key, label: label, reason: L(c.reason), closure: c };
    if (r && r.hours && !inHours(r.hours, now + this.tz)) return { key: key, label: label, reason: lang === 'en' ? 'outside operating hours' : 'di luar jam operasi', hours: true };
    if (this.edgeOpen(e, now)) return null;
    return { key: key, label: label, reason: '' };
  };

  Router.prototype._build = function (accessible, filtered, pref) {
    var adj = {}, self = this, now = this.now;
    var isAcc = accessible === true || accessible === 'accessible' || pref === 'accessible';
    this.D.graph.nodes.forEach(function (n) { adj[n.id] = []; });
    this.D.graph.edges.forEach(function (e) {
      var a = e[0], b = e[1], c = e[2], t = e[3];
      if (isAcc && (t.indexOf('escalator') === 0 || t === 'stairs')) return;
      if (filtered && (e[4] || (self.status && self.status.edgeOverrides && self.status.edgeOverrides.length)) && !self.edgeOpen(e, now)) return;

      // Realistic transit weighting:
      if (pref === 'best') {
        // Smart Default: Elevators require waiting for cabin arrival and dispatch cycle (~60s).
        // Escalators provide continuous flow with zero wait time.
        // Penalty prioritizes escalators for adjacent/near floors while choosing lifts when multi-floor hops are faster.
        if (t === 'lift') c += 60;
      } else if (pref === 'lift') {
        // Lift Priority: Soft penalty on escalators and stairs so Dijkstra strongly favors elevators,
        // but gracefully falls back if a destination floor/wing has no lift shaft.
        if (t.indexOf('escalator') === 0 || t === 'stairs') c += 300;
      }

      adj[a].push([b, c, t, e]);
      if (t.indexOf('escalator') !== 0) adj[b].push([a, c, t, e]);
    });
    return adj;
  };

  // all = true -> ignore schedules & closures (used to explain a failure)
  Router.prototype.dijkstra = function (src, accessible, all, pref) {
    var mKey = pref || (accessible ? 'accessible' : 'false');
    var key = src + '|' + mKey + '|' + !!all;
    if (this.cache[key]) return this.cache[key];
    var table = all ? this.adjAll : this.adj;
    var adj = table[mKey] || table[!!accessible];
    var dist = {}, prev = {}, pq = new MinHeap();
    dist[src] = 0; pq.push(0, src);
    while (pq.a.length) {
      var top = pq.pop(), d = top[0], u = top[1];
      if (d > dist[u]) continue;
      var es = adj[u];
      if (!es) continue;
      for (var i = 0; i < es.length; i++) {
        var v = es[i][0], nd = d + es[i][1];
        if (dist[v] === undefined || nd < dist[v]) { dist[v] = nd; prev[v] = [u, es[i][2], es[i][3]]; pq.push(nd, v); }
      }
    }
    var res = { dist: dist, prev: prev };
    this.cache[key] = res;
    return res;
  };

  Router.prototype.path = function (src, dst, accessible, all, pref) {
    var r = this.dijkstra(src, accessible, all, pref);
    if (r.dist[dst] === undefined) return null;
    var nodes = [dst], types = [null], edges = [null];
    while (nodes[0] !== src) { var p = r.prev[nodes[0]]; types[0] = p[1]; edges[0] = p[2]; nodes.unshift(p[0]); types.unshift(null); edges.unshift(null); }
    return { nodes: nodes, types: types, edges: edges, cost: r.dist[dst] }; // types[i]/edges[i] = edge (i-1 -> i)
  };

  // labels of the edges on path p that are closed now (deduplicated)
  Router.prototype._closedOnPath = function (p, lang) {
    var out = [], seen = {};
    for (var i = 1; i < p.edges.length; i++) {
      var e = p.edges[i]; if (!e) continue;
      var info = this.closedInfo(e, lang);
      if (!info) continue;
      var k = info.label + '|' + info.reason;
      if (seen[k]) continue; seen[k] = 1; out.push(info);
    }
    return out;
  };

  // does a usable (open, correctly directed) escalator leave from this node?
  Router.prototype.canRideFrom = function (node, type, accessible) {
    var es = this.adj[!!accessible][node] || [];
    for (var i = 0; i < es.length; i++) {
      var t = es[i][2];
      if (type === 'escalator' ? t.indexOf('escalator') === 0 : t === (type === 'crossing' ? 'crossing' : type)) return true;
    }
    return false;
  };

  Router.prototype.amenityClosed = function (a) {
    var st = this.status;
    return !!(st && st.amenityClosures && st.amenityClosures.indexOf(a.id) >= 0);
  };

  // connector stops (amenity nodes) whose connector edges are closed now: {node: 'all' | 'partial'}
  Router.prototype.closedConnectorNodes = function () {
    var self = this, res = {}, cnt = {};
    this.D.graph.edges.forEach(function (e) {
      if (e[3] === 'walk') return;
      var open = self.edgeOpen(e, self.now);
      [e[0], e[1]].forEach(function (n) {
        var c = cnt[n] || (cnt[n] = { open: 0, closed: 0 });
        if (open) c.open++; else c.closed++;
      });
    });
    Object.keys(cnt).forEach(function (n) { var c = cnt[n]; if (c.closed) res[n] = c.open ? 'partial' : 'all'; });
    return res;
  };

  Router.prototype.nearestAmenity = function (src, type, accessible, pref) {
    this.refresh();
    var r = this.dijkstra(src, accessible, false, pref), best = null, bd = Infinity, self = this;
    this.D.amenities.forEach(function (a) {
      if (a.type !== type) return;
      if (a.kind === 'poi' && self.amenityClosed(a)) return;
      if (a.kind !== 'poi' && (type === 'escalator' || type === 'lift' || type === 'crossing' || type === 'stairs')) {
        if (!(a.toFloors || []).length) return; // dangling connector ends
        // one-way / closed escalators: only offer stops you can actually ride from
        if (!self.canRideFrom(a.node, type, accessible)) return;
      }
      var d = r.dist[a.node];
      if (d !== undefined && d < bd) { bd = d; best = a; }
    });
    return best;
  };

  // ---------------- geometry helpers ----------------
  function dist(a, b) { return Math.hypot(b.x - a.x, b.y - a.y); }
  function heading(a, b) { return Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI; }
  function normDeg(d) { while (d > 180) d -= 360; while (d < -180) d += 360; return d; }
  function segDist(p, a, b) {
    var dx = b.x - a.x, dy = b.y - a.y, L = dx * dx + dy * dy;
    var t = L ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / L)) : 0;
    return { d: Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy)), t: t };
  }
  function simplify(pts, tol) { // Douglas–Peucker, returns indices
    var keep = new Array(pts.length).fill(false); keep[0] = keep[pts.length - 1] = true;
    (function rec(i, j) {
      if (j <= i + 1) return;
      var md = -1, mi = -1;
      for (var k = i + 1; k < j; k++) { var d = segDist(pts[k], pts[i], pts[j]).d; if (d > md) { md = d; mi = k; } }
      if (md > tol) { keep[mi] = true; rec(i, mi); rec(mi, j); }
    })(0, pts.length - 1);
    var out = []; keep.forEach(function (k, i) { if (k) out.push(i); });
    return out;
  }
  B.geo = { dist: dist, heading: heading, normDeg: normDeg, segDist: segDist };

  Router.prototype.m2u = function (floorId) { // metres -> svg units on that floor
    return 1 / ((this.D.floorById[floorId].unitScale || 1) * this.cfg.metersPerUnit);
  };

  // ---------------- plan: legs + steps ----------------
  Router.prototype.plan = function (srcNode, dstNode, opts) {
    opts = opts || {};
    var D = this.D, self = this, lang = B.lang;
    this.refresh();
    var pref = opts.pref || (opts.accessible ? 'accessible' : 'best');
    var isAcc = pref === 'accessible' || !!opts.accessible;
    var N = D.nodeById;

    // Same-floor routing optimization:
    // If origin and destination are already on the same floor, visitors naturally expect to walk directly on that floor
    // rather than taking an escalator down to another floor and back up just because the escalator hop was weighted cheaply.
    var p = null;
    if (!isAcc && N[srcNode] && N[dstNode] && N[srcNode].floor === N[dstNode].floor) {
      var pSame = this.path(srcNode, dstNode, true, false, 'accessible');
      if (pSame && pSame.nodes.every(function (nid) { return N[nid].floor === N[srcNode].floor; })) {
        p = pSame;
      }
    }
    if (!p) p = this.path(srcNode, dstNode, isAcc, false, pref);

    if (!p) {
      var pa = this.path(srcNode, dstNode, isAcc, true, pref);
      if (pa) return { ok: false, reason: 'closed', closed: this._closedOnPath(pa, lang), accessible: isAcc, pref: pref, tenant: opts.tenant || null };
      return { ok: false, reason: 'noroute', accessible: isAcc, pref: pref, tenant: opts.tenant || null };
    }
    // closures/schedules made the route longer? -> tell the visitor which connector is closed
    var detour = [];
    if (this.closedSig) {
      var pAll = this.path(srcNode, dstNode, isAcc, true, pref);
      if (pAll && pAll.cost < p.cost - 0.01) detour = this._closedOnPath(pAll, lang);
    }
    var N = D.nodeById;

    // 1. split into walking legs separated by transitions (consecutive transitions are merged: lift chains, through-escalators)
    var legs = [], cur = { floor: N[p.nodes[0]].floor, nodes: [p.nodes[0]], types: [null] };
    for (var i = 1; i < p.nodes.length; i++) {
      var id = p.nodes[i], t = p.types[i];
      if ((t === 'walk' || t === 'stairs') && N[id].floor === cur.floor) { cur.nodes.push(id); cur.types.push(t); continue; }
      var last = legs[legs.length - 1];
      if (cur.nodes.length === 1 && last && last.transition && sameKind(last.transition.type, t)) {
        // chained ride (stacked stops share one node): keep ONE leg, but remember every hop so no floor is hidden
        last.transition.toNode = id; last.transition.hops.push({ type: t, fromNode: p.nodes[i - 1], toNode: id });
        cur = { floor: N[id].floor, nodes: [id], types: [null] }; continue;
      }
      cur.transition = { type: t, fromNode: p.nodes[i - 1], toNode: id, hops: [{ type: t, fromNode: p.nodes[i - 1], toNode: id }] };
      legs.push(cur); cur = { floor: N[id].floor, nodes: [id], types: [null] };
    }
    legs.push(cur);

    var totalM = 0, secs = 0, cfg = this.cfg;
    var dstTenant = opts.tenant || null;
    legs.forEach(function (leg, li) {
      var f = D.floorById[leg.floor], k = (f.unitScale || 1) * cfg.metersPerUnit;
      leg.pts = leg.nodes.map(function (n) { return { x: N[n].x, y: N[n].y, node: n }; });
      leg.cum = [0];
      for (var j = 1; j < leg.pts.length; j++) leg.cum.push(leg.cum[j - 1] + dist(leg.pts[j - 1], leg.pts[j]) * k);
      leg.meters = leg.cum[leg.cum.length - 1];
      totalM += leg.meters;
      if (leg.transition) {
        var tr = leg.transition, fromF = D.floorById[N[tr.fromNode].floor], toF = D.floorById[N[tr.toNode].floor];
        tr.fromFloor = fromF.id; tr.toFloor = toF.id;
        tr.dir = toF.level > fromF.level ? 'up' : toF.level < fromF.level ? 'down' : 'same';
        tr.levels = Math.abs(toF.level - fromF.level);
        tr.amenity = D.amenityByNode[tr.fromNode] || null;
        if (tr.type === 'lift') secs += cfg.liftSecPerTrip;
        else if (tr.type.indexOf('escalator') === 0 || tr.type === 'stairs') secs += cfg.escalatorSecPerLevel * Math.max(1, tr.levels);
        // every hop: floor, direction and its own instruction ("Take … to UG", "Continue on … to 1F", …)
        tr.hops.forEach(function (h, hi) {
          var hf = D.floorById[N[h.fromNode].floor], ht = D.floorById[N[h.toNode].floor];
          h.fromFloor = hf.id; h.toFloor = ht.id; h.index = hi; h.count = tr.hops.length;
          h.dir = ht.level > hf.level ? 'up' : ht.level < hf.level ? 'down' : 'same';
          h.levels = Math.abs(ht.level - hf.level);
          h.amenity = D.amenityByNode[h.fromNode] || tr.amenity;
          h.x = N[h.fromNode].x; h.y = N[h.fromNode].y;
          h.text = hi === 0 ? self.transitionText(h, lang) : self.continueText(h, lang);
          h.short = self.transitionShort(h, lang);
        });
        tr.via = tr.hops.slice(1).map(function (h) { return h.fromFloor; });
        tr.text = self.transitionText(tr, lang);
        tr.short = self.transitionShort(tr, lang);
      }
      leg.steps = self.buildSteps(leg, li, legs.length, dstTenant, lang, opts && opts.origin);
    });
    secs += totalM / cfg.walkSpeedMps;
    var hasLift = p.types.some(function (t) { return t === 'lift'; });
    var hasEscalator = p.types.some(function (t) { return t && t.indexOf('escalator') === 0; });
    var fallbackEscalator = (pref === 'lift') && !hasLift && hasEscalator;
    return { ok: true, accessible: isAcc, pref: pref, fallbackEscalator: fallbackEscalator, legs: legs, meters: totalM, seconds: secs, cost: p.cost, tenant: dstTenant,
      srcNode: srcNode, dstNode: dstNode, detour: detour };
  };
  function sameKind(a, b) {
    if (!a || !b) return false;
    if (a === b) return true;
    return a.indexOf('escalator') === 0 && b.indexOf('escalator') === 0;
  }

  Router.prototype.transitionShort = function (tr, lang) {
    var toF = this.D.floorById[tr.toFloor], fl = B.floorLabel(toF);
    var id = lang !== 'en';
    if (tr.type === 'crossing') return id ? 'Jembatan → ' + fl : 'Bridge → ' + fl;
    if (tr.type === 'lift') return (id ? 'Lift → ' : 'Lift → ') + fl;
    if (tr.type === 'stairs') return id ? 'Tangga → ' + fl : 'Stairs → ' + fl;
    return (id ? 'Eskalator → ' : 'Escalator → ') + fl;
  };

  Router.prototype.transitionText = function (tr, lang) {
    var self = this, toF = this.D.floorById[tr.toFloor], fl = B.floorLong(toF), id = lang !== 'en';
    var am = tr.amenity ? B.amenityName(tr.amenity) : '';
    var bank = am.replace(/ · .*$/, '');
    if (tr.type === 'crossing') return id ? 'Seberangi jembatan penghubung ke ' + fl : 'Cross the link bridge to ' + fl;
    if (tr.type === 'stairs') {
      if (tr.fromFloor === tr.toFloor) return id ? 'Lewati tangga outdoor penghubung gedung' : 'Take the outdoor stairs between the buildings';
      return id ? (tr.dir === 'down' ? 'Turun' : 'Naik') + ' tangga ke ' + fl : 'Take the stairs ' + (tr.dir === 'down' ? 'down' : 'up') + ' to ' + fl;
    }
    var lvia = (tr.via && tr.via.length) ? (id ? ' (lewat ' : ' (via ') + tr.via.map(function (f) { return B.floorLabel(self.D.floorById[f]); }).join(', ') + ')' : '';
    if (tr.type === 'lift') return id ? (tr.dir === 'down' ? 'Turun' : 'Naik') + ' lift ke ' + fl + lvia : 'Take the lift ' + (tr.dir === 'down' ? 'down' : 'up') + ' to ' + fl + lvia;
    var verb = id ? (tr.dir === 'down' ? 'Turun' : 'Naik') : (tr.dir === 'down' ? 'Take' : 'Take');
    var via = (tr.via && tr.via.length) ? (id ? ' (lewat ' : ' (via ') + tr.via.map(function (f) { return B.floorLabel(self.D.floorById[f]); }).join(', ') + ')' : '';
    if (id) return verb + ' ' + (bank || 'eskalator') + ' ke ' + fl + via;
    return 'Take ' + (bank || 'the escalator') + ' ' + (tr.dir === 'down' ? 'down' : 'up') + ' to ' + fl + via;
  };

  // 2nd, 3rd … hop of a chained ride: "Continue on Escalator A up to First Floor · E-Walk"
  Router.prototype.continueText = function (h, lang) {
    var toF = this.D.floorById[h.toFloor], fl = B.floorLong(toF), id = lang !== 'en';
    var bank = h.amenity ? B.amenityName(h.amenity).replace(/ · .*$/, '') : '';
    var up = h.dir !== 'down';
    if (h.type === 'lift') return id ? 'Tetap di lift, ' + (up ? 'naik' : 'turun') + ' ke ' + fl : 'Stay in the lift ' + (up ? 'up' : 'down') + ' to ' + fl;
    if (h.type === 'crossing') return id ? 'Lanjut menyeberang ke ' + fl : 'Continue across to ' + fl;
    if (h.type === 'stairs') return id ? 'Lanjut lewati tangga penghubung' : 'Continue via connecting stairs';
    if (h.index === h.count - 1 && h.count > 2) return id ? 'Lanjut ' + (up ? 'naik' : 'turun') + ' ke ' + fl : 'Continue ' + (up ? 'up' : 'down') + ' to ' + fl;
    if (id) return 'Lanjut ' + (up ? 'naik' : 'turun') + ' ' + (bank || 'eskalator') + ' ke ' + fl;
    return 'Continue on ' + (bank || 'the escalator') + ' ' + (up ? 'up' : 'down') + ' to ' + fl;
  };

  Router.prototype.landmarkNear = function (floorId, pt, maxM, exclude) {
    var u = maxM * this.m2u(floorId), best = null, bd = Infinity;
    this.D.tenants.forEach(function (t) {
      if (t.floor !== floorId || (exclude && exclude[t.id])) return;
      var d = Math.hypot(t.x - pt.x, t.y - pt.y);
      if (d < u && d < bd) { bd = d; best = t; }
    });
    return best;
  };

  Router.prototype.landmarksAlong = function (floorId, pts, maxM, exclude) {
    var u = maxM * this.m2u(floorId), found = [];
    this.D.tenants.forEach(function (t) {
      if (t.floor !== floorId || (exclude && exclude[t.id])) return;
      var bd = Infinity, at = 0, total = 0, acc = 0;
      for (var i = 1; i < pts.length; i++) total += dist(pts[i - 1], pts[i]);
      for (i = 1; i < pts.length; i++) {
        var s = segDist(t, pts[i - 1], pts[i]), L = dist(pts[i - 1], pts[i]);
        if (s.d < bd) { bd = s.d; at = (acc + s.t * L) / (total || 1); }
        acc += L;
      }
      if (bd < u && at > 0.15 && at < 0.9) found.push({ t: t, d: bd, at: at });
    });
    found.sort(function (a, b) { return (b.t.logo ? 1 : 0) - (a.t.logo ? 1 : 0) || a.d - b.d; });
    return found.slice(0, 1).map(function (f) { return f.t; });
  };

  function roundM(m) { return m < 10 ? Math.max(1, Math.round(m)) : Math.round(m / 5) * 5; }
  B.roundM = roundM;

  Router.prototype.buildSteps = function (leg, li, nLegs, dstTenant, lang, srcOrigin) {
    var self = this, id = lang !== 'en', floorId = leg.floor;
    var m2u = this.m2u(floorId), pts = leg.pts, steps = [];
    if (pts.length < 2) {
      if (leg.transition) leg.transition.hops.forEach(function (h) {
        var at = h.index === 0 ? pts[0] : { x: h.x, y: h.y, node: h.fromNode };
        steps.push({ floor: h.fromFloor, pts: [at, at], startM: 0, endM: 0, meters: 0, end: at,
          text: h.text, kind: 'transition', transition: h, hop: h.index, chain: leg.transition });
      });
      else steps.push({ floor: floorId, pts: [pts[0], pts[0]], startM: 0, endM: 0, meters: 0, end: pts[0], text: id ? 'Tujuan ada di sini' : 'Destination is here', kind: 'arrive' });
      return steps;
    }
    var excl = {}; if (dstTenant) excl[dstTenant.id] = true;
    if (srcOrigin && srcOrigin.id) excl[srcOrigin.id] = true;
    var usedLm = {}, N = this.D.nodeById, types = leg.types || [];
    // end of the leg: "… to the escalator" / "… X is ahead of you"
    function endText() {
      if (li < nLegs - 1 && leg.transition) {
        var am = leg.transition.amenity;
        var target = am ? B.amenityName(am).replace(/ · .*$/, '') : (id ? 'eskalator' : 'the escalator');
        if (leg.transition.type === 'lift') target = id ? 'lift' : 'the lift';
        else if (leg.transition.type === 'crossing') target = id ? 'jembatan penghubung' : 'the link bridge';
        else if (leg.transition.type === 'stairs') target = id ? 'tangga penghubung' : 'the connecting stairs';
        else if (leg.transition.type.indexOf('escalator') === 0) target = id ? 'eskalator' : 'the escalator';
        return { txt: (id ? ' sampai ' : ' to ') + target, kind: 'to-transition' };
      }
      return { txt: id ? '. ' + (dstTenant ? dstTenant.name : 'Tujuan') + ' ada di depan Anda' : '. ' + (dstTenant ? dstTenant.name : 'Destination') + ' is ahead of you', kind: 'arrive' };
    }
    function outdoor(p) { return !!(N[p.node] || {}).outdoor; }
    // Stairs and road crossings inside a walking leg (the outdoor link between the buildings) are steps of their own, so
    // the visitor reads "Take the stairs down by H&M" → "Cross the road to E-Walk" → "Take the stairs up by …" instead of
    // one long "Go straight". Road nodes carry `outdoor` (graph node label 'outdoor' in the CMS).
    var runs = [], r0 = 0;
    for (var j = 1; j < pts.length; j++) {
      var sp = types[j] === 'stairs' ? 'stairs' : outdoor(pts[j - 1]) && outdoor(pts[j]) ? 'road' : null;
      if (!sp) continue;
      var lastRun = runs[runs.length - 1];
      if (sp === 'road' && j - 1 === r0 && lastRun && lastRun.sp === 'road') { lastRun.i1 = j; r0 = j; continue; }
      if (j - 1 > r0) runs.push({ i0: r0, i1: j - 1 });
      runs.push({ i0: j - 1, i1: j, sp: sp }); r0 = j;
    }
    if (pts.length - 1 > r0) runs.push({ i0: r0, i1: pts.length - 1 });

    runs.forEach(function (run, ri) {
      var next = runs[ri + 1] || null;
      if (!run.sp) return walkRun(run.i0, run.i1, ri === 0, next);
      var meters = leg.cum[run.i1] - leg.cum[run.i0], txt, dir = 'same', lm = null;
      var mtxt = (id ? '±' : '~') + roundM(meters) + ' m';
      if (run.sp === 'stairs') {
        var outA = outdoor(pts[run.i0]), outB = outdoor(pts[run.i1]);
        dir = outB && !outA ? 'down' : outA && !outB ? 'up' : 'same';
        lm = self.landmarkNear(floorId, outA && !outB ? pts[run.i1] : pts[run.i0], 45, {});
        var by = lm ? (id ? ' di dekat ' : ' by ') + (lm.brand || lm.name) : '';
        txt = (dir === 'down' ? (id ? 'Turun tangga' : 'Take the stairs down') : dir === 'up' ? (id ? 'Naik tangga' : 'Take the stairs up')
          : (id ? 'Lewati tangga' : 'Take the stairs')) + by;
      } else {
        // the building across the road: the shop nearest to where the crossing ends vs where it starts
        var far = self.landmarkNear(floorId, pts[Math.min(pts.length - 1, run.i1 + 2)], 60, {});
        var near = self.landmarkNear(floorId, pts[Math.max(0, run.i0 - 2)], 60, {});
        var to = far && far.building && (!near || near.building !== far.building) ? B.buildingName(far.building) : '';
        txt = id ? 'Seberangi jalan ' + mtxt + (to ? ' ke ' + to : '') : 'Cross the road (' + mtxt + ')' + (to ? ' to ' + to : '');
      }
      if (!next) txt += endText().txt;
      steps.push({ floor: floorId, pts: pts.slice(run.i0, run.i1 + 1), startM: leg.cum[run.i0], endM: leg.cum[run.i1], meters: meters,
        end: pts[run.i1], text: txt, kind: run.sp, dir: dir, turn: 0, landmark: lm });
    });

    function walkRun(r0, r1, first, next) {
      var keep = simplify(pts.slice(r0, r1 + 1), 1.2 * m2u).map(function (x) { return x + r0; });
      // turn vertices among simplified points
      var turns = [r0];
      for (var k = 1; k < keep.length - 1; k++) {
        var a = pts[keep[k - 1]], b = pts[keep[k]], c = pts[keep[k + 1]];
        var dIn = (leg.cum[keep[k]] - leg.cum[keep[k - 1]]), dOut = (leg.cum[keep[k + 1]] - leg.cum[keep[k]]);
        var ang = normDeg(heading(b, c) - heading(a, b));
        if ((Math.abs(ang) >= 35 && dIn >= 2.5 && dOut >= 2.5) || Math.abs(ang) >= 70) turns.push(keep[k]);
      }
      turns.push(r1);
      // drop segments shorter than 2 m (merge into next)
      var t2 = [turns[0]];
      for (k = 1; k < turns.length; k++) {
        if (k < turns.length - 1 && leg.cum[turns[k]] - leg.cum[t2[t2.length - 1]] < 2) continue;
        t2.push(turns[k]);
      }
      turns = t2;
      for (k = 1; k < turns.length; k++) {
        var i0 = turns[k - 1], i1 = turns[k], seg = pts.slice(i0, i1 + 1), meters = leg.cum[i1] - leg.cum[i0];
        var isLast = k === turns.length - 1, txt = '';
        var lmEx = Object.assign({}, excl, usedLm);
        var passing = self.landmarksAlong(floorId, seg, 7, lmEx);
        passing.forEach(function (t) { usedLm[t.id] = true; });
        var mtxt = (id ? '±' : '~') + roundM(meters) + ' m';
        if (k === 1 && li === 0 && first) {
          if (srcOrigin && srcOrigin.name && srcOrigin.id !== 'kiosk') {
            txt = id ? 'Dari ' + srcOrigin.name + ', jalan ' + mtxt : 'From ' + srcOrigin.name + ', walk ' + mtxt;
          } else {
            txt = id ? 'Dari titik “Anda di sini”, jalan ' + mtxt : 'From “You are here”, walk ' + mtxt;
          }
        }
        else if (k === 1 && first) txt = id ? 'Setelah tiba, jalan ' + mtxt : 'After arriving, walk ' + mtxt;
        else if (k === 1) txt = id ? 'Lanjut jalan ' + mtxt : 'Continue ' + mtxt;
        else txt = id ? 'Jalan lurus ' + mtxt : 'Go straight ' + mtxt;
        if (passing.length) txt += (id ? ' melewati ' : ' past ') + passing.map(function (t) { return t.brand || t.name; }).join(id ? ' dan ' : ' and ');
        var kind = 'walk', turnDir = 0;
        if (!isLast) {
          // use longer baselines for stable angles
          var a2 = pts[i0], b2 = pts[i1], c2 = pts[turns[k + 1]];
          var ang2 = normDeg(heading(a2, b2) - heading(b2, c2)) * -1;
          turnDir = ang2;
          var lm = self.landmarkNear(floorId, b2, 8, Object.assign({}, excl, usedLm));
          if (lm) usedLm[lm.id] = true;
          txt += ', ' + turnWord(ang2, id) + (lm ? (id ? ' dekat ' : ' near ') + (lm.brand || lm.name) : '');
          kind = 'turn';
        } else if (next) {
          txt += next.sp === 'stairs' ? (id ? ' sampai tangga' : ' to the stairs') : (id ? ' sampai tepi jalan' : ' to the road');
        } else {
          var e = endText(); txt += e.txt; kind = e.kind;
        }
        steps.push({ floor: floorId, pts: seg, startM: leg.cum[i0], endM: leg.cum[i1], meters: meters, end: pts[i1],
          text: txt, kind: kind, turn: turnDir, landmark: passing[0] || null });
      }
    }
    if (leg.transition) {
      var last = pts[pts.length - 1];
      leg.transition.hops.forEach(function (h) {
        var at = h.index === 0 ? last : { x: h.x, y: h.y, node: h.fromNode };
        steps.push({ floor: h.fromFloor, pts: [at, at], startM: leg.meters, endM: leg.meters, meters: 0, end: at,
          text: h.text, kind: 'transition', transition: h, hop: h.index, chain: leg.transition });
      });
    }
    return steps;
  };

  function turnWord(ang, id) {
    var a = Math.abs(ang), right = ang > 0;
    if (a >= 150) return id ? 'lalu putar balik' : 'then make a U-turn';
    if (a >= 60) return id ? (right ? 'lalu belok kanan' : 'lalu belok kiri') : (right ? 'then turn right' : 'then turn left');
    return id ? (right ? 'lalu serong kanan' : 'lalu serong kiri') : (right ? 'then bear right' : 'then bear left');
  }

  // point at distance m along leg polyline (metres) -> {x,y,seg}
  B.pointAtM = function (leg, m) {
    var c = leg.cum, p = leg.pts;
    if (m <= 0) return { x: p[0].x, y: p[0].y, i: 0 };
    for (var i = 1; i < c.length; i++) {
      if (c[i] >= m) {
        var t = (m - c[i - 1]) / ((c[i] - c[i - 1]) || 1);
        return { x: p[i - 1].x + t * (p[i].x - p[i - 1].x), y: p[i - 1].y + t * (p[i].y - p[i - 1].y), i: i };
      }
    }
    var L = p[p.length - 1]; return { x: L.x, y: L.y, i: p.length - 1 };
  };

  B.Router = Router;
})(window.BSB);
