#!/usr/bin/env node
/**
 * Migrate the homepage from the fixed version 1 document to composable sections.
 *
 * Version 1 was one shape: a hero with audiences, a featured-news block and a
 * closing block. Version 2 is a list of sections an editor composes. The words
 * do not change, so none of the 616 translated strings should be lost — and the
 * only way to be sure of that is to rewrite the translation keys in lockstep
 * with the content and then prove, string by string, that every one arrived.
 *
 * Section ids are chosen so the rewrite is a pure prefix change:
 * `audiences.researchers.intro` becomes
 * `sections.who-we-serve.audiences.researchers.intro`. Item ids are preserved
 * exactly. `hero.title` is the one string that moves rather than shifts: it
 * becomes `page.title`, the single h1 that every section heading now sits under.
 *
 * Content that version 2 needs and version 1 never had — the page description,
 * the quick links, the picture that replaces the bare video embed — comes from
 * 002.supplement.json, which a person wrote and a person reviewed.
 *
 *   node scripts/migrations/002-sections.mjs [--dry-run]
 */
import { readdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../..'
)

const CONTENT = path.join(repoRoot, 'content/home.en.json')
const I18N = path.join(repoRoot, 'i18n')
const SUPPLEMENT = path.join(repoRoot, 'scripts/migrations/002.supplement.json')
const MAP_OUT = path.join(repoRoot, 'scripts/migrations/002-sections.map.json')

/** The three sections the version 1 document becomes. */
const SECTION_IDS = {
  audiences: 'who-we-serve',
  featuredNews: 'featured-news',
  integrate: 'integrate',
}

const readJson = async (file) => JSON.parse(await readFile(file, 'utf8'))

/**
 * Every version 1 translation key, mapped to where it lives in version 2.
 *
 * Built from the document itself rather than hardcoded, so a key that exists in
 * the content but not in this map is impossible: the map is derived from the
 * same source the content is.
 */
function buildKeyMap(v1) {
  const map = new Map()
  map.set('hero.title', 'page.title')

  const audiences = SECTION_IDS.audiences
  for (const audience of v1.audiences ?? []) {
    const from = `audiences.${audience.id}`
    const to = `sections.${audiences}.audiences.${audience.id}`
    map.set(`${from}.label`, `${to}.label`)
    map.set(`${from}.intro`, `${to}.intro`)

    for (const feature of audience.features ?? []) {
      const featureFrom = `${from}.features.${feature.id}`
      const featureTo = `${to}.features.${feature.id}`
      map.set(`${featureFrom}.title`, `${featureTo}.title`)
      map.set(`${featureFrom}.body`, `${featureTo}.body`)
    }
  }

  const news = SECTION_IDS.featuredNews
  for (const field of ['kicker', 'title', 'body']) {
    map.set(`featuredNews.${field}`, `sections.${news}.${field}`)
  }

  const integrate = SECTION_IDS.integrate
  map.set('integrate.title', `sections.${integrate}.title`)
  for (const paragraph of v1.integrate?.paragraphs ?? []) {
    // `paragraphs` becomes `items`: the same words under the shared feature-item
    // type, which is what lets an editor give any of them a sub-heading.
    map.set(
      `integrate.paragraphs.${paragraph.id}.body`,
      `sections.${integrate}.items.${paragraph.id}.body`
    )
  }

  return map
}

const layout = (span, spacing, tone) => ({ span, spacing, tone })

function buildDocument(v1, supplement) {
  const sections = []

  sections.push({
    id: SECTION_IDS.audiences,
    type: 'audience-selector',
    // The live page's look. Below 1024px it becomes an accordion, which is what
    // orcid.org already does and what today's tab strip does not.
    variant: 'tabs-photo',
    layout: layout('full', 'normal', 'brand-dark'),
    audiences: (v1.audiences ?? []).map((audience) => ({
      id: audience.id,
      label: audience.label,
      intro: audience.intro,
      background: audience.background
        ? { src: audience.background, focalPoint: 'center' }
        : undefined,
      features: (audience.features ?? []).map((feature) => ({
        id: feature.id,
        title: feature.title,
        body: feature.body,
        icon: feature.icon ? { src: feature.icon } : undefined,
      })),
    })),
  })

  // New in version 2. These six links are on the live page today and version 1
  // had nowhere to put them, so they were simply absent from the content model.
  const quick = supplement.quickLinks
  sections.push({
    id: 'quick-links',
    type: 'quick-links',
    variant: 'bar',
    layout: layout('full', 'compact', 'brand-tint'),
    title: quick.title,
    titleHidden: quick.titleHidden,
    links: quick.links.map((link) => ({
      id: link.id,
      label: link.label,
      href: link.href,
    })),
  })

  const media = supplement.featuredMedia
  sections.push({
    id: SECTION_IDS.featuredNews,
    type: 'media',
    variant: 'media-end',
    layout: layout('full', 'normal', 'default'),
    kicker: v1.featuredNews?.kicker,
    title: v1.featuredNews?.title,
    body: v1.featuredNews?.body,
    mediaKind: media.mediaKind,
    image: media.image,
  })

  sections.push({
    id: SECTION_IDS.integrate,
    type: 'feature-list',
    // The closing block on the live page is plain columns with no card chrome.
    variant: 'columns',
    layout: layout('full', 'normal', 'surface'),
    title: v1.integrate?.title,
    columns: 3,
    items: (v1.integrate?.paragraphs ?? []).map((paragraph) => ({
      id: paragraph.id,
      body: paragraph.body,
    })),
  })

  // The news strip is on the page today but sat outside the content model, so
  // nobody could reorder it, retitle it or take it off. Now it is a section.
  sections.push({
    id: 'latest-news',
    type: 'news-feed',
    variant: 'grid',
    layout: layout('full', 'normal', 'default'),
    title: 'Latest news',
    source: 'orcid-blog',
    maxItems: 3,
  })

  return {
    schemaVersion: 2,
    catalogueVersion: 1,
    page: {
      title: v1.hero?.title ?? 'ORCID',
      description: supplement.page.description,
    },
    sections: sections.map(pruneUndefined),
  }
}

