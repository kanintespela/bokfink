#!/bin/sh
# Lägger upp det Kontera behöver på en tom PocketBase-instans.
#
#   ./skapa-collections.sh http://127.0.0.1:8091 admin@exempel.se losenord
#
# Skapar collection "handelser" med ett unikt index på op_id, collection
# "filer" med ett unikt index på sha256, och en användare som appen loggar in
# som, med en inloggning som gäller i 30 dagar. Kör om utan risk: PocketBase avvisar det som redan finns.
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

echo "Skapar collection handelser ..."
curl -s -X POST "$URL/api/collections" \
  -H "Authorization: $TOKEN" -H 'Content-Type: application/json' -d '{
  "name": "handelser",
  "type": "base",
  "fields": [
    {"name":"op_id","type":"text","required":true,"max":36},
    {"name":"device","type":"text","required":true,"max":64},
    {"name":"payload","type":"text","required":true,"max":0},
    {"name":"created","type":"autodate","onCreate":true,"onUpdate":false}
  ],
  "indexes": ["CREATE UNIQUE INDEX idx_op_id ON handelser (op_id)"],
  "listRule": "@request.auth.id != \"\"",
  "viewRule": "@request.auth.id != \"\"",
  "createRule": "@request.auth.id != \"\"",
  "updateRule": null,
  "deleteRule": null
}' | head -c 200
echo

echo "Skapar collection filer ..."
curl -s -X POST "$URL/api/collections" \
  -H "Authorization: $TOKEN" -H 'Content-Type: application/json' -d '{
  "name": "filer",
  "type": "base",
  "fields": [
    {"name":"sha256","type":"text","required":true,"min":64,"max":64},
    {"name":"data","type":"file","required":true,"maxSize":10485760,"maxSelect":1},
    {"name":"created","type":"autodate","onCreate":true,"onUpdate":false}
  ],
  "indexes": ["CREATE UNIQUE INDEX idx_sha256 ON filer (sha256)"],
  "listRule": "@request.auth.id != \"\"",
  "viewRule": "@request.auth.id != \"\"",
  "createRule": "@request.auth.id != \"\"",
  "updateRule": null,
  "deleteRule": null
}' | head -c 200
echo

# PocketBase's default is a week. The app renews the login on every sync, so
# this is how long a device may lie unused before it has to log in again.
echo "Låter inloggningen gälla i 30 dagar ..."
curl -s -X PATCH "$URL/api/collections/users" \
  -H "Authorization: $TOKEN" -H 'Content-Type: application/json' \
  -d '{"authToken":{"duration":2592000}}' | head -c 200
echo

printf 'E-post för appens användare: '
read -r ANVANDARE
printf 'Lösenord: '
read -r ANVANDARLOSEN

curl -s -X POST "$URL/api/collections/users/records" \
  -H "Authorization: $TOKEN" -H 'Content-Type: application/json' \
  -d "{\"email\":\"$ANVANDARE\",\"password\":\"$ANVANDARLOSEN\",\"passwordConfirm\":\"$ANVANDARLOSEN\",\"verified\":true}" |
  head -c 200
echo
echo "Klart. Skriv in adressen och användaren i Kontera under Inställningar."
