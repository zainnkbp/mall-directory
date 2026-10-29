#!/usr/bin/env node
/*
 * UAT — parallel acceptance checks against the running dev server (php -S 127.0.0.1:8000 tools/dev_router.php).
 *   node tests/uat/uat.js [base=http://127.0.0.1:8000] [only=cli,api,floors,routes,flow,phone,cms]
 *   UAT_EMAIL=… UAT_PASSWORD=… node tests/uat/uat.js     also logs in to the real CMS (otherwise CMS runs in ?mock=1)
 *   PW=<playwright-core dir> CHROME=<chrome executable> override the browser (defaults: ms-playwright-go cache, system Chrome)
 *
 * Suites run at the same time, each in its own browser context:
 *   cli     route regression, verify_routes.py (default + accessible), validate.php from the DB
 *   api     public endpoints, admin endpoints refuse without login, every floor SVG / 3D model / logo in the snapshot loads
 *   floors  every floor via the floor switcher, then rapid random switching: right floor shown, 3D canvas drawn, kawasan on GF/UG
 *   routes  from every kiosk to one tenant per floor (best + accessible), clicking through every leg changes the map floor
 *   flow    attract -> search keyboard -> list -> detail -> route -> QR modal -> back -> home, language toggle, idle reset
 *   phone   m/ guidance page for a multi-floor route
 *   cms     every CMS page renders (mock data, or the real API with UAT_EMAIL/UAT_PASSWORD), no read-only page writes
 *   journey phone used for real: entrance / store -> preview -> destination -> "start" -> every step incl. floor changes -> arrived
 *   hosting the site opened as maps.ewalkpentacitymall.com (mapped to this server): kiosk QR uses that domain, no dev data
 *   embed   the phone page inside an iframe of another site (stand-in for the e-Walk website, tests/uat/embed.html)
 * cli also runs tests/uat/routes_allpairs.js (every start the phone offers -> every destination, full plans).
 * Telemetry and kiosk pings are blocked so a run leaves no analytics behind. Screenshots + report: tests/uat/out/.
 */
'use strict';
const path = require('path'), fs = require('fs'), cp = require('child_process'), os = require('os');
const ROOT = path.resolve(__dirname, '..', '..');
const arg = k => (process.argv.find(a => a.startsWith(k + '=')) || '').slice(k.length + 1);
const BASE = (arg('base') || 'http://127.0.0.1:8000').replace(/\/$/, '') + '/';
const ONLY = arg('only').split(',').filter(Boolean);
const OUT = path.join(__dirname, 'out') + '/';
const PW = process.env.PW || [path.join(os.homedir(), 'Library/Caches/ms-playwright-go/1.57.0/package'), 'playwright-core', 'playwright']
  .find(p => { try { require.resolve(p); return true; } catch (e) { return false; } });
const CHROME = process.env.CHROME || ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium']
  .find(p => fs.existsSync(p));
fs.mkdirSync(OUT, { recursive: true });

