#!/usr/bin/env bash
# release.sh — installs one release on the server and switches the site to it (run by GitHub Actions over SSH).
#   bash release.sh <release.tgz> <label>
# Layout under $BSB_BASE (default ~/bsb):
#   releases/<label>/   code of one release (from git archive)
#   shared/             everything the server writes or owns: config.local.php, live data, CMS media
#   current -> releases/<label>     the domain's document root points here
# A release only links to shared/, so a deploy never overwrites CMS data. Rollback: bash rollback.sh
set -euo pipefail
TGZ=$1; LABEL=$2
BASE=${BSB_BASE:-$HOME/bsb}; PHP=${BSB_PHP:-php}; KEEP=${BSB_KEEP:-5}
R=$BASE/releases/$LABEL; S=$BASE/shared
say() { printf '[release %s] %s\n' "$LABEL" "$*"; }

mkdir -p "$BASE/releases" "$S"
if ! mkdir "$BASE/.deploy.lock" 2>/dev/null; then echo "another deploy is running ($BASE/.deploy.lock)"; exit 1; fi
trap 'rmdir "$BASE/.deploy.lock" 2>/dev/null || true' EXIT
[ -f "$S/config.local.php" ] || { echo "missing $S/config.local.php (database credentials) — see docs/DEPLOY.md step 4"; exit 1; }
[ -e "$R" ] && { say "already installed, switching only"; } || { mkdir -p "$R.tmp" && tar -xzf "$TGZ" -C "$R.tmp" && mv "$R.tmp" "$R"; }

# files and folders owned by the server: first deploy seeds them from the release, later deploys only link them
# (media: files new in git, e.g. a new floor drawing, are added; files already on the server are never replaced)
for f in data/directory.json data/version.json data/status.json data/promos.json; do
  [ -e "$S/$f" ] || { mkdir -p "$(dirname "$S/$f")"; [ -f "$R/$f" ] && cp -p "$R/$f" "$S/$f" || true; }
done
for d in data/releases data/3d/edits media; do
  mkdir -p "$S/$d"
  [ -d "$R/$d" ] && cp -Rpn "$R/$d/." "$S/$d/" 2>/dev/null || true
done
link() { rm -rf "${R:?}/$1"; mkdir -p "$(dirname "$R/$1")"; ln -s "$S/$1" "$R/$1"; }
for p in config.local.php data/directory.json data/version.json data/status.json data/promos.json data/releases data/3d/edits media; do
  [ -e "$S/$p" ] && link "$p"
done

# checks before going live: PHP syntax, database reachable, live snapshot readable
say "checking"
find "$R" -path "$R/media" -prune -o -name '*.php' -print0 | xargs -0 -n 40 "$PHP" -l >/dev/null
( cd "$R" && "$PHP" -r 'require "lib/bootstrap.php"; Db::val("SELECT 1"); $d = json_decode((string)file_get_contents("data/directory.json"), true); if (!isset($d["meta"]["version"])) { fwrite(STDERR, "data/directory.json unreadable\n"); exit(1); } echo "db ok, live data ", $d["meta"]["version"], "\n";' )
for m in "$R"/db/migrate_*.sql; do
  [ -e "$m" ] || continue
  grep -qx "$(basename "$m")" "$S/.migrations-seen" 2>/dev/null || say "NOTE: new migration $(basename "$m") — review and run it by hand (docs/DEPLOY.md)"
done

# switch (atomic where the system allows it)
ln -sfn "$R" "$BASE/current.new"
mv -Tf "$BASE/current.new" "$BASE/current" 2>/dev/null || { rm -f "$BASE/current"; mv "$BASE/current.new" "$BASE/current"; }
say "live: $R"

# kiosks and phones still running the old app reload themselves when idle
BUILD=$(sed -n "s/^ *APP_BUILD: *'\([^']*\)'.*/\1/p" "$R/config.js" | head -1)
if [ -n "$BUILD" ]; then
  ( cd "$R" && "$PHP" -r 'require "lib/bootstrap.php"; Settings::set("kiosk.minAppBuild", $argv[1]); Publisher::writeVersionJson(); echo "kiosk.minAppBuild = ", $argv[1], "\n";' "$BUILD" ) || say "could not set kiosk.minAppBuild"
fi

# keep the last $KEEP releases
ls -1dt "$BASE"/releases/*/ 2>/dev/null | tail -n +"$((KEEP + 1))" | while read -r old; do
  [ "$(cd "$old" && pwd -P)" = "$(cd "$BASE/current" && pwd -P)" ] || rm -rf "$old"
done
rm -f "$TGZ"
say "done"
