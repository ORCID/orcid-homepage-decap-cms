#!/usr/bin/env node
/**
 * Check a deployment from the outside, the way the browser will see it.
 *
 * A port of wordpress-prod-release-validation.py, which exists because a
 * homepage release once shipped with nine images that had never been uploaded:
 * the build was green and the page was broken. So this asks the live host for
 * the version it expects, then fetches every locale and every image it
 * references before the next environment is unlocked.
 *
 *   node scripts/validate-deploy.mjs --base <url> --version <version>
 */
import { fileURLToPath } from 'node:url'

import { collectImagePaths } from './lib/images.mjs'
import { error, failWith, summary } from './lib/gh-summary.mjs'

const POLL_ATTEMPTS = 12
const POLL_INTERVAL_MS = 10_000

function argValue(args, name) {
  const index = args.indexOf(name)
  return index === -1 ? undefined : args[index + 1]
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** A CDN can serve the previous bundle for a while, so give it time to turn over. */
async function waitForVersion(base, expected) {
  for (let attempt = 1; attempt <= POLL_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(`${base}/version.json?t=${Date.now()}`, {
        cache: 'no-store',
      })
      if (response.ok) {
        const published = await response.json()
        if (published.version === expected) return published
        process.stdout.write(
          `  attempt ${attempt}: serving ${published.version}, waiting for ${expected}\n`
        )
      } else {
        process.stdout.write(`  attempt ${attempt}: HTTP ${response.status}\n`)
      }
    } catch (problem) {
      process.stdout.write(`  attempt ${attempt}: ${problem.message}\n`)
    }
    if (attempt < POLL_ATTEMPTS) await wait(POLL_INTERVAL_MS)
  }

  throw new Error(
    `${base} never served version ${expected} after ${POLL_ATTEMPTS} attempts`
  )
}

async function main() {
  const args = process.argv.slice(2)
  const base = (argValue(args, '--base') ?? '').replace(/\/$/, '')
  const expected = argValue(args, '--version')

  if (!base || !expected) {
    throw new Error(
      'usage: validate-deploy.mjs --base <url> --version <version>'
    )
  }

  process.stdout.write(`Waiting for ${base} to serve ${expected}\n`)
  const published = await waitForVersion(base, expected)

  const problems = []
  const images = new Set()
  const rows = []

  for (const locale of published.locales) {
    const url = `${base}/content/home.${locale}.json`
    const response = await fetch(url, { cache: 'no-store' })
    if (!response.ok) {
      problems.push(`${url} -> HTTP ${response.status}`)
      continue
    }

    const document = await response.json()
    if (document.meta?.version !== expected) {
      problems.push(
        `home.${locale}.json reports version ${document.meta?.version}, expected ${expected}`
      )
    }
    if (document.schemaVersion !== published.schemaVersion) {
      problems.push(
        `home.${locale}.json has schemaVersion ${document.schemaVersion}, expected ${published.schemaVersion}`
      )
    }
    for (const image of collectImagePaths(document)) images.add(image)
    rows.push(
      `| ${locale} | ${document.meta?.translated ?? '?'} | ${document.meta?.total ?? '?'} |`
    )
  }

  // Every image the pages point at has to actually be there. This is the check
  // that the WordPress pipeline was missing.
  for (const image of [...images].sort()) {
    const url = `${base}/content/${image}`
    const response = await fetch(url, { method: 'HEAD' })
    if (!response.ok) problems.push(`${url} -> HTTP ${response.status}`)
  }

  if (problems.length > 0) {
    failWith(`${base} is serving a broken bundle`, problems)
  }

  summary(
    [
      `### ✅ ${base} is serving \`${expected}\``,
      '',
      `${published.locales.length} locales, ${images.size} images, all reachable.`,
      '',
      '| Locale | Translated | Total |',
      '| --- | ---: | ---: |',
      ...rows,
    ].join('\n')
  )
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((problem) => {
    error(problem.message)
    process.exit(1)
  })
}
