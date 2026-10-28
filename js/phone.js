/* Phone guidance page: compass arrow + step list + pedometer dot + manual correction */
(function (B) {
  var cfg = window.BSB_CONFIG || {};
  var $ = function (s) { return document.querySelector(s); };
  var $$ = function (s) { return Array.prototype.slice.call(document.querySelectorAll(s)); };
  var t = B.t, esc = B.esc;
  var D, router, map, kiosk, origin, target, plan, flat = [], ci = 0, legM = 0, mapEl;
  var Q = new URLSearchParams(location.search);
  var pref = Q.get('pref') || (Q.get('a') === '1' ? 'accessible' : 'best');
  var accessible = pref === 'accessible' || Q.get('a') === '1';
  var sens = { heading: null, compass: false, motion: false, steps: 0, north: null, started: false, rot: 0 };
  var NORTH_KEY = 'bsb-north-' + (Q.get('k') || '');
  var arrived = false;

  // ---- analytics beacons (CMS_SPEC §6.5): no personal data, one random id per page session ----
  var PSID = (function () { var s = '', a = 'abcdefghijklmnopqrstuvwxyz0123456789'; for (var i = 0; i < 12; i++) s += a.charAt(Math.floor(Math.random() * 36)); return s; })();
  function beacon(type, extra) {
    try {
      var body = { type: type, k: Q.get('k'), t: Q.get('t'), a: accessible ? 1 : 0, lang: B.lang, sid: Q.get('s') || null, psid: PSID };
      if (extra) for (var x in extra) body[x] = extra[x];
      var url = B.apiUrl('/telemetry/phone'), json = JSON.stringify(body);
      if (navigator.sendBeacon && navigator.sendBeacon(url, new Blob([json], { type: 'application/json' }))) return;
      fetch(url, { method: 'POST', body: json, headers: { 'Content-Type': 'application/json' }, keepalive: true }).catch(function () {});
    } catch (e) {}
  }
  // north of the map "up" direction: floor.northDeg > snapshot meta > config > one-time calibration (localStorage)
  function northNow() {
    var f = cur && D && plan && plan.ok && flat.length ? D.floorById[plan.legs[cur().li].floor] : (D && target ? D.floorById[target.floor] : null);
    if (f && f.northDeg != null) return f.northDeg;
    if (D && D.meta && D.meta.mapNorthDeg != null) return D.meta.mapNorthDeg;
    if (cfg.mapNorthDeg != null) return cfg.mapNorthDeg;
    return sens.north;
  }

  if (Q.get('lang') === 'en' || Q.get('lang') === 'id') B.setLang(Q.get('lang'));

  function iconize() { $$('[data-icon]').forEach(function (e) { if (!e.firstChild) e.innerHTML = B.icon(e.dataset.icon); }); }
  function applyI18n() {
    $$('[data-i18n]').forEach(function (e) { e.textContent = t(e.dataset.i18n); });
    $('#langBtn').textContent = B.lang === 'id' ? 'EN' : 'ID';
  }
  function show(id) { ['#scrPick', '#scrStart', '#scrNav', '#scrDone', '#scrErr'].forEach(function (s) { $(s).hidden = s !== id; }); window.scrollTo(0, 0); }
  // no route between two picked points: offer to pick another destination instead of a dead end
  function fail(msg) { $('#errTxt').textContent = msg; $('#errPick').hidden = !(D && origin); show('#scrErr'); }

  try { var sv = localStorage.getItem(NORTH_KEY); if (sv != null && sv !== '') sens.north = +sv; } catch (e) {}

  iconize(); applyI18n();

  // Start + destination come from the kiosk QR (k + t), a lobby sticker (from=) or, when missing, from the visitor:
  // step 1 "where are you" (an entrance = kiosk or CMS lobby point, or a store), step 2 "where to". Choices go into the
  // URL (from=, t=) so a reload keeps them. selfPick: no kiosk -> the chosen start is the "you are here" point.
  var LOBBY_TYPES = ['lobby-exit', 'parking-entrance', 'drop-off'];
  var FAC_TYPES = [['toilet', 'toilet'], ['musholla', 'musholla'], ['atm', 'banknote'], ['lift', 'move-vertical'], ['escalator', 'arrow-up-down']];
  var selfPick = false, began = false, search = null, pick = { step: 1, tab: 'lobby', rows: [] };
  function poiTarget(a) { return { id: a.id, name: B.amenityName(a), floor: a.floor, building: a.building, x: a.x, y: a.y, node: a.node, category: null, logo: null, poi: a.kind === 'poi' }; }
  function amenityById(id) { return D.amenities.filter(function (a) { return a.id === id; })[0]; }
  function targetById(id) { var am = id && !D.tenantById[id] && amenityById(id); return D.tenantById[id] || (am ? poiTarget(am) : null); }
  function originById(id) { return id ? (D.kioskById[id] || targetById(id)) : null; }
  function isEntrance(o) { return !!(o && (D.kioskById[o.id] || (o.poi && LOBBY_TYPES.indexOf((amenityById(o.id) || {}).type) >= 0))); }

  B.loadData().then(function (d) {
    D = d; router = new B.Router(D, { status: B.statusData });
    kiosk = D.kioskById[Q.get('k')] || null;
    selfPick = !kiosk;
    target = targetById(Q.get('t'));
    origin = originById(Q.get('from')) || kiosk;
    if (!origin) return openPick(1);
    if (!target) return openPick(2);
    if (kiosk && Q.get('t')) beacon('qr_scan');
    return begin();
  }).catch(function (e) { console.error(e); fail(t('error')); });

  // map + plan for the current origin / target (first time from boot or the picker, again after "change")
  function begin() {
    if (selfPick) kiosk = origin;
    show('#scrStart');
    if (!map) {
      mapEl = document.createElement('div'); mapEl.className = 'map-holder';
      $('#mapStart').appendChild(mapEl);
      map = new (B.MapView3D || B.MapView)(mapEl, { pad: { l: 30, r: 30, t: 70, b: 30 } });
    }
    began = true;
    map.setKiosk(kiosk);
    map.setOrigin(origin !== kiosk ? origin : null);
    buildPlan();
    if (!plan.ok) return;
    renderHeader(); renderStart();
    var L0 = plan.legs[0];
    return map.showFloor(L0.floor, { box: legBox(L0, 25), animate: false }).then(function () {
      map.setDest(target);
      map.setRoute(L0.floor, L0.pts, { animate: true, duration: 1.4, startMarker: false });
      window.__phoneReady = true;
    });
  }

  // ---------------- picker ----------------
  function openPick(step) {
    pick.step = step; pick.tab = 'lobby';
    $('#pickQ').value = '';
    if (!began) $('#dest').innerHTML = '';
    show('#scrPick');
    renderPick();
  }
  function floorOrder() { var o = {}, n = 0; D.levels.forEach(function (L) { L.floors.forEach(function (f) { o[f.id] = n++; }); }); return o; }
  function pickRows() {
    var q = $('#pickQ').value.trim(), nq = B.norm(q), fo = floorOrder(), rows;
    if (pick.step === 1 && pick.tab === 'lobby') {
      rows = D.kiosks.map(function (k) { return { item: k, name: k.name, floor: k.floor, icon: 'door-open' }; });
      D.amenities.forEach(function (a) {
        if (a.kind === 'poi' && LOBBY_TYPES.indexOf(a.type) >= 0) rows.push({ item: poiTarget(a), name: B.amenityName(a), floor: a.floor, icon: 'door-open' });
      });
      if (nq) rows = rows.filter(function (r) { return B.norm(r.name + ' ' + B.floorLong(D.floorById[r.floor])).indexOf(nq) >= 0; });
      return rows.sort(function (a, b) { return fo[a.floor] - fo[b.floor] || a.name.localeCompare(b.name); });
    }
    if (!search) search = new B.Search(D);
    var ts = nq ? search.query(q) : D.tenants.slice().sort(function (a, b) { return a.name.localeCompare(b.name); });
    return ts.filter(function (x) { return x.node; }).map(function (x) { return { item: x, name: x.name, floor: x.floor, tenant: x }; });
  }
  function renderPick() {
    var s1 = pick.step === 1;
    $('#pickStep').textContent = t('step') + ' ' + pick.step + ' ' + t('of') + ' 2';
    $('#pickTitle').textContent = t(s1 ? 'pickFromTitle' : 'pickToTitle');
    $('#pickSub').textContent = s1 ? t('pickFromSub') : (origin ? (isEntrance(origin) ? t('fromEntrance') : t('from')) + ' ' + origin.name : t('pickToSub'));
    $('#pickTabs').hidden = !s1;
    $$('#pickTabs [data-ptab]').forEach(function (b) { b.classList.toggle('on', b.dataset.ptab === pick.tab); });
    $('#pickQ').placeholder = t('pickSearchPh');
    var fac = '';
    if (!s1) FAC_TYPES.forEach(function (ft) {
      if (D.amenities.some(function (a) { return a.type === ft[0]; })) fac += '<button type="button" class="pick-fac-btn" data-fac="' + ft[0] + '">' + B.icon(ft[1]) + '<span>' + esc(B.hasT(ft[0]) ? t(ft[0]) : B.amenityTypeName(ft[0])) + '</span></button>';
    });
    $('#pickFac').innerHTML = fac ? '<h3 class="ph-sec">' + esc(t('nearestFacility')) + '</h3><div class="pick-fac-row">' + fac + '</div>' : '';
    pick.rows = pickRows();
    var h = '', lastF = null;
    pick.rows.forEach(function (r, i) {
      if (!r.tenant && r.floor !== lastF) { lastF = r.floor; h += '<li class="fl">' + esc(B.floorLong(D.floorById[r.floor])) + '</li>'; }
      var ic = r.tenant ? logoHtml(r.tenant) : B.icon(r.icon);
      h += '<li><button type="button" class="pick-row" data-pi="' + i + '"><span class="logo">' + ic + '</span><span class="pick-row-t"><b>' + esc(B.tidy(r.name)) + '</b>' +
        (r.tenant ? '<small>' + esc(B.floorLong(D.floorById[r.floor])) + '</small>' : '') + '</span>' + B.icon('chevron-right') + '</button></li>';
    });
    $('#pickList').innerHTML = h || '<li class="pick-empty">' + esc(t(s1 && pick.tab === 'lobby' ? 'noLobby' : 'noResults')) + '</li>';
  }
  function choose(item) {
    if (pick.step === 1) origin = item; else target = item;
    var u = new URL(location.href);
    if (origin && (selfPick || origin !== kiosk)) u.searchParams.set('from', origin.id);
    if (target) u.searchParams.set('t', target.id);
    try { history.replaceState(null, '', u.pathname + u.search); } catch (e) {}
    if (!target) return openPick(2);
    var first = !began;
    begin();
    if (first && selfPick) beacon('self_start', { from: origin.id, t: target.id });
  }

  function buildPlan() {
    var srcNode = (origin && origin.node) || kiosk.node;
    var isAcc = pref === 'accessible' || accessible;
    plan = router.plan(srcNode, target.node, { tenant: target.category ? target : null, pref: pref, accessible: isAcc });
    if (!plan.ok && isAcc) {
      isAcc = false; accessible = false; pref = 'best';
      plan = router.plan(srcNode, target.node, { tenant: target, pref: 'best', accessible: false });
    }
    if (!plan.ok) {
      if (plan.reason === 'closed' && plan.closed && plan.closed.length) {
        var c = plan.closed[0];
        return fail(t('routeClosed', { x: B.tidy(c.label) + (plan.closed.length > 1 ? ' (+' + (plan.closed.length - 1) + ')' : ''), r: c.reason ? ' (' + c.reason + ')' : '' }));
      }
      return fail(t('noRoute'));
    }
    if (!target.category) plan.tenant = target;
    flat = [];
    plan.legs.forEach(function (leg, li) { leg.steps.forEach(function (s, si) { flat.push({ li: li, s: s }); }); });
  }

  function logoHtml(x) {
    return x.logo ? '<img src="' + esc(B.ROOT + x.logo) + '" alt="">' : '<span class="ini">' + esc(B.initials(x.name)) + '</span>';
  }
  function renderHeader() {
    var f = D.floorById[target.floor];
    if (origin && (selfPick || origin !== kiosk)) {
      var fo = D.floorById[origin.floor];
      $('#dest').innerHTML =
        '<div class="ph-trip">' +
          '<div class="ph-trip-pt origin"><span class="ph-trip-dot start"></span><div class="ph-trip-info"><div class="ph-trip-n">' + esc(origin.name) + '</div><div class="ph-trip-s">' + esc(fo.short) + '</div></div></div>' +
          '<div class="ph-trip-arrow">' + B.icon('arrow-down') + '</div>' +
          '<div class="ph-trip-pt dest"><span class="ph-trip-dot end"></span><div class="ph-trip-info"><div class="ph-trip-n">' + esc(target.name) + '</div><div class="ph-trip-s">' + esc(f.short) + '</div></div></div>' +
        '</div>';
    } else {
      $('#dest').innerHTML = '<span class="logo">' + logoHtml(target) + '</span><div><div class="dn">' + esc(B.tidy(target.name)) + '</div><div class="ds">' + esc(B.floorLong(f)) + '</div></div>';
    }
  }
  function phoneTransitHtml() {
    var p = pref || 'best';
    return '<div class="ph-transit-pref" role="radiogroup">' +
      '<button type="button" class="ph-tp-btn' + (p === 'best' ? ' on' : '') + '" data-pref="best">' +
        B.icon('sparkles') + '<span>' + esc(t('prefBest')) + '</span>' +
      '</button>' +
      '<button type="button" class="ph-tp-btn' + (p === 'lift' ? ' on' : '') + '" data-pref="lift">' +
        B.icon('move-vertical') + '<span>' + esc(t('prefLift')) + '</span>' +
      '</button>' +
      '<button type="button" class="ph-tp-btn' + (p === 'accessible' ? ' on' : '') + '" data-pref="accessible">' +
        B.icon('accessibility') + '<span>' + esc(t('prefAcc')) + '</span>' +
      '</button>' +
    '</div>';
  }
  function renderStart() {
    if (!plan.ok) return;
    var fromHtml = B.icon('map-pin') + (origin && origin !== kiosk
      ? t('from') + ' ' + esc(origin.name) + ' (' + esc(D.floorById[origin.floor].short) + ')'
      : (selfPick ? (isEntrance(origin) ? t('fromEntrance') : t('from')) : t('fromKiosk')) + ' ' + esc(kiosk.name));
    var chgHtml = '<div class="pick-chg"><button type="button" data-chg="1">' + B.icon('pencil') + esc(t('changeOrigin')) + '</button>' +
      '<button type="button" data-chg="2">' + B.icon('pencil') + esc(t('changeDest')) + '</button></div>';
    var noticeHtml = plan.fallbackEscalator ? ('<div class="ph-transit-notice">' + B.icon('info') + '<span>' + esc(t('liftFallbackNotice')) + '</span></div>') : '';
    $('#summary').innerHTML =
      phoneTransitHtml() +
      noticeHtml +
      '<div class="st-grid">' +
      '<div class="st"><div class="st-k">' + t('distance') + '</div><div class="st-v">' + t('approx') + B.roundM(plan.meters) + '<small>m</small></div></div>' +
      '<div class="st"><div class="st-k">' + t('time') + '</div><div class="st-v">' + Math.max(1, Math.round(plan.seconds / 60)) + '<small>' + t('minutes') + '</small></div></div>' +
      '<div class="st"><div class="st-k">' + t('floor') + '</div><div class="st-v">' + esc(D.floorById[plan.legs[0].floor].short) + ' → ' + esc(D.floorById[target.floor].short) + '</div></div>' +
      '</div>' +
      '<div class="from">' + fromHtml + '</div>' + chgHtml;
    $('#stepsStart').innerHTML = stepsHtml();
    $('#stepsNav').innerHTML = stepsHtml();
  }
  function stepsHtml() {
    var h = '', n = 0, lastLeg = -1;
    flat.forEach(function (f, i) {
      if (f.li !== lastLeg) { lastLeg = f.li; h += '<li class="fl">' + esc(B.floorLong(D.floorById[plan.legs[f.li].floor])) + '</li>'; }
      var tr = f.s.kind === 'transition';
      if (!tr) n++;
      h += '<li data-i="' + i + '" class="' + (tr ? 'tr' : '') + '"><span class="n">' + (tr ? B.icon(f.s.transition && f.s.transition.dir === 'down' ? 'arrow-down' : 'arrow-up') : n) + '</span><span>' + esc(B.tidy(f.s.text)) + '</span></li>';
    });
    return h;
  }

  function legBox(leg, minM) {
    var f = D.floorById[leg.floor], u = 1 / ((f.unitScale || 1) * cfg.metersPerUnit), half = (minM || 25) * u;
    var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    leg.pts.forEach(function (p) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); });
    var cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, w = Math.max(x1 - x0, half * 2) * 1.1, h = Math.max(y1 - y0, half * 1.2) * 1.1;
    return [cx - w / 2, cy - h / 2, w, h];
  }

  // ---------------- navigation ----------------
  function startNav() {
    show('#scrNav');
    $('#mapNav').appendChild(mapEl);
    map.setTenantDots(false);
    map.setKiosk(null);
    ci = 0; legM = 0; sens.steps = 0; arrived = false;
    beacon('nav_start');
    enterStep(true);
    requestSensors();
  }

  function cur() { return flat[ci]; }
  function enterStep(force) {
    var f = cur(), leg = plan.legs[f.li];
    if (f.s.kind !== 'transition') legM = Math.max(Math.min(legM, f.s.endM), f.s.startM);
    // intermediate floor of a chained escalator/lift ride: show that floor + the stop, floor by floor
    var fl = f.s.floor || leg.floor, mid = fl !== leg.floor;
    var needFloor = map.floor !== fl;
    var dir = map.floor && D.floorById[map.floor].level > D.floorById[fl].level ? 'down' : 'up';
    var box = mid ? legBox({ floor: fl, pts: [f.s.end] }, 20) : legBox(leg, 20);
    var p = needFloor ? map.showFloor(fl, { box: box, dir: dir }) : Promise.resolve();
    p.then(function () {
      if (mid) { map.setRoute(null); map.setConnectors([{ floor: fl, x: f.s.end.x, y: f.s.end.y, label: f.s.transition.short, dir: f.s.transition.dir, kind: f.s.transition.type }]); }
      else { map.setConnectors([]); map.setRoute(leg.floor, leg.pts, { animate: needFloor || force, duration: 1, startMarker: f.li > 0 }); }
      update(true);
    });
    $('#floorSheet').hidden = f.s.kind !== 'transition';
    if (f.s.kind === 'transition') showFloorSheet(f.s.transition);
    $$('#stepsNav li[data-i]').forEach(function (li) {
      var i = +li.dataset.i; li.classList.toggle('cur', i === ci); li.classList.toggle('done', i < ci);
    });
    update(true);
  }
  function showFloorSheet(tr) {
    var toF = D.floorById[tr.toFloor];
    $('#flIc').innerHTML = B.icon(tr.type === 'lift' ? 'move-vertical' : tr.type === 'crossing' ? 'waypoints' : tr.dir === 'down' ? 'arrow-down' : 'arrow-up');
    $('#flK').textContent = t('step') + ' ' + (ci + 1) + ' ' + t('of') + ' ' + flat.length;
    $('#flT').textContent = B.tidy(tr.text);
    // chained ride: show the whole floor sequence, current target highlighted (GF → UG → 1F → 2F)
    var chain = cur().s.chain, seq = $('#flSeq');
    if (seq) {
      if (chain && chain.hops.length > 1) {
        var fls = [chain.hops[0].fromFloor].concat(chain.hops.map(function (h) { return h.toFloor; }));
        seq.innerHTML = fls.map(function (id) { var on = id === tr.toFloor; return '<b style="' + (on ? 'background:var(--accent);color:#fff;' : 'background:var(--bg-2);color:var(--ink-2);') + 'padding:3px 9px;border-radius:9px;font-size:14px">' + esc(D.floorById[id].short) + '</b>'; }).join(' → ');
        seq.hidden = false;
      } else seq.hidden = true;
    }
    $('#flBtn').textContent = t('changeFloorDone', { f: B.floorLabel(toF) });
    if (window.gsap) gsap.fromTo('#floorSheet .sheet-card', { y: 300 }, { y: 0, duration: 0.45, ease: 'power3.out' });
  }

  function next() {
    if (ci >= flat.length - 1) return arrive();
    var f = cur();
    if (f.s.kind !== 'transition') legM = f.s.endM;
    ci++;
    if (cur().li !== f.li) legM = 0;
    if (navigator.vibrate) try { navigator.vibrate(30); } catch (e) {}
    enterStep();
  }
  function prev() {
    if (ci <= 0) return;
    ci--;
    var p = cur();
    legM = p.s.kind === 'transition' ? plan.legs[p.li].meters : p.s.startM;
    enterStep();
  }
  function arrive() {
    if (!arrived) beacon('arrived');
    arrived = true;
    $('#floorSheet').hidden = true;
    $('#doneName').textContent = B.tidy(target.name);
    $('#doneLogo').innerHTML = logoHtml(target);
    $('#doneLogo').hidden = !target.logo;
    show('#scrDone');
    if (window.gsap) gsap.fromTo('.done-badge', { scale: 0.3, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.8, ease: 'back.out(2)' });
  }

  function mapBearing(a, b) { return (Math.atan2(b.x - a.x, -(b.y - a.y)) * 180 / Math.PI + 360) % 360; }
  function lookTarget() {
    var f = cur(), leg = plan.legs[f.li];
    var m = Math.min(legM + 6, f.s.endM);
    var p = B.pointAtM(leg, m);
    var here = B.pointAtM(leg, legM);
    if (Math.hypot(p.x - here.x, p.y - here.y) < 1e-6) p = f.s.end;
    return { here: here, to: p };
  }

  var lastCam = 0;
  function update(forceCam) {
    var f = cur(); if (!f) return;
    var leg = plan.legs[f.li];
    var lt = lookTarget();
    var brg = mapBearing(lt.here, lt.to);
    var remain = Math.max(0, f.s.endM - legM);
    $('#gDist').textContent = f.s.kind === 'transition' ? '0' : B.roundM(remain);
    $('#gSub').textContent = t('toNext') + ' · ' + t('approx') + B.roundM(Math.max(0, totalRemaining())) + ' m ' + t('remaining');
    $('#gTxt').textContent = B.tidy(f.s.text);
    $('#prog').textContent = t('step') + ' ' + (ci + 1) + ' ' + t('of') + ' ' + flat.length + (sens.motion ? ' · ' + sens.steps + ' ' + t('stepsCounted') : '');
    // arrow
    var rot, mode;
    var north = northNow();
    if (sens.compass && sens.heading != null && north != null) {
      rot = brg + north - sens.heading; mode = 'compass';
    } else rot = map.screenBearing ? map.screenBearing(lt.here, lt.to) : brg, mode = sens.compass ? 'uncal' : 'map'; // as seen on the (turnable 3D) map
    setArrow(rot);
    var gm = $('#gMode');
    if (mode === 'compass') { gm.className = 'g-mode ok'; gm.innerHTML = B.icon('compass') + t('compassOn') + (sens.motion ? ' · ' + t('pedometerOn') : ''); }
    else if (mode === 'uncal') { gm.className = 'g-mode warn'; gm.innerHTML = B.icon('compass') + t('calibrate'); }
    else { gm.className = 'g-mode' + (sens.started && sens.failNote ? ' warn' : ''); gm.innerHTML = B.icon('info') + (sens.failNote || t('mapArrowNote')); }
    $('#calibBtn').hidden = !sens.compass;
    $('#calibLbl').textContent = north == null ? t('calibrate') : t('recalibrate');
    // dot
    var hd = sens.compass && sens.heading != null && north != null ? (sens.heading - north) : null;
    map.setDot({ floor: leg.floor, x: lt.here.x, y: lt.here.y, heading: hd });
    var now = Date.now();
    if (map.floor === leg.floor && (forceCam || now - lastCam > 900)) {
      lastCam = now;
      var u = 1 / ((D.floorById[leg.floor].unitScale || 1) * cfg.metersPerUnit);
      var e = f.s.end, h = lt.here;
      var pts = [h, e];
      if (map.faceDirection && lt.here && lt.to && (lt.here.x !== lt.to.x || lt.here.y !== lt.to.y)) { // 3D: walking direction up
        map.faceDirection(lt.here, lt.to, 0.6).then(function () { update(false); }); // arrow follows the turned map
      }
      map.fitPoints(pts, 28, 0.6);
    }
  }
  function totalRemaining() {
    var f = cur(), r = plan.legs[f.li].meters - legM;
    for (var i = f.li + 1; i < plan.legs.length; i++) r += plan.legs[i].meters;
    return r;
  }
  function setArrow(deg) {
    var d = ((deg - sens.rot) % 360 + 540) % 360 - 180; // shortest path
    sens.rot += d;
    $('#arrow').style.transform = 'rotate(' + sens.rot.toFixed(1) + 'deg)';
  }

  // ---------------- sensors ----------------
  function requestSensors() {
    sens.started = true;
    var ps = [];
    var DOE = window.DeviceOrientationEvent, DME = window.DeviceMotionEvent;
    if (DOE && typeof DOE.requestPermission === 'function') ps.push(DOE.requestPermission().catch(function () { return 'denied'; }));
    if (DME && typeof DME.requestPermission === 'function') ps.push(DME.requestPermission().catch(function () { return 'denied'; }));
    Promise.all(ps).then(function (res) {
      if (res.indexOf('denied') >= 0) { sens.failNote = t('sensorsOff'); beacon('compass_denied'); }
      if ('ondeviceorientationabsolute' in window) window.addEventListener('deviceorientationabsolute', onOrient);
      window.addEventListener('deviceorientation', onOrient);
      window.addEventListener('devicemotion', onMotion);
      setTimeout(function () {
        if (!sens.compass) {
          var iOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
          sens.failNote = (!window.isSecureContext && iOS) ? t('sensorsNeedHttps') : t('sensorsOff');
          update();
        }
      }, 2500);
    });
  }
  function onOrient(e) {
    var h = null;
    if (e.webkitCompassHeading != null && !isNaN(e.webkitCompassHeading)) h = e.webkitCompassHeading;
    else if (e.absolute && e.alpha != null) {
      h = (360 - e.alpha) % 360;
      var so = (screen.orientation && screen.orientation.angle) || window.orientation || 0;
      h = (h + so + 360) % 360;
    }
    if (h == null) return;
    // low-pass on the unit circle
    if (sens.heading == null) sens.heading = h;
    else {
      var a = sens.heading * Math.PI / 180, b = h * Math.PI / 180, k = 0.25;
      var x = Math.cos(a) * (1 - k) + Math.cos(b) * k, y = Math.sin(a) * (1 - k) + Math.sin(b) * k;
      sens.heading = (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
    }
    if (!sens.compass) { sens.compass = true; beacon('compass_on'); if (northNow() == null) openCalib(); }
    schedUpdate();
  }
  var pd = { avg: 9.81, smooth: 9.81, armed: true, last: 0 };
  function onMotion(e) {
    var a = e.accelerationIncludingGravity;
    if (!a || a.x == null) return;
    var m = Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z);
    pd.smooth += (m - pd.smooth) * 0.35;
    pd.avg += (m - pd.avg) * 0.02;
    var dyn = pd.smooth - pd.avg, now = e.timeStamp || performance.now();
    if (pd.armed && dyn > 1.1 && now - pd.last > 280) {
      pd.armed = false; pd.last = now; onStep();
    } else if (!pd.armed && dyn < 0.2) pd.armed = true;
    if (!sens.motion) { sens.motion = true; schedUpdate(); }
  }
  function onStep() {
    sens.steps++;
    var f = cur();
    if (!f || $('#scrNav').hidden || f.s.kind === 'transition') return;
    legM = Math.min(legM + (cfg.strideMeters || 0.7), plan.legs[f.li].meters);
    if (legM >= f.s.endM - 0.5) {
      // auto-advance within the same leg; floor changes always wait for a tap
      if (ci >= flat.length - 1) { arrive(); return; }
      var nx = flat[ci + 1];
      if (nx.li === f.li) { ci++; enterStep(); return; }
    }
    schedUpdate();
  }
  var raf = 0;
  function schedUpdate() { if (!raf) raf = requestAnimationFrame(function () { raf = 0; if (!$('#scrNav').hidden) update(); }); }

  // ---------------- calibration ----------------
  function calibTarget() {
    var f = cur(); if (!f) return null;
    var leg = plan.legs[f.li], s = f.s;
    if (s.kind === 'transition' || s.kind === 'to-transition') {
      var tr = leg.transition;
      if (tr && tr.amenity) return { name: B.amenityName(tr.amenity), pt: { x: tr.amenity.x, y: tr.amenity.y } };
    }
    var lm = router.landmarkNear(leg.floor, s.end, 15, {});
    if (lm) return { name: lm.name, pt: { x: lm.x, y: lm.y } };
    return { name: B.lang === 'en' ? 'the next point on the route' : 'titik berikutnya pada rute', pt: s.end };
  }
  var calT = null;
  function openCalib() {
    calT = calibTarget();
    $('#calBody').textContent = t('calibrateBody', { x: calT ? calT.name : '' });
    $('#calSheet').hidden = false;
  }
  function saveCalib() {
    if (sens.heading == null || !calT) { $('#calSheet').hidden = true; return; }
    var f = cur(), leg = plan.legs[f.li];
    var here = B.pointAtM(leg, legM);
    var brg = mapBearing(here, calT.pt);
    sens.north = ((sens.heading - brg) % 360 + 360) % 360;
    try { localStorage.setItem(NORTH_KEY, String(sens.north)); } catch (e) {}
    $('#calSheet').hidden = true;
    update();
  }

  // ---------------- events ----------------
  $('#startBtn').addEventListener('click', startNav);
  $('#hereBtn').addEventListener('click', next);
  $('#prevBtn').addEventListener('click', prev);
  $('#flBtn').addEventListener('click', next);
  $('#flBack').addEventListener('click', prev);
  $('#calibBtn').addEventListener('click', openCalib);
  $('#calSave').addEventListener('click', saveCalib);
  $('#calCancel').addEventListener('click', function () { $('#calSheet').hidden = true; });
  $('#doneBtn').addEventListener('click', function () { show('#scrStart'); $('#mapStart').appendChild(mapEl); map.setKiosk(kiosk); map.setDot(null); });
  $('#restartBtn').addEventListener('click', startNav);
  $('#stepsNav').addEventListener('click', function (e) {
    var li = e.target.closest('li[data-i]'); if (!li) return;
    var i = +li.dataset.i, f = flat[i]; ci = i; legM = f.s.kind === 'transition' ? plan.legs[f.li].meters : f.s.startM; enterStep();
  });
  $('#pickTabs').addEventListener('click', function (e) {
    var b = e.target.closest('[data-ptab]'); if (!b || b.dataset.ptab === pick.tab) return;
    pick.tab = b.dataset.ptab; $('#pickQ').value = ''; renderPick();
  });
  $('#pickQ').addEventListener('input', renderPick);
  $('#pickList').addEventListener('click', function (e) {
    var b = e.target.closest('[data-pi]'); if (b) choose(pick.rows[+b.dataset.pi].item);
  });
  $('#pickFac').addEventListener('click', function (e) {
    var b = e.target.closest('[data-fac]'); if (!b) return;
    var a = router.nearestAmenity(origin.node, b.dataset.fac, accessible && b.dataset.fac !== 'escalator', pref);
    if (a) choose(poiTarget(a)); else $('#pickSub').textContent = t('noRoute');
  });
  $('#summary').addEventListener('click', function (e) { var b = e.target.closest('[data-chg]'); if (b) openPick(+b.dataset.chg); });
  $('#errPick').addEventListener('click', function () { openPick(2); });
  $('#langBtn').addEventListener('click', function () {
    B.setLang(B.lang === 'id' ? 'en' : 'id'); applyI18n();
    if (D && !$('#scrPick').hidden) renderPick();
    if (!D || !plan) return;
    var keep = ci, keepM = legM;
    buildPlan(); renderHeader(); renderStart(); if ($('#scrNav').hidden) map.setKiosk(kiosk); map.setDest(target);
    if (!$('#scrNav').hidden) { ci = Math.min(keep, flat.length - 1); legM = keepM; enterStep(); }
  });
  document.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-pref]');
    if (!btn) return;
    var np = btn.dataset.pref;
    if (np === pref) return;
    pref = np;
    accessible = (np === 'accessible');
    buildPlan();
    renderStart();
    if (plan && plan.ok) {
      var L0 = plan.legs[0];
      map.showFloor(L0.floor, { box: legBox(L0, 25), animate: false }).then(function () {
        map.setDest(target);
        map.setRoute(L0.floor, L0.pts, { animate: true, duration: 1.2, startMarker: false });
      });
      if (!$('#scrNav').hidden) { ci = 0; legM = 0; enterStep(); }
    }
  });
  document.addEventListener('gesturestart', function (e) { e.preventDefault(); });
  window.addEventListener('pagehide', function () { if (sens.started && !arrived) { arrived = true; beacon('abandon', { ci: ci }); } });

  window.__phone = { state: function () { return { ci: ci, legM: legM, steps: sens.steps, heading: sens.heading, north: sens.north, rot: sens.rot, compass: sens.compass, total: flat.length, kind: cur() && cur().s.kind }; },
    next: next, setNorth: function (v) { sens.north = v; update(); } };
})(window.BSB);
