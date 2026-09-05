#!/usr/bin/env node
/**
 * Derive the Transifex source file from the content file.
 *
 * Only prose crosses this line. Image paths, ids and the Vimeo id stay behind
 * in content/home.en.json, so a translator cannot repoint an image and a
 * translation round trip cannot alter the page structure.
 *
 * The output is generated, never committed: Decap publishes straight to main,
 * so a committed copy would be stale within one edit. CI regenerates it before
 * pushing to Transifex.
 *
 *   node scripts/extract.mjs [--out i18n/home.en.json] [--stdout]
 */
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { readJson, walkTranslatable } from './lib/content.mjs'
import { unflatten } from './lib/flatten.mjs'
import { error, summary } from './lib/gh-summary.mjs'

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..'
)

export async function extract(contentPath) {
  const content = await readJson(contentPath)
  const flat = {}
  walkTranslatable(content, (keyPath, value) => {
    flat[keyPath.join('.')] = value
  })
  return { source: unflatten(flat), count: Object.keys(flat).length }
}

async function main() {
  const args = process.argv.slice(2)
  const toStdout = args.includes('--stdout')
  const outIndex = args.indexOf('--out')
  const outPath = path.resolve(
    repoRoot,
    outIndex === -1 ? 'i18n/home.en.json' : args[outIndex + 1]
  )
  const contentPath = path.join(repoRoot, 'content/home.en.json')

  const { source, count } = await extract(contentPath)
  const json = `${JSON.stringify(source, null, 2)}\n`

  if (toStdout) {
    process.stdout.write(json)
    return
  }

  await mkdir(path.dirname(outPath), { recursive: true })
  await writeFile(outPath, json)
  summary(
    `Extracted ${count} translatable strings to ${path.relative(repoRoot, outPath)}`
  )
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((problem) => {
    error(problem.message)
    process.exit(1)
  })
}