const results = [];
function ok(suite, name, cond, info) {
  results.push({ suite, name, ok: !!cond, info: info == null ? '' : String(info) });
  if (!cond) console.log('  FAIL [' + suite + '] ' + name + (info != null ? '  — ' + info : ''));
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
const want = s => !ONLY.length || ONLY.includes(s);
const DIR = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/directory.json'), 'utf8'));
const REG = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/3d/floors.json'), 'utf8')).floors;

// ------------------------------------------------------------------ cli
function run(cmd, args) {
  return new Promise(res => {
    const t0 = Date.now();
    cp.execFile(cmd, args, { cwd: ROOT, maxBuffer: 64 << 20 }, (err, stdout, stderr) =>
      res({ code: err ? (err.code || 1) : 0, out: String(stdout) + String(stderr), ms: Date.now() - t0 }));
  });
}
async function suiteCli() {
  const jobs = [
    ['route regression', process.execPath, ['tests/wpc/route_regression.js']],
    ['verify_routes default', 'python3', ['tools/verify_routes.py']],
    ['verify_routes accessible', 'python3', ['tools/verify_routes.py', '--accessible']],
    ['validate.php (DB)', 'php', ['tools/validate.php']],
    ['validate.php accessible (DB)', 'php', ['tools/validate.php', '--accessible']],
    ['all start/destination pairs (phone)', process.execPath, ['tests/uat/routes_allpairs.js']],
  ];
  const rs = await Promise.all(jobs.map(j => run(j[1], j[2])));
  rs.forEach((r, i) => {
    const tail = r.out.trim().split('\n').slice(-2).join(' | ').slice(0, 220);
    ok('cli', jobs[i][0], r.code === 0, tail);
  });
}

// ------------------------------------------------------------------ api
async function get(url) {
  try { const r = await fetch(url, { redirect: 'manual' }); return { status: r.status, body: await r.text(), type: r.headers.get('content-type') || '' }; }
  catch (e) { return { status: 0, body: String(e), type: '' }; }
}
async function suiteApi() {
  const v = await get(BASE + 'api/version');
  let vj = null; try { vj = JSON.parse(v.body); } catch (e) {}
  ok('api', 'GET api/version', v.status === 200 && vj && vj.directory, v.status);
  ok('api', 'version matches data/directory.json', vj && vj.directory && vj.directory.version === DIR.meta.version, vj && vj.directory && vj.directory.version + ' vs ' + DIR.meta.version);
  for (const p of ['api/admin/tenants', 'api/admin/graph', 'api/admin/publish/preview', 'api/admin/3d/floors']) {
    const r = await get(BASE + p);
    ok('api', 'no login -> refused: ' + p, r.status === 401 || r.status === 403, r.status);
  }
  for (const p of ['index.html', 'm/index.html', 'cms/login.html', 'cms/index.html', 'data/promos.json', 'data/status.json', 'data/3d/floors.json']) {
    const r = await get(BASE + p);
    ok('api', 'GET ' + p, r.status === 200, r.status);
  }
  // every asset the snapshot points at
  const assets = new Set();
  DIR.floors.forEach(f => assets.add(f.svg));
  DIR.tenants.forEach(t => t.logo && assets.add(t.logo));
  Object.values(REG).forEach(e => { assets.add(e.model); });
  const missing = [];
  const list = [...assets];
  for (let i = 0; i < list.length; i += 16) {
    const rs = await Promise.all(list.slice(i, i + 16).map(a => fetch(BASE + a, { method: 'HEAD' }).then(r => [a, r.status], () => [a, 0])));
    rs.forEach(([a, s]) => { if (s !== 200) missing.push(a + ' (' + s + ')'); });
  }
  ok('api', 'snapshot assets load (' + list.length + ')', !missing.length, missing.slice(0, 5).join(', '));
  // the kawasan (surroundings) of the joined floors
  for (const fid of ['gf', 'ug']) {
    const m = JSON.parse(fs.readFileSync(path.join(ROOT, REG[fid].model), 'utf8'));
    const kinds = {}; (m.context || []).forEach(c => { kinds[c.kind] = (kinds[c.kind] || 0) + 1; });
    ok('api', fid + ' model has kawasan land/roads/buildings', kinds.ground >= 1 && kinds.road >= 1 && kinds.building >= 10, JSON.stringify(kinds));
    const bad = (m.context || []).filter(c => !c.poly || c.poly.length < 3 || c.poly.some(p => !isFinite(p[0]) || !isFinite(p[1])));
    ok('api', fid + ' kawasan outlines valid', !bad.length, bad.length + ' bad');
  }
}

// ------------------------------------------------------------------ browser helpers
let browser = null;
async function newPage(ctxOpts, tag) {
  const ctx = await browser.newContext(Object.assign({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 }, ctxOpts || {}));
  await ctx.route(/\/api\/(telemetry|kiosk\/ping|phone\/beacon)/, r => r.fulfill({ status: 204, body: '' }));
  const page = await ctx.newPage();
  page._errors = [];
  // a failed load is reported once, by URL (the console line "Failed to load resource" carries no URL)
  page.on('console', m => { if (m.type() === 'error' && !/favicon|Failed to load resource/i.test(m.text())) page._errors.push(m.text().slice(0, 200)); });
  page.on('response', r => { if (r.status() >= 400 && !/favicon/.test(r.url())) page._errors.push(r.status() + ' ' + r.url().replace(BASE, '')); });
  page.on('console', m => { if (/Too many active WebGL contexts/.test(m.text())) page._glEvicted = (page._glEvicted || 0) + 1; });
  page.on('pageerror', e => page._errors.push('pageerror: ' + String(e.message || e).slice(0, 200)));
  page.on('requestfailed', r => { if (!/telemetry|ping|beacon/.test(r.url())) page._errors.push('requestfailed: ' + r.url().replace(BASE, '') + ' ' + (r.failure() || {}).errorText); });
  page._tag = tag;
  return page;
}
async function kioskPage(params, tag) {
  const page = await newPage(null, tag);
  await page.goto(BASE + 'index.html?attract=0&' + (params || ''));
  await page.waitForFunction(() => window.__kioskReady, null, { timeout: 60000 });
  return page;
}
// map state after a floor change has settled; canvas pixels are read in the same task as a render
const mapState = page => page.evaluate(() => {
  const m = window.BSB_MAP, L = m.layers[m.floor] || {};
  const out = { floor: m.floor, is3d: !!(m.is3dShown && m.is3dShown()), visible: L.outer && L.outer.style.visibility !== 'hidden', ctx: 0, units: 0, drawn: 0 };
  if (L.three) {
    const sc = L.three.scene;
    out.ctx = sc.ctxG ? sc.ctxG.children.length : 0;
    out.units = sc.unitG ? sc.unitG.children.length : 0;
    m._render3d(L);
    const gl = L.three.renderer.getContext(), w = gl.drawingBufferWidth, h = gl.drawingBufferHeight, px = new Uint8Array(4);
    out.lost = gl.isContextLost();
    for (let i = 1; i < 24; i++) for (let j = 1; j < 24; j++) {
      gl.readPixels(Math.floor(w * i / 24), Math.floor(h * j / 24), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      if (px[3] > 0) out.drawn++;
    }
  }
  const btn = document.querySelector('#floorSwitch .fs-btn.on');
  out.switcher = btn ? btn.dataset.floor : null;
  return out;
});
async function waitFloor(page, fid) {
  try { await page.waitForFunction(f => window.BSB_MAP.floor === f && !window.BSB_MAP._anim, fid, { timeout: 15000 }); } catch (e) {}
  await sleep(700);
}
// a 3D floor that is still being built right after the switch gets 2 s more; st.late = it needed them
async function settled(page, fid) {
  await waitFloor(page, fid);
  let st = await mapState(page);
  if (REG[fid] && st.drawn <= 5) { await sleep(2000); st = await mapState(page); st.late = true; }
  return st;
}
function checkFloor(suite, label, st, fid) {
  ok(suite, label + ': map shows ' + fid, st.floor === fid, st.floor);
  ok(suite, label + ': switcher highlights ' + fid, st.switcher === fid, st.switcher);
  if (REG[fid]) {
    ok(suite, label + ': 3D drawn', st.is3d && st.visible && st.units > 0 && st.drawn > 5, JSON.stringify({ is3d: st.is3d, visible: st.visible, units: st.units, drawn: st.drawn }));
    if (fid === 'gf' || fid === 'ug') ok(suite, label + ': kawasan rendered', st.ctx > 50, st.ctx + ' meshes');
  }
}
function errorsOk(suite, page, label) {
  ok(suite, label + ': no console errors', !page._errors.length, page._errors.slice(0, 3).join(' || '));
}

// ------------------------------------------------------------------ floors
async function suiteFloors() {
  const page = await kioskPage('', 'floors');
  const ids = DIR.floors.map(f => f.id);
  for (const fid of ids) {
    const t0 = Date.now();
    await page.click('#floorSwitch [data-floor="' + fid + '"]');
    const st = await settled(page, fid);
    checkFloor('floors', 'switch to ' + fid + ' (' + (Date.now() - t0) + ' ms)', st, fid);
    await page.screenshot({ path: OUT + 'floor-' + fid + '.png' });
  }
  // rapid switching: tap a new floor before the previous animation ends; the last tap must win
  let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  let last = null;
  for (let i = 0; i < 30; i++) {
    last = ids[Math.floor(rnd() * ids.length)];
    await page.click('#floorSwitch [data-floor="' + last + '"]');
    await sleep(80 + Math.floor(rnd() * 250));
  }
  await waitFloor(page, last); await sleep(800);
  checkFloor('floors', 'after 30 rapid switches', await mapState(page), last);
  // 3D controls: rotate, reset, zoom, layer toggles keep the floor drawn
  await page.click('#floorSwitch [data-floor="ug"]'); await waitFloor(page, 'ug');
  for (const sel of ['[data-v="left"]', '[data-v="right"]', '[data-v="north"]', '[data-z="in"]', '[data-z="out"]']) {
    const el = await page.$(sel); if (el) { await el.click(); await sleep(500); }
  }
  checkFloor('floors', 'ug after rotate/zoom', await mapState(page), 'ug');
  await page.click('[data-z="home"], [data-z="reset"], #zoomCtl [data-z]:not([data-z="in"]):not([data-z="out"])').catch(() => {});
  await sleep(1500);
  const kf = await page.evaluate(() => window.BSB_S && (window.BSB.D.kioskById[window.BSB.kioskIdentity().id] || window.BSB.D.kiosks[0]).floor);
  ok('floors', '"you are here" button returns to the kiosk floor', (await mapState(page)).floor === kf, kf);
  errorsOk('floors', page, 'floor switching');
  await page.context().close();
}

// ------------------------------------------------------------------ routes
function targetsFor() { // one tenant per floor, the first by name with a node
  const by = {};
  DIR.tenants.slice().sort((a, b) => a.name.localeCompare(b.name)).forEach(t => { if (t.node && !by[t.floor]) by[t.floor] = t; });
  return Object.values(by);
}
async function routeOne(page, kid, t, pref) {
  const label = kid + ' → ' + t.id + (pref ? ' [' + pref + ']' : '');
  await page.evaluate(id => { const m = window.BSB_MAP; m.onTenantTap(window.BSB.D.tenantById[id]); }, t.id);
  await page.waitForSelector('#goRoute', { timeout: 20000 });
  if (pref) { const b = await page.$('[data-pref="' + pref + '"]'); if (b) await b.click(); }
  await page.click('#goRoute');
  await page.waitForFunction(() => document.querySelector('.view.is-active').dataset.view === 'route', null, { timeout: 20000 });
  const plan = await page.evaluate(() => { const P = window.BSB_S.plan; return P && { ok: P.ok, reason: P.reason, legs: P.ok ? P.legs.map(l => l.floor) : [] }; });
  ok('routes', label + ': route found', plan && plan.ok, plan && (plan.reason || ''));
  if (plan && plan.ok) {
    const n = await page.$$eval('#legs [data-leg]', b => b.length);
    ok('routes', label + ': leg list matches plan', n === plan.legs.length, n + ' vs ' + plan.legs.length);
    for (let i = 0; i < plan.legs.length; i++) {
      await page.click('#legs [data-leg="' + i + '"]');
      const st = await settled(page, plan.legs[i]);
      ok('routes', label + ': leg ' + (i + 1) + ' shows ' + plan.legs[i], st.floor === plan.legs[i] && (!REG[plan.legs[i]] || (st.is3d && st.drawn > 5)), JSON.stringify({ floor: st.floor, drawn: st.drawn, late: !!st.late, contextLost: !!st.lost }));
    }
    const hasRoute = await page.evaluate(() => { const m = window.BSB_MAP; return !!(m.route || m._route || document.querySelector('#map .route, #map path.rt, #map [class*="route"]')); });
    ok('routes', label + ': route line on map', hasRoute);
  }
  // back to home for the next one
  await page.evaluate(() => { const b = document.querySelector('.view.is-active [data-back], .view.is-active .back, #route [data-act="back"]'); if (b) b.click(); });
  await page.keyboard.press('Escape').catch(() => {});
}
async function suiteRoutes() {
  const kiosks = DIR.kiosks.map(k => k.id), targets = targetsFor();
  const pool = kiosks.slice(), workers = [];
  for (let w = 0; w < Math.min(3, pool.length); w++) workers.push((async () => {
    let kid;
    while ((kid = pool.shift())) {
      const page = await kioskPage('kiosk=' + encodeURIComponent(kid), 'routes-' + kid);
      const st = await mapState(page);
      const k = DIR.kiosks.find(x => x.id === kid);
      ok('routes', kid + ': kiosk opens on its own floor (' + k.floor + ')', st.floor === k.floor, st.floor);
      for (const t of targets) {
        try { await routeOne(page, kid, t); } catch (e) { ok('routes', kid + ' → ' + t.id + ': no exception', false, e.message.split('\n')[0]); }
      }
      // accessible mode on the farthest target
      const far = targets.find(t => t.floor !== k.floor);
      if (far) { try { await routeOne(page, kid, far, 'accessible'); } catch (e) { ok('routes', kid + ' accessible: no exception', false, e.message.split('\n')[0]); } }
      await page.screenshot({ path: OUT + 'route-' + kid + '.png' });
      errorsOk('routes', page, kid);
      await page.context().close();
    }
  })());
  await Promise.all(workers);
}

// ------------------------------------------------------------------ flow
async function suiteFlow() {
  const page = await newPage(null, 'flow');
  await page.goto(BASE + 'index.html');
  await page.waitForFunction(() => window.__kioskReady, null, { timeout: 60000 });
  const attract = await page.$eval('#attract', e => getComputedStyle(e).display !== 'none' && !e.hidden).catch(() => false);
  ok('flow', 'attract screen shows on start', attract);
  await page.mouse.click(960, 540); await sleep(800);
  ok('flow', 'tap closes the attract screen', await page.$eval('#attract', e => e.hidden || getComputedStyle(e).display === 'none' || getComputedStyle(e).opacity === '0' || !e.classList.contains('on')).catch(() => true));
  // search with the on-screen keyboard
  await page.click('#searchBox').catch(() => page.click('#searchQ'));
  await sleep(400);
  for (const k of ['S', 'O', 'L']) { const b = await page.$('#oskKeys [data-k="' + k + '"]'); if (b) await b.click(); await sleep(120); }
  await sleep(600);
  const items = await page.$$eval('#list [data-t]', l => l.length).catch(() => 0);
  ok('flow', 'keyboard search "SOL" lists tenants', items > 0, items);
  if (items) {
    await page.click('#list [data-t]');
    await page.waitForSelector('#goRoute', { timeout: 20000 });
    ok('flow', 'list -> detail', await page.evaluate(() => document.querySelector('.view.is-active').dataset.view === 'detail'));
    await page.click('#goRoute');
    await sleep(1500);
    ok('flow', 'detail -> route', await page.evaluate(() => document.querySelector('.view.is-active').dataset.view === 'route'));
    const qr = await page.$('.qr-card');
    if (qr) {
      await qr.click(); await sleep(400);
      ok('flow', 'QR modal opens', await page.$eval('#qrModal', e => !e.hidden));
      await page.click('#qrModalClose'); await sleep(300);
      ok('flow', 'QR modal closes', await page.$eval('#qrModal', e => e.hidden));
    }
    const url = await page.evaluate(() => document.querySelector('#route').dataset.url || '');
    ok('flow', 'route has a phone URL', /\/m\/\?k=/.test(url), url.replace(/^https?:\/\/[^/]+/, ''));
  }
  // back to home through the view stack
  for (let i = 0; i < 4; i++) { const b = await page.$('.view.is-active [data-back], .view.is-active .back, .view.is-active [data-act="back"]'); if (!b) break; await b.click(); await sleep(400); }
  ok('flow', 'back returns to home', await page.evaluate(() => document.querySelector('.view.is-active').dataset.view === 'home'));
  // language toggle
  const before = await page.$eval('#azBtn', e => e.textContent.trim()).catch(() => '');
  await page.click('#langBtn'); await sleep(400);
  const after = await page.$eval('#azBtn', e => e.textContent.trim()).catch(() => '');
  ok('flow', 'language toggle changes texts', before !== after, before.slice(0, 30) + ' -> ' + after.slice(0, 30));
  await page.click('#langBtn'); await sleep(200);
  // category -> list, amenity "nearest" route
  const cat = await page.$('#catGrid [data-cat]');
  if (cat) { await cat.click(); await sleep(500); ok('flow', 'category opens a list', (await page.$$('#list [data-t]')).length > 0); }
  for (let i = 0; i < 3; i++) { const b = await page.$('.view.is-active [data-back], .view.is-active .back'); if (!b) break; await b.click(); await sleep(300); }
  const am = await page.$('#amenRow [data-amen="lift"]');
  if (am) {
    await am.click(); await sleep(1500);
    ok('flow', 'nearest lift gives a route', await page.evaluate(() => window.BSB_S.plan && window.BSB_S.plan.ok));
  }
  await page.screenshot({ path: OUT + 'flow.png' });
  errorsOk('flow', page, 'kiosk flow');
  await page.context().close();
}

// ------------------------------------------------------------------ phone
async function suitePhone() {
  const k = DIR.kiosks.find(x => x.floor === 'gf') || DIR.kiosks[0];
  const t = DIR.tenants.find(x => x.node && x.floor !== k.floor);
  const page = await newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }, 'phone');
  await page.goto(BASE + 'm/?k=' + k.id + '&t=' + t.id + '&pref=best&a=0&lang=id');
  try { await page.waitForFunction(() => window.__phoneReady, null, { timeout: 60000 }); } catch (e) {}
  ok('phone', 'phone page ready (' + k.id + ' → ' + t.id + ')', await page.evaluate(() => !!window.__phoneReady));
  const txt = await page.evaluate(() => document.body.innerText);
  ok('phone', 'shows the destination name', txt.includes(t.name), t.name);
  await page.screenshot({ path: OUT + 'phone.png' });
  errorsOk('phone', page, 'phone');
  await page.context().close();
  await phoneSelfStart();
}
// opened without a kiosk QR: the visitor picks the start (entrance / store) and the destination
async function phoneSelfStart() {
  const mobile = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 };
  const ready = p => p.waitForFunction(() => window.__phoneReady, null, { timeout: 60000 }).then(() => true, () => false);
  const step = (p, n) => p.waitForFunction(n => !document.querySelector('#scrPick').hidden && document.querySelector('#pickStep').textContent.includes(n), String(n), { timeout: 10000 }).then(() => true, () => false);
  // tapping a start point opens its preview: the spot on a drawn 3D map + nearby stores, then "Yes, I'm here"
  const confirmPreview = async (p, label) => {
    const open = await p.waitForSelector('#pickSheet:not([hidden])', { timeout: 10000 }).then(() => true, () => false);
    await sleep(1500);
    const st = await p.evaluate(() => {
      const m = window.__phone.map(), L = m && m.layers[m.floor], out = { floor: m && m.floor, inSheet: !!document.querySelector('#pvMap .map-holder'), drawn: 0, near: document.querySelector('#pvNear').textContent };
      if (L && L.three) {
        m._render3d(L);
        const gl = L.three.renderer.getContext(), px = new Uint8Array(4);
        for (let i = 1; i < 12; i++) for (let j = 1; j < 12; j++) { gl.readPixels(Math.floor(gl.drawingBufferWidth * i / 12), Math.floor(gl.drawingBufferHeight * j / 12), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); if (px[3]) out.drawn++; }
      }
      return out;
    });
    ok('phone', label + ': preview shows the spot on the map', open && st.inSheet && st.drawn > 20, JSON.stringify(st));
    ok('phone', label + ': preview names nearby stores', st.near.length > 5, st.near);
    await p.click('#pvYes');
  };
  // 1. nothing in the URL -> step 1 with every entrance, then search a destination
  let page = await newPage(mobile, 'phone-self');
  await page.goto(BASE + 'm/?lang=id');
  ok('phone', 'm/ without kiosk opens step 1 (not "invalid link")', await step(page, 1), await page.evaluate(() => document.querySelector('#errTxt').textContent));
  const nLobby = await page.$$eval('#pickList .pick-row', l => l.length);
  ok('phone', 'step 1 lists the entrances (kiosks + CMS lobby points)', nLobby >= DIR.kiosks.length, nLobby);
  await page.screenshot({ path: OUT + 'phone-pick1.png' });
  await page.click('#pickList .pick-row');
  await page.waitForSelector('#pickSheet:not([hidden])', { timeout: 10000 }).catch(() => {});
  await page.click('#pvNo');
  ok('phone', '"No, choose another" closes the preview and stays on step 1', await page.evaluate(() => document.querySelector('#pickSheet').hidden) && await step(page, 1));
  await page.click('#pickList .pick-row');
  await confirmPreview(page, 'entrance');
  await page.screenshot({ path: OUT + 'phone-preview.png' });
  ok('phone', 'choosing an entrance opens step 2', await step(page, 2));
  await page.fill('#pickQ', 'sol'); await sleep(300);
  const nRes = await page.$$eval('#pickList .pick-row', l => l.length);
  ok('phone', 'step 2 search "sol" finds stores', nRes > 0, nRes);
  await page.screenshot({ path: OUT + 'phone-pick2.png' });
  await page.click('#pickList .pick-row');
  ok('phone', 'entrance -> store: route ready', await ready(page));
  const st = await page.evaluate(() => ({ url: location.search, from: (document.querySelector('#summary .from') || {}).textContent || '' }));
  ok('phone', 'choices kept in the URL (from= & t=)', /from=/.test(st.url) && /[?&]t=/.test(st.url), st.url);
  ok('phone', 'start shown as an entrance, not "from kiosk"', /pintu masuk/i.test(st.from) && !/kiosk/i.test(st.from), st.from.trim());
  await page.screenshot({ path: OUT + 'phone-pick3.png' });
  // 2. "change destination" -> nearest toilet from the same start
  await page.click('[data-chg="2"]');
  ok('phone', '"change destination" reopens step 2', await step(page, 2));
  const fac = await page.$('#pickFac [data-fac="toilet"]');
  if (fac) {
    await page.evaluate(() => { window.__phoneReady = false; });
    await fac.click();
    ok('phone', 'nearest toilet from the entrance: route ready', await ready(page));
  }
  errorsOk('phone', page, 'phone self-start (entrance)');
  await page.context().close();
  // 3. a store as the start
  page = await newPage(mobile, 'phone-self-store');
  await page.goto(BASE + 'm/?lang=en');
  await step(page, 1);
  await page.click('#pickTabs [data-ptab="store"]');
  await page.fill('#pickQ', 'starbucks'); await sleep(300);
  const hasStore = await page.$('#pickList .pick-row');
  ok('phone', '"near a store" tab finds stores', !!hasStore);
  if (hasStore) {
    await hasStore.click();
    await confirmPreview(page, 'store');
    await step(page, 2);
    await page.click('#pickList .pick-row');
    ok('phone', 'store -> store: route ready', await ready(page));
    const from = await page.evaluate(() => (document.querySelector('#summary .from') || {}).textContent || '');
    ok('phone', 'start shown as "From <store>"', /^\s*From /.test(from) && !/kiosk/i.test(from), from.trim());
  }
  errorsOk('phone', page, 'phone self-start (store)');
  await page.context().close();
  // 4. a lobby sticker (from=<entrance>) skips straight to step 2
  page = await newPage(mobile, 'phone-sticker');
  await page.goto(BASE + 'm/?lang=id&from=' + DIR.kiosks[0].id);
  ok('phone', 'm/?from=<entrance> opens step 2 directly', await step(page, 2));
  errorsOk('phone', page, 'phone lobby sticker');
  await page.context().close();
}

