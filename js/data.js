/* Data loader: directory.json + floor SVG cache (each SVG is fetched & parsed exactly once) */
window.BSB = window.BSB || {};
(function (B) {
  // App root = folder that contains config.js / data/ (works from / and /m/)
  var scripts = document.getElementsByTagName('script');
  var root = '';
  for (var i = 0; i < scripts.length; i++) {
    var src = scripts[i].getAttribute('src') || '';
    if (/(^|\/)js\/data\.js(\?|$)/.test(src)) { root = src.replace(/js\/data\.js.*$/, ''); break; }
  }
  B.ROOT = root; // relative prefix, '' or '../'

  B.appBaseUrl = function () {
    var a = document.createElement('a'); a.href = B.ROOT || './';
    return a.href.replace(/\/$/, '');
  };

  // localhost, loopback, LAN / bare IPs and *.local: addresses a visitor's phone usually cannot open
  B.isLocalHost = function (host) {
    host = String(host == null ? location.hostname : host).toLowerCase().replace(/^\[|\]$/g, '');
    return host === 'localhost' || host === '::1' || /\.local$/.test(host) || /^\d{1,3}(\.\d{1,3}){3}$/.test(host);
  };
  // address the phone QR opens: ?base= > a page on a public domain uses its own address (hosting works as is) >
  // config PUBLIC_BASE > CMS setting public.baseUrl (snapshot) when it is not local > this page
  B.publicBase = function () {
    var q = new URLSearchParams(location.search).get('base');
    var own = B.appBaseUrl(), cfg = (window.BSB_CONFIG || {}).PUBLIC_BASE;
    var cms = B.D && B.D.meta && B.D.meta.config && B.D.meta.config.publicBase;
    if (cms && B.isLocalHost(String(cms).replace(/^https?:\/\/([^/:]+).*$/i, '$1'))) cms = null;
    return String(q || (!B.isLocalHost() && own) || cfg || cms || own).replace(/\/$/, '');
  };

  // ---- snapshot loading (directory + promos + status) with localStorage fallback (no Service Worker) ----
  var Q = new URLSearchParams(location.search);
  var CFG = window.BSB_CONFIG || {};
  // dev/test only: ?fixture=v2 -> tests/fixtures/<name>.v2.json
  // dev conveniences only on a local host: on the public site ?fixture= would let a link show test data
  B.devMode = !!CFG.devMode && B.isLocalHost();
  var FIX = B.devMode && /^[a-z0-9_-]+$/i.test(Q.get('fixture') || '') ? Q.get('fixture') : null;
  B.snapUrl = function (name) {
    var vParam = (name === 'directory' ? '?v=D0034-202610061135' : '');
    return B.ROOT + (FIX ? 'tests/fixtures/' + name + '.' + FIX + '.json' : 'data/' + name + '.json' + vParam);
  };
  // API_BASE 'api' (mod_rewrite) or 'api/index.php?r=' (no mod_rewrite): a '?' in the path then becomes '&'
  B.apiUrl = function (path) {
    var base = String(CFG.API_BASE || 'api').replace(/\/$/, '');
    if (base.indexOf('?') >= 0) path = path.replace('?', '&');
    return (/^(https?:)?\/\//.test(base) ? '' : B.ROOT) + base + path;
  };

  function lsGet(k) { try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : null; } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, typeof v === 'string' ? v : JSON.stringify(v)); return true; } catch (e) { return false; } }
  B.lsGet = lsGet; B.lsSet = lsSet;

  // fetch JSON; on failure fall back to the last copy saved in localStorage (key bsb-snap-<name>)
  B.fetchSnap = function (name, url, opt) {
    return fetch(url || B.snapUrl(name), { cache: 'no-cache' }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.text();
    }).then(function (txt) {
      var j = JSON.parse(txt);
      if (!FIX) lsSet('bsb-snap-' + name, txt);
      return j;
    }).catch(function (e) {
      var j = FIX ? null : lsGet('bsb-snap-' + name);
      if (j) { B.offlineSnap = true; return j; }
      if (opt && opt.optional) return null;
      throw e;
    });
  };

  // kiosk identity: URL ?kiosk=<id>&key=<token> -> localStorage -> config.DEFAULT_KIOSK. URL always wins.
  B.kioskIdentity = function () {
    if (B._ident) return B._ident;
    var id = Q.get('kiosk'), key = Q.get('key');
    try {
      // read the stored id BEFORE overwriting it: a stored key belongs to the stored id only (re-pointing a device to
      // another kiosk without &key= must not send the old kiosk's token -> 401 on every ping/telemetry flush)
      var prevId = localStorage.getItem('bsb-kiosk-id');
      if (id) localStorage.setItem('bsb-kiosk-id', id);
      if (key) localStorage.setItem('bsb-kiosk-key', key);
      else if (id && prevId && id !== prevId) localStorage.removeItem('bsb-kiosk-key');
      if (!id) id = prevId;
      if (!key && (!Q.get('kiosk') || Q.get('kiosk') === prevId)) key = localStorage.getItem('bsb-kiosk-key');
    } catch (e) {}
    if (Q.get('key') && window.history && history.replaceState) { // never leave the token in the address bar
      var u = new URL(location.href); u.searchParams.delete('key');
      try { history.replaceState(null, '', u.pathname + u.search + u.hash); } catch (e) {}
    }
    B._ident = { id: id || CFG.DEFAULT_KIOSK || null, key: key || null };
    return B._ident;
  };

  B.indexData = function (D) {
    D.floorById = {}; D.tenantById = {}; D.kioskById = {}; D.catById = {}; D.nodeById = {}; D.amenityByNode = {}; D.amenityById = {};
    D.amenityTypeById = {};
    D.floors.forEach(function (f) { D.floorById[f.id] = f; });
    D.categories.forEach(function (c) { c.count = 0; D.catById[c.id] = c; });
    D.tenants.forEach(function (t) { D.tenantById[t.id] = t; if (D.catById[t.category]) D.catById[t.category].count++; });
    D.kiosks.forEach(function (k) { D.kioskById[k.id] = k; });
    D.graph.nodes.forEach(function (n) { D.nodeById[n.id] = n; });
    // POIs never index by node (a connector stop and a POI must not share a node); old snapshots have no kind = connector
    D.amenities.forEach(function (a) { D.amenityById[a.id] = a; if (a.kind !== 'poi') D.amenityByNode[a.node] = a; });
    (D.amenityTypes || []).forEach(function (t) { D.amenityTypeById[t.id] = t; });
    D.graph.rules = D.graph.rules || {};
    D.meta = D.meta || {};
    D.version = D.meta.version || null;
    // levels sorted top -> bottom for the floor switcher
    var lv = {};
    D.floors.forEach(function (f) { (lv[f.level] = lv[f.level] || []).push(f); });
    D.levels = Object.keys(lv).map(Number).sort(function (a, b) { return b - a; }).map(function (l) {
      return { level: l, short: lv[l][0].short, floors: lv[l].sort(function (a, b) { return a.building < b.building ? 1 : -1; }) };
    });
    if (D.i18n && B.mergeI18n) B.mergeI18n(D.i18n);
    return D;
  };

  B.loadData = function () {
    var pDir = B.fetchSnap('directory');
    var pPro = B.fetchSnap('promos', null, { optional: true });
    var pSt = B.fetchSnap('status', null, { optional: true });
    return pDir.then(function (D) {
      B.indexData(D);
      B.D = D;
      return Promise.all([pPro, pSt]).then(function (r) { B.promosData = r[0]; B.statusData = r[1]; return D; });
    });
  };

  // ---- SVG cache: text fetched once, parsed once, the same <svg> element is re-used ----
  var svgCache = {}, svgPending = {};
  B.evictFloorSvg = function (floorId) { delete svgCache[floorId]; };
  B.loadFloorSvg = function (floorId) {
    if (svgCache[floorId]) return Promise.resolve(svgCache[floorId]);
    if (svgPending[floorId]) return svgPending[floorId];
    var f = B.D.floorById[floorId];
    svgPending[floorId] = fetch(B.ROOT + f.svg).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + f.svg); return r.text(); }).then(function (txt) {
      var doc = new DOMParser().parseFromString(txt, 'image/svg+xml');
      var el = document.importNode(doc.documentElement, true);
      el.removeAttribute('width'); el.removeAttribute('height');
      el.setAttribute('preserveAspectRatio', 'xMinYMin meet');
      svgCache[floorId] = el;
      delete svgPending[floorId];
      return el;
    }, function (e) { delete svgPending[floorId]; throw e; });
    return svgPending[floorId];
  };

  B.esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };
  B.logoUrl = function (t) { return t.logo ? B.ROOT + t.logo : null; };
  // category colour: built-in palette first (keeps the current look), then CMS colour
  B.catColor = function (id) {
    var c = B.D && B.D.catById && B.D.catById[id];
    return (B.CAT_COLORS && B.CAT_COLORS[id]) || (c && c.color) || '#857B70';
  };
  // "now" in mall local time (WITA by default) as {dow:1..7, min, date}
  B.mallNow = function (now) {
    var tz = ((B.D && B.D.meta && B.D.meta.tzOffsetMin) != null ? B.D.meta.tzOffsetMin : 480) * 60000;
    var d = new Date((now || Date.now()) + tz);
    return { dow: d.getUTCDay() || 7, min: d.getUTCHours() * 60 + d.getUTCMinutes(), ymd: d.toISOString().slice(0, 10) };
  };
  B.initials = function (name) {
    return name.replace(/[^A-Za-z0-9 &]/g, ' ').split(/\s+/).filter(Boolean).slice(0, 2).map(function (w) { return w[0]; }).join('').toUpperCase();
  };
  B.fmtPhone = function (p) {
    if (!p) return '';
    if (p.indexOf('+62') === 0) {
      var r = '0' + p.slice(3);
      if (/^08/.test(r)) return r.replace(/^(\d{4})(\d{4})(\d+)$/, '$1-$2-$3');
      return r.replace(/^(0\d{3})(\d+)$/, '($1) $2');
    }
    return p;
  };
})(window.BSB);
