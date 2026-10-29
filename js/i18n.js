/* i18n — Bahasa Indonesia (primary) + English */
window.BSB = window.BSB || {};
(function (B) {
  var S = {
    id: {
      appTitle: 'Direktori & Navigasi',
      mallName: 'e-Walk & Pentacity',
      mallSub: 'Balikpapan Superblock',
      searchPh: 'Cari toko, makanan, merek…',
      categories: 'Kategori',
      all: 'Semua', stores: 'toko', hours: 'Jam buka', allTenants: 'Semua toko A–Z', results: 'hasil', noResults: 'Tidak ada hasil. Coba kata lain.',
      floor: 'Lantai', building: 'Gedung', allFloors: 'Semua lantai', allBuildings: 'Semua gedung',
      back: 'Kembali', close: 'Tutup', showRoute: 'Tunjukkan Rute', call: 'Telepon', website: 'Situs web',
      scanWeb: 'Pindai untuk situs web', accessible: 'Rute ramah kursi roda', accessibleSub: 'Hindari eskalator & tangga',
      prefTitle: 'Pilihan Jalur', prefBest: 'Rekomendasi', prefBestSub: 'Eskalator untuk lantai dekat',
      prefLift: 'Prioritas Lift', prefLiftSub: 'Stroller & koper', prefAcc: 'Kursi Roda', prefAccSub: 'Khusus lift & ramp',
      liftFallbackNotice: 'Lantai ini belum terhubung lift langsung — dialihkan ke eskalator.',
      route: 'Rute', distance: 'Jarak', time: 'Waktu', minutes: 'mnt', approx: '±',
      replay: 'Putar ulang', continuePhone: 'Lanjutkan di HP', continuePhoneSub: 'Pindai untuk panduan langkah demi langkah',
      qrModalTitle: 'Buka Navigasi di Ponsel', qrModalSub: 'Pindai kode QR ini dengan kamera HP Anda untuk panduan rute interaktif',
      youAreHere: 'Anda di sini', destination: 'Tujuan',
      floorSoon: 'Peta 3D lantai ini sedang disiapkan', layers3d: 'Lapisan peta', layerSlab: 'Lantai mall', layerUnits: 'Bangunan toko',
      layerNames: 'Nama toko', layerLogos: 'Logo di atap', layerFac: 'Ikon fasilitas', turnLeft: 'Putar kiri', turnRight: 'Putar kanan', northUp: 'Arah awal',
      touchStart: 'Sentuh layar untuk mulai', welcome: 'Selamat datang di', welcomeSub: 'Temukan toko, kuliner & hiburan — lalu kami antar ke sana.',
      featured: 'Pilihan hari ini', amenities: 'Fasilitas',
      lift: 'Lift', escalator: 'Eskalator', crossing: 'Jembatan', nearest: 'terdekat',
      keyboardDone: 'Selesai', clear: 'Hapus', space: 'Spasi',
      quick: 'Cepat:', noRoute: 'Rute tidak ditemukan untuk mode ini.', noRouteAcc: 'Lantai ini belum terjangkau lift (data belum ada). Matikan mode kursi roda untuk melihat rute eskalator.',
      estNote: 'Jarak & waktu adalah perkiraan.',
      devWarnBase: 'Mode dev: alamat QR memakai localhost — HP tidak bisa membukanya. Isi PUBLIC_BASE di config.js (IP\u00A0LAN\u00A0/ tunnel\u00A0HTTPS).',
      legWalk: 'Jalan', toward: 'menuju',
      floorsGroupLabel: 'Lantai',
      pentacity: 'Pentacity', ewalk: 'E-Walk', both: 'Pentacity & E-Walk',
      step: 'Langkah', of: 'dari', steps: 'Langkah-langkah',
      from: 'Dari', to: 'Tujuan', startPoint: 'Titik Awal',
      changeOrigin: 'Ubah titik awal', changeDest: 'Ubah tujuan',
      resetToKiosk: 'Kiosk ini', swapRoute: 'Tukar arah rute',
      startFromHere: 'Mulai dari sini', selectStartStore: 'Pilih Titik Awal',
      selectDestStore: 'Pilih Toko Tujuan', searchStartPh: 'Cari titik awal (toko / merek)…',
      currentKiosk: 'Posisi Kiosk', currentKioskSub: 'Lokasi fisik kiosk ini di mall',
      startPointSet: 'Titik awal diatur ke {name}. Silakan pilih tujuan.',
      // phone
      fromKiosk: 'Dari kiosk', startNav: 'Mulai Navigasi', startNavSub: 'Izinkan akses kompas & gerak agar panah dan titik posisi berjalan otomatis.',
      sensorsOff: 'Sensor tidak tersedia — gunakan peta & tombol Lanjut.', sensorsNeedHttps: 'Kompas di iPhone butuh HTTPS. Mode peta + langkah manual aktif.',
      compassOn: 'Kompas aktif', pedometerOn: 'Penghitung langkah aktif',
      calibrate: 'Kalibrasi arah', calibrateTitle: 'Kalibrasi kompas (sekali saja)',
      calibrateBody: 'Hadapkan bagian atas HP lurus ke arah {x}, lalu ketuk tombol di bawah.',
      calibrateBtn: 'Sudah menghadap — Simpan', calibrated: 'Arah tersimpan', recalibrate: 'Kalibrasi ulang',
      arrivedHere: 'Sudah sampai sini', next: 'Lanjut', prev: 'Sebelumnya',
      remaining: 'tersisa', toNext: 'ke titik berikutnya',
      changeFloorDone: 'Saya sudah di {f} — Lanjut',
      arrived: 'Anda sudah sampai!', arrivedSub: 'Selamat berbelanja di', done: 'Selesai', restart: 'Ulangi rute',
      mapArrowNote: 'Panah mengikuti arah di peta (kompas tidak aktif)',
      stepsCounted: 'langkah', loading: 'Memuat…', error: 'Data tidak dapat dimuat.',
      badLink: 'Tautan tidak valid. Pindai ulang QR di kiosk.',
      pickFromTitle: 'Kamu di mana?', pickFromSub: 'Pilih pintu masuk atau toko terdekat sebagai titik awal.',
      tabLobby: 'Lobby / pintu masuk', tabNearStore: 'Dekat toko',
      pickToTitle: 'Mau ke mana?', pickToSub: 'Cari toko, makanan, atau fasilitas.',
      pickSearchPh: 'Cari toko, makanan, merek…', nearestFacility: 'Fasilitas terdekat',
      fromEntrance: 'Dari pintu masuk', noLobby: 'Belum ada titik lobby.',
      previewYes: 'Ya, saya di sini', previewNo: 'Bukan, pilih yang lain', nearby: 'Di dekat',
      previewHint: 'Cocokkan peta dengan sekitar Anda.',
      walkTime: 'jalan kaki', via: 'lewat',
      // CMS runtime (WP-C)
      routeClosed: '{x} sedang ditutup{r}. Rute alternatif tidak tersedia — silakan ke Information Desk.',
      routeDetour: '{x} sedang ditutup{r} — rute ini memakai jalur alternatif.',
      tempClosed: 'Tutup sementara', comingSoon: 'Segera hadir', openToday: 'Buka hari ini', closedToday: 'Tutup hari ini',
      offlineRetry: 'Menghubungkan ke server… mencoba lagi dalam {s} detik.', connecting: 'Menghubungkan…',
      offlineMode: 'Mode offline — data terakhir', underMaintenance: 'Dalam perawatan',
      scanPromo: 'Pindai untuk info lengkap', tapToClose: 'Sentuh untuk menutup', kioskId: 'ID kiosk',
      poi_toilet: 'Toilet', 'poi_toilet-accessible': 'Toilet difabel', poi_musholla: 'Musholla', poi_atm: 'ATM',
      'poi_info-desk': 'Information Desk', 'poi_parking-entrance': 'Pintu parkir', 'poi_lobby-exit': 'Lobi / Pintu keluar',
      poi_nursery: 'Ruang laktasi', 'poi_first-aid': 'P3K', poi_charging: 'Charging station', 'poi_smoking-area': 'Area merokok',
      'poi_lost-found': 'Lost & found', 'poi_wheelchair-rental': 'Sewa kursi roda', 'poi_drop-off': 'Drop-off taksi/ojol'
    },
    en: {
      appTitle: 'Directory & Wayfinding',
      mallName: 'e-Walk & Pentacity',
      mallSub: 'Balikpapan Superblock',
      searchPh: 'Search stores, food, brands…',
      categories: 'Categories',
      all: 'All', stores: 'stores', hours: 'Opening hours', allTenants: 'All stores A–Z', results: 'results', noResults: 'No results. Try another word.',
      floor: 'Floor', building: 'Building', allFloors: 'All floors', allBuildings: 'All buildings',
      back: 'Back', close: 'Close', showRoute: 'Show Route', call: 'Phone', website: 'Website',
      scanWeb: 'Scan for website', accessible: 'Wheelchair‑friendly route', accessibleSub: 'Avoid escalators & stairs',
      prefTitle: 'Transit Preference', prefBest: 'Best Route', prefBestSub: 'Escalator for near floors',
      prefLift: 'Elevator', prefLiftSub: 'Strollers & luggage', prefAcc: 'Accessible', prefAccSub: 'Step-free, elevators only',
      liftFallbackNotice: 'No direct lift to this floor — routed via escalator.',
      route: 'Route', distance: 'Distance', time: 'Time', minutes: 'min', approx: '~',
      replay: 'Replay', continuePhone: 'Continue on phone', continuePhoneSub: 'Scan for step‑by‑step directions',
      qrModalTitle: 'Open Navigation on Phone', qrModalSub: 'Scan this QR code with your phone camera for step-by-step route guidance',
      youAreHere: 'You are here', destination: 'Destination',
      floorSoon: 'The 3D map of this floor is coming soon', layers3d: 'Map layers', layerSlab: 'Mall floor', layerUnits: 'Shop buildings',
      layerNames: 'Shop names', layerLogos: 'Roof logos', layerFac: 'Facility icons', turnLeft: 'Turn left', turnRight: 'Turn right', northUp: 'Default view',
      touchStart: 'Touch the screen to start', welcome: 'Welcome to', welcomeSub: 'Find stores, food & fun — then we will guide you there.',
      featured: 'Featured today', amenities: 'Facilities',
      lift: 'Lift', escalator: 'Escalator', crossing: 'Bridge', nearest: 'nearest',
      keyboardDone: 'Done', clear: 'Clear', space: 'Space',
      quick: 'Quick:', noRoute: 'No route found for this mode.', noRouteAcc: 'No lift reaches this floor yet (missing data). Turn off wheelchair mode to see the escalator route.',
      estNote: 'Distance & time are estimates.',
      devWarnBase: 'Dev mode: the QR uses localhost — phones cannot open it. Set PUBLIC_BASE in config.js (LAN\u00A0IP\u00A0/ HTTPS\u00A0tunnel).',
      legWalk: 'Walk', toward: 'toward',
      floorsGroupLabel: 'Floors',
      pentacity: 'Pentacity', ewalk: 'E-Walk', both: 'Pentacity & E-Walk',
      step: 'Step', of: 'of', steps: 'Steps',
      from: 'From', to: 'Destination', startPoint: 'Starting Point',
      changeOrigin: 'Change start', changeDest: 'Change destination',
      resetToKiosk: 'This kiosk', swapRoute: 'Swap route direction',
      startFromHere: 'Start route from here', selectStartStore: 'Select Starting Point',
      selectDestStore: 'Select Destination Store', searchStartPh: 'Search start (store / brand)…',
      currentKiosk: 'Kiosk Location', currentKioskSub: 'Physical location of this kiosk in the mall',
      startPointSet: 'Starting point set to {name}. Please select destination.',
      fromKiosk: 'From kiosk', startNav: 'Start Navigation', startNavSub: 'Allow compass & motion access so the arrow and your position move automatically.',
      sensorsOff: 'Sensors unavailable — use the map and Next button.', sensorsNeedHttps: 'iPhone compass needs HTTPS. Map + manual steps mode is on.',
      compassOn: 'Compass on', pedometerOn: 'Step counter on',
      calibrate: 'Calibrate direction', calibrateTitle: 'Compass calibration (one time)',
      calibrateBody: 'Point the top of your phone straight at {x}, then tap the button below.',
      calibrateBtn: 'Facing it — Save', calibrated: 'Direction saved', recalibrate: 'Recalibrate',
      arrivedHere: 'I’m here', next: 'Next', prev: 'Back',
      remaining: 'left', toNext: 'to next point',
      changeFloorDone: 'I’m on {f} — Continue',
      arrived: 'You’ve arrived!', arrivedSub: 'Enjoy your visit to', done: 'Done', restart: 'Restart route',
      mapArrowNote: 'Arrow follows the map direction (compass off)',
      stepsCounted: 'steps', loading: 'Loading…', error: 'Could not load data.',
      badLink: 'Invalid link. Please scan the QR at the kiosk again.',
      pickFromTitle: 'Where are you?', pickFromSub: 'Choose the entrance or the store nearest to you as your starting point.',
      tabLobby: 'Lobby / entrance', tabNearStore: 'Near a store',
      pickToTitle: 'Where to?', pickToSub: 'Search stores, food or facilities.',
      pickSearchPh: 'Search stores, food, brands…', nearestFacility: 'Nearest facility',
      fromEntrance: 'From entrance', noLobby: 'No lobby points yet.',
      previewYes: 'Yes, I’m here', previewNo: 'No, choose another', nearby: 'Near',
      previewHint: 'Compare the map with what you see around you.',
      walkTime: 'walk', via: 'via',
      routeClosed: '{x} is closed{r}. No alternative route is available — please visit the Information Desk.',
      routeDetour: '{x} is closed{r} — this route uses an alternative way.',
      tempClosed: 'Temporarily closed', comingSoon: 'Coming soon', openToday: 'Open today', closedToday: 'Closed today',
      offlineRetry: 'Connecting to the server… retrying in {s} seconds.', connecting: 'Connecting…',
      offlineMode: 'Offline mode — last saved data', underMaintenance: 'Under maintenance',
      scanPromo: 'Scan for details', tapToClose: 'Tap to close', kioskId: 'Kiosk ID',
      poi_toilet: 'Toilets', 'poi_toilet-accessible': 'Accessible toilet', poi_musholla: 'Prayer room', poi_atm: 'ATM',
      'poi_info-desk': 'Information Desk', 'poi_parking-entrance': 'Parking entrance', 'poi_lobby-exit': 'Lobby / Exit',
      poi_nursery: 'Nursing room', 'poi_first-aid': 'First aid', poi_charging: 'Charging station', 'poi_smoking-area': 'Smoking area',
      'poi_lost-found': 'Lost & found', 'poi_wheelchair-rental': 'Wheelchair rental', 'poi_drop-off': 'Taxi / ride drop-off'
    }
  };

  var CAT = {
    id: { 'food-beverage': 'Makanan & Minuman', 'fashion': 'Fashion & Gaya Hidup', 'beauty-health': 'Kecantikan & Kesehatan',
      'electronics': 'Gadget & Elektronik', 'kids-family': 'Anak & Keluarga', 'entertainment': 'Hiburan',
      'department-store': 'Department Store & Supermarket', 'services': 'Hotel, Travel & Layanan' },
    en: {}
  };

  // CMS overrides from the snapshot (D.i18n = {en:{key:..}, id:{..}}); js/i18n.js stays the default
  B.mergeI18n = function (o) {
    if (!o) return;
    ['en', 'id'].forEach(function (l) { var m = o[l]; if (m) for (var k in m) if (typeof m[k] === 'string' && m[k]) S[l][k] = m[k]; });
  };
  B.hasT = function (k) { return !!(S[B.lang] && S[B.lang][k]) || !!S.id[k]; };

  B.lang = (window.BSB_CONFIG && BSB_CONFIG.defaultLang) || 'en';
  document.documentElement.lang = B.lang;
  B.t = function (k, vars) {
    var s = (S[B.lang] && S[B.lang][k]) || S.id[k] || k;
    if (vars) for (var v in vars) s = s.replace('{' + v + '}', vars[v]);
    return s;
  };
  // keep '&' with the word after it so wraps read 'Department Store / & Supermarket'
  B.catName = function (cat) {
    var n = B.lang === 'id' ? (cat.nameId || (CAT.id[cat.id]) || cat.name) : (cat.nameEn || cat.name);
    return String(n).replace(/ & /g, ' &\u00A0');
  };
  // never start a wrapped line with a '·' separator (e.g. tenant names like "Cinema XXI · Pentacity")
  B.tidy = function (s) { return String(s == null ? '' : s).replace(/ · /g, '\u00A0· '); };
  B.setLang = function (l) { B.lang = l; document.documentElement.lang = l; };
  B.buildingName = function (b) { return b === 'ewalk' ? 'E-Walk' : b === 'pentacity' ? 'Pentacity' : B.t('both'); };
  B.amenityName = function (a) {
    if (B.lang === 'id' && a.nameId) return a.nameId;
    if (B.lang !== 'id' && a.nameEn) return a.nameEn;
    var n = a.name || (a.kind === 'poi' ? B.t('poi_' + a.type) : a.type);
    if (B.lang === 'id') return n.replace('Escalator', 'Eskalator').replace('Bridge', 'Jembatan');
    return n;
  };
  // POI / amenity type label (CMS amenityTypes first, then built-in strings)
  B.amenityTypeName = function (type) {
    var at = B.D && B.D.amenityTypeById && B.D.amenityTypeById[type];
    if (at) return B.lang === 'id' ? (at.nameId || at.nameEn) : (at.nameEn || at.nameId);
    return B.hasT('poi_' + type) ? B.t('poi_' + type) : type;
  };
  B.floorLabel = function (f) {
    // "UG", "1F · Pentacity"
    return f.short + (f.building !== 'both' ? '\u00A0· ' + B.buildingName(f.building) : '');
  };
  B.floorLong = function (f) {
    var names = { id: { '-1': 'Lower Ground', '0': 'Ground Floor', '1': 'Upper Ground', '2': 'Lantai 1', '3': 'Lantai 2' },
                  en: { '-1': 'Lower Ground', '0': 'Ground Floor', '1': 'Upper Ground', '2': 'First Floor', '3': 'Second Floor' } };
    var n = names[B.lang][String(f.level)] || (B.lang === 'id' ? f.nameId : f.nameEn) || f.name;
    return n + (f.building !== 'both' ? '\u00A0· ' + B.buildingName(f.building) : '');
  };
})(window.BSB);
