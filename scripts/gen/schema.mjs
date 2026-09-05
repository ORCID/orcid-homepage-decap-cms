#!/usr/bin/env node
/**
 * Generates schema/home.schema.json from schema/catalogue.json.
 *
 * The output is committed and CI fails on drift (`npm run gen:check`), so the
 * schema diff on a pull request shows exactly what a catalogue edit did to the
 * contract with the renderer — which is the whole reason a generated artefact
 * is committed rather than built on demand.
 *
 *   node scripts/gen/schema.mjs [--out schema/home.schema.json]
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { loadCatalogue } from '../lib/catalogue.mjs'
import {
  VALUE_OBJECT_DEFS,
  defName,
  imageDefs,
  itemTypeSchema,
  leafDefs,
  metaDef,
  objectSchema,
  sectionBranch,
} from './lib/emit.mjs'

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../..'
)

export const DEFAULT_OUTPUT = path.join(repoRoot, 'schema/home.schema.json')

/**
 * §2.7. A page is a narrative an editor scans, not a container: twenty-four
 * sections is already past the point where anyone reads to the end, and an
 * unbounded list is an unbounded build.
 */
const MAX_SECTIONS = 24

function sectionsSchema(catalogue) {
  return {
    type: 'array',
    minItems: 1,
    maxItems: MAX_SECTIONS,
    items: {
      // No `additionalProperties: false` here: this object declares no
      // properties of its own, so closing it would reject every section. Each
      // branch below is closed instead, which is where it bites.
      type: 'object',
      required: ['type'],
      // Without the discriminator one bad field produces an error list from
      // all seven branches; with it, ajv reports only the branch whose `type`
      // matched. Consumers must construct ajv with `discriminator: true`.
      discriminator: { propertyName: 'type' },
      oneOf: Object.keys(catalogue.sectionTypes).map((name) =>
        sectionBranch(catalogue, name)
      ),
    },
  }
}

function defsFor(catalogue) {
  const defs = { ...leafDefs(), ...imageDefs(catalogue) }

  for (const name of VALUE_OBJECT_DEFS) {
    // `image` is the one value object with two shapes; imageDefs emitted both.
    if (name === 'image') continue
    defs[defName(name)] = itemTypeSchema(catalogue, name)
  }

  defs.page = objectSchema(catalogue, catalogue.page.fields, 'page/fields')
  defs.meta = metaDef()
  return defs
}

export function buildSchema(catalogue) {
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: 'https://orcid.github.io/orcid-homepage-decap-cms/schema/home.schema.json',
    $comment:
      'GENERATED FILE — do not edit. Produced by scripts/gen/schema.mjs from schema/catalogue.json; run `npm run gen` after editing the catalogue.',
    title: 'ORCID homepage content',
    description:
      'The contract between this repository and the Angular renderer in orcid-angular. schemaVersion changes only for a breaking change; a new section type, variant or optional field bumps catalogueVersion alone, and an older renderer drops a section whose type it does not know.',
    type: 'object',
    additionalProperties: false,
    required: ['schemaVersion', 'catalogueVersion', 'page', 'sections'],
    properties: {
      schemaVersion: { const: catalogue.schemaVersion },
      catalogueVersion: {
        type: 'integer',
        minimum: 1,
        description:
          'The catalogue this document was authored against. Not pinned to one value: additive catalogue changes are not breaking, so a renderer accepts any of them.',
      },
      page: { $ref: '#/$defs/page' },
      sections: sectionsSchema(catalogue),
      meta: { $ref: '#/$defs/meta' },
    },
    $defs: defsFor(catalogue),
  }
}

export function writeSchema(outPath = DEFAULT_OUTPUT) {
  const text = `${JSON.stringify(buildSchema(loadCatalogue()), null, 2)}\n`
  mkdirSync(path.dirname(outPath), { recursive: true })
  writeFileSync(outPath, text, 'utf8')
  return outPath
}

function main() {
  const args = process.argv.slice(2)
  const index = args.indexOf('--out')
  const outPath =
    index === -1 ? DEFAULT_OUTPUT : path.resolve(repoRoot, args[index + 1])
  writeSchema(outPath)
  process.stdout.write(`wrote ${path.relative(repoRoot, outPath)}\n`)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main()
}
