<?php
declare(strict_types=1);

/**
 * Builder JSON snapshot §5 dari DB (sumber kebenaran).
 *  - directory(): directory.json kandidat + aux (info untuk validator & diff)
 *  - promos():    promos.json
 *  - status():    status.json
 */
final class Snapshot
{
    public const BUILDING_LABEL = ['pentacity' => 'Pentacity', 'ewalk' => 'E-Walk'];

    // ------------------------------------------------------------------ helpers
    public static function f($v): ?float { return $v === null ? null : round((float)$v, 2); }

    public static function costSettings(): array
    {
        return [
            'escalator' => (float)Settings::get('cost.escalatorPerLevel', 19.2),
            'lift' => (float)Settings::get('cost.liftPerLevel', 38.4),
            'stairs' => (float)Settings::get('cost.stairsPerLevel', 28.8),
            'travelator' => (float)Settings::get('cost.travelatorPerLevel', 9.6),
            'bridge' => (float)Settings::get('cost.bridge', 0),
        ];
    }

    /** Biaya leg: override ?? default per level × jumlah level (bridge: cost.bridge). */
    public static function legCost(string $type, ?string $override, int $lowerLevel, int $upperLevel): float
    {
        if ($override !== null && $override !== '') return round((float)$override, 2);
        $c = self::costSettings();
        if ($type === 'bridge') return round($c['bridge'], 2);
        $levels = max(1, abs($upperLevel - $lowerLevel));
        return round(($c[$type] ?? $c['escalator']) * $levels, 2);
    }

    public static function edgeType(string $bankType, string $dirOfEdge): string
    {
        switch ($bankType) {
            case 'lift': return 'lift';
            case 'stairs': return 'stairs';
            case 'bridge': return 'crossing';
            default: return $dirOfEdge === 'up' ? 'escalator-up' : 'escalator-down';
        }
    }

    public static function amenityType(string $bankType): string
    {
        return ['escalator' => 'escalator', 'travelator' => 'escalator', 'lift' => 'lift', 'stairs' => 'stairs', 'bridge' => 'crossing'][$bankType] ?? $bankType;
    }

    public static function mediaUrl(?string $path): ?string { return $path ?: null; }

