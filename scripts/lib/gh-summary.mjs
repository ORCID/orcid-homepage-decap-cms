import { appendFileSync } from 'node:fs'

/**
 * Step summaries and error annotations, so a failed content build says what is
 * wrong on the workflow page instead of only in the log. A port of
 * github_writer.py from orcid-wordpress-home-page-deploy, which exists because
 * a broken clone there was once invisible until someone opened the raw log.
 */

function append(file, text) {
  if (!file) return
  try {
    appendFileSync(file, text)
  } catch {
    // A missing summary file must never fail the step that reports on it.
  }
}

export function summary(markdown) {
  process.stdout.write(`${markdown}\n`)
  append(process.env.GITHUB_STEP_SUMMARY, `${markdown}\n`)
}

export function error(message) {
  process.stderr.write(`${message}\n`)
  if (process.env.GITHUB_ACTIONS) {
    process.stdout.write(`::error::${message.replace(/\n/g, ' ')}\n`)
  }
}

export function warn(message) {
  process.stderr.write(`${message}\n`)
  if (process.env.GITHUB_ACTIONS) {
    process.stdout.write(`::warning::${message.replace(/\n/g, ' ')}\n`)
  }
}

export function output(key, value) {
  append(process.env.GITHUB_OUTPUT, `${key}=${value}\n`)
}

/** Fail the process with every problem listed, not just the first. */
export function failWith(heading, problems) {
  error(`${heading} (${problems.length})`)
  for (const problem of problems) error(`  - ${problem}`)
  summary(`### ❌ ${heading}\n\n${problems.map((p) => `- ${p}`).join('\n')}\n`)
  process.exit(1)
}
