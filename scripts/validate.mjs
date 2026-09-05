#!/usr/bin/env node
/**
 * The gate that stands between an edit and the homepage.
 *
 * Decap can enforce a field pattern but nothing across fields, and it never
 * sees a file that arrives from translation. Everything that would break the
 * page is checked here instead, and this runs on every pull request, on every
 * content proposal before a pull request is opened, and over the built output
 * before it is published.
 *
 *   node scripts/validate.mjs [--strict] [--dist dist/content]
 */
import { readdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// The schema declares the 2020-12 dialect, which is a separate ajv entry point.
import Ajv from 'ajv/dist/2020.js'
import addFormats from 'ajv-formats'

import { assertCatalogueValid } from './lib/catalogue.mjs'
import { readJson, translatableKeys, walkTranslatable } from './lib/content.mjs'
import { flatten } from './lib/flatten.mjs'
import { collectImagePaths } from './lib/images.mjs'
import { lintMarkdownLite } from './lib/markdown-lint.mjs'
import { failWith, summary, warn } from './lib/gh-summary.mjs'

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..'
)

async function makeValidator() {
  const schema = await readJson(path.join(repoRoot, 'schema/home.schema.json'))
  const ajv = new Ajv({ allErrors: true, strict: false })
  addFormats(ajv)
  return ajv.compile(schema)
}

function schemaProblems(validate, document, where) {
  if (validate(document)) return []
  return validate.errors.map(
    (e) => `${where}${e.instancePath || '/'}: ${e.message}`
  )
}

/** Rules the JSON Schema cannot express, checked over the source document. */
function contentProblems(content, imagesOnDisk) {
  const problems = []

  // walkTranslatable throws on a missing or duplicate id, which is the one
  // mistake that silently detaches an item from all of its translations.
  try {
    walkTranslatable(content, (keyPath, value, descriptor) => {
      const where = keyPath.join('.')
      problems.push(...lintMarkdownLite(value, where))

      // `plain` and `alt` are one line by definition; `rich` is the only kind
      // that may hold a paragraph break. Reading that from the catalogue
      // replaces a hand-maintained list of field names that went stale the
      // moment a section type added a field nobody remembered to add to it.
      if (descriptor.kind !== 'rich' && value.includes('\n')) {
        problems.push(`${where}: must be a single line`)
      }
      if (descriptor.maxLength && value.length > descriptor.maxLength) {
        problems.push(
          `${where}: ${value.length} characters, but the most this field takes is ${descriptor.maxLength}`
        )
      }
    })
  } catch (idProblem) {
    problems.push(idProblem.message)
  }

  for (const reference of collectImagePaths(content)) {
    if (!imagesOnDisk.has(path.basename(reference))) {
      problems.push(`image "${reference}" is not in content/images/`)
    }
  }

  return problems
}

/** Rules for a file that came back from translation. */
function localeProblems(locale, translations, englishKeys, strict) {
  const problems = []
  const warnings = []
  const flat = flatten(translations)

  for (const [key, value] of Object.entries(flat)) {
    if (!englishKeys.has(key)) {
      // A stale key is harmless at build time, but it means a translator's work
      // is now unreachable, so it should not pass unnoticed.
      const message = `i18n/home.${locale}.json: "${key}" is not in the English source`
      if (strict) problems.push(message)
      else warnings.push(message)
      continue
    }
    if (typeof value !== 'string' || value.trim() === '') {
      problems.push(`i18n/home.${locale}.json: "${key}" is empty`)
      continue
    }
    problems.push(...lintMarkdownLite(value, `i18n/home.${locale}.json ${key}`))
  }

  return { problems, warnings }
}

async function listLocaleFiles() {
  const dir = path.join(repoRoot, 'i18n')
  let entries = []
  try {
    entries = await readdir(dir)
  } catch {
    return []
  }
  return entries
    .filter(
      (name) => /^home\.[\w-]+\.json$/.test(name) && name !== 'home.en.json'
    )
    .map((name) => ({
      locale: name.slice('home.'.length, -'.json'.length),
      file: path.join(dir, name),
    }))
    .sort((a, b) => a.locale.localeCompare(b.locale))
}

async function validateDist(validate, distDir) {
  const problems = []
  const files = (await readdir(distDir)).filter((n) => n.endsWith('.json'))

  if (files.length === 0) problems.push(`${distDir} has no JSON files`)

  for (const file of files.sort()) {
    const document = await readJson(path.join(distDir, file))
    problems.push(...schemaProblems(validate, document, file))
    if (!document.meta) {
      problems.push(`${file}: built output must carry "meta"`)
    }
    for (const reference of collectImagePaths(document)) {
      if (!reference.startsWith('assets/')) {
        problems.push(`${file}: image "${reference}" was not fingerprinted`)
      }
    }
  }

  return { problems, count: files.length }
}

async function main() {
  const args = process.argv.slice(2)
  const strict = args.includes('--strict')
  const distIndex = args.indexOf('--dist')
  try {
    assertCatalogueValid()
  } catch (problem) {
    failWith('The catalogue is invalid', [problem.message])
  }

  const validate = await makeValidator()

  if (distIndex !== -1) {
    const distDir = path.resolve(
      repoRoot,
      args[distIndex + 1] ?? 'dist/content'
    )
    const { problems, count } = await validateDist(validate, distDir)
    if (problems.length > 0) failWith('Built output is invalid', problems)
    summary(`✅ ${count} built locale files are valid`)
    return
  }

  const content = await readJson(path.join(repoRoot, 'content/home.en.json'))
  const imagesOnDisk = new Set(
    await readdir(path.join(repoRoot, 'content/images')).catch(() => [])
  )

  const problems = [
    ...schemaProblems(validate, content, 'content/home.en.json'),
    ...contentProblems(content, imagesOnDisk),
  ]
  const warnings = []

  // Only look at translations once the source itself is sound; otherwise the
  // key set they are compared against is meaningless.
  if (problems.length === 0) {
    const englishKeys = new Set(translatableKeys(content))
    for (const { locale, file } of await listLocaleFiles()) {
      const result = localeProblems(
        locale,
        await readJson(file),
        englishKeys,
        strict
      )
      problems.push(...result.problems)
      warnings.push(...result.warnings)
    }
  }

  for (const message of warnings) warn(message)
  if (problems.length > 0) failWith('Content is invalid', problems)

  summary(
    `✅ content/home.en.json is valid (${translatableKeys(content).length} translatable strings across ${content.sections.length} sections)`
  )
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((problem) =>
    failWith('Validation could not run', [problem.message])
  )
}

export { contentProblems, localeProblems, makeValidator, schemaProblems }
