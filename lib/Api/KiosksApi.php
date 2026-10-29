<?php
declare(strict_types=1);

/** Kiosk: runtime, provisioning token, command (CRUD dasar di CatalogApi). */
final class KiosksApi
{
    public static function register(Router $r): void
    {
        $r->post('/admin/kiosks/{id}/token', [self::class, 'token'], ['admin' => true, 'perm' => 'kiosks.provision']);
        $r->delete('/admin/kiosks/{id}/token', [self::class, 'revoke'], ['admin' => true, 'perm' => 'kiosks.provision']);
        $r->post('/admin/kiosks/{id}/commands', [self::class, 'command'], ['admin' => true, 'perm' => 'kiosks.command']);
        $r->get('/admin/kiosks/{id}/commands', [self::class, 'commands'], ['admin' => true]);
    }

    public static function runtime(array $k): array
    {
        $seen = $k['last_seen_at'] ? strtotime($k['last_seen_at']) : null;
        $state = 'offline';
        if ($seen && time() - $seen < 180) {
            $state = 'online';
            $live = Publisher::live('directory');
            if ($live && $k['data_version'] && $k['data_version'] !== $live['version'] && time() - strtotime($live['created_at']) > 900) $state = 'stale';
        }
        $up = [];
        $rows = Db::all('SELECT DATE(minute) d, COUNT(*) c FROM kiosk_heartbeats WHERE kiosk_id=? AND minute >= ? GROUP BY DATE(minute)', [$k['id'], date('Y-m-d 00:00:00', strtotime('-6 days'))]);
        $byDay = array_column($rows, 'c', 'd');
        $mins = self::openMinutesPerDay();
        for ($i = 6; $i >= 0; $i--) {
            $d = date('Y-m-d', strtotime("-$i days"));
            $open = $mins[(int)date('N', strtotime($d))] ?: 1440;
            $up[] = round(min(100, 100 * (int)($byDay[$d] ?? 0) / $open), 1);
        }
        return ['state' => $state, 'lastSeenAt' => Util::iso($k['last_seen_at']), 'ip' => $k['ip_last'], 'appBuild' => $k['app_build'],
            'dataVersion' => $k['data_version'], 'promosVersion' => $k['promos_version'], 'statusVersion' => $k['status_version'],
            'userAgent' => $k['user_agent'], 'perfActive' => $k['perf_active'], 'perfReason' => $k['perf_reason'],
            'swActive' => $k['sw_active'] === null ? null : (bool)(int)$k['sw_active'], 'screen' => $k['screen'],
            'uptimeSec' => $k['uptime_sec'] === null ? null : (int)$k['uptime_sec'], 'lastError' => $k['last_error'], 'uptime7d' => $up,
            'hasToken' => $k['token_hash'] !== null];
    }

    /** menit buka mall per hari (1..7) untuk persentase uptime */
    public static function openMinutesPerDay(): array
    {
        $h = Schedule::mallHours(); $o = [];
        for ($d = 1; $d <= 7; $d++) {
            $m = 0;
            foreach ($h[(string)$d] as $iv) { $a = Schedule::toMin($iv[0]); $b = Schedule::toMin($iv[1]); $m += $b > $a ? $b - $a : 1440 - $a + $b; }
            $o[$d] = $m;
        }
        return $o;
    }

    public static function token(array $p): void
    {
        $k = Db::one('SELECT * FROM kiosks WHERE id=?', [$p['id']]);
        if (!$k) throw ApiError::notFound('Kiosk');
        $tok = Util::b64url(random_bytes(32));
        Db::update('kiosks', ['token_hash' => hash('sha256', $tok), 'token_hint' => substr($tok, -4)], ['id' => $k['id']]);
        Audit::log('token', 'kiosk', $k['id'], 'token kiosk dibuat ulang (hint …' . substr($tok, -4) . ')');
        $base = Util::publicBaseUrl();
        $url = $base . '/?kiosk=' . rawurlencode($k['id']) . '&key=' . $tok;
        $bat = "@echo off\r\nREM Kiosk " . $k['id'] . " — dibuat " . date('Y-m-d H:i') . "\r\nset URL=" . str_replace('%', '%%', $url) . "\r\n"
            . "start \"\" \"C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe\" --kiosk \"%URL%\" --edge-kiosk-type=fullscreen --user-data-dir=C:\\bsb-kiosk\\edge --no-first-run --disable-pinch --overscroll-history-navigation=0\r\n";
        Http::ok(['token' => $tok, 'tokenHint' => substr($tok, -4), 'launchUrl' => $url, 'bat' => $bat, 'qrSvg' => Qr::svg($url)]);
    }

    public static function revoke(array $p): void
    {
        if (!Db::exec('UPDATE kiosks SET token_hash=NULL, token_hint=NULL WHERE id=?', [$p['id']]) && !Db::val('SELECT id FROM kiosks WHERE id=?', [$p['id']])) throw ApiError::notFound('Kiosk');
        Audit::log('token_revoke', 'kiosk', $p['id'], 'token kiosk dicabut');
        Http::ok(['revoked' => $p['id']]);
    }

    public static function command(array $p): void
    {
        $b = Http::body();
        $cmd = $b['cmd'] ?? $b['command'] ?? null;
        if (!in_array($cmd, ['reload', 'identify', 'clear_cache'], true)) throw ApiError::validation(['cmd' => 'one_of:reload|identify|clear_cache']);
        $ids = $p['id'] === '*' ? Db::col('SELECT id FROM kiosks WHERE is_active=1') : [$p['id']];
        $out = [];
        foreach ($ids as $kid) {
            if (!Db::val('SELECT id FROM kiosks WHERE id=?', [$kid])) throw ApiError::notFound('Kiosk');
            $id = Db::insert('kiosk_commands', ['kiosk_id' => $kid, 'command' => $cmd, 'payload' => isset($b['payload']) ? Util::jsonEncode($b['payload']) : null, 'created_by' => Auth::id()]);
            Audit::log('command', 'kiosk', $kid, "command $cmd (#$id)");
            $out[] = ['id' => $id, 'kioskId' => $kid, 'cmd' => $cmd];
        }
        Http::ok($p['id'] === '*' ? $out : $out[0], 201);
    }

    public static function commands(array $p): void
    {
        $rows = Db::all('SELECT * FROM kiosk_commands WHERE kiosk_id=? ORDER BY id DESC LIMIT 50', [$p['id']]);
        Http::json(['data' => array_map(fn($c) => ['id' => (int)$c['id'], 'cmd' => $c['command'], 'payload' => Util::jsonDecode($c['payload']), 'createdAt' => Util::iso($c['created_at']),
            'deliveredAt' => Util::iso($c['delivered_at']), 'ackedAt' => Util::iso($c['acked_at']), 'result' => $c['result']], $rows), 'total' => count($rows)]);
    }
}
