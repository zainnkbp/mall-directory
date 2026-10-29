#!/usr/bin/env node
/*
 * Every start the phone picker offers (entrances = kiosks + CMS lobby points, every store) to every destination
 * (stores + facility POIs) over data/directory.json, with the browser's own engine (js/route.js):
 *   1. reachability of all pairs, default + accessible (Dijkstra once per start)
 *   2. a full plan() (legs, steps, texts, metres) from every entrance to every destination and from every store to
 *      12 other stores (fixed sample) -> no failure, no empty / "undefined" / "NaN" text, legs that agree with the graph
 * Run: node tests/uat/routes_allpairs.js [--json out.json]   exit 1 on any problem (known accessible gaps are listed, not failed)
 */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.resolve(__dirname, '..', '..');
const LOBBY_TYPES = ['lobby-exit', 'parking-entrance', 'drop-off'];

const ctx = { window: {}, document: { documentElement: {} }, console, Math, Date, JSON, Object, Array, String, Number, Infinity, isNaN, URLSearchParams };
ctx.window = ctx; ctx.BSB_CONFIG = { metersPerUnit: 0.7, walkSpeedMps: 1.2, escalatorSecPerLevel: 25, liftSecPerTrip: 60 };
vm.createContext(ctx);
['js/i18n.js', 'js/route.js'].forEach(f => vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f }));
const B = ctx.BSB;

const D = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/directory.json'), 'utf8'));
D.floorById = {}; D.nodeById = {}; D.amenityByNode = {}; D.tenantById = {}; D.kioskById = {};
D.floors.forEach(f => D.floorById[f.id] = f); D.graph.nodes.forEach(n => D.nodeById[n.id] = n);
D.tenants.forEach(t => D.tenantById[t.id] = t); D.kiosks.forEach(k => D.kioskById[k.id] = k);
D.amenities.forEach(a => { if (a.kind !== 'poi') D.amenityByNode[a.node] = a; });
D.graph.rules = D.graph.rules || {}; D.meta = D.meta || {};
B.D = D;

const poi = a => ({ id: a.id, name: B.amenityName(a), floor: a.floor, node: a.node, category: null });
const entrances = D.kiosks.map(k => ({ id: k.id, name: k.name, floor: k.floor, node: k.node, kind: 'entrance' }))
  .concat(D.amenities.filter(a => a.kind === 'poi' && LOBBY_TYPES.includes(a.type)).map(a => Object.assign(poi(a), { kind: 'entrance' })));
const stores = D.tenants.filter(t => t.node);
const dests = stores.concat(D.amenities.filter(a => a.kind === 'poi' && !LOBBY_TYPES.includes(a.type)).map(poi));
const problems = [], accGaps = new Set();
const bad = (where, what) => { if (problems.length < 200) problems.push(where + ': ' + what); };

// 1. reachability (closures/schedules ignored: all=true -> the graph itself)
const R = new B.Router(D, { status: null, now: Date.parse('2026-10-05T12:00:00+08:00') });
let pairs = 0;
for (const acc of [false, true]) {
  for (const s of entrances.concat(stores)) {
    if (!D.nodeById[s.node]) { bad(s.id, 'start node ' + s.node + ' missing from the graph'); continue; }
    const r = R.dijkstra(s.node, acc, true, acc ? 'accessible' : 'best');
    for (const d of dests) {
      if (d.id === s.id) continue;
      pairs++;
      if (r.dist[d.node] !== undefined) continue;
      // wheelchair gaps are data (a floor without a lift link): name the cut-off place once, from an entrance's view
      if (acc) { if (s.kind === 'entrance') accGaps.add(d.name); } else bad(s.id + ' -> ' + d.id, 'unreachable');
    }
  }
}

// 2. full plans
const TXT = /undefined|NaN|null|\[object/;
let plans = 0;
function checkPlan(s, d, pref) {
  const P = R.plan(s.node, d.node, { tenant: d.category ? d : null, origin: s, pref, accessible: pref === 'accessible' });
  plans++;
  const where = s.id + ' -> ' + d.id + ' [' + pref + ']';
  if (!P.ok) { if (pref === 'accessible') { if (s.kind === 'entrance') accGaps.add(d.name); } else bad(where, 'plan failed: ' + P.reason); return; }
  if (!isFinite(P.meters) || !isFinite(P.seconds) || P.meters < 0) bad(where, 'metres/seconds ' + P.meters + '/' + P.seconds);
  if (P.meters > 1500) bad(where, 'implausible length ' + Math.round(P.meters) + ' m');
  P.legs.forEach((leg, i) => {
    if (leg.nodes.some(n => D.nodeById[n].floor !== leg.floor)) bad(where, 'leg ' + i + ' mixes floors');
    if (i < P.legs.length - 1 && !leg.transition) bad(where, 'leg ' + i + ' ends without a transition');
    if (leg.transition && (!leg.transition.text || TXT.test(leg.transition.text))) bad(where, 'transition text "' + leg.transition.text + '"');
    leg.steps.forEach(st => { if (!st.text || TXT.test(st.text)) bad(where, 'step text "' + st.text + '"'); });
  });
  const last = P.legs[P.legs.length - 1];
  if (last.floor !== D.nodeById[d.node].floor) bad(where, 'ends on ' + last.floor + ', destination is on ' + D.nodeById[d.node].floor);
}
for (const lang of ['id', 'en']) {
  B.lang = lang;
  for (const s of entrances) for (const d of dests) for (const pref of ['best', 'lift', 'accessible']) if (lang === 'id' || pref === 'best') checkPlan(s, d, pref);
}
B.lang = 'id';
let seed = 11; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
for (const s of stores) for (let k = 0; k < 12; k++) { const d = stores[Math.floor(rnd() * stores.length)]; if (d.id !== s.id) checkPlan(s, d, 'best'); }

console.log('starts: ' + entrances.length + ' entrances + ' + stores.length + ' stores, destinations: ' + dests.length);
console.log('reachability pairs checked: ' + pairs + ', full plans: ' + plans);
console.log('cut off from the entrances in wheelchair mode (no lift link in the data, listed only): ' + ([...accGaps].join(', ') || 'none'));
problems.forEach(p => console.log('  FAIL ' + p));
console.log(problems.length ? problems.length + ' problem(s)' : 'all routes ok');
const ji = process.argv.indexOf('--json');
if (ji > 0) fs.writeFileSync(process.argv[ji + 1], JSON.stringify({ pairs, plans, accGaps: [...accGaps], problems }, null, 1));
process.exit(problems.length ? 1 : 0);
