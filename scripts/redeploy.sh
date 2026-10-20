#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."
node -e 'const [major, minor] = process.versions.node.split(".").map(Number); if (major < 22 || (major === 22 && minor < 15)) { console.error("Node.js 22.15 or newer is required."); process.exit(1) }'
if [[ -n "${DEEPSPACE_ENV:-}" && "$DEEPSPACE_ENV" != production ]]; then
  echo 'Unset DEEPSPACE_ENV before a production deployment.' >&2
  exit 1
fi
for key in DEEPSPACE_DEPLOY_URL DEEPSPACE_AUTH_URL DEEPSPACE_API_URL DEEPSPACE_PLATFORM_URL; do
  if [[ -n "${!key:-}" ]]; then
    echo "Unset $key before a production deployment." >&2
    exit 1
  fi
done

name="$(sed -n 's/^name = "\([^"]*\)"$/\1/p' wrangler.toml | head -1)"
app_id="$(sed -n 's/^DEEPSPACE_APP_ID = "\([^"]*\)"$/\1/p' wrangler.toml | head -1)"
if [[ -z "$name" || -z "$app_id" ]]; then
  echo 'App identity is missing from wrangler.toml.' >&2
  exit 1
fi
if [[ "$name" == dialogue-interview-neel && "${1:-}" != --confirm-production ]]; then
  echo 'This checkout targets the original production app. To deploy it intentionally, run npm run deploy:app -- --confirm-production.' >&2
  exit 1
fi
if [[ $# -gt 1 || ( $# -eq 1 && "${1:-}" != --confirm-production ) ]]; then
  echo 'Usage: npm run deploy:app [-- --confirm-production]' >&2
  exit 1
fi
echo "Deploy target: $name.app.space ($app_id)"
npm ci
npx --yes deepspace@latest deploy
