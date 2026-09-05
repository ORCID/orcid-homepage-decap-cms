#!/usr/bin/env node
/**
 * Turn the edited source plus the translated strings into the bundle that the
 * Angular app fetches.
 *
 * One file per locale, images content-addressed, and a version.json that the
 * post-deploy check polls. Every output document is self-describing: it carries
 * the schema version the renderer checks and a `meta` block saying which
 * release it came from and how much of it is actually translated.
 *
 *   node scripts/build.mjs [--version v0.1.0] [--out dist] [--strict]
 */
import { execFileSync } from 'node:child_process'
import { cp, mkdir, readdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { mapTranslatable, readJson, translatableKeys } from './lib/content.mjs'
import { flatten } from './lib/flatten.mjs'
import { buildAssets, rewriteImagePaths } from './lib/images.mjs'
import { failWith, summary, warn } from './lib/gh-summary.mjs'

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..'
)

function argValue(args, name, fallback) {
  const index = args.indexOf(name)
  return index === -1 ? fallback : args[index + 1]
}

function currentCommit() {
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
  } catch {
    return 'unknown'
  }
}

/** Locales are whatever translation files exist, so adding one is adding a file. */
async function discoverLocales() {
  const entries = await readdir(path.join(repoRoot, 'i18n')).catch(() => [])
  return entries
    .filter((n) => /^home\.[\w-]+\.json$/.test(n) && n !== 'home.en.json')
    .map((n) => n.slice('home.'.length, -'.json'.length))
    .sort()
}

async function main() {
  const args = process.argv.slice(2)
  const strict = args.includes('--strict')
  const version = argValue(args, '--version', `dev-${currentCommit()}`)
  const outDir = path.resolve(repoRoot, argValue(args, '--out', 'dist'))
  const contentOut = path.join(outDir, 'content')

  const content = await readJson(path.join(repoRoot, 'content/home.en.json'))
  const englishKeys = translatableKeys(content)
  const generatedAt = new Date().toISOString()
  const commit = currentCommit()

  await rm(outDir, { recursive: true, force: true })
  await mkdir(contentOut, { recursive: true })

  const { rewrites, missing } = await buildAssets(
    content,
    path.join(repoRoot, 'content/images'),
    contentOut
  )
  if (missing.length > 0) {
    failWith(
      'Referenced images are missing from content/images/',
      missing.map((m) => `${m} (add the file, or fix the reference)`)
    )
  }

  const structure = rewriteImagePaths(content, rewrites)
  const locales = await discoverLocales()
  const rows = []

  for (const locale of ['en', ...locales]) {
    let translated = englishKeys.length
    let document = structure

    if (locale !== 'en') {
      const strings = flatten(
        await readJson(path.join(repoRoot, `i18n/home.${locale}.json`))
      )
      translated = 0
      // Per key, not per file: a locale that is 90% translated shows 90% of the
      // page in its own language rather than falling back wholesale to English.
      document = mapTranslatable(structure, (keyPath) => {
        const value = strings[keyPath.join('.')]
        if (typeof value === 'string' && value.trim() !== '') {
          translated += 1
          return value
        }
        return undefined
      })
    }

    const output = {
      ...document,
      meta: {
        locale,
        version,
        commit,
        generatedAt,
        translated,
        total: englishKeys.length,
      },
    }

    await writeFile(
      path.join(contentOut, `home.${locale}.json`),
      `${JSON.stringify(output, null, 2)}\n`
    )
    rows.push({ locale, translated, total: englishKeys.length })

    if (translated < englishKeys.length) {
      const message = `home.${locale}.json falls back to English for ${englishKeys.length - translated} of ${englishKeys.length} strings`
      if (strict) failWith('Incomplete translations', [message])
      warn(message)
    }
  }

  await writeFile(
    path.join(outDir, 'version.json'),
    `${JSON.stringify({ version, commit, generatedAt, schemaVersion: content.schemaVersion, locales: ['en', ...locales] }, null, 2)}\n`
  )

  // The editor runs entirely in the browser against a seeded copy of the
  // source, so the admin needs the un-fingerprinted document plus a map to the
  // published image URLs.
  const adminOut = path.join(outDir, 'admin')
  await cp(path.join(repoRoot, 'admin'), adminOut, { recursive: true })
  await mkdir(path.join(adminOut, 'seed'), { recursive: true })
  await writeFile(
    path.join(adminOut, 'seed/home.en.json'),
    `${JSON.stringify(content, null, 2)}\n`
  )
  await writeFile(
    path.join(adminOut, 'seed/assets.json'),
    `${JSON.stringify(Object.fromEntries(rewrites), null, 2)}\n`
  )

  await writeFile(path.join(outDir, 'index.html'), indexPage(version, rows))

  summary(
    [
      `### Homepage content \`${version}\``,
      '',
      '| Locale | Translated | Total |',
      '| --- | ---: | ---: |',
      ...rows.map((r) => `| ${r.locale} | ${r.translated} | ${r.total} |`),
      '',
      `${rewrites.size} images fingerprinted into \`content/assets/\`.`,
    ].join('\n')
  )
}

function indexPage(version, rows) {
  const items = rows
    .map(
      (r) =>
        `      <li><a href="content/home.${r.locale}.json">home.${r.locale}.json</a> <span>${r.translated}/${r.total}</span></li>`
    )
    .join('\n')

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="robots" content="noindex" />
    <title>ORCID homepage content ${version}</title>
    <style>
      body { font: 16px/1.5 system-ui, sans-serif; margin: 2rem auto; max-width: 44rem; padding: 0 1rem; color: #2e3d49; }
      a { color: #006a75; }
      ul { list-style: none; padding: 0; }
      li { display: flex; justify-content: space-between; border-bottom: 1px solid #e8ecef; padding: .35rem 0; }
      span { color: #6b7b86; }
    </style>
  </head>
  <body>
    <h1>ORCID homepage content</h1>
    <p>Version <code>${version}</code>. This bundle is fetched at runtime by the ORCID registry front end.</p>
    <p><a href="admin/">Open the content editor</a> &middot; <a href="version.json">version.json</a></p>
    <h2>Locales</h2>
    <ul>
${items}
    </ul>
  </body>
</html>
`
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((problem) => failWith('Build failed', [problem.message]))
}
