/* Kiosk app — landscape 1920×1080 touch directory + wayfinding */
(function (B) {
  var cfg = window.BSB_CONFIG || {};
  var ATT_LANG = cfg.attractLang || 'en';
  var DEF_LANG = cfg.defaultLang || 'en';
  var lite = function () { return !!(B.perf && B.perf.lite); };
  var track = function (type, f) { if (B.track) B.track(type, f); };
  var playlist = null;
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var t = B.t, esc = B.esc;
  var D, router, search, map, kiosk;
  var MAP_PAD = { l: 120, r: 460, t: 160, b: 160 }; // r clears the floor switcher incl. half a map label
  var S = { stack: [], query: '', listMode: 'az', cat: null, lvl: null, bld: null, sel: null, plan: null, accessible: false, pref: 'best',
    target: null, origin: null, pickMode: null, play: 0, activeLeg: -1, kb: false };

  // ---------------- boot ----------------
  function iconize(root) {
    $$('[data-icon]', root).forEach(function (e) { if (!e.firstChild) e.innerHTML = B.icon(e.dataset.icon); });
  }
  function applyI18n() {
    $$('[data-i18n]').forEach(function (e) { e.textContent = t(e.dataset.i18n); });
    $$('[data-i18n-aria]').forEach(function (e) { e.setAttribute('aria-label', t(e.dataset.i18nAria)); });
    $$('#langBtn span').forEach(function (s) { s.classList.toggle('on', s.dataset.l === B.lang); });
  }

  function boot() { return B.loadData().then(function (d) {
    D = d;
    router = new B.Router(D, { status: B.statusData });
    search = new B.Search(D);
    var kid = B.kioskIdentity().id || cfg.DEFAULT_KIOSK;
    kiosk = D.kioskById[kid] || D.kioskById[cfg.DEFAULT_KIOSK] || D.kiosks[0];
    applyProfile(kiosk);
    var ql = new URLSearchParams(location.search).get('lang'); if (ql === 'en' || ql === 'id') B.setLang(ql); else B.setLang(DEF_LANG);
    map = new (B.MapView3D || B.MapView)($('#map'), { pad: MAP_PAD });
    window.BSB_MAP = map; window.BSB_S = S;
    map.onTenantTap = function (tn) { openDetail(tn); };
    map.onAmenityTap = function (a) { track('amenity_route', { type: a.type, src: 'map' }); S.sel = null; openRoute(amenityTarget(a)); };
    map.onFacilityTap = function (f) { toast(f.name || f.type); };
    map.onInteract = function () { stopPlay(); };
    map.onFloor = function () { renderSwitcher(); renderFloorCard(); sync3d(); };
    map.setTenantDots(true);
    map.setKiosk(kiosk);
    applyStatus(B.statusData, true);
    iconize(document); applyI18n();
    buildKeyboard(); bindUi(); renderHome(); renderSwitcher();
    return map.showFloor(kiosk.floor, { building: kiosk.building, animate: false });
  }).then(function () {
    renderFloorCard();
    // warm the SVG cache in the background (each SVG parsed exactly once) — not in lite mode (max 3 floors in DOM)
    var rest = D.floors.map(function (f) { return f.id; }).filter(function (id) { return id !== kiosk.floor; });
    if (!lite()) (function next() { var id = rest.shift(); if (id && !lite()) map._layer(id).then(function () { setTimeout(next, 60); }, function () { setTimeout(next, 60); }); })();
    initAttract();
    startSync();
    tick(); setInterval(tick, 15000);
    var qp = new URLSearchParams(location.search);
    var qFrom = qp.get('from');
    var qTo = qp.get('to') || qp.get('t');
    if (qFrom) {
      if (D.tenantById[qFrom]) S.origin = D.tenantById[qFrom];
      else if (D.kioskById[qFrom]) S.origin = D.kioskById[qFrom];
    }
    if (qTo && D.tenantById[qTo]) {
      hideAttract(true);
      if (qFrom) openRoute(D.tenantById[qTo]);
      else openDetail(D.tenantById[qTo]);
    } else if (qFrom && D.tenantById[qFrom]) {
      hideAttract(true);
      openDetail(D.tenantById[qFrom]);
    }
    if (qp.get('attract') === '0') hideAttract(true);
    window.__kioskReady = true;
  }); }
  // boot; when neither the server nor a saved snapshot is available show "Connecting…" and retry every 30 s
  var bootTry = 0;
  function bootLoop() {
    boot().then(function () { var o = $('#offlineScr'); if (o) o.parentNode.removeChild(o); }).catch(function (e) {
      if (D) { console.error(e); return; } // data loaded but UI failed -> real bug, keep it visible in the console
      bootTry++;
      var o = $('#offlineScr');
      if (!o) { document.body.insertAdjacentHTML('beforeend', '<div class="offline-scr" id="offlineScr"><b>e-Walk &amp; Pentacity</b><span id="offlineTxt"></span></div>'); o = $('#offlineScr'); }
      var n = 30;
      (function cd() { var el = $('#offlineTxt'); if (!el) return; el.textContent = t('offlineRetry', { s: n }); if (n-- > 0) setTimeout(cd, 1000); else bootLoop(); })();
    });
  }
  bootLoop();

  // kiosk profile from the snapshot (and later from the ping response)
  function applyProfile(k) {
    if (!k) return;
    if (k.attractLang === 'en' || k.attractLang === 'id') ATT_LANG = k.attractLang;
    if (k.defaultLang === 'en' || k.defaultLang === 'id') DEF_LANG = k.defaultLang;
    if (B.perf) B.perf.resolve(k.perfMode, k.clientType);
  }

  // ---------------- qr modal ----------------
  function openQrModal() {
    var r = $('#route');
    var url = (r && r.dataset.url) || phoneUrl();
    if (!url) return;
    $('#qrModalBox').innerHTML = B.qrSvg(url, { margin: 1 });
    $('#qrModalTitle').textContent = t('qrModalTitle');
    $('#qrModalSub').textContent = t('qrModalSub');
    var m = $('#qrModal');
    if (m) m.hidden = false;
  }
  function closeQrModal() {
    var m = $('#qrModal');
    if (m) m.hidden = true;
  }

  // ---------------- view stack ----------------
  function showView(name, push) {
    var cur = $('.view.is-active');
    if (push && cur && cur.dataset.view !== name) S.stack.push(cur.dataset.view);
    var nx = $('.view[data-view="' + name + '"]');
    if (cur === nx) return;
    if (cur) cur.classList.remove('is-active');
    nx.classList.add('is-active');
    if (window.gsap && !lite()) gsap.fromTo(nx, { opacity: 0, x: push === false ? -24 : 24 }, { opacity: 1, x: 0, duration: 0.32, ease: 'power2.out', clearProps: 'transform' });
    else if (window.gsap) gsap.fromTo(nx, { opacity: 0 }, { opacity: 1, duration: 0.15, ease: 'none' });
    document.body.classList.toggle('route-mode', name === 'route');
    $('#map').classList.toggle('route-mode', name === 'route');
  }
  function back() {
    S.pickMode = null;
    closeQrModal();
    var curView = $('.view.is-active') ? $('.view.is-active').dataset.view : null;
    var prev = S.stack.pop() || 'home';
    while (prev === curView && S.stack.length > 0) {
      prev = S.stack.pop();
    }
    if (!prev || prev === curView) prev = 'home';
    if (curView === 'route') { stopPlay(); clearRoute(); }
    if (prev === 'home') { S.stack = []; }
    showView(prev, false);
    if (prev === 'detail' && S.sel) focusTenant(S.sel);
    if (prev === 'home' || prev === 'list') { map.setDest(null); map.setOrigin(null); }
  }

  // ---------------- home ----------------
  function renderHome() {
    $('#catGrid').innerHTML = D.categories.map(function (c) {
      var col = B.catColor(c.id);
      return '<button class="cat" type="button" data-cat="' + c.id + '"><span class="cat-ic" style="background:' + col + '1A;color:' + col + '">' + B.icon(c.icon) + '</span>' +
        '<span><div class="cat-n">' + esc(B.catName(c)) + '</div><div class="cat-c">' + c.count + ' ' + t('stores') + '</div></span></button>';
    }).join('');
    $('#azCount').textContent = D.tenants.length;
    var am = [
      { type: 'lift', icon: 'move-vertical', label: t('lift') },
      { type: 'escalator', icon: 'arrow-up-down', label: t('escalator') },
      { type: 'crossing', icon: 'waypoints', label: t('crossing') }
    ];
    // + POI types flagged home:true in the CMS that have at least one published POI (max 6 buttons in total)
    var hasPoi = {};
    D.amenities.forEach(function (a) { if (a.kind === 'poi') hasPoi[a.type] = true; });
    (D.amenityTypes || []).slice().sort(function (a, b) { return (a.sort || 0) - (b.sort || 0); }).forEach(function (at) {
      if (at.home && hasPoi[at.id] && am.length < 6) am.push({ type: at.id, icon: at.icon || 'info', label: B.amenityTypeName(at.id), poi: true });
    });
    $('#amenRow').classList.toggle('many', am.length > 3);
    $('#amenRow').innerHTML = am.map(function (a) {
      return '<button class="amen-btn" type="button" data-amen="' + esc(a.type) + '"><span class="ai' + (a.poi ? ' poi' : '') + '">' + B.icon(a.icon) + '</span>' + esc(a.label) + '<small>' + t('nearest') + '</small></button>';
    }).join('');
  }

  // ---------------- list ----------------
  function openList(mode, opts, push) {
    S.listMode = mode; opts = opts || {};
    if (mode === 'cat') S.cat = opts.cat;
    if (opts.reset !== false) { S.lvl = null; S.bld = null; }
    renderList();
    showView('list', push !== false);
  }
  function currentItems() {
    var items;
    if (S.listMode === 'search' && S.query.trim()) items = search.query(S.query);
    else {
      items = D.tenants.slice().sort(function (a, b) { return a.name.localeCompare(b.name); });
      if (S.listMode === 'cat') items = items.filter(function (x) { return x.category === S.cat; });
    }
    return items;
  }
  function renderList() {
    var all = currentItems();
    var items = all.filter(function (x) {
      return (S.lvl == null || D.floorById[x.floor].level === S.lvl) && (!S.bld || x.building === S.bld);
    });
    var title = S.pickMode === 'origin' ? t('selectStartStore') : S.pickMode === 'dest' ? t('selectDestStore') : S.listMode === 'cat' ? B.catName(D.catById[S.cat]) : S.listMode === 'search' && S.query.trim() ? '“' + S.query.trim() + '”' : t('allTenants');
    $('#listTitle').textContent = title;
    $('#listSub').textContent = items.length + ' ' + t(S.listMode === 'search' && S.query.trim() ? 'results' : 'stores');
    // filters
    var f = '<button class="chip' + (S.lvl == null ? ' on' : '') + '" data-lvl="">' + t('allFloors') + '</button>';
    D.levels.slice().reverse().forEach(function (L) {
      f += '<button class="chip' + (S.lvl === L.level ? ' on' : '') + '" data-lvl="' + L.level + '">' + L.short + '</button>';
    });
    f += '<span class="chip-sep"></span>';
    ['pentacity', 'ewalk'].forEach(function (b) { f += '<button class="chip' + (S.bld === b ? ' on' : '') + '" data-bld="' + b + '">' + B.buildingName(b) + '</button>'; });
    $('#filters').innerHTML = f;
    var html = '', letter = '';
    var showLetters = S.listMode !== 'search' || !S.query.trim();
    items.forEach(function (x) {
      if (showLetters) {
        var L = /[a-z]/i.test(x.name[0]) ? x.name[0].toUpperCase() : '#';
        if (L !== letter) { letter = L; html += '<div class="letter">' + L + '</div>'; }
      }
      html += rowHtml(x);
    });
    if (S.pickMode === 'origin' && (!S.query.trim() || kiosk.name.toLowerCase().indexOf(S.query.trim().toLowerCase()) >= 0)) {
      html = '<button class="row row-kiosk-origin" type="button" data-pick-kiosk="1">' +
        '<span class="logo-box kiosk-box">' + B.icon('map-pin') + '</span>' +
        '<span class="row-main"><div class="row-n">' + esc(t('currentKiosk')) + ' (' + esc(kiosk.name) + ')</div><div class="row-s">' + esc(t('currentKioskSub')) + '</div></span>' +
        '<span class="fbadge here">' + D.floorById[kiosk.floor].short + '</span></button>' + html;
    }
    if (!items.length && S.pickMode !== 'origin') html = '<div class="empty">' + esc(t('noResults')) + '</div>';
    var list = $('#list'); list.innerHTML = html; list.scrollTop = 0;
  }
  function logoHtml(x, cls) {
    return '<span class="logo-box ' + (cls || '') + '">' + (x.logo ? '<img src="' + esc(B.ROOT + x.logo) + '" alt="" loading="lazy" decoding="async">' : '<span class="ini">' + esc(B.initials(x.name)) + '</span>') + '</span>';
  }
  function rowHtml(x) {
    var f = D.floorById[x.floor], c = D.catById[x.category];
    return '<button class="row' + (x.status === 'temp_closed' ? ' dim' : '') + '" type="button" data-t="' + x.id + '">' + logoHtml(x) +
      '<span class="row-main"><div class="row-n">' + esc(x.name) + statusBadge(x) + '</div><div class="row-s"><i class="cdot" style="background:' + B.catColor(x.category) + '"></i>' + esc(B.catName(c)) + ' · ' + B.buildingName(x.building) + '</div></span>' +
      '<span class="fbadge' + (x.floor === kiosk.floor ? ' here' : '') + '">' + f.short + '</span></button>';
  }

  function statusBadge(x) {
    if (x.status === 'temp_closed') return '<span class="st-badge">' + esc(t('tempClosed')) + '</span>';
    if (x.status === 'coming_soon') return '<span class="st-badge soon">' + esc(t('comingSoon')) + '</span>';
    return '';
  }
  // "Open today 10:00–22:00" from hoursWeek (mall local time); null when unknown
  function todayHours(x) {
    if (!x.hoursWeek) return null;
    var iv = x.hoursWeek[String(B.mallNow().dow)] || [];
    if (!iv.length) return t('closedToday');
    return t('openToday') + ' ' + iv.map(function (p) { return p[0] + '–' + p[1]; }).join(', ');
  }
  function txt(o) { return !o ? '' : typeof o === 'string' ? o : (o[B.lang] || o.en || o.id || ''); }

  // ---------------- detail ----------------
  function openDetail(x) {
    stopPlay(); clearRoute();
    var isNew = S.sel !== x || $('.view.is-active').dataset.view !== 'detail';
    S.sel = x; closeKb();
    var c = D.catById[x.category], f = D.floorById[x.floor], col = B.catColor(x.category);
    var hrs = todayHours(x) || x.hours;
    var desc = (B.lang === 'id' ? (x.descId || x.descEn) : (x.descEn || x.descId)) || x.desc;
    if (isNew) track('tenant_view', { t: x.id }); // not again when only the language is switched
    var h = '<div class="d-card"><div class="d-top">' + logoHtml(x, 'd-logo') + '<div><div class="d-name">' + esc(B.tidy(x.name)) + '</div>' +
      '<span class="d-cat" style="background:' + col + '1A;color:' + col + '">' + B.icon(c.icon) + esc(B.catName(c)) + '</span>' +
      (statusBadge(x) ? '<div class="d-status">' + statusBadge(x) + esc(txt(x.statusNote)) + '</div>' : '') + '</div></div>' +
      '<div class="d-facts">' +
      fact(t('floor'), B.icon('layers') + esc(B.floorLong(f).replace(/\s·\s.*/, ''))) +
      fact(t('building'), B.icon('building-2') + esc(B.buildingName(x.building))) +
      (x.phone ? fact(t('call'), B.icon('phone') + esc(B.fmtPhone(x.phone))) : '') +
      (hrs ? fact(t('hours'), B.icon('clock') + esc(hrs)) : '') +
      '</div>' +
      (desc ? '<p class="d-desc">' + esc(desc) + '</p>' : '') +
      (x.url ? '<div class="d-web">' + B.qrSvg(x.url, { margin: 1 }) + '<div><div class="d-web-t">' + t('scanWeb') + '</div><div class="d-web-u">' + esc(x.url.replace(/^https:\/\/(www\.)?/, '').replace(/\/$/, '')) + '</div></div></div>' : '') +
      '</div>';
    h = '<div class="d-scroll">' + h + '</div><div class="d-foot">' + transitPrefHtml() +
      '<div class="d-actions">' +
      '<button class="btn btn-primary" type="button" id="goRoute">' + B.icon('navigation') + t('showRoute') + '</button>' +
      '<button class="btn btn-ghost" type="button" id="setStart">' + B.icon('circle-dot') + t('startFromHere') + '</button>' +
      '</div></div>';
    $('#detail').innerHTML = h;
    $('#detailCrumb').textContent = B.catName(c);
    var active = $('.view.is-active').dataset.view;
    showView('detail', active !== 'detail');
    focusTenant(x);
  }
  function fact(k, v) { return '<div class="fact"><div class="fact-k">' + esc(k) + '</div><div class="fact-v">' + v + '</div></div>'; }
  function transitPrefHtml() {
    var p = S.pref || 'best';
    return '<div class="r-transit-pref" role="radiogroup" aria-label="' + esc(t('prefTitle')) + '">' +
      '<button type="button" class="tp-btn' + (p === 'best' ? ' on' : '') + '" data-pref="best" title="' + esc(t('prefBestSub')) + '">' +
        '<span class="tp-ic">' + B.icon('sparkles') + '</span>' +
        '<span class="tp-txt"><span class="tp-lb">' + esc(t('prefBest')) + '</span><span class="tp-sub">' + esc(t('prefBestSub')) + '</span></span>' +
      '</button>' +
      '<button type="button" class="tp-btn' + (p === 'lift' ? ' on' : '') + '" data-pref="lift" title="' + esc(t('prefLiftSub')) + '">' +
        '<span class="tp-ic">' + B.icon('move-vertical') + '</span>' +
        '<span class="tp-txt"><span class="tp-lb">' + esc(t('prefLift')) + '</span><span class="tp-sub">' + esc(t('prefLiftSub')) + '</span></span>' +
      '</button>' +
      '<button type="button" class="tp-btn' + (p === 'accessible' ? ' on' : '') + '" data-pref="accessible" title="' + esc(t('prefAccSub')) + '">' +
        '<span class="tp-ic">' + B.icon('accessibility') + '</span>' +
        '<span class="tp-txt"><span class="tp-lb">' + esc(t('prefAcc')) + '</span><span class="tp-sub">' + esc(t('prefAccSub')) + '</span></span>' +
      '</button>' +
    '</div>';
  }
  function accToggle() {
    return transitPrefHtml();
  }
  function focusTenant(x) {
    var f = D.floorById[x.floor];
    var cur = map.floor ? D.floorById[map.floor].level : 0;
    var u = 1 / ((f.unitScale || 1) * cfg.metersPerUnit), half = 30 * u;
    var pts = [{ x: x.x, y: x.y }];
    if (kiosk.floor === x.floor) pts.push({ x: kiosk.x, y: kiosk.y });
    var box = bbox(pts, half);
    map.setConnectors([]);
    var tok = S.play;
    map.showFloor(x.floor, { box: box, dir: f.level >= cur ? 'up' : 'down', duration: 1 }).then(function () {
      if (tok !== S.play || S.sel !== x) return;
      map.setDest(x, { bounce: true });
    });
  }
  function bbox(pts, minHalf) {
    var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    pts.forEach(function (p) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); });
    var cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    var w = Math.max(x1 - x0, minHalf * 2) * 1.12, h = Math.max(y1 - y0, minHalf * 1.2) * 1.16;
    return [cx - w / 2, cy - h / 2, w, h];
  }

  // ---------------- route ----------------
  function openRoute(target, orig) {
    if (orig !== undefined) S.origin = orig;
    S.target = target;
    var src = S.origin || kiosk;
    var isAcc = S.pref === 'accessible' || S.accessible;
    S.plan = router.plan(src.node, target.node, { tenant: target, origin: src, pref: S.pref, accessible: isAcc });
    if (S.plan.ok) track('route', { t: target.id, from: src.id, a: isAcc ? 1 : 0, pref: S.pref, ok: 1, cost: Math.round(S.plan.cost * 10) / 10 });
    else track('route_fail', { t: target.id, from: src.id, a: isAcc ? 1 : 0, pref: S.pref, reason: S.plan.reason || 'noroute' });
    map.setOrigin(S.origin);
    renderRoute();
    if (S.plan.ok) track('qr_shown', { t: target.id });
    var active = $('.view.is-active').dataset.view;
    showView('route', active !== 'route');
    if (S.plan.ok) playRoute(); else { clearRoute(); focusTenantMaybe(target); }
  }
  function focusTenantMaybe(x) { if (x.floor) focusTenant(x); }
  function phoneUrl() {
    var sid = B.tele && B.tele.sid;
    var fromParam = (S.origin && S.origin.id !== kiosk.id) ? ('&from=' + encodeURIComponent(S.origin.id)) : '';
    var isAcc = S.pref === 'accessible' || S.accessible;
    return B.publicBase() + '/m/?k=' + encodeURIComponent(kiosk.id) + '&t=' + encodeURIComponent(S.target.id) + fromParam + '&pref=' + encodeURIComponent(S.pref || 'best') + '&a=' + (isAcc ? 1 : 0) + '&lang=' + B.lang + (sid ? '&s=' + sid : '');
  }
  function formatStepText(text, lm) {
    var s = esc(B.tidy(text));
    if (lm && lm.name) {
      var escLm = esc(lm.name);
      var reg = new RegExp('(' + escLm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'gi');
      s = s.replace(reg, '<span class="step-lm">📍 $1</span>');
    }
    return s;
  }
  function stepIconName(s) {
    if (s.kind === 'arrive') return 'map-pin';
    if (s.kind === 'to-transition') return 'navigation';
    if (s.kind === 'stairs') return s.dir === 'down' ? 'arrow-down' : 'arrow-up';
    if (s.kind === 'road') return 'footprints';
    if (s.kind === 'turn') {
      if (s.turn < -30) return 'corner-up-left';
      if (s.turn > 30) return 'corner-up-right';
      return 'arrow-up';
    }
    return 'arrow-up';
  }
  function legTarget(leg, li, plan) {
    if (leg.transition) {
      var tr = leg.transition;
      if (tr.type === 'crossing') return B.lang === 'en' ? 'the link bridge' : 'jembatan penghubung';
      if (tr.type === 'lift') return B.lang === 'en' ? 'the lift' : 'lift';
      return tr.amenity ? B.amenityName(tr.amenity).replace(/ · .*$/, '') : t('escalator');
    }
    return plan.tenant ? plan.tenant.name : t('destination');
  }
  function legTitle(leg, li, plan) {
    var f = D.floorById[leg.floor];
    return '<b>' + esc(B.floorLabel(f)) + '</b> — ' + t('legWalk') + ' ' + t('approx') + B.roundM(leg.meters) + '\u00A0m ' + t('toward') + ' ' + esc(B.tidy(legTarget(leg, li, plan)));
  }
  function renderRoute() {
    var P = S.plan, x = S.target, h = '';
    var f = D.floorById[x.floor];
    var sub = x.category ? B.catName(D.catById[x.category]) : t('amenities');
    var orig = S.origin || kiosk;
    var origFloor = D.floorById[orig.floor];
    var isCustom = !!S.origin && S.origin.id !== kiosk.id;

    $('#routeSub').textContent = isCustom ? (t('from') + ' ' + orig.name + ' → ' + x.name) : (t('fromKiosk') + ' ' + kiosk.name);

    h += '<div class="r-trip-card">' +
      '<div class="r-trip-row origin">' +
        '<div class="r-trip-bullet origin-bullet"></div>' +
        '<div class="r-trip-info" data-pick="origin">' +
          '<div class="r-trip-head">' +
            '<span class="r-trip-tag origin-tag">' + t('from') + '</span>' +
            (isCustom ? '<button type="button" class="r-trip-reset" id="resetOrigin" title="' + t('resetToKiosk') + '">' + B.icon('rotate-ccw') + t('resetToKiosk') + '</button>' : '<span class="r-trip-badge">' + t('youAreHere') + '</span>') +
          '</div>' +
          '<div class="r-trip-name">' + esc(B.tidy(orig.name)) + ' <span class="r-trip-edit">' + B.icon('pencil') + '</span></div>' +
          '<div class="r-trip-sub">' + esc(B.floorLong(origFloor)) + '</div>' +
        '</div>' +
      '</div>' +
      '<div class="r-trip-middle">' +
        '<div class="r-trip-line"></div>' +
        '<button type="button" class="r-trip-swap" id="swapRoute" title="' + t('swapRoute') + '">' + B.icon('arrow-up-down') + '</button>' +
      '</div>' +
      '<div class="r-trip-row dest">' +
        '<div class="r-trip-bullet dest-bullet"></div>' +
        '<div class="r-trip-info" data-pick="dest">' +
          '<div class="r-trip-head">' +
            '<span class="r-trip-tag dest-tag">' + t('to') + '</span>' +
          '</div>' +
          '<div class="r-trip-name">' + esc(B.tidy(x.name)) + ' <span class="r-trip-edit">' + B.icon('pencil') + '</span></div>' +
          '<div class="r-trip-sub">' + esc(B.floorLong(f)) + ' · ' + esc(sub) + '</div>' +
        '</div>' +
      '</div>' +
    '</div>';

    h += transitPrefHtml();

    if (P && P.fallbackEscalator) {
      h += '<div class="r-transit-notice">' + B.icon('info') + '<span>' + esc(t('liftFallbackNotice')) + '</span></div>';
    }

    if (!P.ok) {
      var msg = S.accessible ? t('noRouteAcc') : t('noRoute');
      if (P.reason === 'closed' && P.closed && P.closed.length) msg = t('routeClosed', closedVars(P.closed));
      h += '<div class="r-err">' + esc(msg) + '</div>';
      h += '<div class="r-bottom" style="grid-template-columns:1fr"><div class="r-actions"><button class="btn btn-ghost" type="button" id="replay">' + B.icon('rotate-ccw') + t('replay') + '</button></div></div>';
      $('#route').innerHTML = h; return;
    }
    var floors = P.legs.filter(function (l) { return l.transition; }).length;
    h += '<div class="r-stats">' +
      '<div class="stat"><div class="stat-k">' + t('distance') + '</div><div class="stat-v">' + t('approx') + B.roundM(P.meters) + '<small>m</small></div></div>' +
      '<div class="stat"><div class="stat-k">' + t('time') + '</div><div class="stat-v">' + Math.max(1, Math.round(P.seconds / 60)) + '<small>' + t('minutes') + '</small></div></div>' +
      '<div class="stat"><div class="stat-k">' + t('floor') + '</div><div class="stat-v">' + esc(B.floorLabel(D.floorById[P.legs[0].floor]).replace(/\s·\s.*/, '')) + ' → ' + esc(f.short) + '</div>' +
      (viaFloors(P).length ? '<div class="stat-via">' + esc(t('via')) + ' ' + esc(viaFloors(P).join(' · ')) + '</div>' : '') + '</div></div>';
    if (P.detour && P.detour.length) h += '<div class="r-detour">' + B.icon('wrench') + '<span>' + esc(t('routeDetour', closedVars(P.detour))) + '</span></div>';
    var multi = P.legs.length > 1;
    $('#route').classList.toggle('compact', multi);
    // multi-floor: every leg header stays visible; only the active leg shows its step bullets
    h += '<div class="legs' + (multi ? ' multi' : '') + '" id="legs">';
    var n = 0;
    P.legs.forEach(function (leg, i) {
      n++;
      var lf = D.floorById[leg.floor];
      var steps = leg.steps.filter(function (s) { return s.kind !== 'transition'; });
      var legTg = legTarget(leg, i, P);

      h += '<button class="leg" type="button" data-leg="' + i + '">' +
        '<div class="leg-top">' +
          '<span class="leg-n">' + n + '</span>' +
          '<div class="leg-hdr">' +
            '<div class="leg-fl-row">' +
              '<span class="leg-fl-badge">' + esc(B.floorLabel(lf)) + '</span>' +
              '<span class="leg-dist-badge">' + t('approx') + B.roundM(leg.meters) + ' m</span>' +
            '</div>' +
            '<div class="leg-t">' + t('legWalk') + ' ' + t('toward') + ' <b>' + esc(B.tidy(legTg)) + '</b></div>' +
          '</div>' +
        '</div>' +
        '<div class="leg-s">' +
          '<div class="step-list">' +
            steps.map(function (s) {
              var ic = stepIconName(s);
              return '<div class="step-row' + (s.kind === 'arrive' ? ' is-arrive' : '') + '">' +
                '<span class="step-ic-box">' + B.icon(ic) + '</span>' +
                '<div class="step-body">' +
                  '<div class="step-txt">' + formatStepText(s.text, s.landmark) + '</div>' +
                '</div>' +
              '</div>';
            }).join('') +
          '</div>' +
        '</div>' +
      '</button>';

      if (leg.transition) {
        // one row per floor hop: a chained ride (GF→UG→1F→2F on stacked escalators) never hides a floor
        leg.transition.hops.forEach(function (hp, hi) {
          var ic = hp.type === 'lift' ? 'move-vertical' : hp.type === 'crossing' ? 'waypoints' : (hp.dir === 'down' ? 'arrow-down' : 'arrow-up');
          var fromF = hp.fromFloor ? D.floorById[hp.fromFloor] : null;
          var toF = hp.toFloor ? D.floorById[hp.toFloor] : null;
          h += '<button class="leg tr' + (hi ? ' cont' : '') + '" type="button" data-tr="' + i + '" data-hop="' + hi + '">' +
            '<span class="leg-n tr-n">' + B.icon(ic) + '</span>' +
            '<div class="leg-hdr">' +
              '<div class="leg-t tr-t">' + esc(B.tidy(hp.text)) + '</div>' +
              (fromF && toF ? '<div class="tr-badge-row"><span class="tr-badge">' + esc(fromF.short) + ' → ' + esc(toF.short) + '</span></div>' : '') +
            '</div>' +
          '</button>';
        });
      }
    });
    h += '</div>' + (multi ? '' : '<div class="r-note">' + t('estNote') + '</div>');
    var url = phoneUrl();
    var host = ''; try { host = new URL(url).hostname; } catch (e) {}
    var warn = cfg.devMode && /^(localhost|127\.|::1|\[::1\])/.test(host);
    h += '<div class="r-bottom">' +
      '<div class="r-bottom-actions">' +
        '<button class="btn btn-ghost" type="button" id="replay">' + B.icon('rotate-ccw') + '<span>' + t('replay') + '</span></button>' +
        (multi ? '<div class="r-note">' + t('estNote') + '</div>' : '') +
      '</div>' +
      '<div class="qr-card">' +
        '<div class="qr-box">' + B.qrSvg(url, { margin: 1 }) + '</div>' +
        '<div class="qr-meta">' +
          '<div class="qr-t">' + B.icon('smartphone') + '<span>' + t('continuePhone') + '</span></div>' +
          '<div class="qr-s">' + t('continuePhoneSub') + '</div>' +
        '</div>' +
      '</div>' +
      (warn ? '<div class="dev-warn">' + esc(t('devWarnBase')) + '</div>' : '') +
    '</div>';
    $('#route').innerHTML = h;
    $('#route').dataset.url = url;
  }

  // floors passed between start and destination (incl. those only ridden through on an escalator/lift chain)
  function viaFloors(P) {
    var out = [], first = P.legs[0].floor, last = P.legs[P.legs.length - 1].floor;
    P.legs.forEach(function (l) {
      [l.floor].concat((l.transition && l.transition.via) || []).forEach(function (id) {
        var sh = D.floorById[id].short;
        if (id !== first && id !== last && out.indexOf(sh) < 0) out.push(sh);
      });
    });
    return out;
  }
  function closedVars(list) {
    var c = list[0], more = list.length > 1 ? ' (+' + (list.length - 1) + ')' : '';
    return { x: B.tidy(c.label) + more, r: c.reason ? ' (' + c.reason + ')' : '' };
  }
  function sleep(ms, tok) { return new Promise(function (r) { setTimeout(function () { r(tok === S.play); }, ms); }); }
  function stopPlay() { S.play++; }
  function clearRoute() {
    map.setRoute(null); map.setConnectors([]); $('#caption').hidden = true; S.activeLeg = -1;
    renderSwitcher();
  }
  function legBox(leg, i, P) {
    var pts = leg.pts.slice();
    var f = D.floorById[leg.floor], u = 1 / ((f.unitScale || 1) * cfg.metersPerUnit);
    return bbox(pts, 35 * u);
  }
  function setActive(i, transition, hop) {
    S.activeLeg = i; hop = hop || 0;
    $$('#legs .leg').forEach(function (b) {
      var li = b.dataset.leg != null ? +b.dataset.leg : +b.dataset.tr;
      var isTr = b.dataset.tr != null, bh = +(b.dataset.hop || 0);
      b.classList.toggle('on', transition ? (isTr && li === i && bh === hop) : (!isTr && li === i));
      b.classList.toggle('done', transition ? li < i || (!isTr && li === i) || (isTr && li === i && bh < hop) : li < i);
    });
    var on = $('#legs .leg.on');
    if (on) { var box = $('#legs'); var top = on.offsetTop - 10; if (top < box.scrollTop || top + on.offsetHeight > box.scrollTop + box.clientHeight) box.scrollTo({ top: top, behavior: 'smooth' }); }
  }
  function caption(stepTxt, txt) {
    var c = $('#caption'); $('#capStep').textContent = stepTxt; $('#capTxt').textContent = B.tidy(txt); c.hidden = false;
    if (window.gsap) gsap.fromTo(c, lite() ? { opacity: 0 } : { y: 20, opacity: 0 }, lite() ? { opacity: 1, duration: 0.15 } : { y: 0, opacity: 1, duration: 0.4, ease: 'power2.out' });
  }
  function connectorsFor(leg) {
    if (!leg.transition) return [];
    var L = leg.pts[leg.pts.length - 1], tr = leg.transition, h0 = tr.hops[0];
    return [{ floor: leg.floor, x: L.x, y: L.y, label: h0.short, dir: h0.dir, kind: h0.type }];
  }
  // intermediate floor of a chained ride: show that floor with the stop marker (no walking there)
  function showHop(i, h) {
    var leg = S.plan.legs[i], hp = leg.transition.hops[h], f = D.floorById[hp.fromFloor];
    var cur = map.floor ? D.floorById[map.floor].level : 0, u = 1 / ((f.unitScale || 1) * cfg.metersPerUnit);
    setActive(i, true, h);
    caption(t('step') + ' ' + (i + 1) + ' ' + t('of') + ' ' + S.plan.legs.length, hp.text);
    return map.showFloor(hp.fromFloor, { box: bbox([{ x: hp.x, y: hp.y }], 30 * u), dir: f.level >= cur ? 'up' : 'down', duration: lite() ? 0.2 : 0.8 }).then(function () {
      map.setConnectors([{ floor: hp.fromFloor, x: hp.x, y: hp.y, label: hp.short, dir: hp.dir, kind: hp.type }]);
      renderSwitcher();
    });
  }
  function showLeg(i, animate) {
    var P = S.plan, leg = P.legs[i], cur = map.floor ? D.floorById[map.floor].level : 0, f = D.floorById[leg.floor];
    setActive(i);
    caption(t('step') + ' ' + (i + 1) + ' ' + t('of') + ' ' + P.legs.length, stripTags(legTitle(leg, i, P)));
    return map.showFloor(leg.floor, { box: legBox(leg, i, P), dir: f.level >= cur ? 'up' : 'down', duration: lite() ? 0.2 : 1.1 }).then(function () {
      map.setConnectors(connectorsFor(leg));
      renderSwitcher();
      return map.setRoute(leg.floor, leg.pts, { animate: animate, startMarker: i > 0, duration: Math.max(1.3, Math.min(3.2, leg.meters / 45)) });
    });
  }
  function stripTags(s) { var d = document.createElement('div'); d.innerHTML = s; return d.textContent; }
  function playRoute() {
    var tok = ++S.play, P = S.plan;
    map.setDest(S.target, { noLabel: false });
    var i = 0;
    (function step() {
      if (tok !== S.play) return;
      showLeg(i, true).then(function () {
        if (tok !== S.play) return;
        var leg = P.legs[i];
        if (i === P.legs.length - 1) { map.bounceDest(); setActive(P.legs.length); markAllDone(); return; }
        return sleep(lite() ? 400 : 700, tok).then(function (ok) {
          if (!ok || tok !== S.play) return;
          var hops = (leg.transition && leg.transition.hops) || [];
          if (!hops.length) { i++; step(); return; }
          var h = 0;
          setActive(i, true, 0);
          caption(t('step') + ' ' + (i + 1) + ' ' + t('of') + ' ' + P.legs.length, hops[0].text);
          (function nextHop() { // dwell on every floor of a chained ride before moving on
            sleep(lite() ? 1000 : 1300, tok).then(function (ok2) {
              if (!ok2 || tok !== S.play) return;
              if (++h < hops.length) {
                showHop(i, h).then(function () { if (tok === S.play) nextHop(); }).catch(function () { if (tok === S.play) { i++; step(); } });
              } else { i++; step(); }
            });
          })();
        });
      }).catch(function (err) {
        if (tok === S.play && i < P.legs.length - 1) { i++; step(); }
      });
    })();
  }
  function markAllDone() {
    $$('#legs .leg').forEach(function (b) { b.classList.remove('on'); b.classList.add('done'); });
    var lg = $('#legs'); if (lg) lg.scrollTo({ top: 0, behavior: 'smooth' });
    var P = S.plan;
    caption(t('destination'), S.target.name + ' — ' + t('approx') + B.roundM(P.meters) + ' m · ' + Math.max(1, Math.round(P.seconds / 60)) + ' ' + t('minutes'));
  }

  // ---------------- floor switcher & card ----------------
  function renderSwitcher() {
    if (!D) return;
    var routeFloors = {};
    if (S.plan && S.plan.ok && $('.view.is-active') && $('.view.is-active').dataset.view === 'route') S.plan.legs.forEach(function (l) { routeFloors[l.floor] = 1; ((l.transition && l.transition.via) || []).forEach(function (v) { routeFloors[v] = 1; }); });
    var h = '';
    D.levels.forEach(function (L) {
      h += '<div class="fs-row"><span class="fs-lvl">' + L.short + '</span>';
      L.floors.forEach(function (f) {
        var lbl = f.building === 'both' ? 'Pentacity · E-Walk' : B.buildingName(f.building);
        h += '<button class="fs-btn' + (f.building === 'both' ? ' wide' : '') + (map && map.floor === f.id ? ' on' : '') + (routeFloors[f.id] ? ' route' : '') + (kiosk && kiosk.floor === f.id ? ' here' : '') +
          '" type="button" data-floor="' + f.id + '" style="' + (f.building === 'both' ? '' : 'min-width:104px') + '">' + esc(lbl) + '</button>';
      });
      h += '</div>';
    });
    h += '<div class="fs-legend"><span><i style="background:var(--gold)"></i>' + t('youAreHere') + '</span>' + (Object.keys(routeFloors).length ? '<span><i style="background:var(--accent)"></i>' + t('route') + '</span>' : '') + '</div>';
    $('#floorSwitch').innerHTML = h;
  }
  function renderFloorCard() {
    if (!map.floor) return;
    var f = D.floorById[map.floor];
    $('#fcK').textContent = t('floor') + (f.building !== 'both' ? ' · ' + B.buildingName(f.building) : ' · ' + t('both'));
    $('#fcN').innerHTML = '<span class="lvl">' + f.short + '</span>' + esc(B.floorLong(f).replace(/\s·\s.*/, ''));
  }
  function goFloor(id) {
    stopPlay();
    track('floor_switch', { floor: id });
    var f = D.floorById[id], cur = D.floorById[map.floor].level;
    var inRoute = $('.view.is-active').dataset.view === 'route' && S.plan && S.plan.ok;
    if (inRoute) {
      var li = -1, hv = null; S.plan.legs.forEach(function (l, i) {
        if (l.floor === id) li = i;
        if (l.transition) l.transition.hops.forEach(function (hp, k) { if (k > 0 && hp.fromFloor === id) hv = [i, k]; });
      });
      if (li >= 0) { showLeg(li, false); return; }
      if (hv) { showHop(hv[0], hv[1]); return; }
    }
    map.showFloor(id, { building: f.building === 'both' ? null : f.building, dir: f.level >= cur ? 'up' : 'down' });
  }

  // ---------------- keyboard ----------------
  var ROWS = [['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'], ['Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P'],
    ['A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L', '&'], ['Z', 'X', 'C', 'V', 'B', 'N', 'M', '-', 'BKSP']];
  var QUICK = { id: ['Makan', 'Kopi', 'Fashion', 'Sepatu', 'Bioskop', 'Salon', 'Anak', 'Gadget', 'Supermarket', 'Optik'],
    en: ['Food', 'Coffee', 'Fashion', 'Shoes', 'Cinema', 'Salon', 'Kids', 'Gadget', 'Supermarket', 'Optic'] };
  function buildKeyboard() {
    var h = ROWS.map(function (r) {
      return '<div class="krow">' + r.map(function (k) {
        if (k === 'BKSP') return '<button class="key wide dark" data-k="BKSP" type="button">' + B.icon('delete') + '</button>';
        return '<button class="key" data-k="' + k + '" type="button">' + k + '</button>';
      }).join('') + '</div>';
    }).join('');
    h += '<div class="krow"><button class="key wide dark" data-k="CLR" type="button" data-i18n="clear">' + t('clear') + '</button>' +
      '<button class="key space" data-k=" " type="button" data-i18n="space">' + t('space') + '</button>' +
      '<button class="key done" data-k="DONE" type="button" data-i18n="keyboardDone">' + t('keyboardDone') + '</button></div>';
    $('#oskKeys').innerHTML = h;
    renderQuick();
  }
  function renderQuick() {
    $('#oskQuick').innerHTML = '<span class="ql">' + t('quick') + '</span>' + QUICK[B.lang].map(function (q) { return '<button class="chip" type="button" data-q="' + q + '">' + q + '</button>'; }).join('');
  }
  function openKb() {
    S.kb = true; $('#osk').classList.add('open'); $('#searchBox').classList.add('focus'); $('#panel').classList.add('kb-open');
    if (S.listMode !== 'search' || $('.view.is-active').dataset.view !== 'list') openList('search', {}, $('.view.is-active').dataset.view !== 'list');
    $('#list').style.paddingBottom = ($('#osk').offsetHeight + 20) + 'px';
  }
  function closeKb() {
    S.kb = false; $('#osk').classList.remove('open'); $('#searchBox').classList.remove('focus'); $('#panel').classList.remove('kb-open');
    $('#list').style.paddingBottom = '';
  }
  // typing on a physical keyboard: the search opens without the on-screen keyboard (touch still opens that one)
  function typeStart() {
    if (!$('#attract').classList.contains('off')) hideAttract();
    if (S.listMode !== 'search' || $('.view.is-active').dataset.view !== 'list') openList('search', {}, $('.view.is-active').dataset.view !== 'list');
    $('#searchBox').classList.add('focus');
  }
  var searchT = 0;
  function setQuery(q) {
    S.query = q;
    clearTimeout(searchT);
    if (q && q.trim().length >= 2) searchT = setTimeout(function () { track('search', { q: q.trim().toLowerCase().slice(0, 60), n: search.query(q).length }); }, 1500);
    $('#searchQ').textContent = q;
    $('#searchClear').hidden = !q;
    S.listMode = 'search';
    if ($('.view.is-active').dataset.view !== 'list') showView('list', true);
    renderList();
    $('#list').style.paddingBottom = S.kb ? ($('#osk').offsetHeight + 20) + 'px' : '';
  }

  // ---------------- UI events ----------------
  function bindUi() {
    document.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    document.addEventListener('gesturestart', function (e) { e.preventDefault(); });
    document.addEventListener('wheel', function (e) { if (e.ctrlKey) e.preventDefault(); }, { passive: false });
    document.addEventListener('dblclick', function (e) { e.preventDefault(); });

    $('#searchBox').addEventListener('click', function (e) {
      if (e.target.closest('#searchClear')) { setQuery(''); return; }
      openKb();
    });
    $('#osk').addEventListener('pointerdown', function (e) {
      var k = e.target.closest('.key'); if (!k) return;
      e.preventDefault();
      k.classList.add('press'); setTimeout(function () { k.classList.remove('press'); }, 120);
      var v = k.dataset.k;
      if (v === 'BKSP') setQuery(S.query.slice(0, -1));
      else if (v === 'CLR') setQuery('');
      else if (v === 'DONE') closeKb();
      else if (S.query.length < 30) setQuery((S.query + (S.query ? v.toLowerCase() : v)).replace(/^ +/, ''));
    });
    $('#oskQuick').addEventListener('click', function (e) { var c = e.target.closest('[data-q]'); if (c) setQuery(c.dataset.q); });
    // physical keyboard: any character starts / continues the search; Backspace deletes, Esc clears (then goes back),
    // ↓ ↑ move through the results and Enter opens the chosen one (or the first)
    document.addEventListener('keydown', function (e) {
      if (e.ctrlKey || e.metaKey || e.altKey || e.isComposing) return;
      if (e.target.closest && e.target.closest('input,textarea,select,[contenteditable]')) return;
      if (!$('#qrModal').hidden) { if (e.key === 'Escape') closeQrModal(); return; }
      var k = e.key, searching = S.listMode === 'search' && $('.view.is-active').dataset.view === 'list';
      if (k.length === 1 && (k !== ' ' || (searching && S.query))) {
        e.preventDefault();
        typeStart();
        if (S.query.length < 30) setQuery((S.query + (S.query ? k.toLowerCase() : k.toUpperCase())).replace(/^ +/, ''));
        return;
      }
      if (!searching) return;
      if (k === 'Backspace') { e.preventDefault(); setQuery(S.query.slice(0, -1)); }
      else if (k === 'Escape') { e.preventDefault(); if (S.query) setQuery(''); else { closeKb(); back(); } }
      else if (k === 'ArrowDown' || k === 'ArrowUp') {
        var rows = [].slice.call(document.querySelectorAll('#list [data-t], #list [data-pick-kiosk]'));
        if (!rows.length) return;
        e.preventDefault();
        var i = rows.indexOf(document.activeElement);
        i = k === 'ArrowDown' ? Math.min(rows.length - 1, i + 1) : Math.max(0, i - 1);
        rows[i].focus(); if (rows[i].scrollIntoView) rows[i].scrollIntoView({ block: 'nearest' });
      } else if (k === 'Enter') {
        var a = document.activeElement, row = (a && a.closest && a.closest('#list [data-t], #list [data-pick-kiosk]')) || $('#list [data-t]');
        if (row) { e.preventDefault(); row.click(); }
      }
    });

    $('#langBtn').addEventListener('click', function () {
      B.setLang(B.lang === 'id' ? 'en' : 'id');
      if (!switchingBack) track('lang_switch', { lang: B.lang });
      applyI18n(); renderHome(); renderQuick(); renderSwitcher(); renderFloorCard(); map.setKiosk(kiosk);
      if (map.dest) map.setDest(map.dest);
      var v = $('.view.is-active').dataset.view;
      if (v === 'list') renderList();
      if (v === 'detail' && S.sel) { $('#detail').innerHTML = ''; openDetail(S.sel); }
      if (v === 'route' && S.target) {
        var src = S.origin || kiosk;
        S.plan = router.plan(src.node, S.target.node, { tenant: S.target, origin: src, accessible: S.accessible });
        renderRoute();
        if (S.plan.ok) showLeg(Math.max(0, Math.min(S.activeLeg, S.plan.legs.length - 1)), false);
      }
      fillAttractText();
    });

    function swapRoute() {
      if (!S.target) return;
      if (S.origin && S.origin.id !== kiosk.id) {
        var prevTarget = S.target;
        S.target = S.origin;
        S.origin = prevTarget;
        openRoute(S.target);
      } else {
        S.origin = S.target;
        S.pickMode = 'dest';
        openList('az', { reset: true });
        toast(t('startPointSet', { name: S.origin.name }));
      }
    }

    $('#panel').addEventListener('click', function (e) {
      var b;
      if ((b = e.target.closest('[data-back]'))) { closeKb(); back(); return; }
      if (e.target.closest('#resetOrigin')) { S.origin = null; openRoute(S.target); return; }
      if (e.target.closest('#swapRoute')) { swapRoute(); return; }
      if ((b = e.target.closest('[data-pick]'))) { S.pickMode = b.dataset.pick; openList('az', { reset: true }); return; }
      if (e.target.closest('[data-pick-kiosk]')) { S.origin = null; S.pickMode = null; openRoute(S.target); return; }
      if (e.target.closest('#setStart')) {
        if (S.sel) {
          S.origin = S.sel;
          S.pickMode = 'dest';
          openList('az', { reset: true });
          toast(t('startPointSet', { name: S.sel.name }));
        }
        return;
      }
      if ((b = e.target.closest('[data-cat]'))) { track('category_open', { cat: b.dataset.cat }); openList('cat', { cat: b.dataset.cat }); return; }
      if (e.target.closest('#azBtn')) { track('az_open'); openList('az'); return; }
      if ((b = e.target.closest('[data-amen]'))) { track('amenity_route', { type: b.dataset.amen }); routeToAmenity(b.dataset.amen); return; }
      if ((b = e.target.closest('[data-t]'))) {
        var clickedTenant = D.tenantById[b.dataset.t];
        if (S.pickMode === 'origin') {
          S.origin = clickedTenant;
          S.pickMode = null;
          openRoute(S.target);
          return;
        }
        if (S.pickMode === 'dest') {
          S.pickMode = null;
          openRoute(clickedTenant);
          return;
        }
        openDetail(clickedTenant);
        return;
      }
      if ((b = e.target.closest('[data-lvl]'))) { S.lvl = b.dataset.lvl === '' ? null : +b.dataset.lvl; renderList(); return; }
      if ((b = e.target.closest('[data-bld]'))) { S.bld = S.bld === b.dataset.bld ? null : b.dataset.bld; renderList(); return; }
      if (e.target.closest('#goRoute')) { openRoute(S.sel); return; }
      if ((b = e.target.closest('[data-pref]'))) {
        var np = b.dataset.pref;
        if (np === S.pref) return;
        S.pref = np;
        S.accessible = (np === 'accessible');
        if ($('.view.is-active').dataset.view === 'route' && S.target) {
          stopPlay(); clearRoute(); openRoute(S.target);
        } else if ($('.view.is-active').dataset.view === 'detail') {
          $$('[data-pref]').forEach(function (btn) { btn.classList.toggle('on', btn.dataset.pref === S.pref); });
        }
        return;
      }
      if ((b = e.target.closest('[data-acc]'))) {
        S.accessible = !S.accessible;
        S.pref = S.accessible ? 'accessible' : 'best';
        b.classList.toggle('on', S.accessible);
        if ($('.view.is-active').dataset.view === 'route' && S.target) { stopPlay(); clearRoute(); openRoute(S.target); }
        return;
      }
      if (e.target.closest('#replay')) { stopPlay(); map.setRoute(null); playRoute(); return; }
      if (e.target.closest('.qr-card')) { openQrModal(); return; }
      if ((b = e.target.closest('[data-leg]'))) { stopPlay(); showLeg(+b.dataset.leg, true); return; }
      if ((b = e.target.closest('[data-tr]'))) {
        stopPlay(); var i = +b.dataset.tr, hh = +(b.dataset.hop || 0);
        if (hh > 0) showHop(i, hh); else showLeg(Math.min(i + 1, S.plan.legs.length - 1), true);
        return;
      }
    });

    $('#qrModalClose').addEventListener('click', closeQrModal);
    $('#qrModal').addEventListener('click', function (e) {
      if (e.target === this) closeQrModal();
    });

    $('#floorSwitch').addEventListener('click', function (e) { var b = e.target.closest('[data-floor]'); if (b) goFloor(b.dataset.floor); });
    $('#zoomCtl').addEventListener('click', function (e) {
      var b = e.target.closest('[data-z]'); if (!b) return;
      stopPlay();
      if (b.dataset.z === 'in') map.zoomBy(1.5);
      else if (b.dataset.z === 'out') map.zoomBy(1 / 1.5);
      else {
        var f = D.floorById[kiosk.floor], cur = D.floorById[map.floor].level;
        if (map.resetView) map.resetView(false);
        map.showFloor(kiosk.floor, { building: kiosk.building, dir: f.level >= cur ? 'up' : 'down' });
      }
    });
    // 3D floors: turn the map 360 degrees, back to the default view, switch map layers
    $('#view3dCtl').addEventListener('click', function (e) {
      var b = e.target.closest('[data-v]'); if (!b || !map.rotateBy) return;
      stopPlay();
      if (b.dataset.v === 'left') map.rotateBy(-45);
      else if (b.dataset.v === 'right') map.rotateBy(45);
      else if (b.dataset.v === 'north') map.resetView(true);
      else showLayers3d($('#layers3d').hidden);
    });
    $('#layers3d').addEventListener('change', function () {
      var vis = {};
      $$('#layers3d input[data-l]').forEach(function (i) { vis[i.dataset.l] = i.checked; });
      map.setLayers(vis);
    });

    // idle tracking
    ['pointerdown', 'keydown'].forEach(function (ev) { document.addEventListener(ev, bump, true); });
  }

  function amenityTarget(a) {
    return { id: a.id, name: B.amenityName(a), floor: a.floor, building: a.building, x: a.x, y: a.y, node: a.node, category: null, logo: null, poi: a.kind === 'poi' };
  }
  function routeToAmenity(type) {
    var a = router.nearestAmenity(kiosk.node, type, S.accessible && type !== 'escalator', S.pref);
    if (!a) { toast(t('noRoute')); return; }
    S.sel = null;
    openRoute(amenityTarget(a));
  }
  function toast(msg) {
    var e = $('#toast'); e.textContent = msg; e.hidden = false;
    clearTimeout(toast._t); toast._t = setTimeout(function () { e.hidden = true; }, 3000);
  }

  // ---------------- idle / attract ----------------
  var idleT = 0, att = { tl: null, promoI: 0, promoT: 0, pageT: 0, measured: false }, switchingBack = false;
  function bump() { clearTimeout(idleT); idleT = setTimeout(goIdle, (cfg.idleTimeoutSec || 60) * 1000); }
  function goIdle() {
    if (!$('#attract').classList.contains('off')) return;
    if (B.tele) B.tele.endSession();
    resetAll(); showAttract();
    if (B.syncReloadNow) setTimeout(B.syncReloadNow, 1500); // a pending data update reloads right after going idle
  }
  function sync3d() {
    var on = !!(map.is3dShown && map.is3dShown());
    $('#view3dCtl').hidden = !on;
    if (!on) showLayers3d(false);
  }
  function showLayers3d(on) {
    $('#layers3d').hidden = !on;
    $('#view3dCtl [data-v="layers"]').setAttribute('aria-expanded', String(!!on));
  }
  function resetAll() {
    stopPlay(); closeKb(); closeQrModal(); clearRoute(); setQuery('');
    if (map.resetView) { // a new visitor gets the default view with every layer on
      map.resetView(false); showLayers3d(false);
      $$('#layers3d input[data-l]').forEach(function (i) { i.checked = true; });
      map.setLayers({ slab: true, units: true, names: true, logos: true, fac: true });
    } S.stack = []; S.sel = null; S.target = null; S.origin = null; S.pickMode = null; S.plan = null; S.accessible = false; S.pref = 'best';
    if (B.lang !== DEF_LANG) { switchingBack = true; $('#langBtn').click(); switchingBack = false; }
    showView('home', false); map.setDest(null); map.setOrigin(null);
    map.showFloor(kiosk.floor, { building: kiosk.building, animate: false });
  }
  // The attract (front) screen always speaks one language, independent of the in-app ID/EN toggle.
  function tA(k) { var l = B.lang; B.lang = ATT_LANG; var s = t(k); B.lang = l; return s; }
  function fillAttractText() {
    $('#attKicker').textContent = tA('appTitle');
    $('#attWelcome').textContent = tA('welcome');
    $('#attSub').textContent = tA('welcomeSub');
    $('#attCta').textContent = tA('touchStart');
    $('#attCtaAlt').textContent = '';
    if (playlist) playlist.setLang(ATT_LANG);
  }
  function featuredTenants() {
    var ids = playlist ? playlist.featured() : (cfg.featured || []);
    var feat = ids.map(function (id) { return D.tenantById[id]; }).filter(function (x) { return x && x.status !== 'temp_closed'; });
    if (feat.length < 8) feat = feat.concat(D.tenants.filter(function (x) { return x.logo && feat.indexOf(x) < 0; }).slice(0, 10 - feat.length));
    return feat;
  }
  function tileHtml(x) {
    return '<div class="att-tile">' + (x.logo ? '<img src="' + esc(B.ROOT + x.logo) + '" alt="">' : '') + '<span>' + esc(x.brand || x.name) + '</span><small>' + esc(B.floorLabel(D.floorById[x.floor])) + '</small></div>';
  }
  function renderMarquee() {
    var feat = featuredTenants();
    att.feat = feat; att.page = 0;
    if (lite()) { renderMarqueePage(); return; }
    var tiles = feat.map(tileHtml).join('');
    $('#attTrack').innerHTML = tiles + tiles;
  }
  // lite: static grid of 6 tiles, next page every 6 s (no continuous transform animation)
  function renderMarqueePage() {
    var per = 6, feat = att.feat || [], pages = Math.max(1, Math.ceil(feat.length / per));
    var pg = att.page % pages, items = feat.slice(pg * per, pg * per + per);
    $('#attTrack').innerHTML = items.map(tileHtml).join('');
    if (window.gsap) gsap.fromTo('#attTrack', { opacity: 0 }, { opacity: 1, duration: 0.25 });
  }
  function initAttract() {
    playlist = new B.Playlist({ box: $('#attPromo'), layer: $('#attract'), lang: ATT_LANG, kioskId: kiosk.id, onLink: promoLink });
    if (B.promosData) playlist.setData(B.promosData);
    renderMarquee();
    fillAttractText();
    $('#attract').addEventListener('pointerup', function (e) {
      if ($('#attract').classList.contains('off')) return;
      if (playlist && playlist.handleTap(e.target)) return;
      if (e.target.closest && e.target.closest('.promo-qr')) return;
      hideAttract();
    });
    var q = new URLSearchParams(location.search);
    if (q.get('attract') === '0') hideAttract(true); else showAttract();
    if (B.perf) B.perf.onChange(function (mode, reason) {
      track('perf_switch', { mode: mode, reason: reason });
      renderMarquee();
      if (!$('#attract').classList.contains('off')) showAttract();
    });
  }
  // promo tapped: tenant -> detail, category -> list, event at tenant -> detail
  function promoLink(link) {
    var ref = link.ref;
    if (link.type === 'event' && link.location) { link = link.location; ref = link.ref; }
    hideAttract();
    if (link.type === 'tenant' && D.tenantById[ref]) openDetail(D.tenantById[ref]);
    else if (link.type === 'category' && D.catById[ref]) openList('cat', { cat: ref });
  }
  function showAttract() {
    var a = $('#attract'); a.classList.remove('off');
    if (playlist) playlist.start();
    clearInterval(att.pageT);
    if (!window.gsap) return;
    if (att.tl) att.tl.kill();
    var trackEl = $('#attTrack');
    if (lite()) {
      gsap.set(trackEl, { x: 0 });
      att.tl = null;
      att.pageT = setInterval(function () { att.page++; renderMarqueePage(); }, 6000);
      gsap.fromTo(['.att-kicker', '.att-title', '.att-sub', '.att-promo', '.att-marquee', '.att-cta'], { opacity: 0 }, { opacity: 1, duration: 0.25 });
      return;
    }
    var half = trackEl.scrollWidth / 2;
    att.tl = gsap.timeline();
    att.tl.add(gsap.fromTo(trackEl, { x: 0 }, { x: -half, duration: half / 60, ease: 'none', repeat: -1 }), 0);
    att.tl.add(gsap.to('.b1', { x: 220, y: 120, duration: 14, yoyo: true, repeat: -1, ease: 'sine.inOut' }), 0);
    att.tl.add(gsap.to('.b2', { x: -180, y: -100, duration: 17, yoyo: true, repeat: -1, ease: 'sine.inOut' }), 0);
    att.tl.add(gsap.to('.b3', { x: 160, y: -80, duration: 12, yoyo: true, repeat: -1, ease: 'sine.inOut' }), 0);
    att.tl.add(gsap.to('.att-hand', { y: -8, duration: 0.8, yoyo: true, repeat: -1, ease: 'sine.inOut' }), 0);
    gsap.fromTo(['.att-kicker', '.att-title', '.att-sub', '.att-promo', '.att-marquee', '.att-cta'], { opacity: 0, y: 30 }, { opacity: 1, y: 0, duration: 1, stagger: 0.12, ease: 'power3.out' });
    // auto perf: measure frame time during the first 3 s of the first attract animation
    if (!att.measured && B.perf && B.perf.isAuto() && !lite()) { att.measured = true; B.perf.measure(3000); }
  }
  function hideAttract(instant) {
    var a = $('#attract');
    if (a.classList.contains('off')) return;
    clearInterval(att.promoT); clearInterval(att.pageT);
    if (playlist) playlist.stop();
    if (!instant && B.tele) B.tele.startSession();
    var done = function () { a.classList.add('off'); if (att.tl) { att.tl.kill(); att.tl = null; } a.style.opacity = ''; };
    if (instant || !window.gsap) done();
    else gsap.to(a, { opacity: 0, duration: lite() ? 0.2 : 0.45, ease: 'power2.in', onComplete: done });
    bump();
  }

  // ---------------- live status (closures, notice) & sync ----------------
  function applyStatus(st, initial) {
    if (!initial) router.setStatus(st);
    map.setClosures(router.closedConnectorNodes(), (st && st.amenityClosures) || []);
    renderNotice(st && st.notice);
    if (initial) return;
    // a route on screen that is affected -> re-plan it (no reload)
    var v = $('.view.is-active') && $('.view.is-active').dataset.view;
    if (v === 'route' && S.target) {
      var src = S.origin || kiosk;
      var isAcc = S.pref === 'accessible' || S.accessible;
      var np = router.plan(src.node, S.target.node, { tenant: S.target.category ? S.target : null, origin: src, pref: S.pref, accessible: isAcc });
      if (!S.target.category) np.tenant = S.target;
      var changed = np.ok !== S.plan.ok || (np.ok && Math.abs(np.cost - S.plan.cost) > 0.01) || (np.detour || []).length !== (S.plan.detour || []).length;
      if (changed) { stopPlay(); clearRoute(); S.plan = np; renderRoute(); if (np.ok) playRoute(); }
    }
  }
  function renderNotice(n) {
    var bar = $('#noticeBar'), emg = $('#noticeEmg');
    var now = Date.now();
    var active = n && (!n.to || Date.parse(n.to) > now) && (!n.from || Date.parse(n.from) <= now) &&
      (!n.kiosks || n.kiosks === '*' || (n.kiosks.indexOf && n.kiosks.indexOf(kiosk.id) >= 0));
    if (bar) bar.parentNode.removeChild(bar);
    if (emg) emg.parentNode.removeChild(emg);
    clearTimeout(renderNotice.t);
    if (!active) return;
    var en = n.text && (n.text.en || n.text.id) || '', idt = n.text && (n.text.id || n.text.en) || '';
    if (n.level === 'emergency') {
      document.body.insertAdjacentHTML('beforeend', '<div class="notice-emg" id="noticeEmg">' + B.icon('triangle-alert') + '<b>' + esc(en) + '</b>' + (idt !== en ? '<span>' + esc(idt) + '</span>' : '') + '</div>');
    } else {
      var main = B.lang === 'id' ? idt : en, sub = B.lang === 'id' ? en : idt;
      document.body.insertAdjacentHTML('beforeend', '<div class="notice-bar ' + (n.level === 'warning' ? 'warning' : 'info') + '" id="noticeBar">' + B.icon(n.level === 'warning' ? 'triangle-alert' : 'megaphone') +
        '<div>' + esc(main) + (sub && sub !== main ? '<small>' + esc(sub) + '</small>' : '') + '</div></div>');
    }
    if (n.to) renderNotice.t = setTimeout(function () { renderNotice(n); }, Math.max(1000, Date.parse(n.to) - now + 500));
  }
  function startSync() {
    if (!B.sync) return;
    B.sync.start({
      isIdle: function () { return !$('#attract').classList.contains('off'); },
      profile: function () { return kiosk || {}; },
      onStatus: function (st) { applyStatus(st); },
      onPromos: function (P) { if (playlist) { playlist.setData(P); renderMarquee(); if (!$('#attract').classList.contains('off') && !lite()) showAttract(); } },
      onProfile: function (k) { var before = DEF_LANG; applyProfile(k); if (before !== DEF_LANG && $('#attract').classList.contains('off') === false) resetAll(); },
      onTick: function () { if (router.refresh()) applyStatus(B.statusData); },
      beforeReload: function () { if (B.tele) B.tele.flush(); }
    });
  }

  // ---------------- clock ----------------
  function tick() {
    var d = new Date(), loc = B.lang === 'en' ? 'en-GB' : 'id-ID';
    var hm = d.toLocaleTimeString(loc, { hour: '2-digit', minute: '2-digit' }).replace('.', ':');
    $('#clock').textContent = hm;
    var attLoc = ATT_LANG === 'en' ? 'en-GB' : 'id-ID';
    $('#attClock').innerHTML = esc(hm) + '<small>' + esc(d.toLocaleDateString(attLoc, { weekday: 'long', day: 'numeric', month: 'long' })) + '</small>';
  }

  // test hooks
  window.__kiosk = { openDetail: function (id) { openDetail(D.tenantById[id]); }, openRoute: function (id) { openRoute(D.tenantById[id]); },
    setQuery: setQuery, openKb: openKb, state: S, map: function () { return map; }, hideAttract: hideAttract, goIdle: goIdle,
    setAccessible: function (v) { S.accessible = v; }, routeToAmenity: routeToAmenity, router: function () { return router; },
    kiosk: function () { return kiosk; }, playlist: function () { return playlist; }, showAttract: showAttract };
})(window.BSB);
