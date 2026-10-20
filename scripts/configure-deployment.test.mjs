import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const project = join(dirname(fileURLToPath(import.meta.url)), '..')

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'dialogue-deploy-test-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  mkdirSync(join(root, 'scripts'))
  mkdirSync(join(root, 'src'))
  for (const path of ['scripts/configure-deployment.mjs', 'src/constants.ts', 'wrangler.toml']) {
    copyFileSync(join(project, path), join(root, path))
  }
  return root
}

test('a fresh clone gets a new name but keeps its original ID only until init', (t) => {
  const root = fixture(t)
  const script = join(root, 'scripts/configure-deployment.mjs')
  const run = () => execFileSync(process.execPath, [script, 'my-dialogue-demo'], { encoding: 'utf8' }).trim()
  assert.equal(run(), 'fork')
  assert.match(readFileSync(join(root, 'wrangler.toml'), 'utf8'), /^name = "my-dialogue-demo"$/m)
  assert.match(readFileSync(join(root, 'wrangler.toml'), 'utf8'), /^APP_NAME = "my-dialogue-demo"$/m)
  assert.match(readFileSync(join(root, 'src/constants.ts'), 'utf8'), /APP_NAME = 'my-dialogue-demo'/)
  assert.equal(run(), 'fork') // recovery after an interrupted setup, before app init

  const wranglerPath = join(root, 'wrangler.toml')
  writeFileSync(wranglerPath, readFileSync(wranglerPath, 'utf8').replace(
    /DEEPSPACE_APP_ID = "[^"]+"/,
    'DEEPSPACE_APP_ID = "app_01TESTFORK0000000000000000"',
  ))
  assert.equal(run(), 'ready')
})

test('refuses the original production name and a different existing target', (t) => {
  const root = fixture(t)
  const script = join(root, 'scripts/configure-deployment.mjs')
  const attempt = (name) => spawnSync(process.execPath, [script, name], { encoding: 'utf8' })
  assert.notEqual(attempt('dialogue-interview-neel').status, 0)
  assert.notEqual(attempt('BAD-NAME').status, 0)
  assert.equal(attempt('first-copy').status, 0)
  assert.notEqual(attempt('second-copy').status, 0)
})
