#!/usr/bin/env bash
# Publishes a finished build to the GitHub Pages repository.
#
# The Pages repository only ever holds the latest build, as one orphan commit
# that replaces the last: nobody needs the history of a build output, and it
# keeps the repository small. The source, and its history, stays here.
#
#   DEPLOY_KEY   private SSH key with write access to the Pages repository
#   PAGES_REPO   git URL of the Pages repository (default: the organisation's)
#   usage: publicera-pages.sh <dist-dir>
set -euo pipefail

dist="${1:?usage: publicera-pages.sh <dist-dir>}"
repo="${PAGES_REPO:-git@github.com:bokfinken-app/bokfinken-app.github.io.git}"
here="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [ -z "${DEPLOY_KEY:-}" ]; then
  echo "::notice::PAGES_DEPLOY_KEY is not set, so nothing is published."
  exit 0
fi

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

keyfile="$work/key"
install -m 600 /dev/null "$keyfile"
printf '%s\n' "$DEPLOY_KEY" > "$keyfile"

site="$work/site"
mkdir "$site"
cp -a "$dist"/. "$site"/
cp "$here/LICENSE" "$site/LICENSE"
cat > "$site/README.md" <<'README'
# Bokfink, publicerat bygge

Det här repot innehåller bara det färdiga bygget av Bokfink, som visas på
https://bokfinken-app.github.io. Det skrivs över vid varje publicering.

Källkoden, dokumentationen och historiken finns i
https://github.com/kanintespela/bokfink. Licens: MIT.
README
# The build has files GitHub's Jekyll would otherwise skip or rewrite.
touch "$site/.nojekyll"

cd "$site"
git init -q -b main
git config user.name "bokfink-ci"
git config user.email "noreply@users.noreply.github.com"
git add -A
git commit -q -m "Build of ${GITHUB_SHA:-unknown}"
GIT_SSH_COMMAND="ssh -i $keyfile -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new" \
  git push -q --force "$repo" main
echo "Published ${GITHUB_SHA:-a local build}."
