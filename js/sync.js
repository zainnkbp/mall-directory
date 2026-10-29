/*
 * sync.js — version polling, live status/promo updates, safe hot-reload, heartbeat & remote commands (CMS_SPEC §6.2).
 * ES5 only. Kiosk page only.
 *
 *  every POLL_SEC (60 s ± 10 s jitter):
 *    with token  -> POST <API>/kiosk/ping  (heartbeat + versions + commands)
 *    without     -> GET  <API>/version  ->  fallback GET data/version.json (static file written by the publisher)
 *  status  changed -> fetch status.json, hooks.onStatus()  (no reload; closures applied within one poll ≤ 70 s)
 *  promos  changed -> fetch promos.json, hooks.onPromos()  (no reload)
 *  directory changed -> prefetch directory.json?v= + floor SVGs + logos into the cache, then reload ONLY when idle
 *                       (attract screen) and only after the server answered again. Never reloads while offline.
 *  minAppBuild > APP_BUILD -> SW update + reload when idle.
 *  commands: reload (idle, forced after 2 min) · identify (15 s overlay) · clear_cache (caches + SW + reload). Acked.
 */
window.BSB = window.BSB || {};
(function (B) {
  var cfg = window.BSB_CONFIG || {};
  var Q = new URLSearchParams(location.search);
  var POLL = Math.max(5, +(B.devMode && Q.get('poll')) || cfg.POLL_SEC || 60);
  var MEDIA_CACHE = 'bsb-media-v1';
  var hooks = {}, timer = 0, t0 = Date.now();
  var S = B.syncState = { started: false, lastPoll: 0, lastOk: 0, reachable: null, mode: null, versions: null, pendingReload: null,
    prefetched: null, lastError: null, polls: 0, commands: [], swActive: false };

  function apiUrl(p) { return B.apiUrl ? B.apiUrl(p) : B.ROOT + 'api' + p; }
  function abs(u) { return /^(https?:)?\/\//.test(u) || u.charAt(0) === '/' ? u : B.ROOT + u; }
  function getJSON(url, opt) {
    opt = opt || {};
    var ctl = window.AbortController ? new AbortController() : null;
    var to = setTimeout(function () { if (ctl) ctl.abort(); }, opt.timeout || 8000);
    var init = { method: opt.method || 'GET', cache: 'no-store', headers: opt.headers || {} };
    if (ctl) init.signal = ctl.signal;
    if (opt.body) { init.body = JSON.stringify(opt.body); init.headers['Content-Type'] = 'application/json'; }
    return fetch(url, init).then(function (r) {
      clearTimeout(to);
      if (!r.ok) { var e = new Error('HTTP ' + r.status); e.status = r.status; throw e; }
      return r.status === 204 ? null : r.json();
    }, function (e) { clearTimeout(to); throw e; });
  }
  function cmpBuild(a, b) { // dotted numeric compare: '2026.10.2' > '2026.10.1'
    var x = String(a || '').split(/[.\-]/), y = String(b || '').split(/[.\-]/);
    for (var i = 0; i < Math.max(x.length, y.length); i++) {
      var p = parseInt(x[i] || '0', 10) || 0, q = parseInt(y[i] || '0', 10) || 0;
      if (p !== q) return p > q ? 1 : -1;
    }
    return 0;
  }
  B.cmpBuild = cmpBuild;

  function curVersions() {
    return { directory: (B.D && B.D.version) || null, promos: (B.promosData && B.promosData.version) || null,
      status: (B.statusData && B.statusData.version) || null };
  }
  function idle() { return !!(hooks.isIdle && hooks.isIdle()); }

  // ---------------- polling ----------------
  function schedule(ms) {
    clearTimeout(timer);
    var jitter = POLL >= 30 ? (Math.random() * 20 - 10) * 1000 : 0;
    timer = setTimeout(poll, ms != null ? ms : POLL * 1000 + jitter);
  }
  function heartbeat() {
    var id = B.kioskIdentity();
    var p = B.perf || {};
    return {
      appBuild: cfg.APP_BUILD || null, versions: curVersions(), uptimeSec: Math.round((Date.now() - t0) / 1000),
      screen: (window.screen ? screen.width + 'x' + screen.height : innerWidth + 'x' + innerHeight) + '@' + (window.devicePixelRatio || 1),
      viewport: innerWidth + 'x' + innerHeight,
      clientType: (hooks.profile && hooks.profile().clientType) || cfg.clientType || null,
      perfActive: p.mode || 'full', perfReason: p.reason || null, swActive: !!(navigator.serviceWorker && navigator.serviceWorker.controller),
      queueLen: B.tele ? B.tele.queueLen : 0, lastError: S.lastError || (B.tele && B.tele.lastError) || null,
      ua: navigator.userAgent, kioskId: id.id, idle: idle(), offlineSnap: !!B.offlineSnap
    };
  }
  // API not deployed (404)? use the static data/version.json and retry the API every 10 min (less 404 noise / load)
  var apiMissingUntil = 0;
  function apiGone(e) { if (e && e.status === 404) apiMissingUntil = Date.now() + 600000; }
  function fetchVersions() {
    var id = B.kioskIdentity();
    var viaStatic = function () { return getJSON(B.snapUrl('version') + '?probe=1').then(function (j) { S.mode = 'static'; return { versions: j }; }); };
    var viaVersion = function () {
      if (Date.now() < apiMissingUntil) return viaStatic();
      return getJSON(apiUrl('/version?probe=1')).then(function (j) { S.mode = 'version'; return { versions: j.data || j }; }, function (e) { apiGone(e); return viaStatic(); });
    };
    if (id.key && id.id && Date.now() >= apiMissingUntil) {
      return getJSON(apiUrl('/kiosk/ping'), { method: 'POST', body: heartbeat(), headers: { 'X-Kiosk-Id': id.id, 'X-Kiosk-Key': id.key } })
        .then(function (j) {
          var d = (j && j.data) || j || {};
          S.mode = 'ping';
          return { versions: d.versions || d, commands: d.commands || [], kiosk: d.kiosk || null, serverTime: d.serverTime };
        }, function (e) { if (e && e.status === 401) S.lastError = 'ping 401 (token?)'; apiGone(e); return viaVersion(); });
    }
    return viaVersion();
  }

  function poll() {
    S.polls++; S.lastPoll = Date.now();
    fetchVersions().then(function (r) {
      S.reachable = true; S.lastOk = Date.now(); S.versions = r.versions;
      if (r.kiosk && hooks.onProfile) hooks.onProfile(r.kiosk);
      var jobs = [applyChannel('status', r.versions.status), applyChannel('promos', r.versions.promos)];
      checkDirectory(r.versions.directory);
      if (r.versions.minAppBuild && cfg.APP_BUILD && cmpBuild(r.versions.minAppBuild, cfg.APP_BUILD) > 0) {
        if (navigator.serviceWorker && navigator.serviceWorker.getRegistration) navigator.serviceWorker.getRegistration().then(function (g) { if (g) g.update(); });
        requestReload('app-build ' + r.versions.minAppBuild);
      }
      (r.commands || []).forEach(runCommand);
      return Promise.all(jobs);
    }).catch(function (e) {
      S.reachable = false; S.lastError = 'poll: ' + (e && e.message || e);
    }).then(function () { schedule(); });
  }

  // status / promos: fetch the new file and hand it to the page (no reload)
  function applyChannel(name, info) {
    if (!info || !info.version) return null;
    var cur = name === 'status' ? B.statusData : B.promosData;
    if (cur && cur.version === info.version) return null;
    var url = info.url ? abs(info.url) : B.snapUrl(name) + '?v=' + encodeURIComponent(info.version);
    url += (url.indexOf('?') < 0 ? '?' : '&') + 'probe=1';
    return getJSON(url).then(function (j) {
      if (!j) return;
      if (!j.version) j.version = info.version;
      try { if (!/[?&]fixture=/.test(location.search)) localStorage.setItem('bsb-snap-' + name, JSON.stringify(j)); } catch (e) {}
      if (name === 'status') { B.statusData = j; if (hooks.onStatus) hooks.onStatus(j); }
      else { B.promosData = j; if (hooks.onPromos) hooks.onPromos(j); prefetchPromoMedia(j); }
    }).catch(function (e) { S.lastError = name + ': ' + e.message; });
  }

  // ---------------- directory hot-reload ----------------
  function checkDirectory(info) {
    if (!info || !info.version || !B.D) return;
    if (info.version === B.D.version) return;
    var failedFor = null; try { failedFor = sessionStorage.getItem('bsb-reload-for'); } catch (e) {}
    if (failedFor === info.version && B.D.version !== info.version) { S.lastError = 'reloaded for ' + info.version + ' but still on ' + B.D.version; return; }
    if (S.prefetched === info.version) { requestReload('directory ' + info.version, info.version); return; }
    if (S.prefetching) return;
    S.prefetching = info.version;
    prefetchDirectory(info).then(function () {
      S.prefetched = info.version; S.prefetching = null;
      requestReload('directory ' + info.version, info.version);
    }, function (e) { S.prefetching = null; S.lastError = 'prefetch ' + info.version + ': ' + (e && e.message || e); });
  }
  function assetsOf(D) {
    var a = [], seen = {};
    function add(u) { if (u && !seen[u]) { seen[u] = 1; a.push(abs(u)); } }
    (D.floors || []).forEach(function (f) { add(f.svg); });
    (D.tenants || []).forEach(function (t) { add(t.logo); });
    return a;
  }
  B.assetsOf = assetsOf;
  // fetch every url (6 in parallel) into the media cache; resolves only when ALL succeeded
  function warm(urls) {
    var hasCache = !!window.caches, i = 0, failed = 0;
    var c = hasCache ? caches.open(MEDIA_CACHE) : Promise.resolve(null);
    return c.then(function (cache) {
      function one(u) {
        var have = cache ? cache.match(u) : Promise.resolve(null);
        return have.then(function (hit) {
          if (hit) return;
          return fetch(u, { cache: 'no-cache' }).then(function (r) {
            if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + u);
            return cache ? cache.put(u, r) : r.blob();
          });
        }).catch(function () { failed++; });
      }
      function worker() { if (i >= urls.length) return Promise.resolve(); return one(urls[i++]).then(worker); }
      var ws = []; for (var k = 0; k < 6; k++) ws.push(worker());
      return Promise.all(ws).then(function () { if (failed) throw new Error(failed + ' assets failed'); });
    });
  }
  B.warmAssets = warm;
  function prefetchDirectory(info) {
    var url = abs(info.url || ('data/directory.json?v=' + encodeURIComponent(info.version)));
    return fetch(url, { cache: 'no-cache' }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.text();
    }).then(function (txt) {
      var D2 = JSON.parse(txt);
      if (!D2.graph || !D2.floors || !D2.tenants) throw new Error('invalid snapshot');
      if (D2.meta && D2.meta.version && D2.meta.version !== info.version) throw new Error('version mismatch ' + D2.meta.version);
      var put = window.caches ? caches.open('bsb-data-' + info.version).then(function (c) {
        return c.put(url, new Response(txt, { headers: { 'Content-Type': 'application/json' } }));
      }) : Promise.resolve();
      return put.then(function () { return warm(assetsOf(D2)); }).then(function () {
        try { if (!/[?&]fixture=/.test(location.search)) localStorage.setItem('bsb-snap-directory', txt); } catch (e) {}
      });
    });
  }
  function prefetchPromoMedia(P) {
    var u = [];
    (P && P.promos || []).forEach(function (p) { if (p.media) u.push(abs(p.media)); if (p.poster) u.push(abs(p.poster)); });
    if (u.length) warm(u).catch(function () {});
  }
  // keep the 2 newest versioned data caches
  function pruneDataCaches() {
    if (!window.caches) return;
    caches.keys().then(function (keys) {
      var d = keys.filter(function (k) { return k.indexOf('bsb-data-') === 0; }).sort().reverse();
      d.slice(2).forEach(function (k) { caches.delete(k); });
    });
  }

  // ---------------- reload only when idle and when the server is reachable ----------------
  var reloadWatch = 0;
  function requestReload(why, forVersion, forceAfterMs) {
    if (!S.pendingReload) S.pendingReload = { why: why, at: Date.now(), forVersion: forVersion || null, forceAt: forceAfterMs ? Date.now() + forceAfterMs : 0 };
    if (forceAfterMs && !S.pendingReload.forceAt) S.pendingReload.forceAt = Date.now() + forceAfterMs;
    clearInterval(reloadWatch);
    reloadWatch = setInterval(tryReload, 2000);
    tryReload();
  }
  function tryReload() {
    var p = S.pendingReload; if (!p || S.reloading) return;
    var force = p.forceAt && Date.now() >= p.forceAt;
    if (!idle() && !force) return;
    S.reloading = true;
    // verify the server answers right now (never reload into a dead server without SW)
    getJSON(apiUrl('/version?probe=1'), { timeout: 4000 }).catch(function () { return getJSON(B.snapUrl('version') + '?probe=1', { timeout: 4000 }); }).then(function () {
      try { if (p.forVersion) sessionStorage.setItem('bsb-reload-for', p.forVersion); } catch (e) {}
      clearInterval(reloadWatch);
      if (hooks.beforeReload) try { hooks.beforeReload(p.why); } catch (e) {}
      location.reload();
    }, function () { S.reloading = false; });
  }
  B.syncReloadNow = tryReload;

  // ---------------- commands ----------------
  function ack(cmd, result) {
    var id = B.kioskIdentity(); if (!id.key || cmd.id == null) return;
    getJSON(apiUrl('/kiosk/ack'), { method: 'POST', body: { commandId: cmd.id, result: result || 'ok' }, headers: { 'X-Kiosk-Id': id.id, 'X-Kiosk-Key': id.key } }).catch(function () {});
  }
  var doneCmd = {};
  function runCommand(cmd) {
    if (!cmd || doneCmd[cmd.id]) return;
    doneCmd[cmd.id] = 1; S.commands.push(cmd);
    if (cmd.cmd === 'identify') { identify(); ack(cmd, 'ok'); }
    else if (cmd.cmd === 'reload') { ack(cmd, 'scheduled'); requestReload('command reload', null, 120000); }
    else if (cmd.cmd === 'clear_cache') { ack(cmd, 'ok'); clearCache().then(function () { requestReload('command clear_cache', null, 1); }); }
    else ack(cmd, 'unknown');
  }
  function identify() {
    var id = B.kioskIdentity(), el = document.createElement('div');
    el.className = 'identify';
    el.innerHTML = '<div><small>' + B.esc(B.t('kioskId')) + '</small><b>' + B.esc(id.id || '?') + '</b><span>' + B.esc((cfg.APP_BUILD || '') + ' · ' + ((B.perf && B.perf.mode) || '') +
      ' · ' + ((B.D && B.D.version) || 'no-version')) + '</span></div>';
    document.body.appendChild(el);
    setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 15000);
  }
  function clearCache() {
    var jobs = [];
    if (window.caches) jobs.push(caches.keys().then(function (ks) { return Promise.all(ks.map(function (k) { return caches.delete(k); })); }));
    if (navigator.serviceWorker && navigator.serviceWorker.getRegistrations) jobs.push(navigator.serviceWorker.getRegistrations().then(function (rs) { return Promise.all(rs.map(function (r) { return r.unregister(); })); }));
    try { Object.keys(localStorage).forEach(function (k) { if (k.indexOf('bsb-snap-') === 0) localStorage.removeItem(k); }); } catch (e) {}
    return Promise.all(jobs).catch(function () {});
  }

  // ---------------- public ----------------
  B.sync = {
    start: function (h) {
      if (S.started) return; S.started = true;
      hooks = h || {};
      S.swActive = !!(navigator.serviceWorker && navigator.serviceWorker.controller);
      pruneDataCaches();
      // a new Service Worker took over (new APP_BUILD) -> reload at the next idle moment
      if (navigator.serviceWorker) navigator.serviceWorker.addEventListener('controllerchange', function () {
        if (S.swActive) requestReload('service worker updated'); S.swActive = true;
      });
      schedule(Math.min(5000, POLL * 1000));
      // schedules (escalator hours) change with the clock: let the page re-check every 60 s
      setInterval(function () { if (hooks.onTick) hooks.onTick(); }, 60000);
    },
    pollNow: function () { schedule(0); },
    identify: identify,
    requestReload: requestReload,
    state: S,
    heartbeat: heartbeat
  };
})(window.BSB);
