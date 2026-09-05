#!/usr/bin/env node
/**
 * Apply a content proposal that arrived as a GitHub issue.
 *
 * The issue body is written by whoever opened the issue, so it is treated as
 * data throughout: it is parsed as JSON, applied as a merge patch, and then
 * handed to the ordinary validator. Nothing in it is executed, and a proposal
 * that fails validation never reaches a branch.
 *
 *   node scripts/apply-proposal.mjs --issue-body body.md [--out report.md]
 */
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { apply } from '../admin/merge-patch.js'
import { readJson } from './lib/content.mjs'
import { error, output, summary } from './lib/gh-summary.mjs'

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..'
)

/**
 * Pull the change out of an issue-form body.
 *
 * GitHub renders an issue form as markdown headings followed by the answers, so
 * the patch arrives inside a fenced block under its own heading. A hand-written
 * issue may be just the JSON, which is accepted too.
 */
export function extractPatch(body) {
  const fenced = [...body.matchAll(/```(?:json)?\s*\n([\s\S]*?)```/g)].map(
    (match) => match[1].trim()
  )

  const candidates = [...fenced, body.trim()]
  for (const candidate of candidates) {
    if (!candidate.startsWith('{')) continue
    try {
      const parsed = JSON.parse(candidate)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed
      }
    } catch {
      // Try the next candidate; the body may hold other fenced blocks.
    }
  }

  throw new Error(
    'No change found in the issue. It should contain a JSON object, normally written by the content editor.'
  )
}

/** A change is only allowed to touch content, never the schema contract. */
function guardPatch(patch) {
  if ('schemaVersion' in patch) {
    throw new Error(
      'A content change cannot alter schemaVersion. That is a code change in this repository.'
    )
  }
  if ('meta' in patch) {
    throw new Error('A content change cannot set "meta"; the build writes it.')
  }
}

async function main() {
  const args = process.argv.slice(2)
  const bodyIndex = args.indexOf('--issue-body')
  if (bodyIndex === -1) {
    throw new Error('usage: apply-proposal.mjs --issue-body <file>')
  }

  const body = await readFile(path.resolve(args[bodyIndex + 1]), 'utf8')
  const patch = extractPatch(body)
  guardPatch(patch)

  const contentPath = path.join(repoRoot, 'content/home.en.json')
  const before = await readJson(contentPath)
  const after = apply(before, patch)

  if (JSON.stringify(before) === JSON.stringify(after)) {
    throw new Error('The change makes no difference to the current content.')
  }

  await writeFile(contentPath, `${JSON.stringify(after, null, 2)}\n`)

  const fields = Object.keys(patch).join(', ')
  output('changed-fields', fields)
  summary(`Applied a content proposal touching: ${fields}`)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((problem) => {
    error(problem.message)
    // The message is written where a workflow can quote it back to the author.
    writeFile(
      path.join(repoRoot, 'proposal-error.txt'),
      `${problem.message}\n`
    ).finally(() => process.exit(1))
  })
}