// ------------------------------------------------------------------ cms
const CMS_PAGES = ['', 'tenants', 'categories', 'media', 'floors', 'map3d', 'graph', 'connectors', 'kiosks', 'amenities', 'ops',
  'promos', 'events', 'featured', 'i18n', 'publish', 'analytics', 'audit', 'users', 'settings'];
async function suiteCms() {
  const real = !!(process.env.UAT_EMAIL && process.env.UAT_PASSWORD);
  const page = await newPage({ viewport: { width: 1440, height: 900 } }, 'cms');
  const writes = [];
  page.on('request', r => { if (r.method() !== 'GET' && /\/api\/admin\//.test(r.url()) && !/\/auth\//.test(r.url())) writes.push(r.method() + ' ' + r.url().replace(BASE, '')); });
  // mock mode still asks for a login (any email / password)
  const mode = real ? 'real' : 'mock';
  await page.goto(BASE + 'cms/login.html?mock=' + (real ? '0' : '1'));
  await page.fill('#email', real ? process.env.UAT_EMAIL : 'uat@bsb.local');
  await page.fill('#password', real ? process.env.UAT_PASSWORD : 'uat-mock-only');
  await page.click('#go');
  await page.waitForSelector('#main .sb-link, .sb-link', { timeout: 15000 }).catch(() => {});
  ok('cms', mode + ' login opens the CMS', !/login\.html/.test(page.url()) && !!(await page.$('.sb-link')), page.url().replace(BASE, ''));
  for (const p of CMS_PAGES) {
    page._errors.length = 0;
    await page.evaluate(h => { location.hash = '#/' + h; }, p);
    await sleep(p === 'map3d' || p === 'graph' || p === 'floors' ? 3500 : 1500);
    const st = await page.evaluate(() => {
      const el = document.querySelector('#main .page');
      if (!el) return { shell: false, login: /login\.html/.test(location.href) };
      return { shell: true, text: el.innerText.length, notFound: /Halaman tidak ditemukan/.test(el.innerText),
        errBox: !!el.querySelector('.callout.danger:not([hidden])'), active: (document.querySelector('.sb-link.active') || {}).textContent || '' };
    });
    // the mock fixtures carry one validation error on purpose (cms/mock: a tenant without a node) -> red box on #/publish
    const errOk = !st.errBox || (!real && p === 'publish');
    ok('cms', mode + ' #/' + p + ' renders', st.shell && !st.notFound && st.text > 40 && errOk, JSON.stringify(st));
    errorsOk('cms', page, mode + ' #/' + p);
    await page.screenshot({ path: OUT + 'cms-' + (p || 'dashboard') + '.png' });
  }
  // the 3D plan of the joined floors
  await page.evaluate(() => { location.hash = '#/map3d'; }); await sleep(2500);
  ok('cms', mode + ' read-only browsing made no writes', !writes.length, writes.slice(0, 5).join(', '));
  await page.context().close();
}

// ------------------------------------------------------------------ journey / hosting / embed
// the public names are mapped to this server inside the test browser (--host-resolver-rules), the port stays
const HOST_SITE = 'maps.ewalkpentacitymall.com', HOST_WEB = 'web.ewalkpentacitymall.test';
const PORT = new URL(BASE).port;
const SITE = 'http://' + HOST_SITE + (PORT ? ':' + PORT : '') + '/';
const MOBILE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 };
const plainName = s => String(s).replace(/ /g, ' ');

// picker: tap the row titled exactly `name` (after typing `q` into the search box when given)
async function pickRow(f, name, q) {
  if (q != null) { await f.fill('#pickQ', q); await sleep(250); }
  const rows = await f.$$('#pickList .pick-row');
  for (const r of rows) if (plainName(await r.$eval('b', b => b.textContent)) === plainName(name)) { await r.click(); return true; }
  return false;
}
const phoneReady = f => f.waitForFunction(() => window.__phoneReady, null, { timeout: 60000 }).then(() => true, () => false);
// "Start navigation", then "I'm here" on every step and "I'm on <floor>" on every floor change, until "You've arrived"
async function walkToArrival(f) {
  await f.click('#startBtn');
  let sheets = 0, taps = 0, floors = [];
  for (; taps < 120; taps++) {
    if (await f.evaluate(() => !document.querySelector('#scrDone').hidden)) return { arrived: true, sheets, taps, floors };
    if (await f.evaluate(() => !document.querySelector('#floorSheet').hidden)) { sheets++; await f.click('#flBtn'); }
    else await f.click('#hereBtn');
    await sleep(300);
    const fl = await f.evaluate(() => { const m = window.__phone.map(); return m && m.floor; });
    if (fl && floors[floors.length - 1] !== fl) floors.push(fl);
  }
  return { arrived: false, sheets, taps, floors };
}

async function suiteJourney() {
  const byName = (a, b) => a.name.localeCompare(b.name);
  const onFloor = fl => DIR.tenants.filter(t => t.node && t.floor === fl).sort(byName)[0];
  const far = ['sf-penta', 'lg-ewalk', 'ff-ewalk', 'ug', 'lg-penta', 'ff-penta', 'gf', 'sf-ewalk'];
  // every entrance to a store on another floor (2F E-Walk included: no lift there, escalator route)
  const cases = DIR.kiosks.map((k, i) => ({ from: k, tab: 'lobby', to: onFloor(far.filter(f => f !== k.floor)[i % 7]) }));
  const s = ['lg-penta', 'ff-ewalk', 'ug', 'sf-penta'].map(onFloor);
  cases.push({ from: s[0], tab: 'store', to: s[1] }, { from: s[2], tab: 'store', to: s[3] }, { from: s[1], tab: 'store', fac: 'toilet' });
  const pool = cases.slice();
  await Promise.all([0, 1, 2].map(async () => {
    let c;
    while ((c = pool.shift())) {
      const label = c.from.name + ' -> ' + (c.fac || c.to.name);
      const page = await newPage(MOBILE, 'journey');
      try {
        await page.goto(BASE + 'm/?lang=id');
        await page.waitForSelector('#scrPick:not([hidden]) .pick-row', { timeout: 30000 });
        if (c.tab === 'store') await page.click('#pickTabs [data-ptab="store"]');
        const picked = await pickRow(page, c.from.name, c.tab === 'store' ? c.from.name : null);
        await page.waitForSelector('#pickSheet:not([hidden])', { timeout: 10000 });
        await page.click('#pvYes');
        await page.waitForFunction(() => document.querySelector('#pickStep').textContent.includes('2'), null, { timeout: 10000 });
        if (c.fac) await page.click('#pickFac [data-fac="' + c.fac + '"]');
        else await pickRow(page, c.to.name, c.to.name);
        const ready = await phoneReady(page);
        ok('journey', label + ': route ready', picked && ready);
        if (ready) {
          const w = await walkToArrival(page);
          ok('journey', label + ': walked to "arrived" (' + w.taps + ' taps, ' + w.sheets + ' floor changes)', w.arrived, JSON.stringify(w));
          if (!c.fac && c.to.floor !== c.from.floor) ok('journey', label + ': floor change shown and map ends on ' + c.to.floor, w.sheets > 0 && w.floors[w.floors.length - 1] === c.to.floor, w.floors.join(' > '));
        }
      } catch (e) { ok('journey', label + ': no exception', false, e.message.split('\n')[0]); }
      errorsOk('journey', page, label);
      await page.context().close();
    }
  }));
}

async function suiteHosting() {
  // kiosk on the public domain; ?fixture= must do nothing there
  const page = await newPage(null, 'hosting');
  await page.goto(SITE + 'index.html?attract=0&fixture=v2');
  const up = await page.waitForFunction(() => window.__kioskReady, null, { timeout: 60000 }).then(() => true, () => false);
  ok('hosting', 'kiosk opens on ' + HOST_SITE, up);
  const st = await page.evaluate(() => ({ host: location.host, dev: window.BSB.devMode, version: window.BSB.D && window.BSB.D.meta.version }));
  ok('hosting', 'dev features off on a public domain (?fixture= ignored)', !st.dev && st.version === DIR.meta.version, JSON.stringify(st));
  const t = DIR.tenants.find(x => x.node && x.floor !== 'gf');
  await page.evaluate(id => window.BSB_MAP.onTenantTap(window.BSB.D.tenantById[id]), t.id);
  await page.click('#goRoute'); await sleep(1500);
  const url = await page.evaluate(() => document.querySelector('#route').dataset.url || '');
  ok('hosting', 'kiosk QR opens the site itself (not the LAN address in config.js)', url.indexOf(SITE + 'm/?k=') === 0, url);
  const urls = await page.evaluate(async () => {
    const out = {};
    for (const p of ['api/version', 'data/directory.json', 'data/3d/floors.json', 'm/', 'cms/login.html']) {
      try { out[p] = (await fetch(p, { cache: 'no-store' })).status; } catch (e) { out[p] = 0; }
    }
    return out;
  });
  ok('hosting', 'API, data, phone page and CMS answer on the domain', Object.values(urls).every(s => s === 200), JSON.stringify(urls));
  errorsOk('hosting', page, 'kiosk on ' + HOST_SITE);
  await page.context().close();
  // the QR link opened on a phone
  if (url) {
    const ph = await newPage(MOBILE, 'hosting-phone');
    await ph.goto(url);
    ok('hosting', 'phone opens the kiosk QR link', await phoneReady(ph));
    errorsOk('hosting', ph, 'phone from the kiosk QR');
    await ph.context().close();
  }
}

async function suiteEmbed() {
  // tests/ is not served (dev_router / .htaccess): the stand-in website page is handed to the browser directly
  const parent = 'http://' + HOST_WEB + (PORT ? ':' + PORT : '') + '/embed.html?src=' + encodeURIComponent(SITE + 'm/?lang=id');
  const parentHtml = fs.readFileSync(path.join(__dirname, 'embed.html'), 'utf8');
  for (const [tag, opts] of [['desktop', { viewport: { width: 1280, height: 900 } }], ['mobile', MOBILE]]) {
    const page = await newPage(opts, 'embed-' + tag);
    await page.route(u => u.host === new URL(parent).host && u.pathname === '/embed.html', r => r.fulfill({ status: 200, contentType: 'text/html', body: parentHtml }));
    try {
      await page.goto(parent);
      const f = await (await page.waitForSelector('#bsbMap')).contentFrame();
      const loaded = await f.waitForSelector('#scrPick:not([hidden]) .pick-row', { timeout: 30000 }).then(() => true, () => false);
      ok('embed', tag + ': map page loads inside the website iframe (cross-origin)', loaded && new URL(f.url()).host !== new URL(page.url()).host, f.url());
      await f.click('#pickList .pick-row');
      await f.waitForSelector('#pickSheet:not([hidden])', { timeout: 10000 }); await sleep(1500);
      const drawn = await f.evaluate(() => {
        const m = window.__phone.map(), L = m && m.layers[m.floor]; let n = 0;
        if (L && L.three) { m._render3d(L); const gl = L.three.renderer.getContext(), px = new Uint8Array(4);
          for (let i = 1; i < 10; i++) for (let j = 1; j < 10; j++) { gl.readPixels(Math.floor(gl.drawingBufferWidth * i / 10), Math.floor(gl.drawingBufferHeight * j / 10), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); if (px[3]) n++; } }
        return n;
      });
      ok('embed', tag + ': 3D preview draws inside the iframe', drawn > 10, drawn);
      await f.click('#pvYes');
      await f.waitForFunction(() => document.querySelector('#pickStep').textContent.includes('2'), null, { timeout: 10000 });
      await f.fill('#pickQ', 'sol'); await sleep(250);
      await f.click('#pickList .pick-row');
      ok('embed', tag + ': route inside the iframe', await phoneReady(f));
      const lay = await f.evaluate(() => ({ hscroll: document.documentElement.scrollWidth > innerWidth, w: innerWidth }));
      ok('embed', tag + ': no sideways scrolling in the iframe', !lay.hscroll, JSON.stringify(lay));
      await f.click('#startBtn');
      ok('embed', tag + ': navigation starts inside the iframe', await f.waitForSelector('#scrNav:not([hidden])', { timeout: 10000 }).then(() => true, () => false));
      await page.screenshot({ path: OUT + 'embed-' + tag + '.png' });
    } catch (e) { ok('embed', tag + ': no exception', false, e.message.split('\n')[0]); }
    errorsOk('embed', page, tag);
    await page.context().close();
  }
}

// ------------------------------------------------------------------ main
(async () => {
  const t0 = Date.now();
  const up = await get(BASE + 'api/version');
  if (up.status !== 200) { console.error('Server not reachable at ' + BASE + ' (start: php -S 127.0.0.1:8000 tools/dev_router.php)'); process.exit(2); }
  const needBrowser = ['floors', 'routes', 'flow', 'phone', 'cms', 'journey', 'hosting', 'embed'].some(want);
  if (needBrowser) {
    if (!PW || !CHROME) { console.error('playwright-core or Chrome not found (set PW= / CHROME=)'); process.exit(2); }
    const { chromium } = require(PW);
    browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--enable-unsafe-swiftshader', '--ignore-gpu-blocklist',
      '--host-resolver-rules=MAP ' + HOST_SITE + ' 127.0.0.1, MAP ' + HOST_WEB + ' 127.0.0.1',
      // the stand-in website is served by the test itself (looks public) while the map resolves to 127.0.0.1: without this
      // Chrome's local-network check blocks the iframe. On the real hosting both are public, so the check never applies.
      '--disable-features=LocalNetworkAccessChecks'] });
  }
  const suites = { cli: suiteCli, api: suiteApi, floors: suiteFloors, routes: suiteRoutes, flow: suiteFlow, phone: suitePhone, cms: suiteCms,
    journey: suiteJourney, hosting: suiteHosting, embed: suiteEmbed };
  const timing = {};
  await Promise.all(Object.entries(suites).filter(([k]) => want(k)).map(([k, fn]) => {
    const s = Date.now();
    console.log('start ' + k);
    return fn().catch(e => ok(k, 'suite crashed', false, e.stack.split('\n').slice(0, 2).join(' '))).then(() => { timing[k] = Date.now() - s; console.log('done  ' + k + ' (' + Math.round(timing[k] / 1000) + ' s)'); });
  }));
  if (browser) await browser.close();
  const bySuite = {};
  results.forEach(r => { const s = bySuite[r.suite] = bySuite[r.suite] || { pass: 0, fail: 0 }; r.ok ? s.pass++ : s.fail++; });
  console.log('\nUAT ' + BASE + '  (' + Math.round((Date.now() - t0) / 1000) + ' s, directory ' + DIR.meta.version + ')');
  Object.entries(bySuite).forEach(([k, s]) => console.log('  ' + (s.fail ? 'FAIL' : 'ok  ') + ' ' + k.padEnd(8) + s.pass + ' passed' + (s.fail ? ', ' + s.fail + ' failed' : '')));
  fs.writeFileSync(OUT + 'report.json', JSON.stringify({ base: BASE, version: DIR.meta.version, at: new Date().toISOString(), timing, results }, null, 1));
  console.log('report: ' + path.relative(ROOT, OUT + 'report.json'));
  process.exit(results.some(r => !r.ok) ? 1 : 0);
})();