    /** Daftar leg lengkap dengan level & stop (dipakai snapshot, API konektor, validator). */
    public static function legsFull(): array
    {
        return Db::all("SELECT l.*, b.type bank_type, b.is_enabled bank_enabled, b.schedule_id bank_schedule_id, b.name_en bank_name_en, b.name_id bank_name_id,
              sl.node_id lower_node, sl.floor_id lower_floor, sl.public_id lower_public, sl.bank_id lower_bank, fl.level lower_level, fl.short lower_short, fl.is_active lower_floor_active,
              su.node_id upper_node, su.floor_id upper_floor, su.public_id upper_public, su.bank_id upper_bank, fu.level upper_level, fu.short upper_short, fu.is_active upper_floor_active
            FROM connector_legs l
            JOIN connector_banks b ON b.id = l.bank_id
            JOIN connector_stops sl ON sl.id = l.lower_stop_id JOIN floors fl ON fl.id = sl.floor_id
            JOIN connector_stops su ON su.id = l.upper_stop_id JOIN floors fu ON fu.id = su.floor_id
            ORDER BY l.id");
    }

    public static function legLabel(array $l): array
    {
        $arrow = $l['direction'] === 'up' ? '→' : ($l['direction'] === 'down' ? '←' : '↔');
        if ($l['bank_type'] === 'bridge' || in_array($l['bank_type'], ['lift'], true)) $arrow = '↔';
        $seg = $l['direction'] === 'down' && $l['bank_type'] !== 'lift' && $l['bank_type'] !== 'bridge'
            ? $l['upper_short'] . '→' . $l['lower_short']
            : $l['lower_short'] . ($arrow === '↔' ? '↔' : '→') . $l['upper_short'];
        return ['en' => $l['bank_name_en'] . ' ' . $seg, 'id' => $l['bank_name_id'] . ' ' . $seg];
    }

    public static function legExported(array $l): bool
    {
        return (int)$l['is_enabled'] === 1 && (int)$l['bank_enabled'] === 1
            && (int)$l['lower_floor_active'] === 1 && (int)$l['upper_floor_active'] === 1;
    }

    /** Edge [from,to,cost,type,key] dari leg. */
    public static function legEdges(array $l, float $cost): array
    {
        $a = 'n' . $l['lower_node']; $b = 'n' . $l['upper_node']; $k = 'L' . $l['id'];
        $t = $l['bank_type'];
        if ($t === 'escalator' || $t === 'travelator') {
            $out = [];
            if ($l['direction'] !== 'down') $out[] = [$a, $b, $cost, 'escalator-up', $k];
            if ($l['direction'] !== 'up') $out[] = [$b, $a, $cost, 'escalator-down', $k];
            return $out;
        }
        return [[$a, $b, $cost, self::edgeType($t, 'both'), $k]];
    }

    // ------------------------------------------------------------------ directory
    /**
     * @return array{0: array, 1: array} [snapshot, aux]
     * opts: writeSvg (bool, default true)
     */
    public static function directory(array $opts = []): array
    {
        $writeSvg = $opts['writeSvg'] ?? true;
        Settings::flush(); Schedule::flush();
        $aux = ['legs' => [], 'danglingStops' => [], 'unitMissing' => [], 'spurNodes' => [], 'tenantStatus' => [], 'notes' => []];

        // floors
        $floors = Db::all('SELECT f.*, m.path svg_path, m.sha256 svg_sha FROM floors f JOIN media m ON m.id=f.svg_media_id WHERE f.is_active=1 ORDER BY f.sort_order, f.level, f.id');
        $focus = [];
        foreach (Db::all('SELECT * FROM floor_focus') as $r) $focus[$r['floor_id']][$r['building']] = [self::f($r['x']), self::f($r['y']), self::f($r['w']), self::f($r['h'])];
        $floorById = [];
        foreach ($floors as $f) $floorById[$f['id']] = $f;

        // categories
        $cats = Db::all('SELECT * FROM categories WHERE is_active=1 ORDER BY sort_order, id');

        // tenants (+brand)
        $trows = Db::all("SELECT t.*, b.slug brand_slug, b.name brand_name, b.category_id, b.logo_media_id, b.desc_en, b.desc_id, b.keywords_en, b.keywords_id,
               b.url brand_url, b.instagram, b.tiktok, b.facebook, b.whatsapp,
               COALESCE(mo.path, mb.path) logo_path, COALESCE(mo.path_2x, mb.path_2x) logo_path_2x
            FROM tenants t JOIN brands b ON b.id=t.brand_id
            LEFT JOIN media mo ON mo.id=t.logo_override_media_id
            LEFT JOIN media mb ON mb.id=b.logo_media_id
            WHERE t.is_published=1 AND t.status<>'closed'
            ORDER BY t.id");
        $trows = array_values(array_filter($trows, fn($t) => isset($floorById[$t['floor_id']])));
        $hoursRows = [];
        foreach (Db::all('SELECT * FROM tenant_hours ORDER BY tenant_id, dow') as $h) $hoursRows[$h['tenant_id']][] = $h;
        // display name
        $byBrand = [];
        foreach ($trows as $t) $byBrand[$t['brand_id']][] = $t;
        $mallHours = Schedule::mallHours();

        $tenants = [];
        foreach ($trows as $t) {
            $f = $floorById[$t['floor_id']];
            $name = self::displayName($t, $byBrand[$t['brand_id']], $floorById);
            [$week, $hoursStr] = self::tenantHours($t, $hoursRows[$t['id']] ?? [], $mallHours);
            $url = $t['url_override'] ?: $t['brand_url'];
            $tenants[] = [
                'id' => $t['id'], 'name' => $name, 'brand' => $t['brand_name'], 'category' => $t['category_id'],
                'floor' => $t['floor_id'], 'building' => $t['building'],
                'x' => self::f($t['x']), 'y' => self::f($t['y']), 'node' => $t['node_id'] ? 'n' . $t['node_id'] : null,
                'logo' => self::mediaUrl($t['logo_path']), 'phone' => $t['phone'] ?: null, 'url' => $url ?: null,
                'desc' => $t['desc_en'] ?? $t['desc_id'] ?? null, 'hours' => $hoursStr,
                'keywords' => Keywords::build($t['keywords_id'], $t['keywords_en'], $t['category_id'], $f['short'], $t['building']),
                'srcId' => $t['src_id'],
                // ---- schema 2 (additive)
                'unit' => $t['unit_no'], 'status' => $t['status'],
                'statusNote' => ($t['status_note_en'] || $t['status_note_id']) ? ['en' => $t['status_note_en'], 'id' => $t['status_note_id']] : null,
                'descEn' => $t['desc_en'], 'descId' => $t['desc_id'],
                'hoursWeek' => $week,
                'hoursNote' => ($t['hours_note_en'] || $t['hours_note_id']) ? ['en' => $t['hours_note_en'], 'id' => $t['hours_note_id']] : null,
                'social' => ['instagram' => $t['instagram'], 'tiktok' => $t['tiktok'], 'facebook' => $t['facebook'], 'whatsapp' => $t['whatsapp']],
                'openingDate' => $t['opening_date'], 'hasUnit' => $t['unit_shape_id'] !== null && $t['unit_shape_id'] !== '',
                'logo2x' => self::mediaUrl($t['logo_path_2x']),
                // 3D floors (js/map3d.js): building in data/3d/<model>.json that shows this tenant's name and logo
                'unitShape' => $t['unit_shape_id'] !== null && $t['unit_shape_id'] !== '' ? $t['unit_shape_id'] : null,
            ];
            $aux['tenantStatus'][$t['id']] = $t['status'];
        }

        // floor SVG publish (§5.4.10)
        $links = [];
        foreach ($trows as $t) if ($t['unit_shape_id']) $links[$t['floor_id']][$t['unit_shape_id']] = $t['id'];
        // units whose only tenants are hidden (unpublished or closed): 3D roofs stay blank instead of showing the drawing's name
        $hiddenUnits = [];
        foreach (Db::all("SELECT floor_id, unit_shape_id FROM tenants WHERE unit_shape_id IS NOT NULL AND unit_shape_id<>'' AND NOT (is_published=1 AND status<>'closed') ORDER BY unit_shape_id") as $h)
            if (!isset($links[$h['floor_id']][$h['unit_shape_id']])) $hiddenUnits[$h['floor_id']][$h['unit_shape_id']] = true;
        $floorsOut = [];
        $north = Settings::get('map.northDeg');
        foreach ($floors as $f) {
            [$svgPath, $missing] = SvgPublisher::publish($f['id'], (string)$f['svg_path'], (string)$f['svg_sha'], $links[$f['id']] ?? [], $writeSvg);
            foreach ($missing as $m) $aux['unitMissing'][] = ['floor' => $f['id'], 'shape' => $m, 'tenant' => $links[$f['id']][$m]];
            $floorsOut[] = [
                'id' => $f['id'], 'name' => $f['name_en'], 'short' => $f['short'], 'level' => (int)$f['level'], 'building' => $f['building'],
                'svg' => $svgPath, 'viewBox' => [(float)$f['vb_x'], (float)$f['vb_y'], (float)$f['vb_w'], (float)$f['vb_h']],
                'unitScale' => (float)$f['unit_scale'], 'focus' => (object)($focus[$f['id']] ?? []),
                'nameEn' => $f['name_en'], 'nameId' => $f['name_id'], 'northDeg' => $f['north_deg'] === null ? null : (float)$f['north_deg'],
            ] + (isset($hiddenUnits[$f['id']]) ? ['unitsHidden' => array_keys($hiddenUnits[$f['id']])] : []);
        }

        // kiosks
        $kiosks = [];
        foreach (Db::all('SELECT * FROM kiosks WHERE is_active=1 ORDER BY id') as $k) {
            if (!isset($floorById[$k['floor_id']])) continue;
            $kiosks[] = ['id' => $k['id'], 'name' => $k['name'], 'floor' => $k['floor_id'], 'building' => $k['building'],
                'x' => self::f($k['x']), 'y' => self::f($k['y']), 'node' => $k['node_id'] ? 'n' . $k['node_id'] : null,
                'facingDeg' => $k['facing_deg'] === null ? null : (int)$k['facing_deg'], 'srcId' => $k['src_id'],
                'defaultLang' => $k['default_lang'], 'attractLang' => $k['attract_lang'], 'clientType' => $k['client_type'], 'perfMode' => $k['perf_mode']];
        }

        // graph nodes
        $nodes = [];
        $nodeById = [];
        foreach (Db::all('SELECT id, floor_id, x, y, label FROM graph_nodes ORDER BY id') as $n) {
            if (!isset($floorById[$n['floor_id']])) continue;
            $node = ['id' => 'n' . $n['id'], 'floor' => $n['floor_id'], 'x' => self::f($n['x']), 'y' => self::f($n['y'])];
            if ($n['label'] === 'outdoor') $node['outdoor'] = true;   // jalan di luar gedung (penyeberangan): route.js memberi langkah sendiri
            $nodes[] = $node;
            $nodeById[(int)$n['id']] = $n;
            if ($n['label'] !== null && str_starts_with((string)$n['label'], 'spur:')) $aux['spurNodes'][] = 'n' . $n['id'];
        }

        // walk edges
        $rules = [];
        $edges = [];
        $openEdgeClosures = [];
        foreach (Db::col('SELECT DISTINCT edge_id FROM closures WHERE edge_id IS NOT NULL AND (ends_at IS NULL OR ends_at > NOW())') as $eid) $openEdgeClosures[(int)$eid] = true;
        foreach (Db::all('SELECT * FROM graph_edges WHERE is_enabled=1 ORDER BY node_a, node_b') as $e) {
            $a = $nodeById[(int)$e['node_a']] ?? null; $b = $nodeById[(int)$e['node_b']] ?? null;
            if (!$a || !$b) continue;
            $cost = $e['cost_override'] !== null ? round((float)$e['cost_override'], 2) : self::walkCost($a, $b, $floorById);
            $row = ['n' . $e['node_a'], 'n' . $e['node_b'], $cost, $e['type'] === 'stairs' ? 'stairs' : 'walk'];
            $hours = Schedule::hours($e['schedule_id'] ? (int)$e['schedule_id'] : null);
            if ($hours !== null || isset($openEdgeClosures[(int)$e['id']])) {
                $key = 'E' . $e['id'];
                $row[] = $key;
                $lbl = $e['label'] ?: ('Koridor ' . $a['floor_id'] . ' n' . $e['node_a'] . '–n' . $e['node_b']);
                $rules[$key] = ['label' => ['en' => $e['label'] ?: 'Corridor', 'id' => $lbl]];
                if ($hours !== null) $rules[$key]['hours'] = $hours;
            }
            $edges[] = $row;
        }

        // connectors: legs → edges
        $legs = self::legsFull();
        $exportedByStop = [];   // stopId => [ ['floor'=>..., 'level'=>..., 'src'=>...], ...]
        $stopIds = [];
        foreach ($legs as $l) {
            $cost = self::legCost($l['bank_type'], $l['cost_override'], (int)$l['lower_level'], (int)$l['upper_level']);
            $exp = self::legExported($l);
            $aux['legs'][] = ['id' => (int)$l['id'], 'bank' => $l['bank_id'], 'type' => $l['bank_type'], 'direction' => $l['direction'],
                'exported' => $exp, 'lowerLevel' => (int)$l['lower_level'], 'upperLevel' => (int)$l['upper_level'],
                'lowerFloor' => $l['lower_floor'], 'upperFloor' => $l['upper_floor'], 'lowerBank' => $l['lower_bank'], 'upperBank' => $l['upper_bank'],
                'scheduleId' => $l['schedule_id'] ?? $l['bank_schedule_id'], 'label' => self::legLabel($l)['en'], 'cost' => $cost];
            if (!$exp) continue;
            foreach (self::legEdges($l, $cost) as $e) $edges[] = $e;
            $key = 'L' . $l['id'];
            $rules[$key] = ['label' => self::legLabel($l)];
            $sid = $l['schedule_id'] ?? $l['bank_schedule_id'];
            $hours = Schedule::hours($sid !== null ? (int)$sid : null);
            if ($hours !== null) $rules[$key]['hours'] = $hours;
            $src = $l['src_key'] ?: $key;
            $exportedByStop[(int)$l['lower_stop_id']][] = ['floor' => $l['upper_floor'], 'src' => $src];
            $exportedByStop[(int)$l['upper_stop_id']][] = ['floor' => $l['lower_floor'], 'src' => $src];
        }
        usort($edges, function ($x, $y) {
            return [(int)substr($x[0], 1), (int)substr($x[1], 1), $x[3]] <=> [(int)substr($y[0], 1), (int)substr($y[1], 1), $y[3]];
        });

        // amenities: stops (connector) + POI
        $floorOrder = array_flip(array_column($floors, 'id'));
        $amen = [];
        $stops = Db::all('SELECT s.*, b.type bank_type, b.name_en, b.name_id, b.building bank_building, b.is_enabled bank_enabled
            FROM connector_stops s JOIN connector_banks b ON b.id=s.bank_id ORDER BY s.floor_id, s.public_id');
        foreach ($stops as $s) {
            $exp = $exportedByStop[(int)$s['id']] ?? [];
            if (!$exp) { $aux['danglingStops'][] = $s['public_id']; continue; }
            $n = $nodeById[(int)$s['node_id']] ?? null;
            if (!$n || !isset($floorById[$s['floor_id']])) continue;
            $to = array_values(array_unique(array_column($exp, 'floor')));
            usort($to, fn($a, $b) => ($floorOrder[$a] ?? 99) <=> ($floorOrder[$b] ?? 99));
            $src = array_values(array_unique(array_column($exp, 'src')));
            sort($src);
            $f = $floorById[$s['floor_id']];
            $bld = $f['building'] !== 'both' ? $f['building'] : ($s['bank_building'] !== 'both' ? $s['bank_building'] : 'pentacity');
            $amen[] = ['_o' => [$floorOrder[$s['floor_id']] ?? 99, $s['public_id']],
                'id' => $s['public_id'], 'type' => self::amenityType($s['bank_type']), 'name' => $s['name_en'],
                'floor' => $s['floor_id'], 'building' => $bld, 'x' => self::f($n['x']), 'y' => self::f($n['y']), 'node' => 'n' . $s['node_id'],
                'toFloors' => $to, 'connectors' => $src,
                'kind' => 'connector', 'bank' => $s['bank_id'], 'nameEn' => $s['name_en'], 'nameId' => $s['name_id'],
                'icon' => null, 'detail' => ($s['label_en'] || $s['label_id']) ? ['en' => $s['label_en'], 'id' => $s['label_id']] : null,
                'wheelchair' => $s['bank_type'] === 'lift' || $s['bank_type'] === 'bridge', 'gender' => 'all', 'ruleKey' => null];
        }
        $types = Db::all('SELECT * FROM amenity_types ORDER BY sort_order, id');
        $typeById = [];
        foreach ($types as $t) $typeById[$t['id']] = $t;
        foreach (Db::all('SELECT * FROM amenities WHERE is_published=1 ORDER BY id') as $a) {
            if (!isset($floorById[$a['floor_id']])) continue;
            $ty = $typeById[$a['type_id']] ?? null;
            $ruleKey = null;
            if ($a['schedule_id']) {
                $ruleKey = 'A' . $a['schedule_id'];
                $h = Schedule::hours((int)$a['schedule_id']);
                if ($h !== null && !isset($rules[$ruleKey])) {
                    $sn = (string)Db::val('SELECT name FROM schedules WHERE id=?', [$a['schedule_id']]);
                    $rules[$ruleKey] = ['label' => ['en' => $sn, 'id' => $sn], 'hours' => $h];
                }
            }
            $amen[] = ['_o' => [$floorOrder[$a['floor_id']] ?? 99, 'zz' . $a['id']],
                'id' => $a['id'], 'type' => $a['type_id'], 'name' => $a['name_en'] ?: ($ty['name_en'] ?? $a['type_id']),
                'floor' => $a['floor_id'], 'building' => $a['building'], 'x' => self::f($a['x']), 'y' => self::f($a['y']),
                'node' => $a['node_id'] ? 'n' . $a['node_id'] : null, 'toFloors' => [], 'connectors' => [],
                'kind' => 'poi', 'nameEn' => $a['name_en'] ?: ($ty['name_en'] ?? null), 'nameId' => $a['name_id'] ?: ($ty['name_id'] ?? null),
                'icon' => $ty['icon'] ?? null, 'detail' => ($a['detail_en'] || $a['detail_id']) ? ['en' => $a['detail_en'], 'id' => $a['detail_id']] : null,
                'wheelchair' => (bool)(int)$a['is_wheelchair'], 'gender' => $a['gender'], 'ruleKey' => $ruleKey];
        }
        usort($amen, fn($x, $y) => $x['_o'] <=> $y['_o']);
        foreach ($amen as &$a) unset($a['_o']);
        unset($a);

        $amenityTypes = array_map(fn($t) => ['id' => $t['id'], 'nameEn' => $t['name_en'], 'nameId' => $t['name_id'], 'icon' => $t['icon'],
            'color' => $t['color'], 'home' => (bool)(int)$t['show_in_home'], 'sort' => (int)$t['sort_order']], $types);

        $i18n = ['en' => new stdClass(), 'id' => new stdClass()];
        $ie = []; $ii = [];
        foreach (Db::all('SELECT * FROM i18n_strings ORDER BY `key`') as $r) {
            if ($r['en'] !== null && $r['en'] !== '') $ie[$r['key']] = $r['en'];
            if ($r['id'] !== null && $r['id'] !== '') $ii[$r['key']] = $r['id'];
        }
        if ($ie) $i18n['en'] = $ie;
        if ($ii) $i18n['id'] = $ii;

        ksort($rules, SORT_NATURAL);
        $snap = [
            'meta' => [
                'generated' => Util::nowIso(), 'source' => 'cms', 'mapNorthDeg' => $north === null ? null : (float)$north,
                'notes' => [
                    'x/y are in each floor SVG viewBox space',
                    'edges: walk/lift/stairs/crossing are undirected; escalator-up/escalator-down are directed (from -> to)',
                    'edge cost unit = Ground-Floor SVG unit (detail floors scaled by floors[].unitScale)',
                    'optional 5th edge element = ruleKey into graph.rules (operating hours / live closures in status.json)',
                ],
                'schema' => 2, 'version' => null, 'publishedAt' => null, 'tzOffsetMin' => 480,
                'mallHours' => $mallHours,
                'config' => [
                    'idleTimeoutSec' => (int)Settings::get('kiosk.idleTimeoutSec', 60),
                    'metersPerUnit' => (float)Settings::get('kiosk.metersPerUnit', 0.7),
                    'walkSpeedMps' => (float)Settings::get('kiosk.walkSpeedMps', 1.2),
                    'escalatorSecPerLevel' => (int)Settings::get('kiosk.escalatorSecPerLevel', 25),
                    'liftSecPerTrip' => (int)Settings::get('kiosk.liftSecPerTrip', 60),
                    'publicBase' => Settings::get('public.baseUrl'),
                ],
            ],
            'floors' => $floorsOut,
            'categories' => array_map(fn($c) => ['id' => $c['id'], 'name' => $c['name_en'], 'icon' => $c['icon'],
                'nameEn' => $c['name_en'], 'nameId' => $c['name_id'], 'color' => $c['color'], 'sort' => (int)$c['sort_order']], $cats),
            'tenants' => $tenants,
            'kiosks' => $kiosks,
            'amenities' => $amen,
            'amenityTypes' => $amenityTypes,
            'graph' => ['nodes' => $nodes, 'edges' => $edges, 'rules' => (object)$rules],
            'i18n' => $i18n,
        ];
        return [$snap, $aux];
    }

    public static function walkCost(array $a, array $b, array $floorById): float
    {
        $scale = (float)($floorById[$a['floor_id']]['unit_scale'] ?? 1);
        $len = hypot(round((float)$a['x'], 2) - round((float)$b['x'], 2), round((float)$a['y'], 2) - round((float)$b['y'], 2));
        return round($len * $scale, 2);
    }

    public static function displayName(array $t, array $outlets, array $floorById): string
    {
        if ($t['name_override'] !== null && $t['name_override'] !== '') return $t['name_override'];
        if (count($outlets) < 2) return $t['brand_name'];
        $same = 0;
        foreach ($outlets as $o) if ($o['building'] === $t['building']) $same++;
        $s = self::BUILDING_LABEL[$t['building']] ?? $t['building'];
        if ($same > 1) $s .= ' ' . ($floorById[$t['floor_id']]['short'] ?? '');
        return $t['brand_name'] . ' · ' . $s;
    }

    /** @return array{0:?array,1:?string} [hoursWeek, display] */
    public static function tenantHours(array $t, array $rows, array $mallHours): array
    {
        switch ($t['hours_mode']) {
            case 'mall': $w = $mallHours; break;
            case '24h': $w = []; for ($d = 1; $d <= 7; $d++) $w[(string)$d] = [['00:00', '24:00']]; break;
            case 'custom':
                $w = [];
                for ($d = 1; $d <= 7; $d++) $w[(string)$d] = [];
                foreach ($rows as $r) {
                    if ((int)$r['is_closed'] || $r['open_time'] === null || $r['close_time'] === null) continue;
                    $w[(string)(int)$r['dow']][] = [Schedule::t((string)$r['open_time']), Schedule::t((string)$r['close_time'])];
                }
                break;
            default: return [null, null];
        }
        $disp = $t['hours_mode'] === '24h' ? '24 jam' : Schedule::display($w);
        return [$w, $disp];
    }

    // ------------------------------------------------------------------ promos
    public static function promos(): array
    {
        Settings::flush();
        $now = Util::now();
        $featured = Db::col("SELECT f.tenant_id FROM featured_tenants f JOIN tenants t ON t.id=f.tenant_id
            WHERE t.is_published=1 AND t.status<>'closed' AND (f.ends_at IS NULL OR f.ends_at > ?) ORDER BY f.sort_order, f.tenant_id", [$now]);
        $fwin = [];
        foreach (Db::all('SELECT tenant_id, starts_at, ends_at FROM featured_tenants WHERE starts_at IS NOT NULL OR ends_at IS NOT NULL') as $r)
            $fwin[$r['tenant_id']] = ['from' => Util::iso($r['starts_at']), 'to' => Util::iso($r['ends_at'])];
        $promos = [];
        $rows = Db::all("SELECT p.*, m.path media_path, pm.path poster_path FROM promos p
            LEFT JOIN media m ON m.id=p.media_id LEFT JOIN media pm ON pm.id=p.poster_media_id
            WHERE p.status='active' AND p.ends_at > ? ORDER BY p.id", [$now]);
        $targets = [];
        foreach (Db::all('SELECT promo_id, kiosk_id FROM promo_targets ORDER BY kiosk_id') as $r) $targets[(int)$r['promo_id']][] = $r['kiosk_id'];
        foreach ($rows as $p) {
            $days = [];
            for ($b = 0; $b < 7; $b++) if ((int)$p['days_mask'] & (1 << $b)) $days[] = $b + 1;
            $promos[] = ['id' => (int)$p['id'], 'slot' => $p['slot'], 'kind' => $p['kind'],
                'media' => $p['media_path'], 'poster' => $p['poster_path'], 'bg' => $p['bg_color'],
                'title' => ['en' => $p['title_en'], 'id' => $p['title_id']], 'sub' => ['en' => $p['sub_en'], 'id' => $p['sub_id']],
                'link' => ['type' => $p['link_type'], 'ref' => $p['link_ref']],
                'from' => Util::iso($p['starts_at']), 'to' => Util::iso($p['ends_at']), 'days' => $days,
                'time' => ($p['time_from'] && $p['time_to']) ? [Util::hhmm($p['time_from']), Util::hhmm($p['time_to'])] : null,
                'durationSec' => (int)$p['duration_sec'], 'weight' => (int)$p['weight'],
                'targets' => (int)$p['all_kiosks'] ? '*' : ($targets[(int)$p['id']] ?? []),
                'advertiser' => $p['advertiser_name'] ?: $p['advertiser_tenant_id']];
        }
        $events = [];
        $erows = Db::all("SELECT e.*, m.path media_path FROM events e LEFT JOIN media m ON m.id=e.media_id
            WHERE e.is_published=1 AND e.ends_at > ? ORDER BY e.starts_at, e.id", [$now]);
        foreach ($erows as $e) {
            switch ($e['location_type']) {
                case 'tenant': $loc = ['type' => 'tenant', 'ref' => $e['tenant_id']]; break;
                case 'amenity': $loc = ['type' => 'amenity', 'ref' => $e['amenity_id']]; break;
                case 'point': $loc = ['type' => 'point', 'floor' => $e['floor_id'], 'x' => self::f($e['x']), 'y' => self::f($e['y']), 'node' => $e['node_id'] ? 'n' . $e['node_id'] : null]; break;
                default: $loc = ['type' => 'text', 'text' => ['en' => $e['location_text_en'], 'id' => $e['location_text_id']]];
            }
            $ev = ['id' => (int)$e['id'], 'title' => ['en' => $e['title_en'], 'id' => $e['title_id']],
                'desc' => ['en' => $e['desc_en'], 'id' => $e['desc_id']], 'media' => $e['media_path'],
                'from' => Util::iso($e['starts_at']), 'to' => Util::iso($e['ends_at']), 'location' => $loc, 'onAttract' => (bool)(int)$e['show_on_attract']];
            $events[] = $ev;
            if ($ev['onAttract']) {
                $promos[] = ['id' => 'e' . $e['id'], 'slot' => 'attract-hero', 'kind' => 'event', 'media' => $e['media_path'], 'poster' => null, 'bg' => null,
                    'title' => $ev['title'], 'sub' => ['en' => $e['location_text_en'], 'id' => $e['location_text_id']],
                    'link' => ['type' => 'event', 'ref' => (string)$e['id']], 'from' => $ev['from'], 'to' => $ev['to'],
                    'days' => [1, 2, 3, 4, 5, 6, 7], 'time' => null, 'durationSec' => 8, 'weight' => 5, 'targets' => '*', 'advertiser' => null];
            }
        }
        return ['version' => null, 'generated' => Util::nowIso(), 'featured' => $featured, 'featuredWindows' => (object)$fwin,
            'promos' => $promos, 'events' => $events];
    }

    // ------------------------------------------------------------------ status
    public static function status(?int $now = null): array
    {
        $now = $now ?? time();
        $nowDb = date('Y-m-d H:i:s', $now);
        $legs = [];
        foreach (self::legsFull() as $l) $legs[(int)$l['id']] = $l;
        $closures = [];
        $edgeOverrides = [];
        $amenityClosures = [];
        $rows = Db::all('SELECT c.*, e.node_a, e.node_b, e.label edge_label FROM closures c LEFT JOIN graph_edges e ON e.id=c.edge_id
            WHERE (c.ends_at IS NULL OR c.ends_at > ?) ORDER BY c.starts_at, c.id', [$nowDb]);
        foreach ($rows as $c) {
            $base = ['dir' => $c['direction'], 'from' => Util::iso($c['starts_at']), 'to' => Util::iso($c['ends_at']),
                'reason' => ['en' => $c['reason_en'], 'id' => $c['reason_id']], 'closureId' => (int)$c['id']];
            $active = $c['starts_at'] <= $nowDb;
            if ($c['leg_id'] !== null || $c['bank_id'] !== null) {
                $ids = $c['leg_id'] !== null ? [(int)$c['leg_id']] : array_map('intval', Db::col('SELECT id FROM connector_legs WHERE bank_id=? ORDER BY id', [$c['bank_id']]));
                foreach ($ids as $lid) {
                    if (!isset($legs[$lid])) continue;
                    $closures[] = ['key' => 'L' . $lid] + $base + ['label' => self::legLabel($legs[$lid])];
                }
            } elseif ($c['edge_id'] !== null) {
                $closures[] = ['key' => 'E' . $c['edge_id']] + $base + ['label' => ['en' => $c['edge_label'] ?: 'Corridor', 'id' => $c['edge_label'] ?: 'Koridor']];
                if ($active && $c['node_a'] !== null) $edgeOverrides[] = ['n' . $c['node_a'], 'n' . $c['node_b']];
            } elseif ($c['amenity_id'] !== null) {
                if ($active) $amenityClosures[] = $c['amenity_id'];
            }
        }
        // reorder keys for readability
        $closures = array_map(fn($c) => ['key' => $c['key'], 'dir' => $c['dir'], 'from' => $c['from'], 'to' => $c['to'], 'label' => $c['label'], 'reason' => $c['reason'], 'closureId' => $c['closureId']], $closures);
        $n = Db::one('SELECT * FROM notices WHERE starts_at <= ? AND (ends_at IS NULL OR ends_at > ?) ORDER BY id DESC LIMIT 1', [$nowDb, $nowDb]);
        $notice = null;
        if ($n) {
            $ks = Util::jsonDecode($n['kiosk_ids'], []);
            $notice = ['id' => (int)$n['id'], 'level' => $n['level'], 'text' => ['en' => $n['text_en'], 'id' => $n['text_id']],
                'from' => Util::iso($n['starts_at']), 'to' => Util::iso($n['ends_at']), 'kiosks' => (int)$n['all_kiosks'] ? '*' : array_values($ks ?: [])];
        }
        return ['version' => null, 'generated' => Util::nowIso(), 'closures' => $closures, 'edgeOverrides' => $edgeOverrides,
            'amenityClosures' => array_values(array_unique($amenityClosures)), 'notice' => $notice];
    }
}
