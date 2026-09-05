import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

import { buildAssets, collectImagePaths, fingerprint } from '../lib/images.mjs'
import { makeValidator, schemaProblems } from '../validate.mjs'
import { readJson } from '../lib/content.mjs'

const run = promisify(execFile)
const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../..'
)

test('the seeded content satisfies the published schema', async () => {
  const validate = await makeValidator()
  const content = await readJson(path.join(repoRoot, 'content/home.en.json'))
  assert.deepEqual(schemaProblems(validate, content, 'content'), [])
})

test('the schema refuses a variant that belongs to a different section type', async () => {
  const validate = await makeValidator()
  const content = await readJson(path.join(repoRoot, 'content/home.en.json'))

  const wrongVariant = structuredClone(content)
  // `cards` is a feature-list variant; the audience selector has no such thing.
  wrongVariant.sections[0].variant = 'cards'
  assert.ok(schemaProblems(validate, wrongVariant, 'x').length > 0)
})

test('the schema rejects a field nobody declared', async () => {
  const validate = await makeValidator()
  const content = await readJson(path.join(repoRoot, 'content/home.en.json'))

  const extra = structuredClone(content)
  extra.page.subtitle = 'not in the catalogue'
  assert.ok(schemaProblems(validate, extra, 'x').length > 0)
})

test('the schema rejects an unknown section type', async () => {
  const validate = await makeValidator()
  const content = await readJson(path.join(repoRoot, 'content/home.en.json'))

  const unknown = structuredClone(content)
  unknown.sections[0].type = 'carousel'
  assert.ok(schemaProblems(validate, unknown, 'x').length > 0)
})

test('image paths are collected from icons and backgrounds only', async () => {
  const content = await readJson(path.join(repoRoot, 'content/home.en.json'))
  const paths = [...collectImagePaths(content)]
  assert.ok(paths.length > 0)
  assert.ok(paths.every((p) => p.startsWith('images/')))
})

test('a fingerprint depends only on the bytes', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'orcid-assets-'))
  await writeFile(path.join(dir, 'a.png'), 'same bytes')
  await writeFile(path.join(dir, 'b.png'), 'same bytes')
  await writeFile(path.join(dir, 'c.png'), 'other bytes')

  const first = await fingerprint(path.join(dir, 'a.png'))
  assert.match(first, /^[0-9a-f]{10}$/)
  assert.equal(first, await fingerprint(path.join(dir, 'b.png')))
  assert.notEqual(first, await fingerprint(path.join(dir, 'c.png')))
})

test('one image referenced many times is copied once', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'orcid-assets-'))
  const source = path.join(dir, 'src')
  const out = path.join(dir, 'out')
  await mkdir(source, { recursive: true })
  await writeFile(path.join(source, 'shared.png'), 'bytes')

  // The live page uses the same background on all six tabs.
  const { rewrites, missing } = await buildAssets(
    {
      audiences: Array.from({ length: 6 }, () => ({
        background: 'images/shared.png',
      })),
    },
    source,
    out
  )

  assert.deepEqual(missing, [])
  assert.equal(rewrites.size, 1)
  assert.deepEqual(await readdir(path.join(out, 'assets')), [
    `shared-${await fingerprint(path.join(source, 'shared.png'))}.png`,
  ])
})

test('a referenced image that is not on disk is reported, not skipped', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'orcid-assets-'))
  const source = path.join(dir, 'src')
  await mkdir(source, { recursive: true })

  const { missing } = await buildAssets(
    { hero: { background: 'images/nope.png' } },
    source,
    path.join(dir, 'out')
  )
  assert.deepEqual(missing, ['images/nope.png'])
})

test('a full build writes one document per locale, fingerprinted and stamped', async () => {
  const out = await mkdtemp(path.join(tmpdir(), 'orcid-build-'))
  await run(
    'node',
    ['scripts/build.mjs', '--version', 'test-1', '--out', out],
    {
      cwd: repoRoot,
    }
  )

  const version = JSON.parse(
    await readFile(path.join(out, 'version.json'), 'utf8')
  )
  assert.equal(version.version, 'test-1')
  assert.ok(version.locales.includes('en'))

  const files = await readdir(path.join(out, 'content'))
  const documents = files.filter((f) => f.endsWith('.json'))
  assert.equal(documents.length, version.locales.length)

  const english = JSON.parse(
    await readFile(path.join(out, 'content/home.en.json'), 'utf8')
  )
  assert.equal(english.meta.version, 'test-1')
  assert.equal(english.meta.locale, 'en')
  assert.equal(english.meta.translated, english.meta.total)
  assert.match(
    english.sections[0].audiences[0].features[0].icon.src,
    /^assets\/.+-[0-9a-f]{10}\./
  )

  // The admin ships with the un-fingerprinted source so the editor writes back
  // the same image paths a maintainer sees in the repository.
  const seed = JSON.parse(
    await readFile(path.join(out, 'admin/seed/home.en.json'), 'utf8')
  )
  assert.match(seed.sections[0].audiences[0].features[0].icon.src, /^images\//)
  assert.equal(seed.meta, undefined)
})

test('a translated build keeps structure English-free of drift', async () => {
  const out = await mkdtemp(path.join(tmpdir(), 'orcid-build-'))
  await run('node', ['scripts/build.mjs', '--out', out], { cwd: repoRoot })

  const english = JSON.parse(
    await readFile(path.join(out, 'content/home.en.json'), 'utf8')
  )
  const czech = JSON.parse(
    await readFile(path.join(out, 'content/home.cs.json'), 'utf8')
  )

  assert.notEqual(czech.page.title, english.page.title)
  assert.equal(czech.sections.length, english.sections.length)
  assert.deepEqual(
    czech.sections.map((s) => s.id),
    english.sections.map((s) => s.id)
  )
  // Structure is identical in every language: same types, same variants, same
  // images. Only the words differ.
  assert.deepEqual(
    czech.sections.map((s) => `${s.type}/${s.variant}`),
    english.sections.map((s) => `${s.type}/${s.variant}`)
  )
  assert.equal(
    czech.sections[0].audiences[0].features[0].icon.src,
    english.sections[0].audiences[0].features[0].icon.src
  )
})
