#!/bin/sh
# Puts the newest green build of main in place, if it is not already.
#
#   ./uppdatera.sh            (run by kontera-uppdatera.timer)
#
# "Green" means the whole CI run - verify, end-to-end and documentation -
# not only the job that built it. A red run is skipped, and the version in
# place keeps being served until a green one comes along.
#
# Each build gets its own directory under releases/, named by commit, and
# `current` is switched to it with a rename, which is atomic: servera.mjs
# never sees a half-unpacked version.
set -eu

DRIFT="${KONTERA_DRIFT:-$HOME/kontera-drift}"
REPO="${KONTERA_REPO:-kanintespela/bokfink}"

mkdir -p "$DRIFT/releases"

RAD=$(gh run list -R "$REPO" --workflow ci.yml --branch main --event push \
  --status success --limit 1 --json databaseId,headSha \
  --jq '.[0] | "\(.databaseId) \(.headSha)"')

if [ -z "$RAD" ]; then
  echo "Inget grönt bygge av main hittades."
  exit 0
fi
KORNING=${RAD% *}
SHA=${RAD#* }

NUVARANDE=$(basename "$(readlink "$DRIFT/current" 2>/dev/null || echo ingen)")
if [ "$NUVARANDE" = "$SHA" ]; then
  exit 0
fi

TILLFALLIG="$DRIFT/releases/.$SHA"
rm -rf "$TILLFALLIG"
gh run download "$KORNING" -R "$REPO" -n kontera-dist -D "$TILLFALLIG"

# An artifact without these is not an app, whatever CI thought of it.
for FIL in index.html sw.js manifest.webmanifest; do
  if [ ! -f "$TILLFALLIG/$FIL" ]; then
    echo "Bygget från $SHA saknar $FIL. Behåller $NUVARANDE." >&2
    rm -rf "$TILLFALLIG"
    exit 1
  fi
done

rm -rf "$DRIFT/releases/$SHA"
mv "$TILLFALLIG" "$DRIFT/releases/$SHA"
ln -sfn "releases/$SHA" "$DRIFT/current.ny"
mv -T "$DRIFT/current.ny" "$DRIFT/current"
echo "Kontera $SHA är i drift (tidigare $NUVARANDE)."

# The three newest are kept, so going back is a symlink away.
cd "$DRIFT/releases"
ls -1t | tail -n +4 | while read -r GAMMAL; do
  rm -rf -- "./$GAMMAL"
done
