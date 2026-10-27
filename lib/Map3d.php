<?php
declare(strict_types=1);

/**
 * Lantai 3D (docs/3D.md). Registry data/3d/floors.json → per lantai: model (data/3d/<mall>-<lantai>.json, meter),
 * file edit atap, arah pandang awal. Lantai dengan "frame": "plan" menyimpan SEMUA koordinat CMS (graph, tenant,
 * fasilitas, kiosk) dalam satuan artboard gambar Illustrator-nya:  meter = (x − origin) × m_per_unit.
 * CMS mengeditnya di atas denah tampak atas yang dibuat dari model (planSvg).
 */
final class Map3d
{
    public const REGISTRY = 'data/3d/floors.json';
    private const MODEL_RX = '#^data/3d/[A-Za-z0-9_.-]+\.json$#';
    private const EDITS_RX = '#^data/3d/edits/[A-Za-z0-9_.-]+\.json$#';
    private const FAC_LABEL = ['toilet' => 'Toilet', 'lift' => 'Lift', 'escalator' => 'Eskalator', 'stairs' => 'Tangga', 'prayer' => 'Musholla',
        'atm' => 'ATM', 'info' => 'Info', 'parking' => 'Parkir', 'firstaid' => 'P3K', 'nursery' => 'Laktasi'];
    // sama dengan Scene3D.guessCategory (js/scene3d.js): kategori tebakan dari nama toko
    private const CAT_HINTS = [
        ['department-store', '/\b(mart|market|supermarket|minimarket|hypermart|department)\b|mart\b/i'],
        ['food-beverage', '/deli|caf[eé]|kopi|coffee|resto|restaurant|food|kitchen|bbq|sushi|ramen|bakso|mie\b|noodle|chicken|pizza|burger|bistro|bakery|\btea\b|boba|juice|gelato|ice cream|warung|dimsum|steak|grill/iu'],
        ['beauty-health', '/salon|beauty|skin|spa\b|barber|optik|optical|clinic|klinik|apotek|pharma|massage|nail|kosmetik/i'],
        ['entertainment', '/karaoke|cinema|bioskop|game|arcade|fun|club|bowling|billiard|timezone/i'],
        ['kids-family', '/\bkid|toy|baby|bayi|anak|play/i'],
        ['electronics', '/phone|ponsel|gadget|electr|digital|computer|komputer|camera|samsung|xiaomi|oppo|vivo/i'],
        ['services', '/fit\b|gym|bank|atm|travel|laundry|service|money|exchange/i'],
        ['fashion', '/fashion|shoe|sepatu|sneaker|bag|tas\b|\bbra\b|wear|cloth|boutique|batik|jeans|denim|hijab|shop/i'],
    ];

    public static function registry(): array
    {
        $f = APP_ROOT . '/' . self::REGISTRY;
        $r = is_file($f) ? Util::jsonDecode((string)file_get_contents($f), null) : null;
        return is_array($r) && is_array($r['floors'] ?? null) ? $r : ['version' => 1, 'floors' => []];
    }

    public static function saveRegistry(array $reg): void
    {
        Util::atomicWrite(APP_ROOT . '/' . self::REGISTRY, Util::jsonEncode($reg, true) . "\n");
    }

    public static function entry(string $floorId): ?array
    {
        $e = self::registry()['floors'][$floorId] ?? null;
        return is_array($e) ? $e : null;
    }

    public static function model(array $entry): ?array
    {
        $p = (string)($entry['model'] ?? '');
        if (!preg_match(self::MODEL_RX, $p) || !is_file(APP_ROOT . '/' . $p)) return null;
        $m = Util::jsonDecode((string)file_get_contents(APP_ROOT . '/' . $p), null);
        return is_array($m) && isset($m['units'], $m['m_per_unit'], $m['origin']) ? $m : null;
    }

    public static function modelSha(array $entry): ?string
    {
        $p = (string)($entry['model'] ?? '');
        return preg_match(self::MODEL_RX, $p) && is_file(APP_ROOT . '/' . $p) ? hash_file('sha256', APP_ROOT . '/' . $p) : null;
    }

    /** Path relatif file edit atap, atau null bila registry tidak menyebut file yang sah. */
    public static function editsFile(array $entry): ?string
    {
        $p = (string)($entry['edits'] ?? '');
        return preg_match(self::EDITS_RX, $p) ? $p : null;
    }

    public static function isPlan(array $entry): bool { return ($entry['frame'] ?? '') === 'plan'; }

    /** Satuan lantai → meter model: [[a, b, c], [d, e, f]]. */
    public static function toMetres(array $entry, array $model): ?array
    {
        if (self::isPlan($entry)) {
            $s = (float)$model['m_per_unit']; $ox = (float)$model['origin'][0]; $oy = (float)$model['origin'][1];
            return [[$s, 0.0, -$ox * $s], [0.0, $s, -$oy * $s]];
        }
        return isset($entry['toMetres']) && is_array($entry['toMetres']) ? $entry['toMetres'] : null;
    }

    /** Meter model → satuan artboard (denah). */
    public static function planPoint(array $model, float $mx, float $my): array
    {
        $s = (float)$model['m_per_unit'];
        return [$mx / $s + (float)$model['origin'][0], $my / $s + (float)$model['origin'][1]];
    }

    /** Nama yang diketik huruf besar / huruf kecil semua di Illustrator → "Judul" (singkatan ≤ 3 huruf besar tetap), sama dengan Scene3D.titleCase. */
    public static function displayName(string $name): string
    {
        $name = trim($name);
        if ($name === '' || ($name !== mb_strtoupper($name) && $name !== mb_strtolower($name))) return $name;
        return implode(' ', array_map(fn($w) => mb_strlen($w) <= 3 && preg_match('/^[A-Z&.]+$/', $w) ? $w : mb_strtoupper(mb_substr($w, 0, 1)) . mb_strtolower(mb_substr($w, 1)),
            preg_split('/\s+/', $name)));
    }

    public static function guessCategory(string $name): string
    {
        foreach (self::CAT_HINTS as [$cat, $rx]) if (preg_match($rx, $name)) return $cat;
        return 'fashion';
    }

    // ------------------------------------------------------------------ denah tampak atas
    private static function n(float $v): string { $s = number_format($v, 2, '.', ''); return rtrim(rtrim($s, '0'), '.') ?: '0'; }

    private static function pathD(array $model, array $poly): string
    {
        $pts = array_map(fn($p) => self::planPoint($model, (float)$p[0], (float)$p[1]), $poly);
        return 'M' . implode('L', array_map(fn($p) => self::n($p[0]) . ',' . self::n($p[1]), $pts)) . 'Z';
    }

    private static function esc(string $s): string { return htmlspecialchars($s, ENT_XML1 | ENT_QUOTES, 'UTF-8'); }

