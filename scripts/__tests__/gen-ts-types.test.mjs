import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'

import { loadCatalogue } from '../lib/catalogue.mjs'
import { generateTypes, writeTypes } from '../gen/ts-types.mjs'

const catalogue = loadCatalogue()

/**
 * Written where the real generator writes, not to a temp dir: the point of
 * `npm run gen` is that dist/types/homepage-content.generated.ts exists and is
 * the file NG vendors, and a test that only ever exercised --out would pass
 * with the default path broken.
 */
const emitted = writeTypes()
const text = readFileSync(emitted.path, 'utf8')

test('the generator writes the file the Angular repo vendors', () => {
  assert.equal(
    path.basename(emitted.path),
    'homepage-content.generated.ts',
    'NG imports this file by name; renaming it breaks the vendoring step'
  )
  assert.ok(text.length > 0)
  assert.equal(text, emitted.text)
})

test('the header tells a reader not to edit it, and what to re-run', () => {
  assert.match(text, /DO NOT EDIT/)
  assert.match(text, /scripts\/gen\/ts-types\.mjs/)
  assert.match(
    text,
    new RegExp(`catalogueVersion ${catalogue.catalogueVersion}\\b`),
    'the header has to name the catalogue version, so a stale vendored copy is identifiable without a diff'
  )
})

test('every section type in the catalogue has an interface and joins the union', () => {
  for (const name of Object.keys(catalogue.sectionTypes)) {
    const interfaceName = `${pascal(name)}Section`
    assert.match(
      text,
      new RegExp(`export interface ${interfaceName} \\{`),
      `no interface for the "${name}" section type`
    )
    assert.match(
      text,
      new RegExp(`\\n  \\| ${interfaceName}\\n`),
      `${interfaceName} is declared but never joins HomepageSection, so no component can be handed one`
    )
    assert.match(text, new RegExp(`  type: '${name}'`))
  }
})

test('every item type in the catalogue has a declaration', () => {
  for (const [name, itemType] of Object.entries(catalogue.itemTypes)) {
    if (name === 'image') continue // the slot picks decorative or informative
    const declaration = itemType.scalar
      ? `export type ${pascal(name)} =`
      : `export interface ${pascal(name)} {`
    assert.ok(
      text.includes(declaration),
      `no declaration for the "${name}" item type`
    )
  }
  assert.match(text, /export interface DecorativeImage \{/)
  assert.match(text, /export interface InformativeImage \{/)
})

test('a decorative image slot offers no alt text to get wrong', () => {
  const decorative = interfaceBody('DecorativeImage')
  assert.ok(
    !/\balt\??:/.test(decorative),
    'a decorative slot with an alt property lets an editor describe a picture the renderer hides'
  )
  assert.match(interfaceBody('InformativeImage'), /\n  alt: string/)
})

test('every variant of every section type appears in VARIANTS', () => {
  const record = text.slice(
    text.indexOf('export const VARIANTS = {'),
    text.indexOf('} as const', text.indexOf('export const VARIANTS = {'))
  )
  for (const [name, sectionType] of Object.entries(catalogue.sectionTypes)) {
    for (const variant of sectionType.variants) {
      assert.ok(
        record.includes(`'${variant.name}'`),
        `variant "${variant.name}" of "${name}" is missing from VARIANTS, so the renderer's fallback (D4) cannot know about it`
      )
    }
    const first = sectionType.variants[0].name
    assert.match(
      record,
      new RegExp(`'${name}': \\['${first}'`),
      `VARIANTS must keep catalogue order: an unknown variant falls back to the first entry`
    )
  }
})

test('every section type has a guard that narrows to its own interface', () => {
  for (const name of Object.keys(catalogue.sectionTypes)) {
    const guard = `is${pascal(name)}Section`
    assert.match(
      text,
      new RegExp(
        `export function ${guard}\\(\\s*section: HomepageSection\\s*\\): section is ${pascal(name)}Section \\{\\s*return section\\.type === '${name}'`
      ),
      `no guard ${guard} that tests section.type === '${name}'`
    )
  }
})

test('nothing is typed as any', () => {
  const offenders = text
    .split('\n')
    .map((line, index) => [index + 1, line])
    .filter(([, line]) => /\bany\b/.test(line))
  assert.deepEqual(
    offenders,
    [],
    'an `any` in the generated types silently disables checking at exactly the boundary these types exist to police'
  )
})

test('the file stands alone: it imports nothing', () => {
  assert.ok(
    !/^\s*import\b/m.test(text),
    'NG vendors this file on its own; an import would need a matching copy of whatever it named'
  )
})

test('a field the catalogue marks optional is optional in the types', () => {
  // media.actions is `required: false` with `min: 1`: one or two buttons if
  // present, and a media section with no buttons at all is valid.
  assert.match(interfaceBody('MediaSection'), /\n  actions\?: Action\[\]/)
  // cta-band.actions is `required: true`, same min and max.
  assert.match(interfaceBody('CtaBandSection'), /\n  actions: Action\[\]/)
  // audience.features says nothing but has min 1, which the schema reads as
  // required (§3.2).
  assert.match(interfaceBody('Audience'), /\n  features: FeatureItem\[\]/)
})

test('an enum of numbers stays numeric', () => {
  assert.match(
    interfaceBody('FeatureListSection'),
    /\n  columns\?: 2 \| 3/,
    'quoting the values would make every consumer compare a string to a number'
  )
})

test('regenerating produces the same bytes, so the drift check is meaningful', () => {
  assert.equal(generateTypes(), text)
})

test('a catalogue that points an "of" at the image item type is refused', () => {
  const broken = structuredClone(catalogue)
  broken.sectionTypes.prose.fields.picture = { kind: 'object', of: 'image' }
  assert.throws(() => generateTypes(broken), {
    message: /"kind": "image".*decorative/s,
  })
})

test('a section type that redeclares a structural field is refused', () => {
  const broken = structuredClone(catalogue)
  broken.sectionTypes.prose.fields.variant = { kind: 'plain' }
  assert.throws(() => generateTypes(broken), {
    message: /section type "prose" declares variant/,
  })
})

function pascal(name) {
  return name
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('')
}

function interfaceBody(name) {
  const start = text.indexOf(`export interface ${name} {`)
  assert.notEqual(start, -1, `no interface named ${name}`)
  return text.slice(start, text.indexOf('\n}', start))
}
