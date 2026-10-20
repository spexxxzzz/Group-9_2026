#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."
if [[ ${1:-} == --help || ${1:-} == -h ]]; then
  echo 'Usage: npm run setup:deploy -- <new-app-name>'
  echo 'Run this from a fresh clone to create an independent <new-app-name>.app.space deployment.'
  exit 0
fi
if [[ $# -ne 1 ]]; then
  echo 'Usage: npm run setup:deploy -- <new-app-name>' >&2
  exit 1
fi

node -e 'const [major, minor] = process.versions.node.split(".").map(Number); if (major < 22 || (major === 22 && minor < 15)) { console.error("Node.js 22.15 or newer is required."); process.exit(1) }'
for key in DEEPSPACE_ENV DEEPSPACE_DEPLOY_URL DEEPSPACE_AUTH_URL DEEPSPACE_API_URL DEEPSPACE_PLATFORM_URL; do
  if [[ "$key" == DEEPSPACE_ENV && -n "${!key:-}" && "${!key}" != production ]] ||
     [[ "$key" != DEEPSPACE_ENV && -n "${!key:-}" ]]; then
    echo "Unset $key before a production deployment." >&2
    exit 1
  fi
done

npm ci
cli=(npx --yes deepspace@latest)
if ! "${cli[@]}" auth whoami --json >/dev/null 2>&1; then
  echo 'Sign in to your DeepSpace account in the browser.'
  "${cli[@]}" auth login
fi

state="$(node scripts/configure-deployment.mjs "$1")"
if [[ "$state" == fork ]]; then
  echo 'Creating an independent DeepSpace app ID. The original app is untouched.'
  "${cli[@]}" app init --new-id
elif [[ "$state" != ready ]]; then
  echo 'Unexpected setup state; refusing to deploy.' >&2
  exit 1
fi

if [[ ! -r /dev/tty ]]; then
  echo 'A terminal is required to enter the Tavus and Gemini keys securely.' >&2
  exit 1
fi

for key in TAVUS_API_KEY GOOGLE_GENERATIVE_AI_API_KEY; do
  secret=''
  read -r -s -p "Enter $key (input hidden): " secret </dev/tty || true
  printf '\n' >/dev/tty
  if [[ -z "$secret" ]]; then
    echo "$key cannot be empty; no deployment was made." >&2
    exit 1
  fi
  printf '%s' "$secret" | "${cli[@]}" secrets set "$key" --stdin
  unset secret
done

"${cli[@]}" secrets list --only-names
"${cli[@]}" deploy
echo "Your independent app is at https://$1.app.space"
