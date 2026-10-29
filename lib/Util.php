<?php
declare(strict_types=1);

final class Util
{
    /** DATETIME lokal WITA → ISO 8601 +08:00 */
    public static function iso($dt): ?string
    {
        if ($dt === null || $dt === '') return null;
        $t = strtotime((string)$dt);
        return $t === false ? null : date('Y-m-d\TH:i:sP', $t);
    }
    public static function nowIso(): string { return date('Y-m-d\TH:i:sP'); }
    public static function now(): string { return date('Y-m-d H:i:s'); }

    /** ISO / 'Y-m-d H:i[:s]' → DATETIME lokal WITA; null bila kosong; throw bila invalid. */
    public static function toDb($v, string $field = 'datetime'): ?string
    {
        if ($v === null || $v === '') return null;
        $t = strtotime((string)$v);
        if ($t === false) throw ApiError::validation([$field => 'invalid_datetime']);
        return date('Y-m-d H:i:s', $t);
    }

    public static function slug(string $s): string
    {
        $s = strtolower(trim($s));
        $s = str_replace(['&', '+', "'", '’'], ['and', 'plus', '', ''], $s);
        $s = preg_replace('/[^a-z0-9]+/', '-', $s) ?? '';
        return trim($s, '-') ?: 'item';
    }

    public static function camel(string $snake): string
    {
        return lcfirst(str_replace(' ', '', ucwords(str_replace('_', ' ', $snake))));
    }

    public static function r2($v): ?float { return $v === null ? null : round((float)$v, 2); }

    public static function hhmm(?string $t): ?string { return $t === null ? null : substr($t, 0, 5); }

    public static function jsonEncode($v, bool $pretty = false): string
    {
        $f = JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRESERVE_ZERO_FRACTION;
        if ($pretty) $f |= JSON_PRETTY_PRINT;
        return json_encode($v, $f | JSON_THROW_ON_ERROR);
    }

    public static function jsonDecode(?string $s, $default = null)
    {
        if ($s === null || $s === '') return $default;
        $d = json_decode($s, true);
        return json_last_error() === JSON_ERROR_NONE ? $d : $default;
    }

    /** Tulis file secara atomik (tmp + rename) dengan izin dev yang ramah Apache/CLI. */
    public static function atomicWrite(string $path, string $content): void
    {
        $dir = dirname($path);
        self::ensureDir($dir);
        $tmp = $path . '.tmp' . getmypid() . bin2hex(random_bytes(3));
        if (file_put_contents($tmp, $content) === false) throw new ApiError('server', 'Gagal menulis ' . basename($path));
        @chmod($tmp, (int)Config::get('fileMode', 0664));
        if (!rename($tmp, $path)) { @unlink($tmp); throw new ApiError('server', 'Gagal rename ' . basename($path)); }
    }

    /** File sementara privat (data/.tmp, diblokir web oleh aturan dotfile) — sys temp dir belum tentu bisa ditulis Apache. */
    public static function tmpFile(string $suffix = ''): string
    {
        $dir = APP_ROOT . '/data/.tmp';
        self::ensureDir($dir);
        return $dir . '/' . bin2hex(random_bytes(8)) . $suffix;
    }

    public static function ensureDir(string $dir): void
    {
        if (!is_dir($dir)) {
            $old = umask(0);
            @mkdir($dir, (int)Config::get('dirMode', 0775), true);
            umask($old);
        }
        if (!is_dir($dir)) throw new ApiError('server', 'Tidak bisa membuat folder ' . $dir);
    }

    public static function ipInCidr(string $ip, string $cidr): bool
    {
        if (!str_contains($cidr, '/')) $cidr .= str_contains($cidr, ':') ? '/128' : '/32';
        [$net, $bits] = explode('/', $cidr, 2);
        $ipb = @inet_pton($ip); $netb = @inet_pton($net);
        if ($ipb === false || $netb === false || strlen($ipb) !== strlen($netb)) return false;
        $bits = (int)$bits; $bytes = intdiv($bits, 8); $rem = $bits % 8;
        if (substr($ipb, 0, $bytes) !== substr($netb, 0, $bytes)) return false;
        if ($rem === 0) return true;
        $mask = chr((0xFF << (8 - $rem)) & 0xFF);
        return (($ipb[$bytes] & $mask) === ($netb[$bytes] & $mask));
    }

    public static function b64url(string $bin): string { return rtrim(strtr(base64_encode($bin), '+/', '-_'), '='); }

    public static function bool($v): bool
    {
        if (is_bool($v)) return $v;
        if (is_string($v)) return in_array(strtolower($v), ['1', 'true', 'yes', 'on'], true);
        return (bool)$v;
    }

    public static function appBasePath(): string
    {
        // /bsb-directory/api/index.php → /bsb-directory
        $sn = (string)($_SERVER['SCRIPT_NAME'] ?? '/bsb-directory/api/index.php');
        $d = str_replace('\\', '/', dirname(dirname($sn)));
        return ($d === '/' || $d === '.') ? '' : rtrim($d, '/');
    }

    /**
     * Public address of the app (kiosk launch links). Setting public.baseUrl when it is a public host; while it is still
     * localhost / a LAN IP (the default) the address this request came in on, so a fresh hosting needs no setting.
     */
    public static function publicBaseUrl(): string
    {
        $set = rtrim((string)Settings::get('public.baseUrl', ''), '/');
        $host = strtolower((string)parse_url($set, PHP_URL_HOST));
        $local = $host === '' || $host === 'localhost' || str_ends_with($host, '.local') || filter_var($host, FILTER_VALIDATE_IP);
        $reqHost = (string)($_SERVER['HTTP_HOST'] ?? '');
        if (!$local || !preg_match('/^[a-z0-9.-]+(:\d+)?$/i', $reqHost)) return $set !== '' ? $set : 'http://localhost/bsb-directory';
        $https = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') || (($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https' && Config::get('trustProxy'));
        return ($https ? 'https' : 'http') . '://' . $reqHost . self::appBasePath();
    }
}
