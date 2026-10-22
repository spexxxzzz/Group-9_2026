#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."
count="${1:-}"
if [[ ! "$count" =~ ^([1-9]|10)$ ]]; then
  echo 'Usage: npm run tavus:keys -- <number-of-keys-1-to-10>' >&2
  exit 1
fi
if [[ ! -r /dev/tty ]]; then
  echo 'A terminal is required so key values can be entered without echoing them.' >&2
  exit 1
fi

name="$(sed -n 's/^name = "\([^"]*\)"$/\1/p' wrangler.toml | head -1)"
echo "Setting $count Tavus key slots for $name.app.space. Existing slots above $count are not deleted."
for ((slot=1; slot<=count; slot++)); do
  key=''
  read -r -s -p "Tavus key for slot $slot (hidden): " key </dev/tty || true
  printf '\n' >/dev/tty
  if [[ -z "$key" ]]; then
    echo "Slot $slot was empty; stopping without changing later slots." >&2
    exit 1
  fi
  printf '%s' "$key" | npx --yes deepspace@latest secrets set "TAVUS_API_KEY_$slot" --stdin
  unset key
done
echo 'Keys saved in the DeepSpace secret store. Deploy to apply them: npm run deploy:app'