    /**
     * Denah tampak atas dari model 3D, dalam satuan artboard Illustrator: lantai (khaki), unit toko (putih, id = id unit 3D,
     * bisa dipilih di CMS "Pilih unit"), fasilitas, dan nama dari gambar. Warna lewat atribut presentasi, bukan CSS,
     * supaya sorotan CMS/kiosk tetap menang.
     */
    public static function planSvg(array $model): string
    {
        $vb = $model['artboard'] ?? null;
        if (!is_array($vb) || count($vb) !== 4) throw new ApiError('validation', 'Model 3D belum punya "artboard" — konversi ulang lantainya dengan konverter terbaru');
        $s = (float)$model['m_per_unit'];
        $o = [];
        $o[] = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="' . implode(' ', array_map(fn($v) => self::n((float)$v), $vb)) . '"'
            . ' data-plan3d="' . self::esc((string)($model['mall'] ?? '') . '-' . (string)($model['floor'] ?? '')) . '">';
        // surroundings of a floor both malls share (tools/3d/kawasan.py): land, roads, ruko — under the malls, not clickable
        if (!empty($model['context'])) {
            $ctx = ['ground' => ['#ecebe5', 'none', '0'], 'road' => ['#d3d5d9', 'none', '0'], 'parking' => ['#d6e8cb', 'none', '0'],
                'divider' => ['#bcdcab', 'none', '0'], 'podium' => ['#f2efe8', '#d8d3c6', '.6'], 'building' => ['#fbfaf7', '#c9c3b5', '.6']];
            $o[] = '<g id="plan3d-context" pointer-events="none">';
            foreach ($model['context'] as $c) {
                if (empty($c['poly']) || count($c['poly']) < 3 || !isset($ctx[$c['kind'] ?? ''])) continue;
                [$fill, $stroke, $sw] = $ctx[$c['kind']];
                $o[] = '<path d="' . self::pathD($model, $c['poly']) . '" fill="' . $fill . '" stroke="' . $stroke . '" stroke-width="' . $sw . '" stroke-linejoin="round"/>';
            }
            $o[] = '</g>';
        }
        $o[] = '<g id="plan3d-slab" pointer-events="none">';
        foreach ($model['slab'] ?? [] as $sp) {
            if (empty($sp['outer'])) continue;
            $d = self::pathD($model, $sp['outer']);
            foreach ($sp['holes'] ?? [] as $hole) if (count($hole) >= 3) $d .= self::pathD($model, $hole);
            $o[] = '<path d="' . $d . '" fill="#f3eed8" fill-rule="evenodd" stroke="#cdc4a3" stroke-width="1.2" stroke-linejoin="round"/>';
        }
        $o[] = '</g>';
        $style = ['anchor' => ['#ffffff', '#a7a298', '1'], 'tenant' => ['#ffffff', '#a7a298', '1'], 'unit' => ['#f4f3ee', '#b3aea3', '.9'],
            'kiosk' => ['#fcfbf8', '#bcb7ac', '.8'], 'vacant' => ['#efede6', '#b3aea3', '.9']];
        $o[] = '<g id="plan3d-units">';
        foreach ($model['units'] as $u) {
            if (empty($u['poly']) || count($u['poly']) < 3 || !preg_match('/^[A-Za-z0-9_.:-]{1,120}$/', (string)$u['id'])) continue;
            [$fill, $stroke, $sw] = $style[$u['kind'] ?? 'tenant'] ?? $style['tenant'];
            $title = trim(((string)($u['name'] ?? '')) . ' · ' . $u['id'], ' ·');
            $o[] = '<path id="' . self::esc((string)$u['id']) . '" data-kind="' . self::esc((string)($u['kind'] ?? '')) . '" d="' . self::pathD($model, $u['poly'])
                . '" fill="' . $fill . '" stroke="' . $stroke . '" stroke-width="' . $sw . '" stroke-linejoin="round"><title>' . self::esc($title) . '</title></path>';
        }
        $o[] = '</g>';
        $o[] = '<g id="plan3d-facilities" pointer-events="none">';
        foreach ($model['facilities'] ?? [] as $f) {
            if (!empty($f['poly']) && count($f['poly']) >= 3)
                $o[] = '<path d="' . self::pathD($model, $f['poly']) . '" fill="#e6edfb" stroke="#97aee4" stroke-width=".8" stroke-linejoin="round"/>';
            [$x, $y] = self::planPoint($model, (float)$f['x'], (float)$f['y']);
            $fs = max(3.5, min(9.0, (float)($f['size'] ?? 3) / $s * 0.32));
            $o[] = '<text x="' . self::n($x) . '" y="' . self::n($y) . '" font-family="system-ui,sans-serif" font-size="' . self::n($fs) . '" font-weight="700"'
                . ' fill="#3f5fae" text-anchor="middle" dominant-baseline="central">' . self::esc(self::FAC_LABEL[$f['type'] ?? ''] ?? (string)($f['name'] ?? '')) . '</text>';
        }
        $o[] = '</g>';
        $o[] = '<g id="plan3d-names" pointer-events="none">';
        foreach ($model['units'] as $u) {
            $name = trim((string)($u['name'] ?? ''));
            $L = $u['label'] ?? null;
            if ($name === '' || !is_array($L)) continue;
            $name = self::displayName($name);
            [$x, $y] = self::planPoint($model, (float)$L['x'], (float)$L['y']);
            $w = (float)$L['w'] / $s; $h = (float)$L['h'] / $s;
            $a = fmod((float)($L['angle'] ?? 0), 180.0); if ($a > 90) $a -= 180; if ($a <= -90) $a += 180;
            $fs = max(2.5, min(16.0, $h * 0.5, $w / (0.6 * max(1, mb_strlen($name)))));
            $o[] = '<text x="' . self::n($x) . '" y="' . self::n($y) . '"' . (abs($a) > 0.5 ? ' transform="rotate(' . self::n($a) . ' ' . self::n($x) . ' ' . self::n($y) . ')"' : '')
                . ' font-family="system-ui,sans-serif" font-size="' . self::n($fs) . '" font-weight="600" fill="#5a564e" text-anchor="middle" dominant-baseline="central">'
                . self::esc($name) . '</text>';
        }
        $o[] = '</g>';
        $o[] = '</svg>';
        return implode("\n", $o) . "\n";
    }

    /** Poligon unit (satuan denah) dari denah tampak atas yang sedang terpasang di lantai itu (path buatan planSvg). */
    private static function installedPlanUnits(string $floorId): array
    {
        $path = (string)Db::val('SELECT m.path FROM floors f JOIN media m ON m.id=f.svg_media_id WHERE f.id=?', [$floorId]);
        $abs = APP_ROOT . '/' . $path;
        if ($path === '' || !is_file($abs)) return [];
        $svg = (string)file_get_contents($abs);
        if (!str_contains($svg, 'data-plan3d')) return [];
        preg_match_all('/<path id="([^"]+)" data-kind="[^"]*" d="M([^"]+)Z"/', $svg, $mm, PREG_SET_ORDER);
        $out = [];
        foreach ($mm as $m) {
            $pts = array_map(fn($q) => array_map('floatval', explode(',', $q)), explode('L', $m[2]));
            if (count($pts) >= 3) $out[html_entity_decode($m[1], ENT_QUOTES | ENT_XML1)] = $pts;
        }
        return $out;
    }

    private static function inPoly(float $x, float $y, array $poly): bool
    {
        $in = false; $n = count($poly);
        for ($i = 0, $j = $n - 1; $i < $n; $j = $i++) {
            [$xi, $yi] = $poly[$i]; [$xj, $yj] = $poly[$j];
            if ((($yi > $y) !== ($yj > $y)) && ($x < ($xj - $xi) * ($y - $yi) / (($yj - $yi) ?: 1e-9) + $xi)) $in = !$in;
        }
        return $in;
    }

    /** Tumpang-tindih dua poligon (irisan / gabungan, 0..1), diperkirakan dengan sampel grid 24 × 24. */
    private static function overlap(array $a, array $b): float
    {
        $ax = array_column($a, 0); $ay = array_column($a, 1); $bx = array_column($b, 0); $by = array_column($b, 1);
        if (max($ax) < min($bx) || max($bx) < min($ax) || max($ay) < min($by) || max($by) < min($ay)) return 0.0;
        $x0 = min(min($ax), min($bx)); $x1 = max(max($ax), max($bx)); $y0 = min(min($ay), min($by)); $y1 = max(max($ay), max($by));
        $in = 0; $un = 0; $n = 24;
        for ($i = 0; $i < $n; $i++) for ($j = 0; $j < $n; $j++) {
            $x = $x0 + ($i + 0.5) / $n * ($x1 - $x0); $y = $y0 + ($j + 0.5) / $n * ($y1 - $y0);
            $pa = self::inPoly($x, $y, $a); $pb = self::inPoly($x, $y, $b);
            if ($pa || $pb) $un++;
            if ($pa && $pb) $in++;
        }
        return $un ? $in / $un : 0.0;
    }

