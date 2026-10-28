/*
 * Scene3D — the 3D floor scene shared by the kiosk/phone map (map3d.js) and the editor (editor3d.html).
 * Input: a floor model from tools/3d/svg_to_3d.py (metres, plan y-down; world X = x, world Z = y, Y up)
 * plus optional edits {units: {unitId: {name, logo, show, style, tone, color, scale, rot, dx, dy, c}}} made in the editor.
 * The kiosk may set on a unit: display (the CMS tenant's name), logoCms (its CMS logo), off (tenant switched off:
 * blank roof); edits still win over them.
 * Look: Mapplic-style daytime isometric -- white materials under fixed lights give roofs #e8e8e8,
 * right-facing walls #bbbbbb, left-facing walls #999999, khaki floor #ddd9c5; thin seams between shops.
 * Roof tones as on Mapplic's demo maps: shops white, anchors dark grey with white names, empty units light grey.
 */
window.BSB = window.BSB || {};
(function (B) {
  var THREE = window.THREE;
  if (!THREE) return;
  var DEG = Math.PI / 180;
  var SLAB_H = 1.2; // floor podium height (m); routes and pins sit on this plane
  var HEIGHT = { anchor: 4.5, tenant: 4.5, unit: 4.5, kiosk: 2.2, facility: 3, vacant: 4.5 }; // one storey; booths low
  // base colour of roof and walls (the lights shade it): dark reads #8d8d8d on roofs, #717171 / #5d5d5d on walls
  var TONE = { light: 0xffffff, dark: 0x9b9b9b, empty: 0xe0e0e0 };
  var KIND_TONE = { tenant: 'light', anchor: 'dark', unit: 'empty', kiosk: 'light', facility: 'empty', vacant: 'empty' };
  var SEL_TOP = 0xffd88a, SEL_SIDE = 0xf6c770;
  var FLOOR_TOP = 0xf3eed8, FLOOR_SIDE = 0xe9e2c8;
  var GAP = 0.2; // metres each shop is pulled in from its outline, leaving thin seams between neighbours
  // surroundings of a floor both malls share (model.context, tools/3d/kawasan.py): just below the mall floor, so a route
  // across the plaza lies on it; y = base above the ground, h = height. Not tappable.
  var CTX = {
    ground: { y: 0, h: SLAB_H - 0.1, top: 0xe9e7e0, side: 0xdedbd2 },
    road: { y: SLAB_H - 0.1, h: 0.04, top: 0xbfc2c7, side: 0xb3b6bb },
    parking: { y: SLAB_H - 0.1, h: 0.06, top: 0xc3dcb4, side: 0xb2cfa2 },
    divider: { y: SLAB_H - 0.1, h: 0.25, top: 0xaed29b, side: 0x9cc488 },
    podium: { y: SLAB_H - 0.1, h: 0.45, top: 0xf1eee6, side: 0xe3dfd3 },
    building: { y: SLAB_H - 0.1, h: 4.0, top: 0xfbfaf7, side: 0xefede7, gap: true },
    marka: { y: SLAB_H - 0.05, h: 0.02, top: 0xffffff, side: 0xffffff }
  };
  var FONT = '"Plus Jakarta Sans",system-ui,sans-serif';
  var FAC = { toilet: 'Toilet', lift: 'Lift', escalator: 'Eskalator', stairs: 'Tangga', prayer: 'Musholla', atm: 'ATM',
    info: 'Informasi', parking: 'Parkir', firstaid: 'P3K', nursery: 'Ruang laktasi' };

  function disposeTree(o) {
    o.traverse(function (c) {
      if (c.geometry) c.geometry.dispose();
      if (c.material) (Array.isArray(c.material) ? c.material : [c.material]).forEach(function (m) {
        if (m.map && !m.map.userData.shared) m.map.dispose();
        m.dispose();
      });
    });
  }
  function shapeOf(poly, holes) {
    var s = new THREE.Shape(poly.map(function (p) { return new THREE.Vector2(p[0], -p[1]); }));
    (holes || []).forEach(function (h) { s.holes.push(new THREE.Path(h.map(function (p) { return new THREE.Vector2(p[0], -p[1]); }))); });
    return s;
  }
  function extrude(poly, depth, holes) {
    var g = new THREE.ExtrudeGeometry(shapeOf(poly, holes), { depth: depth, bevelEnabled: false, curveSegments: 1 });
    g.rotateX(-Math.PI / 2);
    return g;
  }
  // Pull a polygon in by d metres (mitred corners, clamped on sharp ones); tiny shapes shrink proportionally less.
  function inset(poly, d) {
    var pts = [], n, i, area = 0;
    poly.forEach(function (p) { var q = pts[pts.length - 1]; if (!q || Math.hypot(p[0] - q[0], p[1] - q[1]) > 1e-3) pts.push(p); });
    if (pts.length > 2 && Math.hypot(pts[0][0] - pts[pts.length - 1][0], pts[0][1] - pts[pts.length - 1][1]) < 1e-3) pts.pop();
    n = pts.length;
    if (n < 3 || !d) return poly;
    for (i = 0; i < n; i++) { var a = pts[i], b = pts[(i + 1) % n]; area += a[0] * b[1] - b[0] * a[1]; }
    var sgn = area > 0 ? 1 : -1;
    d = Math.min(d, Math.sqrt(Math.abs(area) / 2) * 0.04);
    function nrm(a, b) { var dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy); return [-dy / l * sgn, dx / l * sgn]; } // inward
    return pts.map(function (p, i) {
      var n1 = nrm(pts[(i - 1 + n) % n], p), n2 = nrm(p, pts[(i + 1) % n]);
      var mx = n1[0] + n2[0], my = n1[1] + n2[1], ml = Math.hypot(mx, my);
      if (ml < 1e-6) return p;
      mx /= ml; my /= ml;
      var len = d / Math.max(0.35, mx * n1[0] + my * n1[1]);
      return [p[0] + mx * len, p[1] + my * len];
    });
  }
  function centroid(poly) {
    var x = 0, y = 0; poly.forEach(function (p) { x += p[0]; y += p[1]; });
    return [Math.round(x / poly.length * 10) / 10, Math.round(y / poly.length * 10) / 10];
  }
  function partitions(words, n) {
    if (n === 1) return [[words.join(' ')]];
    var out = [];
    for (var i = 1; i <= words.length - n + 1; i++) {
      var head = words.slice(0, i).join(' ');
      partitions(words.slice(i), n - 1).forEach(function (rest) { out.push([head].concat(rest)); });
    }
    return out;
  }
  function titleCase(s) {
    return s.split(/\s+/).map(function (w) { return w.length <= 3 && /^[A-Z&.]+$/.test(w) ? w : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase(); }).join(' ');
  }
  function normAng(a) { while (a > 90) a -= 180; while (a <= -90) a += 180; return a; }
  // Height of the largest aspect:1 rectangle turned by theta degrees that fits a w x h box.
  function fitAt(theta, aspect, w, h) {
    var c = Math.abs(Math.cos(theta * DEG)), s = Math.abs(Math.sin(theta * DEG));
    return Math.min(w / (aspect * c + s), h / (aspect * s + c));
  }

  // ---------- facility icons: dark rounded tiles with white pictograms, standing upright ----------
  var iconTex = {};
  function rr(ctx, x, y, w, h, r) {
    ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }
  function escalatorBase(c) {
    c.lineWidth = 20; c.lineJoin = 'round'; c.lineCap = 'round';
    c.beginPath(); c.moveTo(48, 196); c.lineTo(92, 196); c.lineTo(160, 118); c.lineTo(200, 118); c.stroke();
    c.beginPath(); c.arc(112, 92, 14, 0, 7); c.fill();
    c.lineWidth = 15; c.beginPath(); c.moveTo(112, 114); c.lineTo(112, 150); c.stroke();
  }
  var PICTO = {
    toilet: function (c) {
      c.beginPath(); c.arc(86, 74, 15, 0, 7); c.arc(170, 74, 15, 0, 7); c.fill();
      rr(c, 66, 98, 40, 62, 12); c.fill();
      c.fillRect(70, 150, 14, 52); c.fillRect(88, 150, 14, 52);
      c.beginPath(); c.moveTo(170, 96); c.lineTo(198, 164); c.lineTo(142, 164); c.closePath(); c.fill();
      c.fillRect(156, 160, 12, 42); c.fillRect(172, 160, 12, 42);
      c.fillRect(126, 64, 4, 140);
    },
    lift: function (c) {
      c.lineWidth = 11; rr(c, 62, 58, 132, 140, 16); c.stroke();
      c.beginPath(); c.moveTo(128, 80); c.lineTo(156, 116); c.lineTo(100, 116); c.closePath(); c.fill();
      c.beginPath(); c.moveTo(100, 138); c.lineTo(156, 138); c.lineTo(128, 174); c.closePath(); c.fill();
    },
    escalator: function (c) {
      escalatorBase(c);
      c.beginPath(); c.moveTo(172, 40); c.lineTo(190, 62); c.lineTo(154, 62); c.closePath(); c.fill();
      c.beginPath(); c.moveTo(154, 72); c.lineTo(190, 72); c.lineTo(172, 94); c.closePath(); c.fill();
    },
    stairs: function (c) {
      c.lineWidth = 18; c.lineJoin = 'round';
      c.beginPath(); c.moveTo(52, 196); c.lineTo(96, 196); c.lineTo(96, 156); c.lineTo(136, 156); c.lineTo(136, 116); c.lineTo(176, 116); c.lineTo(176, 76); c.lineTo(206, 76); c.stroke();
    }
  };
  var GLYPH = { prayer: '☾', atm: 'ATM', info: 'i', parking: 'P', firstaid: '+', nursery: '♡' };
  // lucide: for facilities without a pictogram, the CMS icon name (B.ICONS, kiosk only), drawn once it has loaded
  function iconTexture(type, lucide, onLoad) {
    var svgBody = !PICTO[type] && lucide && B.ICONS && B.ICONS[lucide], key = svgBody ? type + ':' + lucide : type;
    if (iconTex[key]) return iconTex[key];
    var cv = document.createElement('canvas'); cv.width = cv.height = 256;
    var c = cv.getContext('2d');
    c.fillStyle = 'rgba(0,0,0,.18)'; rr(c, 14, 20, 228, 228, 54); c.fill(); // soft drop under the tile
    c.fillStyle = '#1e2226'; rr(c, 12, 10, 232, 232, 54); c.fill();
    c.fillStyle = c.strokeStyle = '#ffffff';
    var t = new THREE.CanvasTexture(cv); t.userData.shared = true;
    if (PICTO[type]) PICTO[type](c);
    else if (svgBody) {
      var img = new Image();
      img.onload = function () { c.drawImage(img, 48, 46, 160, 160); t.needsUpdate = true; if (onLoad) onLoad(); };
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + svgBody + '</svg>');
    } else {
      var g = GLYPH[type] || 'i';
      c.font = '700 ' + (g.length > 1 ? 84 : 150) + 'px ' + FONT; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillText(g, 128, 132);
    }
    iconTex[key] = t;
    return t;
  }

  // ---------- logos: cut out, then shown as a raised 3D emblem or a sign board on the roof ----------
  var logoCache = {};
  function prepLogo(img, aniso) {
    var w = img.naturalWidth || 512, h = img.naturalHeight || 512, k = Math.min(1, 1024 / Math.max(w, h));
    var W = Math.max(1, Math.round(w * k)), H = Math.max(1, Math.round(h * k));
    var cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    var c = cv.getContext('2d'); c.drawImage(img, 0, 0, W, H);
    var id = c.getImageData(0, 0, W, H), p = id.data, i, hasAlpha = false;
    for (i = 3; i < p.length; i += 4) if (p[i] < 250) { hasAlpha = true; break; }
    if (!hasAlpha) for (i = 0; i < p.length; i += 4) { // no transparency: make the white background see-through
      p[i + 3] = Math.max(0, Math.min(255, (765 - p[i] - p[i + 1] - p[i + 2]) * 255 / 60));
    }
    var x0 = W, y0 = H, x1 = -1, y1 = -1;
    for (var y = 0; y < H; y++) for (var x = 0; x < W; x++) if (p[(y * W + x) * 4 + 3] > 12) {
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
    if (x1 < 0) return null;
    // A photo (a shop-front picture uploaded as "logo") stays opaque after the white cut and has no few flat colours
    // covering most of it, unlike a logo; roofs then keep the name unless a logo was chosen on purpose.
    var opaque = 0, bins = {}, top = [0, 0, 0], step = Math.max(1, Math.floor(Math.sqrt(W * H / 16000)));
    for (y = 0; y < H; y += step) for (x = 0; x < W; x += step) {
      var q = (y * W + x) * 4;
      if (p[q + 3] < 200) continue;
      opaque++;
      var key = (p[q] >> 5) * 64 + (p[q + 1] >> 5) * 8 + (p[q + 2] >> 5);
      bins[key] = (bins[key] || 0) + 1;
    }
    Object.keys(bins).forEach(function (k) { var n = bins[k]; if (n > top[2]) { top[2] = n; top.sort(function (a, b) { return b - a; }); } });
    var samples = Math.ceil(H / step) * Math.ceil(W / step);
    var photo = opaque / samples > 0.8 && (top[0] + top[1] + top[2]) / Math.max(1, opaque) < 0.55;
    c.putImageData(id, 0, 0);
    var tw = x1 - x0 + 1, th = y1 - y0 + 1, out = document.createElement('canvas'); out.width = tw; out.height = th;
    out.getContext('2d').drawImage(cv, x0, y0, tw, th, 0, 0, tw, th);
    var tex = new THREE.CanvasTexture(out); tex.anisotropy = aniso; tex.userData.shared = true;
    return { canvas: out, aspect: tw / th, tex: tex, photo: photo };
  }
  function loadLogo(url, aniso, cb) {
    var e = logoCache[url];
    if (e) { if (e.done) cb(e.logo); else e.wait.push(cb); return; }
    e = logoCache[url] = { wait: [cb] };
    var img = new Image();
    img.onload = function () { e.logo = prepLogo(img, aniso); e.done = true; e.wait.forEach(function (f) { f(e.logo); }); e.wait = []; };
    img.onerror = function () { e.logo = null; e.done = true; e.wait.forEach(function (f) { f(null); }); e.wait = []; };
    img.src = url;
  }
  function embossLogo(L, pw, ph) {
    // stacked cut-out layers read as a solid raised emblem: darker body, full-colour face on top
    var g = new THREE.Group(), T = THREE.MathUtils.clamp(Math.min(pw, ph) * 0.06, 0.06, 0.35), N = 8;
    var geo = new THREE.PlaneGeometry(pw, ph); geo.rotateX(-Math.PI / 2);
    var body = new THREE.MeshBasicMaterial({ map: L.tex, alphaTest: 0.45, color: 0x8e8e8e });
    for (var i = 0; i < N - 1; i++) { var s = new THREE.Mesh(geo, body); s.position.y = T * i / (N - 1); g.add(s); }
    var face = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: L.tex, transparent: true, alphaTest: 0.03, depthWrite: false }));
    face.position.y = T; face.renderOrder = 3; g.add(face);
    return g;
  }
  function plateLogo(L, pw, ph, aniso) {
    var mg = Math.min(pw, ph) * 0.14, W = pw + 2 * mg, H = ph + 2 * mg;
    var cw = 512, ch = Math.max(16, Math.round(cw * H / W));
    var cv = document.createElement('canvas'); cv.width = cw; cv.height = ch;
    var ctx = cv.getContext('2d');
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, cw, ch);
    var k = cw / W; ctx.drawImage(L.canvas, mg * k, mg * k, pw * k, ph * k);
    var tex = new THREE.CanvasTexture(cv); tex.anisotropy = aniso;
    var side = new THREE.MeshLambertMaterial({ color: 0xffffff });
    var plate = new THREE.Mesh(new THREE.BoxGeometry(W, 0.3, H), [side, side, new THREE.MeshBasicMaterial({ map: tex }), side, side, side]);
    plate.position.y = 0.15;
    var g = new THREE.Group(); g.add(plate);
    return g;
  }

  /*
   * opts: { root: URL prefix for asset paths (B.ROOT), az, polar: view angles in degrees (labels/logos are kept
   *         upright for this view), aniso, labelPpm (label texture pixels per metre), onChange() after async updates }
   */
  function Scene3D(opts) {
    this.o = opts || {};
    this.aniso = this.o.aniso || 4;
    this.scene = new THREE.Scene();
    // flat, shadowless midday light: white reads 91% on roofs, 73% on walls facing the camera's right, 60% on its left
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.5));
    this.key = new THREE.DirectionalLight(0xffffff, 0.447); this.scene.add(this.key); this.scene.add(this.key.target);
    this.fill = new THREE.DirectionalLight(0xffffff, 0.104); this.scene.add(this.fill); this.scene.add(this.fill.target);
    this.root = new THREE.Group(); this.scene.add(this.root);
    this.edits = { units: {} }; this.links = {}; this.meshes = []; this.icons = []; this.model = null; this.hl = null;
    this.vis = { slab: true, units: true, names: true, logos: true, fac: true };
    this.setBase(this.o.az != null ? this.o.az : 45, this.o.polar != null ? this.o.polar : 54.736);
  }
  Scene3D.SLAB_H = SLAB_H;
  Scene3D.FAC = FAC;
  Scene3D.iconTexture = iconTexture;
  Scene3D.iconDataURL = function (type) { return iconTexture(type).image.toDataURL(); };
  Scene3D.titleCase = titleCase;
  // A directory category guessed from a shop name (map-only tenants until the CMS has them); the editor can override it.
  var CAT_HINTS = [
    ['department-store', /\b(mart|market|supermarket|minimarket|hypermart|department)\b|mart\b/i],
    ['food-beverage', /deli|caf[eé]|kopi|coffee|resto|restaurant|food|kitchen|bbq|sushi|ramen|bakso|mie\b|noodle|chicken|pizza|burger|bistro|bakery|\btea\b|boba|juice|gelato|ice cream|warung|dimsum|steak|grill/i],
    ['beauty-health', /salon|beauty|skin|spa\b|barber|optik|optical|clinic|klinik|apotek|pharma|massage|nail|kosmetik/i],
    ['entertainment', /karaoke|cinema|bioskop|game|arcade|fun|club|bowling|billiard|timezone/i],
    ['kids-family', /\bkid|toy|baby|bayi|anak|play/i],
    ['electronics', /phone|ponsel|gadget|electr|digital|computer|komputer|camera|samsung|xiaomi|oppo|vivo/i],
    ['services', /fit\b|gym|bank|atm|travel|laundry|service|money|exchange/i],
    ['fashion', /fashion|shoe|sepatu|sneaker|bag|tas\b|\bbra\b|wear|cloth|boutique|batik|jeans|denim|hijab|shop/i]
  ];
  Scene3D.guessCategory = function (name, fallback) {
    for (var i = 0; i < CAT_HINTS.length; i++) if (CAT_HINTS[i][1].test(name || '')) return CAT_HINTS[i][0];
    return fallback || 'fashion';
  };
  Scene3D.centroid = centroid;
  var S = Scene3D.prototype;

  S.url = function (p) { return !p || /^(blob:|data:|https?:|\/)/.test(p) ? p : (this.o.root || '') + p; };
  // The floor's own (drawing) view: edit offsets are measured in it. Resets the current view and label direction too.
  S.setBase = function (az, polar) {
    this.baseAz = az; this.labelAz = az; this.az = null;
    this.setView(az, polar, false);
    if (this.model) this.redecorateAll();
  };
  // Current view. Lights follow it every frame, so the same faces stay light/dark while the map turns; with relabel,
  // names and logos re-orient to stay readable once the turn has moved enough (done when a turn settles).
  S.setView = function (az, polar, relabel) {
    if (this.az !== az) {
      var k = (az + 45) * DEG, f = (az - 45) * DEG;
      this.key.position.set(Math.sin(k) * 0.522, 0.853, Math.cos(k) * 0.522).multiplyScalar(400);
      this.fill.position.set(Math.sin(f) * 0.96, 0.28, Math.cos(f) * 0.96).multiplyScalar(400);
    }
    this.az = az; this.polar = polar;
    if (relabel && this.model && Math.abs((((az - this.labelAz) % 360) + 540) % 360 - 180) >= 15) {
      this.labelAz = az;
      this.redecorateAll();
    }
  };
  // Turn a roof angle by 180 degrees when its top would face the viewer, so text and logos never read upside down.
  S.upright = function (a) {
    var d = ((-a - this.labelAz) % 360 + 540) % 360 - 180;
    return Math.abs(d) > 90 ? a + 180 : a;
  };
  // Screen-aligned offsets (metres right / up at the floor's own view) -> plan x / y; fixed while the map turns.
  S.planOffset = function (o) {
    var sx = o.dx || 0, sy = o.dy || 0, a = this.baseAz * DEG;
    return [sx * Math.cos(a) - sy * Math.sin(a), -sx * Math.sin(a) - sy * Math.cos(a)];
  };
  S.ovOf = function (u) { return this.edits.units[u.id] || {}; };
  S.baseName = function (u) {
    if (u.display) return u.display;
    if (!u.name) return '';
    return u.name === u.name.toUpperCase() || u.name === u.name.toLowerCase() ? titleCase(u.name) : u.name; // all caps / all lower case → Title Case, else as written
  };
  S.nameOf = function (u) { var n = this.ovOf(u).name; return n && n.trim() ? n.trim() : this.baseName(u); };
  S.logoOf = function (u) { var o = this.ovOf(u); return o.logo === '' ? null : (o.logo || u.logoCms || u.logo || null); }; // '' = removed on purpose
  S.showOf = function (u) { var s = this.ovOf(u).show; return s === 'name' || !this.logoOf(u) ? 'name' : 'logo'; };
  // roof tone: chosen in the editor (edits.tone light / dark), else by kind; a switched-off tenant leaves an empty unit
  S.toneOf = function (u) { var t = this.ovOf(u).tone; return t === 'light' || t === 'dark' ? t : u.off ? 'empty' : KIND_TONE[u.kind] || 'light'; };
  // Roof colour: a colour picked in the editor (edits.color "#rrggbb", what the roof should look like) or the tone.
  // {hex: base colour for the materials, dark: names in white}. Roofs show 91 % of the base colour under the lights.
  S.roofOf = function (u) {
    var c = this.ovOf(u).color;
    if (typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c)) {
      var col = new THREE.Color(c);
      return { hex: new THREE.Color(Math.min(1, col.r / 0.91), Math.min(1, col.g / 0.91), Math.min(1, col.b / 0.91)).getHex(),
        dark: 0.2126 * col.r + 0.7152 * col.g + 0.0722 * col.b < 0.55 };
    }
    var t = this.toneOf(u);
    return { hex: TONE[t], dark: t === 'dark' };
  };
  S.unit = function (id) { return this.model && this.model.units.filter(function (u) { return u.id === id; })[0]; };
  S.meshOf = function (u) {
    for (var i = 0; i < this.meshes.length; i++) if (this.meshes[i].userData.unit === u || this.meshes[i].userData.unit.id === u) return this.meshes[i];
    return null;
  };
  S.changed = function () { if (this.o.onChange) this.o.onChange(); };

  // An edit keyed by an id that no longer exists (shapes re-ordered in Illustrator) follows its unit by position.
  S.attachEdits = function () {
    var units = this.model.units, E = this.edits.units, ids = {};
    units.forEach(function (u) { ids[u.id] = u; });
    Object.keys(E).forEach(function (id) {
      var o = E[id];
      if (ids[id] || !o.c) return;
      var best = null, bd = 3;
      units.forEach(function (u) {
        if (E[u.id]) return;
        var c = centroid(u.poly), dd = Math.hypot(c[0] - o.c[0], c[1] - o.c[1]);
        if (dd < bd) { bd = dd; best = u; }
      });
      if (best) { E[best.id] = o; delete E[id]; }
    });
  };

  // Where and how a name sits on its roof. Tries reading straight across the screen first, then along the roof's own
  // axes, over 1-3 line breaks, and keeps the biggest text (straight-across wins up to 1.3x smaller).
  // Returns {x, y, angle, w, h, lines, em} in metres, or null when the name would be too small to read.
  var measure = null;
  S.labelLayout = function (u, text) {
    var o = this.ovOf(u), k = o.scale || 1, off = this.planOffset(o), s = u.label;
    var words = text.split(/\s+/).filter(Boolean);
    if (!words.length) return null;
    measure = measure || document.createElement('canvas').getContext('2d');
    measure.font = '600 100px ' + FONT;
    var parts = [];
    for (var n = 1; n <= Math.min(3, words.length); n++) partitions(words, n).forEach(function (lines) {
      var mw = Math.max.apply(null, lines.map(function (l) { return measure.measureText(l).width; }));
      parts.push({ lines: lines, r: mw / (lines.length * 115) }); // block width / height (line height 1.15 em)
    });
    var base = s.angle || 0, W = s.w * k, H = s.h * k, cap = 2.4 * k, best = null;
    [[-this.labelAz, 1.3], [base, 1], [base + 90, 1]].forEach(function (c) {
      var a = normAng(c[0]);
      parts.forEach(function (p) {
        var em = Math.min(fitAt(a - base, p.r, W, H) * 0.92 / (p.lines.length * 1.15), cap);
        if (!best || em * c[1] > best.score * 1.04) best = { score: em * c[1], a: a, em: em, p: p };
      });
    });
    if (!best || best.em < 0.32) return null; // too small to read
    var hb = best.em * best.p.lines.length * 1.15;
    return { x: s.x + off[0], y: s.y + off[1], angle: this.upright(best.a) + (o.rot || 0), w: hb * best.p.r * 1.06, h: hb, lines: best.p.lines, em: best.em };
  };
  // Tenant name printed flat on the roof, as laid out by labelLayout.
  S.labelMesh = function (L, color) {
    var ppm = Math.min(this.o.labelPpm || 56, 1024 / Math.max(L.w, L.h));
    var W = Math.max(8, Math.round(L.w * ppm)), H = Math.max(8, Math.round(L.h * ppm));
    var cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    var ctx = cv.getContext('2d'), size = L.em * ppm, lh = size * 1.15;
    ctx.font = '600 ' + size + 'px ' + FONT;
    ctx.fillStyle = color || '#3b3c3e'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    var y0 = H / 2 - lh * (L.lines.length - 1) / 2;
    L.lines.forEach(function (l, i) { ctx.fillText(l, W / 2, y0 + i * lh); });
    var tex = new THREE.CanvasTexture(cv); tex.anisotropy = this.aniso;
    var g = new THREE.PlaneGeometry(L.w, L.h); g.rotateX(-Math.PI / 2);
    var m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }));
    m.position.set(L.x, 0, L.y);
    m.rotation.y = -(L.angle || 0) * DEG;
    m.renderOrder = 2;
    return m;
  };
  // middle of a unit's roof (metres) and its height: where a destination pin stands
  S.roofTop = function (uid) {
    var m = this.meshOf(uid);
    if (!m) return null;
    var u = m.userData.unit, c = u.label ? [u.label.x, u.label.y] : centroid(u.poly);
    return { x: c[0], y: c[1], h: m.userData.h };
  };
  S.logoObject = function (u, L) {
    var o = this.ovOf(u), spec = u.label, base = spec.angle || 0, best = null;
    // prefer reading straight across the screen; follow the roof's own axes only when that fits much bigger
    [[-this.labelAz, 1.35], [base, 1], [base + 90, 1]].forEach(function (c) {
      var a = normAng(c[0]), ph = fitAt(a - base, L.aspect, spec.w, spec.h);
      if (!best || ph * c[1] > best.score) best = { ang: a, ph: ph, score: ph * c[1] };
    });
    var ang = this.upright(best.ang) + (o.rot || 0);
    var ph = Math.min(best.ph * 0.88, 24 / L.aspect), pw = ph * L.aspect;
    var k = o.scale || 1; pw *= k; ph *= k;
    if (pw < 0.5 || ph < 0.3) return null;
    var obj = o.style === 'plate' ? plateLogo(L, pw, ph, this.aniso) : embossLogo(L, pw, ph);
    var off = this.planOffset(o);
    obj.position.set(spec.x + off[0], 0, spec.y + off[1]);
    obj.rotation.y = -ang * DEG;
    return obj;
  };
  S.updateVis = function () {
    var v = this.vis;
    if (this.slabG) this.slabG.visible = v.slab;
    if (this.ctxG) this.ctxG.visible = v.slab;
    if (this.unitG) this.unitG.visible = v.units;
    if (this.logoG) this.logoG.visible = v.units && v.logos;
    if (this.facG) this.facG.visible = v.fac;
    if (this.labelG) {
      this.labelG.visible = v.units && v.names;
      this.meshes.forEach(function (m) {
        if (m.userData.label) m.userData.label.visible = !(v.logos && m.userData.logo); // a logo replaces the name
      });
    }
  };
  S.setVisible = function (v) { for (var k in v) this.vis[k] = v[k]; this.updateVis(); };

  // (Re)build the name and logo on one unit's roof.
  S.decorate = function (u) {
    var m = this.meshOf(u);
    if (!m) return;
    u = m.userData.unit;
    var self = this, h = m.userData.h, v = m.userData.decoV = (m.userData.decoV || 0) + 1, roof = this.roofOf(u), col = roof.hex;
    if (m.userData.top !== col) { // colour / tone changed in the editor, tenant switched on or off
      m.userData.top = m.userData.side = col;
      if (this.hl !== m) { m.material[0].color.setHex(col); m.material[1].color.setHex(col); }
    }
    if (m.userData.label) { this.labelG.remove(m.userData.label); disposeTree(m.userData.label); m.userData.label = null; }
    if (m.userData.logo) { this.logoG.remove(m.userData.logo); disposeTree(m.userData.logo); m.userData.logo = null; }
    if (!u.label || u.kind === 'vacant' || u.off) { this.updateVis(); return; }
    var nm = this.nameOf(u), logo = this.logoOf(u);
    if (nm) {
      var lay = this.labelLayout(u, nm), lm = lay && this.labelMesh(lay, roof.dark ? '#ffffff' : null);
      if (lm) { lm.position.y = h + 0.04; this.labelG.add(lm); m.userData.label = lm; }
    }
    var chosen = this.ovOf(u).show === 'logo' || !!this.ovOf(u).logo; // picked in the editor: shown even when it is a photo
    if (logo && this.showOf(u) === 'logo') loadLogo(this.url(logo), this.aniso, function (L) {
      if (!L || m.userData.decoV !== v || m.parent !== self.unitG) return;
      m.userData.photo = L.photo;
      if (L.photo && !chosen) return;
      var obj = self.logoObject(u, L);
      if (!obj) return;
      obj.position.y = h + 0.03;
      self.logoG.add(obj); m.userData.logo = obj;
      self.updateVis(); self.changed();
    });
    this.updateVis();
  };
  S.redecorateAll = function () { var self = this; this.meshes.forEach(function (m) { self.decorate(m.userData.unit); }); this.changed(); };

  S.clear = function () {
    if (this.floorG) { this.root.remove(this.floorG); disposeTree(this.floorG); }
    this.floorG = this.slabG = this.ctxG = this.unitG = this.labelG = this.logoG = this.facG = null;
    this.meshes = []; this.icons = []; this.hl = null; this.routeG = null;
  };
  // model: floor JSON; edits: {units:{}} or null; links: {unitId: tenantId} (kiosk) -- kept for lookups only
  S.build = function (model, edits, links) {
    var self = this;
    this.clear();
    this.model = model; this.edits = edits && edits.units ? edits : { units: {} }; this.links = links || {};
    if (!model) return;
    this.attachEdits();
    var F = this.floorG = new THREE.Group();
    this.ctxG = new THREE.Group();
    (model.context || []).forEach(function (c, ci) {
      var st = CTX[c.kind];
      if (!st || !c.poly || c.poly.length < 3) return;
      var h = st.h;
      var topColor = st.top;
      var sideColor = st.side;
      if (c.kind === 'building') {
        var nm = (c.name || '').toLowerCase();
        if (c.subtype === 'ruko') {
          // Standard Ruko (Blok A-F) commercial shophouses
          h = 5.5;
          // Curated warm terracotta clay ceramic roof tile hues with natural per-unit variation
          var rukoRoofs = [0xc86a4b, 0xbd5e3f, 0xd07353, 0xb65738, 0xcc6e4d, 0xba5a3b];
          topColor = rukoRoofs[ci % rukoRoofs.length];
          sideColor = 0xded8ce; // warm limestone / commercial plaster facade
        } else if (/tower|apartment|appartment/.test(nm)) {
          h = 12.0;
          topColor = 0xb4c2d0; // modern slate glass / steel tower
          sideColor = 0x93a3b5;
        } else if (/hotel|jicon|beach|restaurant|wash/.test(nm)) {
          h = 7.0;
          topColor = 0xe5dfd5; // contemporary commercial stone
          sideColor = 0xd5cec2;
        } else {
          // Other institutional & commercial buildings (pendidikan, gedung tengah, etc.)
          h = 5.0;
          topColor = 0xf5f3ed; // clean architectural off-white
          sideColor = 0xe6e1d8;
        }
      }
      try {
        var m = new THREE.Mesh(extrude(st.gap ? inset(c.poly, GAP) : c.poly, h), [new THREE.MeshLambertMaterial({ color: topColor }), new THREE.MeshLambertMaterial({ color: sideColor })]);
        m.position.y = st.y;
        self.ctxG.add(m);
      } catch (e) { /* skip bad outline */ }
    });
    F.add(this.ctxG);
    this.slabG = new THREE.Group();
    (model.slab || []).forEach(function (sp) {
      try {
        self.slabG.add(new THREE.Mesh(extrude(sp.outer, SLAB_H, sp.holes), [new THREE.MeshLambertMaterial({ color: FLOOR_TOP }), new THREE.MeshLambertMaterial({ color: FLOOR_SIDE })]));
      } catch (e) { /* skip bad outline */ }
    });
    F.add(this.slabG);
    this.unitG = new THREE.Group(); this.labelG = new THREE.Group(); this.logoG = new THREE.Group(); this.facG = new THREE.Group();
    [this.unitG, this.labelG, this.logoG, this.facG].forEach(function (g) { g.position.y = SLAB_H; F.add(g); });
    this.root.add(F);
    (model.units || []).forEach(function (u) {
      if (!u.poly || u.poly.length < 3) return;
      var h = HEIGHT[u.kind] || 4.5, col = self.roofOf(u).hex;
      try {
        var m = new THREE.Mesh(extrude(inset(u.poly, GAP), h), [new THREE.MeshLambertMaterial({ color: col }), new THREE.MeshLambertMaterial({ color: col })]);
        m.userData = { unit: u, top: col, side: col, h: h };
        self.unitG.add(m); self.meshes.push(m);
        self.decorate(u);
      } catch (e) { /* skip bad polygon */ }
    });
    // facilities: a faint footprint on the floor plus an upright icon tile, never a building block
    var patchMat = new THREE.MeshLambertMaterial({ color: 0xe9e3cb });
    (model.facilities || []).forEach(function (f) {
      if (f.poly && f.poly.length >= 3) {
        try { self.facG.add(new THREE.Mesh(extrude(f.poly, 0.04), patchMat)); } catch (e) { /* skip */ }
      }
      var tex = iconTexture(f.type, f.icon, function () { self.changed(); });
      var sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true }));
      sp.center.set(0.5, 0.08); // stands on the floor
      sp.renderOrder = 4;
      // faint copy drawn through buildings, so an icon tucked behind a shop is still findable
      var ghost = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, opacity: 0.4, depthTest: false, depthWrite: false }));
      ghost.center.copy(sp.center); ghost.renderOrder = 5; ghost.raycast = function () {};
      sp.add(ghost);
      sp.position.set(f.x, 0.3, f.y);
      sp.userData = { fac: f };
      self.facG.add(sp); self.icons.push(sp);
    });
    this.updateVis();
  };
  // new edits (names/logos changed in an editor) without rebuilding the floor
  S.setEdits = function (edits) {
    this.edits = edits && edits.units ? edits : { units: {} };
    if (this.model) { this.attachEdits(); this.redecorateAll(); }
  };
  // ---------- route: a ribbon on the floor between the shops (white casing, blue core with arrows) ----------
  var routeTex = null;
  function routeTexture() {
    if (routeTex) return routeTex;
    var cv = document.createElement('canvas'); cv.width = 64; cv.height = 128;
    var c = cv.getContext('2d');
    c.fillStyle = '#2F5BEA'; c.fillRect(0, 0, 64, 128);
    c.strokeStyle = 'rgba(255,255,255,.95)'; c.lineWidth = 9; c.lineCap = 'round'; c.lineJoin = 'round';
    c.beginPath(); c.moveTo(16, 74); c.lineTo(32, 56); c.lineTo(48, 74); c.stroke(); // chevron pointing along the route
    routeTex = new THREE.CanvasTexture(cv);
    routeTex.wrapS = THREE.ClampToEdgeWrapping; routeTex.wrapT = THREE.RepeatWrapping; routeTex.userData.shared = true;
    return routeTex;
  }
  function ribbon(P, width, mat) {
    var pos = [], uv = [], idx = [], cum = 0, hw = width / 2;
    for (var i = 0; i < P.length; i++) {
      var a = P[Math.max(0, i - 1)], b = P[Math.min(P.length - 1, i + 1)];
      var dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1;
      if (i) cum += Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]);
      var nx = -dy / l, ny = dx / l;
      pos.push(P[i][0] + nx * hw, 0, P[i][1] + ny * hw, P[i][0] - nx * hw, 0, P[i][1] - ny * hw);
      uv.push(0, cum / 3, 1, cum / 3); // one arrow every 3 m
      if (i) { var k = i * 2; idx.push(k - 2, k, k - 1, k - 1, k, k + 1); }
    }
    var g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    return new THREE.Mesh(g, mat);
  }
  // pts: [[x, y], ...] in metres along the floor
  S.setRoute = function (pts) {
    this.clearRoute();
    if (!pts || pts.length < 2 || !this.floorG) return;
    var P = [pts[0]];
    for (var i = 1; i < pts.length; i++) { // resample every ~0.8 m so drawing the route animates smoothly
      var a = pts[i - 1], b = pts[i], n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 0.8));
      for (var j = 1; j <= n; j++) P.push([a[0] + (b[0] - a[0]) * j / n, a[1] + (b[1] - a[1]) * j / n]);
    }
    var g = new THREE.Group();
    g.position.y = SLAB_H + 0.06;
    var casing = ribbon(P, 2.0, new THREE.MeshBasicMaterial({ color: 0xffffff, polygonOffset: true, polygonOffsetFactor: -1 }));
    var core = ribbon(P, 1.25, new THREE.MeshBasicMaterial({ map: routeTexture(), polygonOffset: true, polygonOffsetFactor: -2 }));
    core.position.y = 0.01;
    // faint copy drawn through buildings, so the way stays visible where a shop hides it
    var ghost = new THREE.Mesh(core.geometry, new THREE.MeshBasicMaterial({ map: routeTexture(), transparent: true, opacity: 0.35, depthTest: false, depthWrite: false }));
    ghost.renderOrder = 6; casing.renderOrder = 3; core.renderOrder = 3;
    g.add(casing); g.add(core); g.add(ghost);
    this.routeG = g; this.routeSegs = P.length - 1;
    this.floorG.add(g);
    this.setRouteProgress(1);
  };
  S.setRouteProgress = function (t) {
    if (!this.routeG) return;
    var n = Math.round(this.routeSegs * Math.max(0, Math.min(1, t))) * 6;
    this.routeG.children.forEach(function (m) { m.geometry.setDrawRange(0, n); });
  };
  S.clearRoute = function () {
    if (!this.routeG) return;
    this.floorG && this.floorG.remove(this.routeG);
    var seen = {};
    this.routeG.traverse(function (c) { if (c.geometry && !seen[c.geometry.uuid]) { seen[c.geometry.uuid] = 1; c.geometry.dispose(); } if (c.material) c.material.dispose(); });
    this.routeG = null;
  };
  S.setIconSize = function (worldSize) { this.icons.forEach(function (s) { s.scale.set(worldSize, worldSize, 1); }); };
  // colour one unit as selected (roof and walls), or none
  S.highlight = function (unitId) {
    var m = unitId ? this.meshOf(unitId) : null;
    if (this.hl && this.hl !== m) { this.hl.material[0].color.setHex(this.hl.userData.top); this.hl.material[1].color.setHex(this.hl.userData.side); }
    this.hl = m;
    if (m) { m.material[0].color.setHex(SEL_TOP); m.material[1].color.setHex(SEL_SIDE); }
  };
  // nearest hit under a ray: {fac} for an icon, {unit} for a building
  S.pick = function (ray) {
    var hit = this.vis.units && this.unitG ? ray.intersectObjects(this.meshes, false)[0] || null : null;
    if (this.vis.fac && this.facG) {
      var hi = ray.intersectObjects(this.icons, false)[0];
      if (hi && (!hit || hi.distance < hit.distance)) return { fac: hi.object.userData.fac };
    }
    return hit ? { unit: hit.object.userData.unit } : null;
  };
  S.dispose = function () { this.clear(); };

  B.Scene3D = Scene3D;
})(window.BSB);
