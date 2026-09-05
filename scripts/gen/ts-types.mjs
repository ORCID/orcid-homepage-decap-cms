#!/usr/bin/env node
/**
 * Emit the TypeScript the Angular renderer compiles against, from the
 * catalogue (spec v2 D1, §2.4 row 5).
 *
 * The renderer used to carry a hand-written parallel implementation of the
 * schema — `src/app/types/homepage-content.ts` — which disagreed with the
 * published schema in three verified places, so a document the publisher had
 * accepted could still be refused by the app. Generating the types and the
 * per-type guards from the same catalogue that generates the schema is what
 * stops that from recurring.
 *
 *   node scripts/gen/ts-types.mjs [--out dist/types/homepage-content.generated.ts]
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { loadCatalogue } from '../lib/catalogue.mjs'

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..'
)

/** Named in the emitted header, so a reader knows what to re-run. */
const GENERATOR = 'scripts/gen/ts-types.mjs'

export const DEFAULT_OUTPUT = path.join(
  repoRoot,
  'dist',
  'types',
  'homepage-content.generated.ts'
)

/**
 * Scalar kinds all land on `string`; only the containers and the value sets
 * need a rule of their own. A map rather than a chain of ifs so that a kind
 * added to the meta-schema and forgotten here throws in `fieldType` instead of
 * quietly emitting the wrong type.
 */
const SCALAR_TYPES = {
  plain: 'string',
  rich: 'string',
  alt: 'string',
  note: 'string',
  id: 'string',
  href: 'string',
  imagePath: 'string',
  videoId: 'string',
  integer: 'number',
  boolean: 'boolean',
}

/** The two shapes a `kind: image` slot resolves to (§3.2). */
const DECORATIVE_IMAGE = 'DecorativeImage'
const INFORMATIVE_IMAGE = 'InformativeImage'

const IMAGE_ITEM_TYPE = 'image'

/** Emitted into every section interface; never declared by a section type. */
const STRUCTURAL = ['id', 'type', 'variant', 'layout']

function pascalCase(name) {
  return name
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('')
}

const itemTypeName = pascalCase
const sectionTypeName = (name) => `${pascalCase(name)}Section`
const guardName = (name) => `is${pascalCase(name)}Section`

function quote(value) {
  return `'${String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`
}

/** A number stays a number in the union: `columns` is `2 | 3`, not `'2' | '3'`. */
function literal(value) {
  return typeof value === 'number' ? String(value) : quote(value)
}

function unionOf(values) {
  return values.map(literal).join(' | ')
}

/**
 * A field is present in every valid document when the catalogue says
 * `required`, and also when it is a list with `min >= 1` and says nothing —
 * §3.2's worked schema puts `audiences` in its branch's `required` list on the
 * strength of `min: 1` alone, and these types have to agree with that schema
 * or the renderer writes fallbacks the validator has already made unreachable.
 * An explicit `required: false` wins over that: `media.actions` is min 1 max 2
 * *if present*, and a media section with no buttons is valid.
 *
 * Everything else is optional, including fields that carry a `default`. A
 * default is applied by whoever writes the document, not by the JSON itself,
 * so a consumer that treated `layout.tone` as always present would read
 * `undefined` off a hand-edited file the schema still accepts.
 */
function isAlwaysPresent(field) {
  if (field.required !== undefined) return field.required === true
  return field.kind === 'list' && (field.min ?? 0) >= 1
}

/**
 * `requiredWhen` is a conditional the types cannot state without splitting the
 * section into one interface per branch, which would break the single `type`
 * discriminator that §4.3's `@switch` narrows on. The condition goes in the
 * doc comment; the schema is what enforces it.
 */
function conditionSentence(field) {
  return Object.entries(field.requiredWhen)
    .map(([name, value]) => `Required when \`${name}\` is \`${value}\`.`)
    .join(' ')
}

