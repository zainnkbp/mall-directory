# Deploy ke hosting (GitHub Actions + SSH)

Alurnya: Pull Request → tes otomatis di GitHub → merge ke `main` → GitHub mengirim rilis ke server lewat SSH → situs pindah ke rilis baru sekaligus → kiosk & HP memuat versi baru saat idle.

```
~/bsb/
├── releases/20261029-0700-ab12cd3/   kode satu rilis (5 rilis terakhir disimpan untuk rollback)
├── shared/                           milik server, TIDAK PERNAH ditimpa deploy
│   ├── config.local.php              kredensial database
│   ├── data/                         directory.json, version.json, status.json, promos.json, releases/, 3d/edits/
│   └── media/                        logo, promo, denah, logo atap 3D yang diunggah di CMS
└── current -> releases/…             document root domain menunjuk ke sini
```

Data CMS (tenant, jalur, atap 3D, logo) hidup di database + `shared/` server. Git hanya membawa **kode dan file peta**.

---

## A. Persiapan sekali saja

### 1. SSH key khusus deploy (di laptop)
```bash
ssh-keygen -t ed25519 -f ~/.ssh/bsb_deploy -C "github-deploy bsb" -N ""
cat ~/.ssh/bsb_deploy.pub      # salin isinya
```
cPanel → **SSH Access** → **Manage SSH Keys** → **Import Key** → tempel public key → **Authorize**.

Cek dari laptop (ganti host, port, user sesuai email hosting):
```bash
ssh -i ~/.ssh/bsb_deploy -p 45022 ewalkpen@101.50.1.87 "php -v"   # Jagoan Hosting: SSH di port 45022
```
Aplikasi butuh **PHP 8.1+**. Di Jagoan Hosting `php` di terminal = 7.2 (dipakai juga WordPress di `public_html`, jangan diubah); PHP 8.2 ada di **`/opt/alt/php82/usr/bin/php`** (pdo_mysql ✓). Path itu dipakai untuk `DEPLOY_PHP`, cron, dan semua perintah `php` di panduan ini.

Sidik jari server yang benar (cocokkan dengan yang muncul saat pertama connect): `SHA256:FnN8luObwKwKYjK1L/2dL0Ua6iyMzN4wDzo1pVA8BAY`.

Ambil sidik jari server untuk GitHub:
```bash
ssh-keyscan -p 45022 101.50.1.87
```

### 2. Database
1. Di laptop, buat dump (jangan dimasukkan ke git — berisi hash password):
   ```bash
   php tools/setup.php dump --cpanel --out ~/Desktop/bsb_directory.sql
   ```
2. cPanel → **MySQL Databases**: buat database + user, beri **ALL PRIVILEGES**. Catat nama DB, user, password.
3. cPanel → **phpMyAdmin** → pilih database → **Import** → `bsb_directory.sql`.
   (Kalau terlalu besar: `scp -P 45022 -i ~/.ssh/bsb_deploy ~/Desktop/bsb_directory.sql ewalkpen@101.50.1.87:~/` lalu di SSH `mysql -u USER_DB -p NAMA_DB < ~/bsb_directory.sql && rm ~/bsb_directory.sql`.)

### 3. Folder di server
```bash
ssh -i ~/.ssh/bsb_deploy -p 45022 ewalkpen@101.50.1.87
mkdir -p ~/bsb/shared
# PHP 8.2 khusus situs maps (WordPress di public_html tetap 7.2):
echo 'AddHandler application/x-httpd-alt-php82___lsphp .php' > ~/bsb/shared/htaccess.local
nano ~/bsb/shared/config.local.php
```
Isi:
```php
<?php
return [
  'db' => ['host' => 'localhost', 'port' => 3306, 'name' => 'NAMA_DB', 'user' => 'USER_DB', 'pass' => 'PASSWORD_DB'],
  'secret'   => 'GANTI-teks-acak-minimal-32-karakter',
  'fileMode' => 0644,
  'dirMode'  => 0755,
  // 'trustProxy' => true,   // hanya bila situs di belakang Cloudflare
];
```
```bash
chmod 600 ~/bsb/shared/config.local.php
```

### 4. GitHub: secrets & variables
Repo → **Settings** → **Secrets and variables** → **Actions**.

**Secrets** (tab *Secrets*):

| Nama | Isi |
|---|---|
| `SSH_HOST` | `101.50.1.87` |
| `SSH_PORT` | `45022` (Jagoan Hosting) |
| `SSH_USER` | `ewalkpen` |
| `SSH_PRIVATE_KEY` | isi `~/.ssh/bsb_deploy` (file **tanpa** `.pub`), seluruhnya |
| `SSH_KNOWN_HOSTS` | hasil `ssh-keyscan` di langkah 1 |

**Variables** (tab *Variables*):

| Nama | Isi |
|---|---|
| `DEPLOY_ENABLED` | `true` |
| `DEPLOY_BASE` | `~/bsb` |
| `DEPLOY_PHP` | `/opt/alt/php82/usr/bin/php` |
| `SITE_URL` | `https://maps.ewalkpentacitymall.com` |

Disarankan: **Settings → Branches → Add rule** untuk `main`: *Require a pull request* + *Require status checks* → pilih **test**. Jadi tidak ada kode yang tayang tanpa lolos tes.

### 5. Deploy pertama
Merge Pull Request ke `main` (atau **Actions → CI & deploy → Run workflow** di branch `main`). Tunggu job **test** dan **deploy** hijau (±3 menit). Log deploy menampilkan `db ok, live data D00xx…` dan `done`.

