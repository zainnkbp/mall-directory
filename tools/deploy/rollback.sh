#!/usr/bin/env bash
# rollback.sh — switch the site back to the previous release (or to a given one): bash rollback.sh [label]
set -euo pipefail
BASE=${BSB_BASE:-$HOME/bsb}
cur=$(basename "$(cd "$BASE/current" && pwd -P)")
if [ $# -ge 1 ]; then to=$1; else to=$(ls -1t "$BASE/releases" | grep -vx "$cur" | head -1); fi
[ -n "$to" ] && [ -d "$BASE/releases/$to" ] || { echo "no release to roll back to"; ls -1t "$BASE/releases"; exit 1; }
ln -sfn "$BASE/releases/$to" "$BASE/current.new"
mv -Tf "$BASE/current.new" "$BASE/current" 2>/dev/null || { rm -f "$BASE/current"; mv "$BASE/current.new" "$BASE/current"; }
echo "live: $to (was $cur). Data in shared/ is untouched."