/**
 * The name to use for a nested item type. `image` is refused deliberately: an
 * image slot has to say whether it is decorative, because that decision
 * belongs to the slot and not to the editor's memory (§3.2), and only a
 * `kind: image` field carries the flag.
 */
function referenceTo(itemTypeKey, catalogue) {
  if (itemTypeKey === IMAGE_ITEM_TYPE) {
    throw new Error(
      `schema/catalogue.json points an "of" at the item type "image". Use "kind": "image" with "decorative": true or false instead, so the slot decides whether a description is collected. ${GENERATOR} cannot pick for it.`
    )
  }
  return itemTypeName(itemTypeKey)
}

function fieldType(field, catalogue) {
  const scalar = SCALAR_TYPES[field.kind]
  if (scalar) return scalar

  if (field.kind === 'enum') {
    const values =
      field.enum === 'videoProviders'
        ? Object.keys(catalogue.videoProviders)
        : catalogue.enums[field.enum].values
    return unionOf(values)
  }

  if (field.kind === 'image') {
    return field.decorative ? DECORATIVE_IMAGE : INFORMATIVE_IMAGE
  }

  if (field.kind === 'object') return referenceTo(field.of, catalogue)

  if (field.kind === 'list') return `${referenceTo(field.of, catalogue)}[]`

  throw new Error(
    `${GENERATOR} cannot type the field kind "${field.kind}". Add it to SCALAR_TYPES or to fieldType() there, alongside the entry the kind already has in schema/catalogue.meta.schema.json.`
  )
}

/**
 * Catalogue labels are written as headings ("Width") and hints as sentences,
 * so joining them raw produced "Width Half-width sections pair…". Each part
 * gets a full stop unless it already ends in punctuation.
 */
function sentences(parts) {
  return parts
    .filter(Boolean)
    .map((part) =>
      /[.!?:]$/.test(part.trim()) ? part.trim() : `${part.trim()}.`
    )
    .join(' ')
}