    /**
     * Gambar dikonversi ulang: id unit ikut nama/urutan di Illustrator, jadi unit yang diganti nama ("luca" → "luuca") atau
     * bergeser urutan mendapat id baru. Cocokkan unit denah lama ke model baru menurut bentuknya (tumpang-tindih ≥ 0,5) lalu
     * pindahkan tautan tenant CMS dan edit atap ke id barunya. Return [idLama => idBaru].
     */
    private static function remapUnits(string $floorId, array $entry, array $model): array
    {
        $old = self::installedPlanUnits($floorId);
        if (!$old) return [];
        $new = [];
        foreach ($model['units'] as $u) if (!empty($u['poly']) && count($u['poly']) >= 3) $new[$u['id']] = array_map(fn($q) => self::planPoint($model, (float)$q[0], (float)$q[1]), $u['poly']);
        $kept = [];
        foreach ($old as $oid => $op) if (isset($new[$oid]) && self::overlap($op, $new[$oid]) >= 0.5) $kept[$oid] = true;
        $remap = [];
        foreach ($old as $oid => $op) {
            if (isset($kept[$oid])) continue;
            $best = null; $bv = 0.5;
            foreach ($new as $nid => $np) {
                if (isset($kept[$nid]) || in_array($nid, $remap, true)) continue;
                $v = self::overlap($op, $np);
                if ($v > $bv) { $bv = $v; $best = $nid; }
            }
            if ($best !== null && $best !== $oid) $remap[$oid] = $best;
        }
        if (!$remap) return [];
        foreach ($remap as $oid => $nid)
            foreach (Db::all('SELECT id FROM tenants WHERE floor_id=? AND unit_shape_id=?', [$floorId, $oid]) as $t) {
                Db::update('tenants', ['unit_shape_id' => $nid], ['id' => $t['id']]);
                Audit::log('update', 'tenant', $t['id'], "unit 3D $oid → $nid (gambar dikonversi ulang)", ['unit_shape_id' => $oid], ['unit_shape_id' => $nid]);
            }
        $ef = self::editsFile($entry);
        if ($ef && is_file(APP_ROOT . '/' . $ef)) {
            $ed = Util::jsonDecode((string)file_get_contents(APP_ROOT . '/' . $ef), []);
            $units = is_array($ed['units'] ?? null) ? $ed['units'] : [];
            $moved = false;
            foreach ($remap as $oid => $nid) if (isset($units[$oid]) && !isset($units[$nid])) { $units[$nid] = $units[$oid]; unset($units[$oid]); $moved = true; }
            if ($moved) { $ed['units'] = (object)$units; Util::atomicWrite(APP_ROOT . '/' . $ef, Util::jsonEncode($ed, true)); }
        }
        Revisions::bump('content');
        return $remap;
    }

    /**
     * Simpan denah sebagai media SVG (lewat sanitizer yang sama dengan unggahan CMS) dan pasang di lantai.
     * Tanpa $vb: viewBox lantai harus sudah sama dengan artboard (penyegaran biasa, koordinat tidak berubah).
     * @return array{mediaId:int, path:string, changed:bool, remap:object}
     */
    public static function installPlan(string $floorId, array $entry, array $model, ?float $unitScale = null, bool $setViewBox = false): array
    {
        $svg = self::planSvg($model);
        [$clean, $rep] = SvgSanitizer::sanitize($svg);
        $vb = array_map('floatval', $model['artboard']);
        $f = Db::one('SELECT * FROM floors WHERE id=?', [$floorId]);
        if (!$f) throw ApiError::notFound('Lantai');
        $cur = [(float)$f['vb_x'], (float)$f['vb_y'], (float)$f['vb_w'], (float)$f['vb_h']];
        if (!$setViewBox && array_map(fn($v) => round($v, 2), $cur) !== array_map(fn($v) => round($v, 2), $vb))
            throw new ApiError('validation', 'Artboard gambar (' . implode(' ', $vb) . ') beda dengan viewBox lantai (' . implode(' ', $cur) . ') — koordinat CMS harus dipindah dulu (tools/3d/rebase_floor.php)');
        $remap = $setViewBox ? [] : self::remapUnits($floorId, $entry, $model); // before the new plan replaces the old one
        $sha = hash('sha256', $clean);
        $rel = 'media/floors/' . substr($sha, 0, 16) . '.svg';
        if (!is_file(APP_ROOT . '/' . $rel)) Util::atomicWrite(APP_ROOT . '/' . $rel, $clean);
        $mid = (int)Db::val("SELECT id FROM media WHERE sha256=? AND kind='svg'", [$sha]);
        if (!$mid) {
            unset($rep['ids']);
            $mid = Db::insert('media', ['kind' => 'svg', 'path' => $rel, 'mime' => 'image/svg+xml', 'bytes' => strlen($clean), 'sha256' => $sha,
                'original_name' => 'plan3d-' . $floorId . '.svg', 'meta' => Util::jsonEncode(['encoder' => 'plan3d', 'model' => $entry['model'] ?? null,
                    'modelSha' => self::modelSha($entry), 'sanitize' => $rep, 'warnings' => []]), 'created_by' => Auth::id()]);
        }
        $row = ['svg_media_id' => $mid, 'updated_by' => Auth::id()];
        if ($setViewBox) $row += ['vb_x' => $vb[0], 'vb_y' => $vb[1], 'vb_w' => $vb[2], 'vb_h' => $vb[3]];
        if ($unitScale !== null) $row['unit_scale'] = round($unitScale, 4);
        $changed = (int)$f['svg_media_id'] !== $mid || $setViewBox || $unitScale !== null;
        if ($changed) {
            Db::update('floors', $row, ['id' => $floorId]);
            Revisions::bump('map');
            Audit::log('svg_replace', 'floor', $floorId, 'Denah lantai dibuat dari model 3D → ' . $rel,
                ['svg_media_id' => $f['svg_media_id'], 'viewBox' => $cur, 'unit_scale' => $f['unit_scale']],
                ['svg_media_id' => $mid, 'viewBox' => $setViewBox ? $vb : $cur, 'unit_scale' => $unitScale ?? $f['unit_scale']]);
        }
        return ['mediaId' => $mid, 'path' => $rel, 'changed' => $changed, 'remap' => (object)$remap];
    }

    /** Apakah denah lantai ini sama dengan denah yang dibuat dari model sekarang. */
    public static function planIsCurrent(string $floorId, array $entry): bool
    {
        $m = self::model($entry);
        if (!$m || empty($m['artboard'])) return false;
        [$clean] = SvgSanitizer::sanitize(self::planSvg($m));
        return hash('sha256', $clean) === (string)Db::val('SELECT m.sha256 FROM floors f JOIN media m ON m.id=f.svg_media_id WHERE f.id=?', [$floorId]);
    }

    // ------------------------------------------------------------------ unit bernama → tenant CMS
    /** Nama di gambar tanpa kata gedung/lantai yang ditambahkan penggambar ("xxi-ewalk-ff" → "xxi"), seperti register_floor.py. */
    public static function unqualified(string $s): string
    {
        $words = preg_split('/[\s_-]+/', trim($s), -1, PREG_SPLIT_NO_EMPTY) ?: [];
        $kept = array_filter($words, fn($w) => !in_array(mb_strtolower($w), ['ewalk', 'penta', 'pentacity', 'lg', 'gf', 'ug', 'ff', 'sf', '1f', '2f'], true));
        return implode(' ', $kept ?: $words);
    }

    /** Kunci nama seperti register_floor.py: huruf besar/kecil, tanda baca dan angka-kata (one/satu = 1) diabaikan. */
    public static function nameKey(string $s): string
    {
        $num = ['one' => '1', 'two' => '2', 'three' => '3', 'four' => '4', 'five' => '5', 'satu' => '1', 'dua' => '2', 'tiga' => '3', 'empat' => '4', 'lima' => '5'];
        $s = preg_replace_callback('/[a-z]+/', fn($m) => $num[$m[0]] ?? $m[0], mb_strtolower(str_replace('&', 'and', $s)));
        return (string)preg_replace('/[^a-z0-9]/', '', (string)$s);
    }