### 6. Arahkan domain ke rilis
Document root `maps.ewalkpentacitymall.com` sekarang `~/maps.ewalkpentacitymall.com` (berisi versi lama 12 Okt). Pindahkan folder lama ke luar web (tidak dihapus, untuk jaga-jaga), lalu jadikan link ke rilis:
```bash
mv ~/maps.ewalkpentacitymall.com ~/maps-lama-20261012
ln -s ~/bsb/current ~/maps.ewalkpentacitymall.com
curl -sI https://maps.ewalkpentacitymall.com/ | head -1      # HTTP/2 200
curl -s https://maps.ewalkpentacitymall.com/api/version     # JSON, bukan "Parse error"
```
Kalau ternyata error / 403: kembalikan dengan `rm ~/maps.ewalkpentacitymall.com && mv ~/maps-lama-20261012 ~/maps.ewalkpentacitymall.com`, lalu kabari.
Lalu cPanel → **SSL/TLS Status** → **Run AutoSSL** (HTTPS wajib untuk kompas iPhone).

### 7. Setelah online
```bash
cd ~/bsb/current
/opt/alt/php82/usr/bin/php tools/create_admin.php admin@bsb.local "Admin IT WBL" --password 'PasswordBaruYangKuat!'   # password produksi baru
/opt/alt/php82/usr/bin/php tools/setup.php check                                                                     # semua harus OK
```
Buka `https://maps.ewalkpentacitymall.com/cms/` → login → **Publish** sekali.

### 8. Cron (tugas terjadwal)
cPanel → **Cron Jobs** (ganti `php` dengan `DEPLOY_PHP` bila berbeda):
```
*/5 * * * *  cd ~/bsb/current && /opt/alt/php82/usr/bin/php tools/cron.php > /dev/null 2>&1
0 2 * * *    cd ~/bsb/current && /opt/alt/php82/usr/bin/php tools/cron.php --daily > /dev/null 2>&1
```
(status penutupan toko/eskalator terjadwal, ringkasan analitik, pembersihan data lama)

### 9. Cek
| Buka | Hasil |
|---|---|
| `https://maps.ewalkpentacitymall.com/` | kiosk; pilih toko → rute; QR berisi domain ini |
| `…/` dari HP | pindah ke tampilan HP, "Kamu di mana?" |
| `…/cms/` | login, Editor graph, Publish |
| `…/data/version.json` | versi data terbaru |
| `…/config.local.php`, `…/lib/` | **403** (terkunci) |

---

## B. Sehari-hari

**Update kode:** buat branch → Pull Request → tes hijau → merge. ±3 menit kemudian server memakai rilis baru; kiosk reload sendiri saat idle (`kiosk.minAppBuild` diset otomatis dari `APP_BUILD`).
Setiap rilis: naikkan `APP_BUILD` di `config.js` **dan** `?v=` di `index.html` + `m/index.html` bersamaan.

**Isi data (tenant, jalur, promo):** langsung di CMS server → Publish. Tidak lewat git, tidak tertimpa deploy.

**Rollback** (kembali ke rilis sebelumnya, data tidak berubah):
```bash
ssh -i ~/.ssh/bsb_deploy -p 45022 ewalkpen@101.50.1.87 "bash ~/bsb/current/tools/deploy/rollback.sh"
```
Lihat daftar rilis: `ls -1t ~/bsb/releases`. Ke rilis tertentu: `bash ~/bsb/current/tools/deploy/rollback.sh <nama-rilis>`.

**Migrasi database:** bila log deploy menulis `NOTE: new migration migrate_xxx.sql`, jalankan sekali:
```bash
cd ~/bsb/current && mysql -u USER_DB -p NAMA_DB < db/migrate_xxx.sql && echo migrate_xxx.sql >> ~/bsb/shared/.migrations-seen
```

**Peta baru / gambar 3D berubah** (menggeser koordinat di database):
1. Bekukan edit CMS sebentar.
2. Ambil database server ke laptop (phpMyAdmin → Export), `php tools/setup.php import --force --file dump.sql`.
3. Kerjakan peta di laptop (`tools/3d/…`, lihat `docs/3D.md`), tes.
4. Pull Request → merge (file peta ikut deploy otomatis).
5. Dump database laptop → import ke server → CMS server → Publish. Buka lagi edit CMS.

**Data server ke laptop** (untuk mengembangkan dengan data asli): Export DB dari phpMyAdmin, lalu
`rsync -az -e "ssh -p 45022 -i ~/.ssh/bsb_deploy" ewalkpen@101.50.1.87:bsb/shared/media/ media/` dan `…:bsb/shared/data/3d/edits/ data/3d/edits/`.

---

## C. Kalau ada masalah

| Gejala | Penyebab / solusi |
|---|---|
| Job **deploy** gagal di "Upload" | secret SSH salah, atau port. Cek `ssh -i ~/.ssh/bsb_deploy -p PORT USER@HOST` dari laptop |
| `missing …/shared/config.local.php` | langkah A3 belum dibuat |
| `db ok` tidak muncul / error DB | isi `config.local.php`; user DB harus punya hak ke database itu |
| Situs **500** setelah langkah A6 | hosting tidak mengizinkan symlink di document root → minta support aktifkan `SymLinksIfOwnerMatch`, atau pakai cara `ln -s` di A6 |
| Publish di CMS gagal "Gagal menulis" | `chmod 755 ~/bsb/shared/data ~/bsb/shared/media` (dan subfolder) |
| `/api/...` 404 | mod_rewrite mati → `API_BASE: 'api/index.php?r='` di `config.js` |
| Rilis baru jelek | rollback (bagian B), perbaiki, PR lagi |