/** A doc comment, wrapped to the 80 columns .prettierrc asks for. */
function comment(parts, indent) {
  const text = sentences(parts)
    // An unescaped `*/` in a catalogue label would close the comment early and
    // leave the rest of the file as code.
    .replace(/\*\//g, '* /')
  if (!text) return []
  if (`${indent}/** ${text} */`.length <= 80) return [`${indent}/** ${text} */`]

  const lines = [`${indent}/**`]
  let line = ''
  for (const word of text.split(/\s+/)) {
    const candidate = line ? `${line} ${word}` : word
    if (line && `${indent} * ${candidate}`.length > 80) {
      lines.push(`${indent} * ${line}`)
      line = word
    } else {
      line = candidate
    }
  }
  lines.push(`${indent} * ${line}`, `${indent} */`)
  return lines
}

function propertyLines(name, field, catalogue) {
  const doc = comment(
    [
      field.label,
      field.hint,
      field.requiredWhen ? conditionSentence(field) : null,
      field.requiredForPublication ? 'Required for publication.' : null,
    ],
    '  '
  )
  const optional = isAlwaysPresent(field) ? '' : '?'
  return [...doc, `  ${name}${optional}: ${fieldType(field, catalogue)}`]
}

function emitInterface(name, doc, entries, catalogue, leadingLines = []) {
  const body = entries.flatMap(([fieldName, field]) =>
    propertyLines(fieldName, field, catalogue)
  )
  return [
    ...comment([doc], ''),
    `export interface ${name} {`,
    ...leadingLines,
    ...body,
    '}',
  ].join('\n')
}

/**
 * The `image` item type is the one place where the slot, not the editor,
 * decides the shape: a decorative slot has no `alt` property at all, so an
 * editor can neither supply one nor forget one.
 */
function emitImageInterfaces(catalogue) {
  const entries = Object.entries(catalogue.itemTypes[IMAGE_ITEM_TYPE].fields)
  return [
    emitInterface(
      DECORATIVE_IMAGE,
      'A picture that carries no information. The renderer always emits alt="" and aria-hidden="true", so there is no description to author.',
      entries.filter(([, field]) => !field.informativeOnly),
      catalogue
    ),
    emitInterface(
      INFORMATIVE_IMAGE,
      'A picture that carries information. The description is required, because no machine can derive it (D3).',
      entries,
      catalogue
    ),
  ]
}

function emitItemTypes(catalogue) {
  const blocks = []
  for (const [name, itemType] of Object.entries(catalogue.itemTypes)) {
    if (name === IMAGE_ITEM_TYPE) {
      blocks.push(...emitImageInterfaces(catalogue))
      continue
    }
    if (itemType.scalar) {
      // An item type with no fields would become an interface that every
      // object in the language satisfies. `locale-tag` is a string.
      blocks.push(
        [
          ...comment(
            [
              itemType.label,
              itemType.pattern ? `Matches \`${itemType.pattern}\`.` : null,
            ],
            ''
          ),
          `export type ${itemTypeName(name)} = ${itemType.scalar}`,
        ].join('\n')
      )
      continue
    }
    const doc = itemType.external
      ? `${itemType.label}. Never authored: fetched from a third party at render time, so every string in it is untrusted text.`
      : itemType.label
    blocks.push(
      emitInterface(
        itemTypeName(name),
        doc,
        Object.entries(itemType.fields),
        catalogue
      )
    )
  }
  return blocks
}

/**
 * The four structural fields, emitted into each section interface rather than
 * inherited from a base one: §4.3 narrows the union with `@switch` on `type`,
 * and a shared base would widen `type` to `string` in every arm.
 */
function structuralLines(typeName, sectionType, catalogue) {
  const common = catalogue.commonFields
  const declared = Object.keys(sectionType.fields).filter((name) =>
    STRUCTURAL.includes(name)
  )
  if (declared.length > 0) {
    throw new Error(
      `schema/catalogue.json: section type "${typeName}" declares ${declared.join(
        ', '
      )}, which every section already carries. Remove it from sectionTypes/${typeName}/fields; declaring it twice would emit two conflicting properties.`
    )
  }

  return [
    ...comment([common.id.label, common.id.hint], '  '),
    '  id: string',
    ...comment(
      ['The discriminator. Written by the CMS, never by a human.'],
      '  '
    ),
    `  type: ${quote(typeName)}`,
    ...comment(
      [
        common.variant.label,
        'A variant this build does not know falls back to the first one (D4).',
      ],
      '  '
    ),
    `  variant: ${unionOf(sectionType.variants.map((v) => v.name))}`,
    ...comment([common.layout.label], '  '),
    `  layout: ${referenceTo(common.layout.of, catalogue)}`,
  ]
}

function emitSectionTypes(catalogue) {
  return Object.entries(catalogue.sectionTypes).map(([name, sectionType]) =>
    emitInterface(
      sectionTypeName(name),
      sectionType.label,
      Object.entries(sectionType.fields),
      catalogue,
      structuralLines(name, sectionType, catalogue)
    )
  )
}

function emitUnion(catalogue) {
  return [
    ...comment(
      [
        'Every section the renderer can be handed. Narrow it with the guard for the type, or with a switch on `type`.',
      ],
      ''
    ),
    'export type HomepageSection =',
    ...Object.keys(catalogue.sectionTypes).map(
      (name) => `  | ${sectionTypeName(name)}`
    ),
  ].join('\n')
}

function emitConstants(catalogue) {
  const typeNames = Object.keys(catalogue.sectionTypes)

  const types = [
    ...comment(
      ['Every section type this catalogue declares, in catalogue order.'],
      ''
    ),
    'export const SECTION_TYPES = [',
    ...typeNames.map((name) => `  ${quote(name)},`),
    '] as const',
    '',
    'export type HomepageSectionType = (typeof SECTION_TYPES)[number]',
  ].join('\n')

  const variants = [
    ...comment(
      [
        "Each type's variants, in catalogue order. A variant the renderer does not know falls back to the first entry of its tuple (D4), so the order here is content, not presentation.",
      ],
      ''
    ),
    'export const VARIANTS = {',
    ...typeNames.map((name) => {
      const names = catalogue.sectionTypes[name].variants.map((variant) =>
        quote(variant.name)
      )
      return `  ${quote(name)}: [${names.join(', ')}],`
    }),
    '} as const',
  ].join('\n')

  return [types, variants]
}

function emitDocument(catalogue) {
  const page = emitInterface(
    'HomepagePage',
    'Document-level fields that sit alongside the sections.',
    Object.entries(catalogue.page.fields),
    catalogue
  )

  // `meta` is written by scripts/build.mjs and never authored, so it is the
  // one block here that the catalogue does not describe (§3.1).
  const meta = `/** Written by the build, never authored. */
export interface HomepageContentMeta {
  locale: string
  /** The content release this bundle came from, such as \`v0.2.0\`. */
  version: string
  commit: string
  /** ISO 8601. */
  generatedAt: string
  /** How many strings this locale actually translates, out of \`total\`. */
  translated: number
  total: number
  /**
   * Keys that fell back to English. Optional because bundles built before
   * §7.6 carry no such list, and a missing list is not an empty one.
   */
  untranslated?: string[]
}`

  const content = `/** One published homepage document, for one locale. */
export interface HomepageContent {
  /**
   * The major version the renderer checks. A document from an unsupported
   * major is refused whole and the static page renders instead.
   */
  schemaVersion: number
  /**
   * Bumped by every additive catalogue change (D4). The renderer does not gate
   * on it; the staleness check in CI is what compares it (§2.6).
   */
  catalogueVersion: number
  page: HomepagePage
  sections: HomepageSection[]
  meta?: HomepageContentMeta
}`

  return [page, meta, content]
}

function emitGuards(catalogue) {
  return Object.keys(catalogue.sectionTypes).map((name) =>
    [
      `export function ${guardName(name)}(`,
      '  section: HomepageSection',
      `): section is ${sectionTypeName(name)} {`,
      `  return section.type === ${quote(name)}`,
      '}',
    ].join('\n')
  )
}

function header(catalogue) {
  return `/**
 * GENERATED FILE — DO NOT EDIT.
 *
 * Written from schema/catalogue.json by ${GENERATOR}, in the
 * orcid-homepage-decap-cms repository.
 *
 * catalogueVersion ${catalogue.catalogueVersion}, schemaVersion ${catalogue.schemaVersion}.
 *
 * Edit the catalogue and re-run \`npm run gen\` there. An edit made here is
 * lost on the next run, and CI fails on the drift before that.
 *
 * The catalogue that produced this file is published beside it as
 * dist/catalogue.json, so a renderer spec can assert that every type here has
 * a component and every variant is handled.
 */`
}

/** The whole file as text, so a test can read it without writing it. */
export function generateTypes(catalogue = loadCatalogue()) {
  return `${[
    header(catalogue),
    ...emitConstants(catalogue),
    ...emitItemTypes(catalogue),
    ...emitSectionTypes(catalogue),
    emitUnion(catalogue),
    ...emitDocument(catalogue),
    ...emitGuards(catalogue),
  ].join('\n\n')}\n`
}

export function writeTypes(outPath = DEFAULT_OUTPUT) {
  const text = generateTypes()
  mkdirSync(path.dirname(outPath), { recursive: true })
  writeFileSync(outPath, text, 'utf8')
  return { path: outPath, text }
}

function main() {
  const args = process.argv.slice(2)
  const index = args.indexOf('--out')
  const outPath =
    index === -1 ? DEFAULT_OUTPUT : path.resolve(repoRoot, args[index + 1])
  const { path: written } = writeTypes(outPath)
  process.stdout.write(`${path.relative(repoRoot, written)}\n`)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main()
}