    /** Kemiripan nama 0..1 (beda ejaan kecil di gambar: "ichiban shusi" / "Ichiban Sushi" ≈ 0.92; "xxi-ewalk-ff" / "Cinema XXI" 0.9). */
    public static function nameSimilarity(string $a, string $b): float
    {
        $a = self::nameKey(self::unqualified($a)); $b = self::nameKey(self::unqualified($b));
        if ($a === $b) return strlen($a) >= 2 ? 1.0 : 0.0; // "X8"
        if (strlen($a) < 3 || strlen($b) < 3) return 0.0;
        if (str_contains($a, $b) || str_contains($b, $a)) return 0.9;
        similar_text($a, $b, $pct);
        return $pct / 100;
    }

    /**
     * Unit bernama di model yang belum ditautkan ke tenant CMS di lantai itu, dengan saran:
     *  - sameAs:  tenant yang sudah tertaut ke unit lain dengan nama sama → bangunan kedua tenant itu (kiosk menampilkannya sama)
     *  - suggest: tenant CMS yang belum punya unit gambar dengan nama mirip (≥ 0.8) → tautkan, jangan buat duplikat
     * Di lantai gabungan (gf, ug) unit punya "building": hanya tenant gedung yang sama yang cocok (Starbucks e-Walk ≠ Starbucks Pentacity).
     */
    public static function unlinkedUnits(string $floorId, array $model): array
    {
        $ids = []; foreach ($model['units'] as $u) $ids[$u['id']] = $u['building'] ?? null;
        $tenants = Db::all('SELECT t.id, COALESCE(t.name_override, b.name) name, t.unit_shape_id, t.building FROM tenants t JOIN brands b ON b.id=t.brand_id WHERE t.floor_id=?', [$floorId]);
        $taken = []; foreach ($tenants as $t) if ($t['unit_shape_id'] && array_key_exists($t['unit_shape_id'], $ids)) $taken[$t['unit_shape_id']] = true;
        $out = [];
        foreach ($model['units'] as $u) {
            $name = trim((string)($u['name'] ?? ''));
            if ($name === '' || isset($taken[$u['id']])) continue;
            $row = ['id' => $u['id'], 'name' => self::displayName($name), 'kind' => $u['kind'] ?? null, 'sameAs' => null, 'suggest' => null];
            $best = 0.0;
            foreach ($tenants as $t) {
                $linked = $t['unit_shape_id'] && array_key_exists($t['unit_shape_id'], $ids);
                if (!empty($u['building']) && ($linked ? $ids[$t['unit_shape_id']] : $t['building']) !== $u['building']) continue;
                if ($linked && self::nameKey($t['name']) === self::nameKey($name)) { $row['sameAs'] = ['id' => $t['id'], 'name' => $t['name']]; break; }
                $sim = self::nameSimilarity($name, (string)$t['name']);
                if (!$linked && $sim >= 0.8 && $sim > $best) { $best = $sim; $row['suggest'] = ['id' => $t['id'], 'name' => $t['name']]; }
            }
            if ($row['sameAs']) $row['suggest'] = null;
            $out[] = $row;
        }
        return $out;
    }

    /** Tautkan unit gambar ke tenant CMS yang sudah ada ({unitId: tenantId}), lalu pindahkan pin ke muka tokonya & sambungkan ke jalur. */
    public static function linkUnits(string $floorId, array $links): array
    {
        $entry = self::entry($floorId);
        $model = $entry ? self::model($entry) : null;
        if (!$entry || !$model || !self::isPlan($entry)) throw new ApiError('validation', 'Lantai ' . $floorId . ' belum memakai denah 3D');
        $ids = []; foreach ($model['units'] as $u) $ids[$u['id']] = true;
        $done = [];
        Db::tx(function () use ($floorId, $links, $ids, &$done) {
            foreach ($links as $uid => $tid) {
                if (!is_string($uid) || !isset($ids[$uid])) throw ApiError::validation(['links' => 'unit:' . $uid]);
                $t = Db::one('SELECT id, unit_shape_id FROM tenants WHERE id=? AND floor_id=?', [(string)$tid, $floorId]);
                if (!$t) throw ApiError::validation(['links' => 'tenant:' . $tid]);
                Db::update('tenants', ['unit_shape_id' => $uid, 'updated_by' => Auth::id()], ['id' => $t['id']]);
                Audit::log('update', 'tenant', $t['id'], 'ditautkan ke unit 3D ' . $uid, ['unit_shape_id' => $t['unit_shape_id']], ['unit_shape_id' => $uid]);
                $done[] = $t['id'];
            }
            if ($done) Revisions::bump('content');
        });
        return $done ? self::reconnect($floorId, $done, []) : [];
    }

    /** Jenis ikon fasilitas di gambar (layer "Fasilitas") → tipe fasilitas CMS. Lift/eskalator/tangga = konektor (halaman Eskalator & lift). */
    public const FAC_TO_AMENITY = ['toilet' => 'toilet', 'prayer' => 'musholla', 'atm' => 'atm', 'info' => 'info-desk', 'parking' => 'parking-entrance',
        'firstaid' => 'first-aid', 'nursery' => 'nursery'];
    public const FAC_CONNECTOR = ['lift' => 'lift', 'escalator' => 'escalator', 'stairs' => 'stairs'];

    /**
     * Fasilitas di gambar yang belum punya pasangan di CMS: fasilitas CMS bertipe sama (atau stop konektor untuk lift/eskalator)
     * dalam 25 m (sama dengan pencocokan ikon di kiosk). Hanya tipe POI yang bisa dibuat otomatis.
     */
    public static function unlinkedFacilities(string $floorId, array $model): array
    {
        $s = (float)$model['m_per_unit'];
        $cms = array_map(fn($a) => ['type' => $a['type_id'], 'x' => (float)$a['x'], 'y' => (float)$a['y']], Db::all('SELECT type_id, x, y FROM amenities WHERE floor_id=?', [$floorId]));
        foreach (Db::all('SELECT b.type, n.x, n.y FROM connector_stops st JOIN connector_banks b ON b.id=st.bank_id JOIN graph_nodes n ON n.id=st.node_id WHERE st.floor_id=?', [$floorId]) as $c)
            $cms[] = ['type' => $c['type'] === 'travelator' ? 'escalator' : $c['type'], 'x' => (float)$c['x'], 'y' => (float)$c['y']];
        $out = [];
        foreach ($model['facilities'] ?? [] as $f) {
            $want = self::FAC_TO_AMENITY[$f['type'] ?? ''] ?? self::FAC_CONNECTOR[$f['type'] ?? ''] ?? null;
            if (!$want) continue;
            [$x, $y] = self::planPoint($model, (float)$f['x'], (float)$f['y']);
            $near = false;
            foreach ($cms as $c) if (($c['type'] === $want || ($want === 'toilet' && $c['type'] === 'toilet-accessible')) && hypot($c['x'] - $x, $c['y'] - $y) * $s <= 25) { $near = true; break; }
            if (!$near) $out[] = ['id' => $f['id'], 'type' => $f['type'], 'name' => (string)($f['name'] ?? ''), 'amenityType' => $want,
                'connector' => isset(self::FAC_CONNECTOR[$f['type']])];
        }
        return $out;
    }