/** JSON has no undefined; an absent optional field must be absent, not null. */
function pruneUndefined(value) {
  if (Array.isArray(value)) return value.map(pruneUndefined)
  if (value === null || typeof value !== 'object') return value

  const out = {}
  for (const [key, inner] of Object.entries(value)) {
    if (inner === undefined) continue
    out[key] = pruneUndefined(inner)
  }
  return out
}

function flatten(node, prefix = []) {
  const out = {}
  if (!node || typeof node !== 'object') return out
  for (const [key, value] of Object.entries(node)) {
    const at = [...prefix, key]
    if (typeof value === 'string') out[at.join('.')] = value
    else if (value && typeof value === 'object' && !Array.isArray(value)) {
      Object.assign(out, flatten(value, at))
    }
  }
  return out
}

function unflatten(flat) {
  const out = {}
  for (const [key, value] of Object.entries(flat)) {
    const parts = key.split('.')
    let cursor = out
    for (const part of parts.slice(0, -1)) {
      if (typeof cursor[part] !== 'object' || cursor[part] === null) {
        cursor[part] = {}
      }
      cursor = cursor[part]
    }
    cursor[parts[parts.length - 1]] = value
  }
  return out
}

async function main() {
  const dryRun = process.argv.includes('--dry-run')

  const v1 = await readJson(CONTENT)
  if (v1.schemaVersion !== 1) {
    throw new Error(
      `content/home.en.json is already at schemaVersion ${v1.schemaVersion}; this migration only runs against version 1`
    )
  }

  const supplement = await readJson(SUPPLEMENT)
  const keyMap = buildKeyMap(v1)
  const v2 = buildDocument(v1, supplement)

  const localeFiles = (await readdir(I18N))
    .filter(
      (name) => /^home\.[\w-]+\.json$/.test(name) && name !== 'home.en.json'
    )
    .sort()

  const report = []
  const rewritten = new Map()

  for (const file of localeFiles) {
    const locale = file.slice('home.'.length, -'.json'.length)
    const flat = flatten(await readJson(path.join(I18N, file)))
    const moved = {}
    const orphans = []

    for (const [oldKey, value] of Object.entries(flat)) {
      const newKey = keyMap.get(oldKey)
      // An orphan means the map and the content disagree, which is a bug in this
      // script rather than a fact about the translation. Fail rather than drop.
      if (!newKey) orphans.push(oldKey)
      else moved[newKey] = value
    }

    if (orphans.length > 0) {
      throw new Error(
        `${file}: ${orphans.length} keys have no home in version 2, which means this migration is wrong, not the translation:\n  ${orphans.join('\n  ')}`
      )
    }

    const before = Object.keys(flat).length
    const after = Object.keys(moved).length
    if (before !== after) {
      throw new Error(
        `${file}: ${before} strings went in and ${after} came out; two keys must have collided`
      )
    }

    rewritten.set(file, unflatten(moved))
    report.push({ locale, strings: after })
  }

  const mapOut = {
    $comment:
      'Written by scripts/migrations/002-sections.mjs. Every version 1 translation key and where it went. Read by key-diff.mjs so a reviewer sees renames as renames rather than as 44 deletions and 44 additions.',
    from: 1,
    to: 2,
    keys: Object.fromEntries([...keyMap.entries()].sort()),
  }

  if (dryRun) {
    process.stdout.write(
      `Would migrate ${keyMap.size} keys across ${report.length} locales.\n`
    )
    for (const row of report) {
      process.stdout.write(`  ${row.locale}: ${row.strings} strings\n`)
    }
    process.stdout.write(
      `\nSections: ${v2.sections.map((s) => `${s.id} (${s.type}/${s.variant})`).join(', ')}\n`
    )
    return
  }

  await writeFile(CONTENT, `${JSON.stringify(v2, null, 2)}\n`)
  for (const [file, document] of rewritten) {
    await writeFile(
      path.join(I18N, file),
      `${JSON.stringify(document, null, 2)}\n`
    )
  }
  await writeFile(MAP_OUT, `${JSON.stringify(mapOut, null, 2)}\n`)

  process.stdout.write(
    `Migrated ${keyMap.size} keys across ${report.length} locales, ${keyMap.size * report.length} strings in total.\n`
  )
  process.stdout.write(`Wrote ${path.relative(repoRoot, MAP_OUT)}\n`)
}

main().catch((problem) => {
  process.stderr.write(`${problem.message}\n`)
  process.exit(1)
})
