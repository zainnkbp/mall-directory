/*
 * BSB Directory — runtime configuration (kiosk + phone).
 * Edit this file on each kiosk PC; no build step needed.
 */
window.BSB_CONFIG = {
  // Base URL the PHONE opens after scanning the QR. Must be reachable from the visitor's phone.
  //  - null  -> auto: location.origin + app folder (e.g. http://localhost/bsb-directory) — NOT reachable from a phone!
  //  - LAN   -> 'http://192.168.11.252:8000'  (Android OK; iOS compass needs HTTPS)
  //  - HTTPS -> 'https://xxxx.trycloudflare.com' (cloudflared quick tunnel, see README)
  // It can also be overridden per launch with ?base=<url> on the kiosk URL.
  // Only used when the page runs on a local address (localhost / LAN IP): on a public domain (hosting, e.g.
  // https://maps.ewalkpentacitymall.com) the QR always uses that domain, so this file needs no change there.
  PUBLIC_BASE: 'http://192.168.11.252:8000',

  // Default kiosk when the URL has no ?kiosk=<id>
  DEFAULT_KIOSK: 'gf-pentacity',

  // Compass bearing (degrees clockwise from true north) of the map's "up" direction.
  // null = unknown -> the phone asks the visitor for a one-time calibration.
  // NOTE: the plans are isometric drawings, so a single rotation is only an approximation.
  mapNorthDeg: null,

  // ESTIMATE: metres per cost unit (cost unit = Ground-Floor SVG unit; detail floors are scaled by floor.unitScale).
  // Derived from Pentacity GF corridor length (~280 units ≈ 200 m). Accuracy roughly ±30 %.
  metersPerUnit: 0.7,

  // 3D floors from data/3d/floors.json (js/map3d.js). false = always the 2D SVG maps. Lite devices stay 2D anyway.
  map3d: true,
  // true = floors without a 3D model show an empty map ("coming soon") instead of the old 2D drawing.
  map3dOnly: true,
  // seconds between checks for renamed tenants / new roof logos saved by the 3D editor (0 = only on load)
  map3dEditsPollSec: 60,

  // Walking model (estimates)
  walkSpeedMps: 1.2,        // average mall walking speed
  strideMeters: 0.7,        // used by the phone pedometer
  escalatorSecPerLevel: 25,
  liftSecPerTrip: 60,

  // Kiosk behaviour
  idleTimeoutSec: 60,
  defaultLang: 'en',        // 'id' | 'en'
  devMode: true,            // shows warnings (e.g. PUBLIC_BASE is localhost)

  // Featured tenants on the attract screen (fallback when data/promos.json has no `featured` list)
  featured: ['uniqlo-gf', 'h-and-m-gf', 'starbucks-gf-penta', 'cinema-xxi-sf-penta', 'matahari-ff-ewalk',
             'hypermart-lg-penta', 'sephora-gf', 'kfc-lg-penta', 'marugame-udon-ug', 'fun-world-ff-penta',
             'charles-and-keith-gf', 'samsung-experience-store-ug'],

  // Language of the attract/front screen (independent of the in-app ID/EN toggle)
  attractLang: 'en',

  // ---- CMS runtime (WP-C) ----
  // bump on every kiosk code deploy -> new Service Worker + shell cache (sw.js?v=APP_BUILD); also set the same value in the
  // ?v= of the script / stylesheet tags of index.html and m/index.html so a cached page never mixes old and new files
  APP_BUILD: '2026.10.29-5',
  API_BASE: 'api',          // relative to the app root; without mod_rewrite use 'api/index.php?r='. Kiosk identity: ?kiosk=<id>&key=<token> on the launch URL.
  POLL_SEC: 60,             // version poll / heartbeat interval (±10 s jitter). Status closures apply within ~70 s.
  TELEMETRY_SEC: 60,        // telemetry flush interval (also flushes at >= 50 queued events)
  perfMode: 'auto',         // 'auto' | 'full' | 'lite'  (CMS kiosks.perfMode and ?perf= override this)
  clientType: null,         // fallback when the snapshot has no kiosk profile: 'windows_pc' | 'smart_tv' | 'android_box'
  fullscreenEvery: 4,       // attract-fullscreen takeover after every N hero promos
  serviceWorker: false,     // set false to disable offline caching (debugging)

  // Placeholder promos for the attract screen — used only when data/promos.json is missing or has no active promo
  promos: [
    { id: 'Weekend Fashion Week', en: 'Weekend Fashion Week', subId: 'Diskon s.d. 50% di tenant fashion pilihan', subEn: 'Up to 50% off at selected fashion stores' },
    { id: 'Kuliner Nusantara', en: 'Taste of Nusantara', subId: 'Jelajahi rasa favorit di LG & UG', subEn: 'Explore local favourites on LG & UG' },
    { id: 'Family Fun Day', en: 'Family Fun Day', subId: 'Fun World, Kidzooona & Kidzlandia', subEn: 'Fun World, Kidzooona & Kidzlandia' }
  ]
};
