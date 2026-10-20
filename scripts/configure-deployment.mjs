#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const name = process.argv[2]
const sourceName = 'dialogue-interview-neel'
const sourceId = 'app_01M1GCVCAHVQW1PKV5VGKBN1CS'

function fail(message) {
  console.error(message)
  process.exit(1)
}

if (!name || !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])$/.test(name) || name.includes('--')) {
  fail('Choose a lowercase app name of 2–63 characters, using letters, numbers, and single hyphens.')
}
if (name === sourceName) fail('Choose a new name; the existing production name is reserved for the original app.')

const wranglerPath = join(root, 'wrangler.toml')
const constantsPath = join(root, 'src/constants.ts')
const wrangler = readFileSync(wranglerPath, 'utf8')
const constants = readFileSync(constantsPath, 'utf8')
const currentName = wrangler.match(/^name = "([^"]+)"$/m)?.[1]
const appName = wrangler.match(/^APP_NAME = "([^"]+)"$/m)?.[1]
const appId = wrangler.match(/^DEEPSPACE_APP_ID = "([^"]+)"$/m)?.[1]
const constantName = constants.match(/^export const APP_NAME = '([^']+)'$/m)?.[1]

if (!currentName || !appName || !appId || !constantName) fail('Could not find the expected app identity fields.')
if (currentName !== appName || currentName !== constantName) fail('App names disagree between wrangler.toml and src/constants.ts.')
if (currentName !== sourceName && currentName !== name) {
  fail(`This checkout already targets "${currentName}". Refusing to repoint an existing app.`)
}
if (currentName === sourceName && appId !== sourceId) {
  fail('This checkout has a different app ID. Refusing to rename an existing deployment.')
}

if (currentName === sourceName) {
  writeFileSync(wranglerPath, wrangler
    .replace(/^name = "[^"]+"$/m, `name = "${name}"`)
    .replace(/^APP_NAME = "[^"]+"$/m, `APP_NAME = "${name}"`))
  writeFileSync(constantsPath, constants.replace(
    /^export const APP_NAME = '[^']+'$/m,
    `export const APP_NAME = '${name}'`,
  ))
}

// The shell script forks the immutable ID before uploading secrets or deploying.
console.log(appId === sourceId ? 'fork' : 'ready')
