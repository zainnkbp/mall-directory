# HANDOFF — BSB Directory (Kiosk Wayfinding e-Walk & Pentacity)

Dokumen serah terima untuk tim pengembang yang meneruskan proyek. Status per **4 Oktober 2026**.

## 1. Apa ini

Pengganti halaman directory lama (ewalkpentacitymall.com/maps-e-walk-pentacity-mall-balikpapan/, berbasis Mapplic) menjadi:

- **Kiosk touchscreen** (`index.html`) di beberapa titik mall: cari tenant, kategori, rute animasi antar-lantai/antar-gedung, mode kursi roda, QR "Continue on phone".
- **Halaman HP** (`m/`) hasil scan QR: panah kompas ala Apple Find My, langkah per segmen, hitung langkah kaki, koreksi manual "Sudah sampai sini".
- **CMS** (`cms/` + `api/`): kelola tenant, peta, jalur, eskalator/lift, kiosk, promo, publish/rollback, status ops live, analitik.

## 2. Keputusan yang sudah diambil pemilik proyek (jangan diubah tanpa konfirmasi)

| Topik | Keputusan |
|---|---|
| Panduan di HP | Kompas + langkah per segmen + hitung langkah sensor HP. **Tanpa BLE beacon.** |
| Gaya visual | "Mall modern": terang, warm neutral, Plus Jakarta Sans. Bukan 3D/neon. |
| Bahasa | **Default Inggris**, opsi Indonesia. Halaman depan (attract) **selalu Inggris**. QR membawa bahasa pilihan pengunjung (`&lang=`). |
| Logo | Logo resmi e-Walk \| Pentacity (`assets/brand/`), e-Walk diperkecil 70% agar seimbang. |
| Data | Impor sekali dari Mapplic, lalu dikelola di CMS sendiri (lepas dari Mapplic). |
| Hardware kiosk | PC Windows layar landscape (Edge `--kiosk`), **atau** Smart TV touchscreen ber-browser (profil `smart_tv`, mode `lite`). Layout didesain 1920×1080 dan diskalakan otomatis ke layar apa pun. |
| Stack CMS | PHP 8 native + MariaDB (XAMPP), tanpa framework. MySQL = sumber kebenaran; **Publish** menghasilkan `data/directory.json`, `data/promos.json`, `data/status.json`. |
| Eskalator/lift | Dimodelkan per **leg** antar dua lantai: aktif/nonaktif, arah (dua arah / naik saja / turun saja), jadwal, penutupan sementara. |
| Offline | Server di **LAN mall** + domain asli & sertifikat (Let's Encrypt DNS-01) → internet putus tidak berpengaruh; Service Worker menyimpan cache agar kiosk tetap jalan walau server mati. |

## 3. Status

**Selesai & teruji** (lulus uji integrasi di stack asli):

- Data: 8 sheet lantai (5 level), 210 tenant, 7 kiosk, graph 614 node; 100% tenant terjangkau dari semua kiosk (1470/1470), mode kursi roda 1449/1470.
- Kiosk & HP: lihat bagian 1. Rute berantai menampilkan setiap lantai ("via UG · 1F").
- CMS 20 layar, API, publisher, validator, rollback, audit log, Ops status (bisa di HP), promo, analitik.
- Runtime: Service Worker offline, sinkronisasi versi (reload hanya saat idle), status live ≤70 dtk, telemetri antre offline, mode lite TV, script setup Windows.
- Uji: `validate.php` 1470/1470 · `smoke_test.php` 114/114 · `tests/wpc/e2e.js` 59/59 · `tests/wpc/route_regression.js` identik.

**Belum dikerjakan / belum teruji**:

1. Uji di **perangkat fisik**: PC Windows (`kiosk/setup-kiosk.ps1` belum pernah dijalankan), Smart TV (merk/OS belum diketahui), HP sungguhan (kompas & hitung langkah baru diuji simulasi).
2. **Produksi**: domain + HTTPS (wajib untuk kompas iOS & Service Worker), server di LAN mall, `config.local.php`, ganti `secret`, izin file (dev memakai 0666/0777 karena Apache=daemon).
3. **Data lapangan** (lihat bagian 5).
4. CMS: penempatan pin tenant, edit graph, dan ganti SVG lantai baru diuji di mode mock; tampilan peran selain superadmin belum diuji.
5. Promo video belum diuji dengan file nyata. Admin panel v2 (lihat `docs/CMS_SPEC.md` §10.2).

## 4. Menjalankan di lokal

1. Salin folder `bsb-directory/` ke `htdocs/` XAMPP (PHP ≥ 8.0, MariaDB ≥ 10.4). Untuk WebP: PHP ≥ 8.1 dengan GD WebP, atau `cwebp` (path di `config.php`).
2. Import database: `php tools/setup.php import` (membuat DB `bsb_directory` dari `_handoff/db/bsb_directory.sql`, cukup PHP; database yang sudah berisi dicadangkan dulu dengan `--force`). Lalu `php tools/setup.php check`. Panduan lengkap: `CARA_MENJALANKAN.md`.
3. Akun CMS ikut di dump (login sama dengan komputer asal dump; password tidak ditulis di repo publik). Akun tambahan: `php tools/create_admin.php`.
4. Buka:
   - Kiosk: `http://localhost/bsb-directory/` (param: `?kiosk=<id>&key=<token>`, `?attract=0`, `?lang=id`)
   - HP: `http://localhost/bsb-directory/m/?k=gf-pentacity&t=<tenantId>&a=0&lang=en`
   - CMS: `http://localhost/bsb-directory/cms/` (mode contoh tanpa DB: `cms/login.html?mock=1`)
5. Token kiosk dibuat di CMS → Kiosk → provisioning (URL + QR + `.bat`).
   Alternatif tanpa XAMPP: `php -S 127.0.0.1:8000 tools/dev_router.php` (meniru `.htaccess`; kiosk, CMS & API di `http://localhost:8000/`).
6. Uji ulang: `php tools/validate.php`, `php tools/smoke_test.php --cred <file kredensial>`, `node tests/wpc/route_regression.js`, `node tests/wpc/e2e.js` (Playwright).

Untuk HP di jaringan yang sama: set `PUBLIC_BASE` di `config.js` (IP LAN atau tunnel HTTPS, mis. `cloudflared tunnel --url http://localhost:80`). Lewat http biasa, HP jatuh ke mode manual (tanpa kompas).

## 5. Data yang harus dikumpulkan dari tim mall

- **Cek lapangan eskalator & lift**: formulir siap cetak di `docs/CMS_SPEC.md` §9.3–9.4. Di Mapplic, eskalator digambar menembus semua lantai, padahal tidak selalu begitu.
  - Sudah dikonfirmasi: **Eskalator A Pentacity (depan Sociolla) hanya GF↔UG**, tidak ke LG. Sudah diterapkan.
  - Perlu dicek: eskalator satu arah; apakah Lift E-Walk sampai 2F (kalau tidak, Matahari 2F, XXI 2F, Grand Jatra tidak terjangkau rute kursi roda); dua eskalator E-Walk yang ujungnya putus di data; apakah eskalator bertumpuk (UG/1F) memang langsung bersambung tanpa berjalan.
  - Hasil diisi di CMS → Eskalator & lift (centang "Sudah dicek di lapangan").
- Arah utara denah (`map.northDeg`) dan arah hadap layar tiap kiosk; apakah 7 titik "You Are Here" memang lokasi kiosk.
- Toilet, musala, ATM, meja info, ruang menyusui (belum ada di peta).
- Jam buka tenant; logo resmi (banyak "logo" dari Mapplic sebenarnya foto toko: Uniqlo, Starbucks, XXI, Matahari, Hypermart…).
- Koridor 2F E-Walk hampir tidak ada di Mapplic (rute di sana masih garis perkiraan) → gambar ulang di Editor graph CMS.
- Merk/tipe TV touchscreen, domain produksi, server & VLAN.

## 6. Peta dokumen & kode

| Lokasi | Isi |
|---|---|
| `docs/CMS_SPEC.md` | Spesifikasi lengkap: peran, modul, DDL, API, format snapshot, keamanan, ops, formulir lapangan, rencana v2 |
| `docs/CMS_DEVIATIONS.md` | Perbedaan implementasi dari spec (WP-A, WP-B, WP-C, Integrasi) |
| `data/DATA_REPORT.md` | Laporan pembersihan data Mapplic: yang dibuang/digabung, asumsi, transform koordinat |
| `README.md` | Cara menjalankan prototype kiosk/HP |
| `kiosk/README-kiosk.txt`, `kiosk/README-smart-tv.md` | Setup PC Windows & Smart TV |
| `db/`, `lib/`, `api/`, `tools/*.php` | Backend CMS |
| `cms/` | Admin UI |
| `index.html`, `m/`, `js/`, `css/`, `sw.js` | Runtime kiosk & HP |
| `tools/build_data.py`, `tools/verify_routes.py` | Importer Mapplic awal (sekarang hanya untuk seed ulang; sumber kebenaran = DB) |
| `data/releases/` | Arsip rilis yang dipublish (untuk rollback) |
| `docs/screens/` | Screenshot prototype |
| `_handoff/context/` | Catatan konteks dari sesi pengembangan dengan Claude |

## 7. Catatan teknis penting

- `data/directory.json` hanya boleh ditulis oleh publisher CMS. Jangan edit tangan.
- Kiosk lama (tanpa patch) tetap bisa membaca snapshot baru; format edge `[from,to,cost,type,(ruleKey)]`.
- Folder `data/raw/logos/` (cache logo mentah 71 MB) **tidak disertakan**; diunduh ulang otomatis oleh `build_data.py` bila perlu.
- Database di paket berisi sedikit data telemetri dari pengujian; hash password admin dev & token kiosk dev ada di DB. **Hapus akun dev dan buat ulang token sebelum produksi.**
- Deploy ke hosting: `docs/DEPLOY.md` (GitHub Actions + SSH, data server di `~/bsb/shared`). Naikkan `APP_BUILD` saat deploy agar kiosk segera mengambil versi baru.
- Peta 3D (Oktober 2026, `docs/3D.md`): jalankan `db/migrate_2026_10_3d.sql` di DB server (tipe edge `stairs` + tangga GF E-Walk). Koordinat CMS semua lantai sekarang memakai satuan gambar Illustrator (denah tampak atas; GF dan UG digabung dari gambar per gedung); perubahan itu ada di DB, jadi bawa lewat dump DB penuh, bukan `export_cpanel_sql.php`.
