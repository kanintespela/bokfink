#!/bin/sh
# Skapar användaren som appen loggar in som.
#
#   ./skapa-anvandare.sh http://127.0.0.1:8091 admin@exempel.se losenord
#
# Samlingarna behöver inte skapas för hand: PocketBase lägger upp dem själv
# från pb_migrations/ när den startar. Kör om utan risk: PocketBase avvisar
# en användare som redan finns.
set -eu

URL="${1:?ange serverns adress}"
EPOST="${2:?ange administratörens e-post}"
LOSEN="${3:?ange administratörens lösenord}"

TOKEN=$(curl -sf -X POST "$URL/api/collections/_superusers/auth-with-password" \
  -H 'Content-Type: application/json' \
  -d "{\"identity\":\"$EPOST\",\"password\":\"$LOSEN\"}" |
  sed -n 's/.*"token":"\([^"]*\)".*/\1/p')

if [ -z "$TOKEN" ]; then
  echo "Kunde inte logga in som administratör." >&2
  exit 1
fi

printf 'E-post för appens användare: '
read -r ANVANDARE
printf 'Lösenord: '
read -r ANVANDARLOSEN

curl -s -X POST "$URL/api/collections/users/records" \
  -H "Authorization: $TOKEN" -H 'Content-Type: application/json' \
  -d "{\"email\":\"$ANVANDARE\",\"password\":\"$ANVANDARLOSEN\",\"passwordConfirm\":\"$ANVANDARLOSEN\",\"verified\":true}" |
  head -c 200
echo
echo "Klart. Öppna Synk i Bokfink och logga in med användaren."