    /** Fasilitas CMS untuk fasilitas gambar (tipe POI): titik di tepi ruangnya yang menghadap koridor, disambung ke jalur. */
    public static function importFacilities(string $floorId, array $facIds): array
    {
        $entry = self::entry($floorId);
        $model = $entry ? self::model($entry) : null;
        if (!$entry || !$model || !self::isPlan($entry)) throw new ApiError('validation', 'Lantai ' . $floorId . ' belum memakai denah 3D');
        $floor = Db::one('SELECT * FROM floors WHERE id=?', [$floorId]);
        $want = array_flip(array_map('strval', $facIds));
        $todo = array_values(array_filter(self::unlinkedFacilities($floorId, $model), fn($f) => isset($want[$f['id']]) && !$f['connector']));
        $byId = []; foreach ($model['facilities'] as $f) $byId[$f['id']] = $f;
        $types = []; foreach (Db::all('SELECT id, name_id, name_en FROM amenity_types') as $ty) $types[$ty['id']] = $ty;
        $G = null;
        return Db::tx(function () use ($todo, $byId, $types, $floor, $floorId, $model, &$G) {
            $edges = array_map(fn($r) => [(float)$r['ax'], (float)$r['ay'], (float)$r['bx'], (float)$r['by_']], Db::all(
                'SELECT a.x ax, a.y ay, b.x bx, b.y by_ FROM graph_edges e JOIN graph_nodes a ON a.id=e.node_a JOIN graph_nodes b ON b.id=e.node_b WHERE a.floor_id=? AND e.is_enabled=1', [$floorId]));
            $out = [];
            foreach ($todo as $f) {
                if (!isset($types[$f['amenityType']])) continue;
                $src = $byId[$f['id']];
                if ($G === null) $G = self::walkGrid($model);
                [$x, $y] = !empty($src['poly']) && count($src['poly']) >= 3 ? self::doorPoint($model, $src, $edges, $G) : self::planPoint($model, (float)$src['x'], (float)$src['y']);
                $base = $f['amenityType'] . '-' . $floorId . '-'; $i = 1;
                while (Db::val('SELECT id FROM amenities WHERE id=?', [$base . $i])) $i++;
                $id = $base . $i;
                $nm = mb_strtolower((string)($src['name'] ?? ''));
                $gender = preg_match('/\b(laki|pria|male|men)\b/u', $nm) ? 'male' : (preg_match('/\b(perempuan|wanita|female|women|ladies)\b/u', $nm) ? 'female' : 'all');
                $ty = $types[$f['amenityType']];
                $row = ['id' => $id, 'type_id' => $f['amenityType'], 'floor_id' => $floorId, 'building' => $floor['building'] === 'both' ? ($src['building'] ?? 'ewalk') : $floor['building'],
                    'x' => round($x, 2), 'y' => round($y, 2), 'gender' => $gender, 'is_published' => 1, 'updated_by' => Auth::id()]
                    + ($gender === 'all' ? [] : ['name_id' => $ty['name_id'] . ($gender === 'male' ? ' Pria' : ' Wanita'), 'name_en' => $ty['name_en'] . ($gender === 'male' ? ' (Men)' : ' (Women)')]);
                Db::insert('amenities', $row);
                $node = null; $via = false;
                if ($edges) { $node = Db::insert('graph_nodes', ['floor_id' => $floorId, 'x' => round($x, 2), 'y' => round($y, 2), 'label' => 'spur:' . $id]);
                    $via = self::connectDoor($floorId, $model, $G, $node, $x, $y, 'spur:' . $id); }
                if ($node) Db::update('amenities', ['node_id' => $node], ['id' => $id]);
                Audit::log('create', 'amenity', $id, 'fasilitas dibuat dari gambar 3D (' . $f['id'] . ')', null, $row + ['node_id' => $node]);
                $out[] = ['facility' => $f['id'], 'amenity' => $id, 'type' => $f['amenityType'], 'viaFloor' => $via];
            }
            if ($out) Revisions::bump('map');
            return $out;
        });
    }

    // ------------------------------------------------------------------ sambung otomatis lewat lantai yang bisa dilalui
    private const CELL_M = 0.4;      // resolusi grid lantai (m)
    private const MAX_WALK_M = 90.0; // spur otomatis terpanjang

    /** Isi poligon (satuan denah) ke grid byte dengan aturan even-odd: $v = "\1" bisa dilalui, "\0" terhalang. */
    private static function fillPoly(string &$g, array $G, array $poly, string $v): void
    {
        $n = count($poly);
        if ($n < 3) return;
        $ys = array_column($poly, 1);
        $r0 = max(0, (int)floor((min($ys) - $G['y0']) / $G['c'])); $r1 = min($G['H'] - 1, (int)ceil((max($ys) - $G['y0']) / $G['c']));
        for ($r = $r0; $r <= $r1; $r++) {
            $y = $G['y0'] + ($r + 0.5) * $G['c']; $xs = [];
            for ($i = 0, $j = $n - 1; $i < $n; $j = $i++) {
                [$xi, $yi] = $poly[$i]; [$xj, $yj] = $poly[$j];
                if (($yi > $y) !== ($yj > $y)) $xs[] = $xi + ($y - $yi) * ($xj - $xi) / ($yj - $yi);
            }
            sort($xs);
            for ($k = 0; $k + 1 < count($xs); $k += 2) {
                $c0 = max(0, (int)ceil(($xs[$k] - $G['x0']) / $G['c'] - 0.5)); $c1 = min($G['W'] - 1, (int)floor(($xs[$k + 1] - $G['x0']) / $G['c'] - 0.5));
                if ($c1 >= $c0) $g = substr_replace($g, str_repeat($v, $c1 - $c0 + 1), $r * $G['W'] + $c0, $c1 - $c0 + 1);
            }
        }
    }

    /** Lantai yang bisa dilalui: di dalam outline lantai, di luar void, bangunan toko dan fasilitas (+ satu sel jarak dari dinding). */
    private static function walkGrid(array $model): array
    {
        $P = fn(array $poly) => array_map(fn($q) => self::planPoint($model, (float)$q[0], (float)$q[1]), $poly);
        $pts = [];
        foreach ($model['slab'] ?? [] as $sp) foreach ($P($sp['outer']) as $q) $pts[] = $q;
        if (!$pts) return [];
        $c = self::CELL_M / (float)$model['m_per_unit'];
        $G = ['x0' => min(array_column($pts, 0)) - $c, 'y0' => min(array_column($pts, 1)) - $c, 'c' => $c];
        $G['W'] = (int)ceil((max(array_column($pts, 0)) - $G['x0']) / $c) + 2; $G['H'] = (int)ceil((max(array_column($pts, 1)) - $G['y0']) / $c) + 2;
        $g = str_repeat("\0", $G['W'] * $G['H']);
        foreach ($model['slab'] ?? [] as $sp) { self::fillPoly($g, $G, $P($sp['outer']), "\1"); foreach ($sp['holes'] ?? [] as $h) self::fillPoly($g, $G, $P($h), "\0"); }
        $blocked = str_repeat("\0", $G['W'] * $G['H']);
        foreach ($model['units'] as $u) if (!empty($u['poly'])) self::fillPoly($blocked, $G, $P($u['poly']), "\1");
        foreach ($model['facilities'] ?? [] as $f) if (!empty($f['poly'])) self::fillPoly($blocked, $G, $P($f['poly']), "\1");
        $W = $G['W'];
        // the podium rim the converter adds around the mall outline ("rim", 1.2 m) is not a walkway
        $inner = str_repeat("\0", $G['W'] * $G['H']);
        foreach ($model['slab'] ?? [] as $sp) self::fillPoly($inner, $G, $P($sp['outer']), "\1");
        for ($k = (int)ceil(((float)($model['rim'] ?? 1.2) + self::CELL_M) / self::CELL_M); $k > 0; $k--) {
            $next = $inner;
            for ($i = 0, $N = strlen($inner); $i < $N; $i++) {
                if ($inner[$i] !== "\1") continue;
                $x = $i % $W;
                if ($x === 0 || $x === $W - 1 || $i < $W || $i >= $N - $W || $inner[$i - 1] !== "\1" || $inner[$i + 1] !== "\1" || $inner[$i - $W] !== "\1" || $inner[$i + $W] !== "\1") $next[$i] = "\0";
            }
            $inner = $next;
        }
        for ($i = 0, $N = strlen($g); $i < $N; $i++) if ($inner[$i] !== "\1") $g[$i] = "\0";
        for ($i = 0, $N = strlen($g); $i < $N; $i++) {
            if ($blocked[$i] === "\1") { $g[$i] = "\0"; continue; }
            if ($g[$i] === "\0") continue;
            $x = $i % $W; // one cell of clearance from walls
            foreach ([-1, 1, -$W, $W] as $d) { $j = $i + $d; if ($j >= 0 && $j < $N && $blocked[$j] === "\1" && !($d === -1 && $x === 0) && !($d === 1 && $x === $W - 1)) { $g[$i] = "\2"; break; } }
        }
        $G['g'] = strtr($g, "\2", "\0");
        return $G;
    }

