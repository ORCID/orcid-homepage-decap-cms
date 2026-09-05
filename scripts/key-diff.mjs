#!/usr/bin/env node
/**
 * Report which translation keys a change adds or removes.
 *
 * Renaming an item's `id` is invisible in a content diff but discards every
 * translation of that item, because the id *is* the translation key. This turns
 * that into something a reviewer sees on the pull request before merging.
 *
 *   node scripts/key-diff.mjs --before <path to the previous content file>
 */
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { readJson, translatableKeys } from './lib/content.mjs'
import { error, summary, warn } from './lib/gh-summary.mjs'

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..'
)

function list(title, keys) {
  if (keys.length === 0) return `${title}: none.`
  return `${title} (${keys.length}):\n${keys.map((k) => `- \`${k}\``).join('\n')}`
}

async function main() {
  const args = process.argv.slice(2)
  const beforeIndex = args.indexOf('--before')
  if (beforeIndex === -1) {
    throw new Error('usage: key-diff.mjs --before <file>')
  }

  const before = new Set(
    translatableKeys(await readJson(path.resolve(args[beforeIndex + 1])))
  )
  const after = new Set(
    translatableKeys(
      await readJson(path.join(repoRoot, 'content/home.en.json'))
    )
  )

  const added = [...after].filter((key) => !before.has(key))
  const removed = [...before].filter((key) => !after.has(key))

  summary(
    [
      '### Translation keys',
      '',
      list('Added', added),
      '',
      list('Removed', removed),
      removed.length > 0
        ? '\nRemoving a key discards every existing translation of it. That is expected when text is deleted, and a mistake when an ID was renamed.'
        : '',
    ].join('\n')
  )

  if (removed.length > 0) {
    warn(
      `${removed.length} translation keys are removed by this change: ${removed.join(', ')}`
    )
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((problem) => {
    error(problem.message)
    process.exit(1)
  })
}
