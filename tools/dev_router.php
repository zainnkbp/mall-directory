<?php
/*
 * Router untuk server bawaan PHP (pengembangan lokal saja):
 *   php -S 127.0.0.1:8000 tools/dev_router.php
 * Meniru .htaccess produksi: /api/* → api/index.php, folder server (lib, db, tools, config) ditolak,
 * CSP untuk /cms/. HTML/JS/CSS/JSON dikirim no-store supaya browser tidak memakai versi lama saat mengedit.
 */
declare(strict_types=1);

$root = (string)realpath(dirname(__DIR__));
$path = rawurldecode((string)parse_url((string)($_SERVER['REQUEST_URI'] ?? '/'), PHP_URL_PATH));

if ($path === '/api' || str_starts_with($path, '/api/')) {
    $_SERVER['SCRIPT_NAME'] = $_SERVER['PHP_SELF'] = '/api/index.php';
    $_SERVER['SCRIPT_FILENAME'] = $root . '/api/index.php';
    chdir($root . '/api');
    require $root . '/api/index.php';
    return true;
}

$deny = static function (): bool { http_response_code(403); header('Content-Type: text/plain'); echo "Forbidden\n"; return true; };
if (preg_match('#(^|/)\.|^/(lib|db|tools|_handoff|tests)(/|$)#', $path)
    || preg_match('#(^|/)(config(\.local)?\.php|[^/]*\.sql|\.publish\.lock|\.cache\.json)$#', $path)
    || preg_match('#\.(php\d?|phtml|phar)$#i', $path)
    || preg_match('#^/media/.*\.json$#i', $path)) return $deny();

$file = realpath($root . $path);
if ($file !== false && is_dir($file)) $file = realpath($file . '/index.html');
// a deployed release links data/… and media/ to the shared folder (like Apache's SymLinksIfOwnerMatch): the request path
// must stay inside the root, the link target may be outside it
$inside = $file !== false && (str_starts_with($file, $root . DIRECTORY_SEPARATOR) || !preg_match('#(^|/)\.\.(/|$)#', $path));
if ($file === false || !$inside || !is_file($file)) {
    http_response_code(404); header('Content-Type: text/plain'); echo "Not found\n"; return true;
}

if (str_starts_with($path, '/cms/')) {
    header("Content-Security-Policy: default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-src 'self'");
    header('X-Frame-Options: DENY');
}
header('X-Content-Type-Options: nosniff');
header('Referrer-Policy: same-origin');

$types = ['html' => 'text/html; charset=utf-8', 'js' => 'text/javascript; charset=utf-8', 'mjs' => 'text/javascript; charset=utf-8',
    'css' => 'text/css; charset=utf-8', 'json' => 'application/json; charset=utf-8', 'webmanifest' => 'application/manifest+json',
    'svg' => 'image/svg+xml', 'png' => 'image/png', 'jpg' => 'image/jpeg', 'jpeg' => 'image/jpeg', 'webp' => 'image/webp', 'gif' => 'image/gif',
    'ico' => 'image/x-icon', 'woff2' => 'font/woff2', 'woff' => 'font/woff', 'ttf' => 'font/ttf', 'mp4' => 'video/mp4', 'txt' => 'text/plain; charset=utf-8'];
$ext = strtolower(pathinfo($file, PATHINFO_EXTENSION));
header('Content-Type: ' . ($types[$ext] ?? 'application/octet-stream'));
if (in_array($ext, ['html', 'js', 'mjs', 'css', 'json', 'webmanifest'], true)) header('Cache-Control: no-store');
if (str_starts_with($path, '/media/') && $ext === 'svg') header("Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'");
header('Content-Length: ' . filesize($file));
if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'HEAD') readfile($file);
return true;