    private static function cellOf(array $G, float $x, float $y): array { return [(int)floor(($x - $G['x0']) / $G['c']), (int)floor(($y - $G['y0']) / $G['c'])]; }
    private static function free(array $G, int $cx, int $cy): bool { return $cx >= 0 && $cy >= 0 && $cx < $G['W'] && $cy < $G['H'] && $G['g'][$cy * $G['W'] + $cx] === "\1"; }

    private static function sight(array $G, array $a, array $b): bool
    {
        $n = (int)ceil(max(abs($b[0] - $a[0]), abs($b[1] - $a[1])) / ($G['c'] * 0.5));
        for ($k = 0; $k <= $n; $k++) { $t = $n ? $k / $n : 0; [$cx, $cy] = self::cellOf($G, $a[0] + ($b[0] - $a[0]) * $t, $a[1] + ($b[1] - $a[1]) * $t); if (!self::free($G, $cx, $cy)) return false; }
        return true;
    }

    /**
     * Jalan dari pintu ke koridor terdekat lewat lantai yang bisa dilalui (Dijkstra 8 arah di grid 0,4 m, lalu diluruskan).
     * $edges: [[ax, ay, bx, by], ...] koridor. Return titik-titik belok (satuan denah, tanpa titik pintu) atau null.
     */
    public static function walkToCorridor(array $model, array $G, float $x, float $y, array $edges): ?array
    {
        if (!$G || !$edges) return null;
        $W = $G['W']; $H = $G['H']; $c = $G['c'];
        // goals: free cells within ~0.8 m of a corridor edge
        $goal = [];
        foreach ($edges as [$ax, $ay, $bx, $by]) {
            $n = (int)ceil(hypot($bx - $ax, $by - $ay) / ($c * 0.5));
            for ($k = 0; $k <= $n; $k++) {
                $t = $n ? $k / $n : 0; [$cx, $cy] = self::cellOf($G, $ax + ($bx - $ax) * $t, $ay + ($by - $ay) * $t);
                for ($dy = -2; $dy <= 2; $dy++) for ($dx = -2; $dx <= 2; $dx++) if (self::free($G, $cx + $dx, $cy + $dy)) $goal[($cy + $dy) * $W + $cx + $dx] = true;
            }
        }
        // start: the door cell, or the nearest free cell around it (the door sits on a wall)
        [$sx, $sy] = self::cellOf($G, $x, $y); $start = null;
        for ($r = 0; $r <= 4 && $start === null; $r++) { // ≤ 1.6 m: through the wall and its clearance, never across a shop
            $best = null;
            for ($dy = -$r; $dy <= $r; $dy++) for ($dx = -$r; $dx <= $r; $dx++) {
                if (max(abs($dx), abs($dy)) !== $r || !self::free($G, $sx + $dx, $sy + $dy)) continue;
                $d = $dx * $dx + $dy * $dy; if ($best === null || $d < $best[0]) $best = [$d, ($sy + $dy) * $W + $sx + $dx];
            }
            if ($best) $start = $best[1];
        }
        if ($start === null) return null;
        $dist = [$start => 0.0]; $prev = []; $q = new SplPriorityQueue(); $q->insert($start, 0.0);
        $limit = self::MAX_WALK_M / self::CELL_M; $end = null;
        $nb = [[1, 0, 1.0], [-1, 0, 1.0], [0, 1, 1.0], [0, -1, 1.0], [1, 1, M_SQRT2], [1, -1, M_SQRT2], [-1, 1, M_SQRT2], [-1, -1, M_SQRT2]];
        while (!$q->isEmpty()) {
            $i = $q->extract(); $d = $dist[$i];
            if (isset($goal[$i])) { $end = $i; break; }
            if ($d > $limit) break;
            $cx = $i % $W; $cy = intdiv($i, $W);
            foreach ($nb as [$dx, $dy, $w]) {
                $nx = $cx + $dx; $ny = $cy + $dy;
                if (!self::free($G, $nx, $ny) || ($dx && $dy && (!self::free($G, $cx + $dx, $cy) || !self::free($G, $cx, $cy + $dy)))) continue;
                $j = $ny * $W + $nx; $nd = $d + $w;
                if (!isset($dist[$j]) || $nd < $dist[$j]) { $dist[$j] = $nd; $prev[$j] = $i; $q->insert($j, -$nd); }
            }
        }
        if ($end === null) return null;
        $cells = [$end]; while (isset($prev[$cells[0]])) array_unshift($cells, $prev[$cells[0]]);
        $pts = array_map(fn($i) => [$G['x0'] + ($i % $W + 0.5) * $c, $G['y0'] + (intdiv($i, $W) + 0.5) * $c], $cells);
        // straighten: from each kept point jump to the farthest point still in sight
        $out = []; $cur = [$x, $y]; $k = 0; $last = count($pts) - 1;
        while ($k < $last) {
            $j = $last; while ($j > $k + 1 && !self::sight($G, $cur, $pts[$j])) $j--;
            $out[] = $pts[$j]; $cur = $pts[$j]; $k = $j;
        }
        return $out ?: [$pts[$last]];
    }

    /** Edge koridor lantai (tanpa spur ke pintu lain) untuk walkToCorridor. */
    private static function corridorEdges(string $floorId, array $skip): array
    {
        $out = [];
        foreach (Db::all('SELECT e.node_a, e.node_b, a.x ax, a.y ay, b.x bx, b.y by_ FROM graph_edges e JOIN graph_nodes a ON a.id=e.node_a JOIN graph_nodes b ON b.id=e.node_b WHERE a.floor_id=? AND e.is_enabled=1', [$floorId]) as $r)
            if (!isset($skip[(int)$r['node_a']]) && !isset($skip[(int)$r['node_b']])) $out[] = [(float)$r['ax'], (float)$r['ay'], (float)$r['bx'], (float)$r['by_']];
        return $out;
    }

    /**
     * Sambungkan node pintu ke jalur: lewat lantai yang bisa dilalui (titik belok jadi node $label), lalu ke edge koridor
     * terdekat. Tanpa model/grid atau bila tidak ketemu: langsung ke koridor terdekat seperti GraphApi::snapToCorridor.
     * Return true bila lewat lantai; false = garis lurus (di lantai 3D: pintunya tidak menghadap koridor di gambar).
     */
    public static function connectDoor(string $floorId, ?array $model, ?array &$G, int $door, float $x, float $y, ?string $label): bool
    {
        $skip = GraphApi::doorLeaves($floorId); $skip[$door] = true;
        if ($model && $G === null) $G = self::walkGrid($model);
        $way = $model ? self::walkToCorridor($model, $G, $x, $y, self::corridorEdges($floorId, $skip)) : null;
        if (!$way) { GraphApi::connectNode($door, $floorId, $x, $y, $label, $skip); return false; }
        $prevId = $door;
        foreach ($way as [$wx, $wy]) {
            $id = Db::insert('graph_nodes', ['floor_id' => $floorId, 'x' => round($wx, 2), 'y' => round($wy, 2), 'label' => $label]);
            Db::insert('graph_edges', ['node_a' => min($prevId, $id), 'node_b' => max($prevId, $id), 'is_enabled' => 1]);
            $prevId = $id;
            $skip[$id] = true; // the spur being built is no corridor to land on
        }
        [$lx, $ly] = end($way);
        GraphApi::connectNode($prevId, $floorId, $lx, $ly, $label, $skip);
        return true;
    }

