#!/usr/bin/env bash
# Weekly workspace archive (BRD section 16): tar.gz of every student workspace and the shared datasets,
# kept in <storage root>/archive, newest 4 retained (about one month). Run by the systemd timer cloudlab-backup.timer
# (Fridays 16:30 IST) or by hand:  sudo bash infra/azure/backup.sh
#
# STORAGE_ROOT is read from /etc/cloudlab/api.env (default /mnt/cloudlab). Override for a test:
#   STORAGE_ROOT=/tmp/x ARCHIVE_DIR=/tmp/y KEEP=4 bash backup.sh
set -euo pipefail

ENV_FILE="${ENV_FILE:-/etc/cloudlab/api.env}"
if [ -z "${STORAGE_ROOT:-}" ] && [ -r "$ENV_FILE" ]; then
  STORAGE_ROOT="$(grep -E '^STORAGE_ROOT=' "$ENV_FILE" | tail -n1 | cut -d= -f2- | tr -d '"' || true)"
fi
STORAGE_ROOT="${STORAGE_ROOT:-/mnt/cloudlab}"
ARCHIVE_DIR="${ARCHIVE_DIR:-$STORAGE_ROOT/archive}"
KEEP="${KEEP:-4}"
STAMP="$(TZ=Asia/Kolkata date +%Y-%m-%d_%H%M%S)"
OUT="$ARCHIVE_DIR/workspaces-$STAMP.tar.gz"

say() { echo "$(TZ=Asia/Kolkata date '+%F %T IST') backup: $*"; }

[ -d "$STORAGE_ROOT" ] || { say "storage root $STORAGE_ROOT does not exist"; exit 1; }
mkdir -p "$ARCHIVE_DIR"

# What goes in: every top-level folder except the archive itself.
mapfile -t ITEMS < <(cd "$STORAGE_ROOT" && find . -mindepth 1 -maxdepth 1 -not -name archive -printf '%f\n' | sort)
[ "${#ITEMS[@]}" -gt 0 ] || { say "nothing to archive in $STORAGE_ROOT"; exit 1; }

say "archiving ${ITEMS[*]} from $STORAGE_ROOT"
TMP="$OUT.partial"
# Files can change while we read them (a lab is running): tar exit code 1 means "changed while reading", which is fine.
set +e
tar -czf "$TMP" -C "$STORAGE_ROOT" "${ITEMS[@]}"
RC=$?
set -e
if [ "$RC" -gt 1 ]; then rm -f "$TMP"; say "tar failed with code $RC"; exit "$RC"; fi
tar -tzf "$TMP" >/dev/null   # the archive must be readable before an older one is deleted
mv "$TMP" "$OUT"
say "wrote $OUT ($(du -h "$OUT" | cut -f1))"

# Retention: keep the newest $KEEP archives.
mapfile -t OLD < <(ls -1t "$ARCHIVE_DIR"/workspaces-*.tar.gz 2>/dev/null | tail -n +"$((KEEP + 1))")
for f in "${OLD[@]}"; do [ -n "$f" ] && { rm -f -- "$f"; say "removed old archive $(basename "$f")"; }; done

echo "$STAMP $(basename "$OUT")" > "$ARCHIVE_DIR/LATEST.txt"
say "done. archives kept: $(ls -1 "$ARCHIVE_DIR"/workspaces-*.tar.gz | wc -l)"