    /** Node berderajat 2 dilebur: kedua tetangganya disambung langsung lagi (kebalikan dari split edge). */
    private static function dissolve(int $nid): bool
    {
        $es = Db::all('SELECT * FROM graph_edges WHERE node_a=? OR node_b=?', [$nid, $nid]);
        if (count($es) !== 2) return false;
        $o = array_map(fn($e) => (int)$e['node_a'] === $nid ? (int)$e['node_b'] : (int)$e['node_a'], $es);
        Db::exec('DELETE FROM graph_edges WHERE node_a=? OR node_b=?', [$nid, $nid]);
        if ($o[0] !== $o[1] && !Db::val('SELECT id FROM graph_edges WHERE node_a=? AND node_b=?', [min($o), max($o)]))
            Db::insert('graph_edges', ['node_a' => min($o), 'node_b' => max($o), 'type' => $es[0]['type'], 'is_enabled' => (int)$es[0]['is_enabled'],
                'schedule_id' => $es[0]['schedule_id'], 'label' => $es[0]['label']]);
        Db::exec('DELETE FROM graph_nodes WHERE id=?', [$nid]);
        return true;
    }

    private static function usedNodes(): array
    {
        return array_flip(array_map('intval', Db::col('SELECT node_id FROM tenants WHERE node_id IS NOT NULL UNION SELECT node_id FROM amenities WHERE node_id IS NOT NULL
            UNION SELECT node_id FROM kiosks WHERE node_id IS NOT NULL UNION SELECT node_id FROM connector_stops UNION SELECT node_id FROM events WHERE node_id IS NOT NULL')));
    }

    /**
     * Lepas spur lama sebuah pintu yang tidak dipakai lagi: node pintu + node "$label" yang jadi buntu dihapus, node "$label"
     * yang tinggal di tengah koridor (titik split) dilebur lagi. Pintu yang menumpang di spur pintu lain cukup dilebur.
     */
    public static function removeSpur(string $floorId, int $door, string $label): void
    {
        $used = self::usedNodes();
        if (isset($used[$door])) return;
        $deg = (int)Db::val('SELECT COUNT(*) FROM graph_edges WHERE node_a=? OR node_b=?', [$door, $door]);
        if ($deg === 2) { self::dissolve($door); return; }
        if ($deg > 2) return;
        Db::exec('DELETE FROM graph_edges WHERE node_a=? OR node_b=?', [$door, $door]);
        Db::exec('DELETE FROM graph_nodes WHERE id=?', [$door]);
        for ($pass = 0; $pass < 50; $pass++) {
            $changed = false;
            foreach (Db::col('SELECT id FROM graph_nodes WHERE floor_id=? AND label=?', [$floorId, $label]) as $nid) {
                $nid = (int)$nid;
                if (isset($used[$nid])) continue;
                $n = (int)Db::val('SELECT COUNT(*) FROM graph_edges WHERE node_a=? OR node_b=?', [$nid, $nid]);
                if ($n <= 1) { Db::exec('DELETE FROM graph_edges WHERE node_a=? OR node_b=?', [$nid, $nid]); Db::exec('DELETE FROM graph_nodes WHERE id=?', [$nid]); $changed = true; }
                elseif ($n === 2) $changed = self::dissolve($nid) || $changed;
            }
            if (!$changed) break;
        }
    }

    /**
     * Sambung ulang tenant/fasilitas ke jalur yang sekarang (setelah jalur diedit di CMS): pin pindah ke pintu unitnya
     * (tenant bertaut unit 3D / fasilitas di gambar) atau tetap, spur lamanya dilepas, lalu disambung lewat lantai.
     */
    public static function reconnect(string $floorId, array $tenantIds, array $amenityIds): array
    {
        $entry = self::entry($floorId);
        $model = $entry && self::isPlan($entry) ? self::model($entry) : null;
        $G = null;
        $units = []; foreach ($model['units'] ?? [] as $u) $units[$u['id']] = $u;
        $fac = []; foreach ($model['facilities'] ?? [] as $f) if (!empty($f['poly'])) $fac[] = $f;
        return Db::tx(function () use ($floorId, $model, &$G, $units, $fac, $tenantIds, $amenityIds) {
            $todo = []; $out = [];
            foreach ($tenantIds as $tid) { $t = Db::one('SELECT id, x, y, node_id, unit_shape_id FROM tenants WHERE id=? AND floor_id=?', [(string)$tid, $floorId]); if ($t) $todo[] = ['tenants', 'tenant', $t]; }
            foreach ($amenityIds as $aid) { $a = Db::one('SELECT id, x, y, node_id FROM amenities WHERE id=? AND floor_id=?', [(string)$aid, $floorId]); if ($a) $todo[] = ['amenities', 'amenity', $a]; }
            foreach ($todo as [$tbl, $kind, $r]) {
                $label = 'spur:' . $r['id'];
                Db::update($tbl, ['node_id' => null], ['id' => $r['id']]);
                if ($r['node_id'] !== null) self::removeSpur($floorId, (int)$r['node_id'], $label);
                $skip = GraphApi::doorLeaves($floorId);
                $edges = array_values(array_filter(array_map(fn($q) => isset($skip[(int)$q['node_a']]) || isset($skip[(int)$q['node_b']]) ? null : [(float)$q['ax'], (float)$q['ay'], (float)$q['bx'], (float)$q['by_']],
                    Db::all('SELECT e.node_a, e.node_b, a.x ax, a.y ay, b.x bx, b.y by_ FROM graph_edges e JOIN graph_nodes a ON a.id=e.node_a JOIN graph_nodes b ON b.id=e.node_b WHERE a.floor_id=? AND e.is_enabled=1', [$floorId]))));
                $x = $r['x'] !== null ? (float)$r['x'] : null; $y = $r['y'] !== null ? (float)$r['y'] : null;
                // the door: an existing pin moved onto its building's wall (it records the real entrance), else the wall side nearest a corridor
                if ($model && $G === null) $G = self::walkGrid($model);
                if ($kind === 'tenant' && $model && isset($units[$r['unit_shape_id'] ?? '']))
                    [$x, $y] = $x !== null ? self::wallPoint($model, $G, $units[$r['unit_shape_id']]['poly'], $x, $y) : self::doorPoint($model, $units[$r['unit_shape_id']], $edges, $G);
                elseif ($kind === 'amenity' && $model && $x !== null)
                    foreach ($fac as $f) { [$fx, $fy] = self::planPoint($model, (float)$f['x'], (float)$f['y']); if (hypot($fx - $x, $fy - $y) * (float)$model['m_per_unit'] < 25) { [$x, $y] = self::wallPoint($model, $G, $f['poly'], $x, $y); break; } }
                if ($x === null) continue;
                $door = Db::insert('graph_nodes', ['floor_id' => $floorId, 'x' => round($x, 2), 'y' => round($y, 2), 'label' => $label]);
                $via = self::connectDoor($floorId, $model, $G, $door, $x, $y, $label);
                Db::update($tbl, ['x' => round($x, 2), 'y' => round($y, 2), 'node_id' => $door], ['id' => $r['id']]);
                Audit::log('update', $kind, $r['id'], 'disambung ulang ke jalur (otomatis' . ($via ? ', lewat lantai' : ', garis lurus') . ')', ['node_id' => $r['node_id']], ['node_id' => $door]);
                $out[] = ['type' => $kind, 'id' => $r['id'], 'node' => $door, 'viaFloor' => $via || !$model];
            }
            if ($out) { Revisions::bump('map'); if (array_filter($out, fn($o) => $o['type'] === 'tenant')) Revisions::bump('content'); }
            return $out;
        });
    }

    /**
     * Titik-titik di dinding bangunan (tiap ±0,3 m, satuan denah) beserta tandanya: true bila sisi luarnya lantai yang bisa
     * dilalui (muka toko), false bila menempel ke bangunan lain / tepi mall.
     */
    private static function wallSamples(array $model, ?array $G, array $poly): array
    {
        $pts = array_map(fn($p) => self::planPoint($model, (float)$p[0], (float)$p[1]), $poly);
        $n = count($pts); $out = [];
        $step = 0.3 / (float)$model['m_per_unit']; $off = 1.0 / (float)$model['m_per_unit'];
        $area = 0.0; for ($i = 0; $i < $n; $i++) { $a = $pts[$i]; $b = $pts[($i + 1) % $n]; $area += $a[0] * $b[1] - $b[0] * $a[1]; }
        $sgn = $area > 0 ? 1 : -1;
        for ($i = 0; $i < $n; $i++) {
            [$ax, $ay] = $pts[$i]; [$bx, $by] = $pts[($i + 1) % $n];
            $L = hypot($bx - $ax, $by - $ay); if ($L < 1e-6) continue;
            $nx = ($by - $ay) / $L * $sgn; $ny = -($bx - $ax) / $L * $sgn; // outward (plan is y-down)
            $k = max(1, (int)ceil($L / $step));
            for ($j = 0; $j < $k; $j++) {
                $x = $ax + ($bx - $ax) * ($j + 0.5) / $k; $y = $ay + ($by - $ay) * ($j + 0.5) / $k;
                $front = false;
                if ($G) foreach ([1.0, 1.6] as $f) { [$cx, $cy] = self::cellOf($G, $x + $nx * $off * $f, $y + $ny * $off * $f); if (self::free($G, $cx, $cy)) { $front = true; break; } }
                $out[] = [$x, $y, $front];
            }
        }
        return $out;
    }

    /** Pin pintu yang sudah ada → titik muka toko terdekat (bukan dinding yang menempel ke unit sebelah), satuan denah. */
    public static function wallPoint(array $model, ?array $G, array $poly, float $x, float $y): array
    {
        $S = self::wallSamples($model, $G, $poly);
        $front = array_values(array_filter($S, fn($q) => $q[2]));
        $best = null;
        foreach ($front ?: $S as $q) { $d = hypot($q[0] - $x, $q[1] - $y); if ($best === null || $d < $best[2]) $best = [$q[0], $q[1], $d]; }
        return $best ? [$best[0], $best[1]] : [$x, $y];
    }

    /** Pintu masuk tanpa pin: titik muka toko yang paling dekat ke koridor, satuan denah. */
    public static function doorPoint(array $model, array $unit, array $edges, ?array $G = null): array
    {
        $S = self::wallSamples($model, $G, $unit['poly']);
        $front = array_values(array_filter($S, fn($q) => $q[2]));
        $best = null;
        foreach ($front ?: $S as [$x, $y]) {
            foreach ($edges as $e) {
                $dx = $e[2] - $e[0]; $dy = $e[3] - $e[1]; $L = $dx * $dx + $dy * $dy;
                $t = $L > 0 ? max(0.0, min(1.0, (($x - $e[0]) * $dx + ($y - $e[1]) * $dy) / $L)) : 0.0;
                $d = hypot($x - $e[0] - $t * $dx, $y - $e[1] - $t * $dy);
                if ($best === null || $d < $best[2]) $best = [$x, $y, $d];
            }
        }
        if ($best === null) { $c = $unit['label'] ?? null; return $c ? self::planPoint($model, (float)$c['x'], (float)$c['y']) : ($S ? [$S[0][0], $S[0][1]] : [0.0, 0.0]); }
        return [$best[0], $best[1]];
    }

    /**
     * Buat tenant CMS (brand baru atau brand yang namanya sama) untuk unit bernama: pin di pintu yang menghadap koridor,
     * disambung ke jalur terdekat, unit ditautkan, langsung tampil di kiosk setelah publish.
     * @return array<int, array{unit:string, tenant:string, name:string, category:string}>
     */
    public static function importUnits(string $floorId, array $unitIds): array
    {
        $entry = self::entry($floorId);
        $model = $entry ? self::model($entry) : null;
        if (!$entry || !$model || !self::isPlan($entry)) throw new ApiError('validation', 'Lantai ' . $floorId . ' belum memakai denah 3D');
        $floor = Db::one('SELECT * FROM floors WHERE id=?', [$floorId]);
        if (!$floor) throw ApiError::notFound('Lantai');
        $want = array_flip(array_map('strval', $unitIds));
        $units = array_values(array_filter(self::unlinkedUnits($floorId, $model), fn($u) => isset($want[$u['id']])));
        $byId = []; foreach ($model['units'] as $u) $byId[$u['id']] = $u;
        $cats = array_flip(Db::col('SELECT id FROM categories WHERE is_active=1'));
        $focus = Db::all('SELECT * FROM floor_focus WHERE floor_id=?', [$floorId]);
        $G = null;
        return Db::tx(function () use ($units, $byId, $cats, $focus, $floor, $floorId, $model, &$G) {
            $edges = array_map(fn($r) => [(float)$r['ax'], (float)$r['ay'], (float)$r['bx'], (float)$r['by_']], Db::all(
                'SELECT a.x ax, a.y ay, b.x bx, b.y by_ FROM graph_edges e JOIN graph_nodes a ON a.id=e.node_a JOIN graph_nodes b ON b.id=e.node_b WHERE a.floor_id=? AND e.is_enabled=1', [$floorId]));
            $out = [];
            foreach ($units as $u) {
                $name = self::displayName($u['name']);
                $cat = self::guessCategory($name); if (!isset($cats[$cat])) $cat = (string)array_key_first($cats);
                $brandId = (int)Db::val('SELECT id FROM brands WHERE LOWER(name)=LOWER(?) ORDER BY id LIMIT 1', [$name]);
                if (!$brandId) {
                    $slug = substr(Util::slug($name), 0, 60); $base = $slug; $i = 2;
                    while (Db::val('SELECT id FROM brands WHERE slug=?', [$slug])) $slug = substr($base, 0, 56) . '-' . $i++;
                    $b = ['slug' => $slug, 'name' => $name, 'category_id' => $cat, 'updated_by' => Auth::id()];
                    $brandId = Db::insert('brands', $b);
                    Audit::log('create', 'brand', (string)$brandId, 'brand dibuat dari peta 3D: ' . $name, null, $b);
                } else $cat = (string)Db::val('SELECT category_id FROM brands WHERE id=?', [$brandId]);
                $base = substr(Util::slug($name) . '-' . $floorId, 0, 60); $tid = $base; $i = 2;
                while (Db::val('SELECT id FROM tenants WHERE id=?', [$tid])) $tid = substr($base, 0, 58) . '-' . $i++;
                if ($G === null) $G = self::walkGrid($model);
                [$x, $y] = self::doorPoint($model, $byId[$u['id']], $edges, $G);
                $building = $floor['building'] === 'both' ? ($byId[$u['id']]['building'] ?? 'both') : $floor['building'];
                if ($building === 'both') {
                    $building = 'ewalk';
                    foreach ($focus as $fb) if ($x >= $fb['x'] && $x <= $fb['x'] + $fb['w'] && $y >= $fb['y'] && $y <= $fb['y'] + $fb['h']) { $building = $fb['building']; break; }
                }
                $row = ['id' => $tid, 'brand_id' => $brandId, 'floor_id' => $floorId, 'building' => $building, 'x' => round($x, 2), 'y' => round($y, 2),
                    'unit_shape_id' => $u['id'], 'status' => 'open', 'hours_mode' => 'unknown', 'is_published' => 1, 'src_id' => '3d:' . $u['id'], 'updated_by' => Auth::id()];
                Db::insert('tenants', $row);
                $node = null; $via = false;
                if ($edges) { $node = Db::insert('graph_nodes', ['floor_id' => $floorId, 'x' => round($x, 2), 'y' => round($y, 2), 'label' => 'spur:' . $tid]);
                    $via = self::connectDoor($floorId, $model, $G, $node, $x, $y, 'spur:' . $tid); }
                if ($node) Db::update('tenants', ['node_id' => $node], ['id' => $tid]);
                Audit::log('create', 'tenant', $tid, 'tenant dibuat dari unit 3D ' . $u['id'], null, $row + ['node_id' => $node]);
                $out[] = ['unit' => $u['id'], 'tenant' => $tid, 'name' => $name, 'category' => $cat, 'viaFloor' => $via];
            }
            if ($out) { Revisions::bump('content'); Revisions::bump('map'); }
            return $out;
        });
    }
}
