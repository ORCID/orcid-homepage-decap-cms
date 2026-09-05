/**
 * The catalogue is the only file a human edits when a section type, a field or
 * a variant changes (spec v2 D1). Everything else that describes the content
 * model — schema/home.schema.json, the generated block of admin/config.yml,
 * the TypeScript types, the CMS preview, the extractor — reads it through this
 * module, so a question like "is this field translated?" has exactly one
 * answer in the repository instead of one per consumer (D6).
 *
 * Nothing here is lenient. An unknown section type, an unknown field or an
 * unresolvable reference throws, because the allowlists this model replaces
 * all failed open: a field nobody had listed was silently dropped from the
 * extract, and the string never reached Transifex.
 */
import { readFileSync } from 'node:fs'

// The meta-schema declares the 2020-12 dialect, which is a separate entry point.
import Ajv from 'ajv/dist/2020.js'
import addFormats from 'ajv-formats'

const CATALOGUE_URL = new URL('../../schema/catalogue.json', import.meta.url)
const META_URL = new URL(
  '../../schema/catalogue.meta.schema.json',
  import.meta.url
)

/** Repo-relative, because the message is read in a CI log with no cwd. */
const CATALOGUE_PATH = 'schema/catalogue.json'

/**
 * §1.0. `note` is editorial metadata for reviewers and `alt` is the only
 * translatable field inside an image, so the set cannot be derived from
 * "is it a string" — it is stated once, here.
 */
const TRANSLATABLE_KINDS = new Set(['plain', 'rich', 'alt'])

/** The name an `enum` field uses to draw its values from `videoProviders`. */
const VIDEO_PROVIDERS = 'videoProviders'

let validateMeta = null
let cached = null

function readJson(url, label) {
  const raw = readFileSync(url, 'utf8')
  try {
    return JSON.parse(raw)
  } catch (error) {
    throw new Error(`${label} is not valid JSON: ${error.message}`)
  }
}

function metaValidator() {
  if (!validateMeta) {
    // allowUnionTypes: an enum value is a string or a number (`columns` is
    // 2 or 3), and a field default is either of those or a boolean.
    const ajv = new Ajv({
      allErrors: true,
      strict: true,
      allowUnionTypes: true,
      // strictRequired would reject the `if kind is image then require
      // decorative` branches, because it wants every required property
      // re-declared inside the branch that requires it. They are declared once
      // on the field schema instead.
      strictRequired: false,
    })
    // `format: regex` on the video-provider id patterns: a pattern that does
    // not compile would otherwise throw from inside the content validator,
    // with no mention of the catalogue that contains it.
    addFormats(ajv)
    validateMeta = ajv.compile(readJson(META_URL, 'catalogue.meta.schema.json'))
  }
  return validateMeta
}

function deepFreeze(value) {
  if (value === null || typeof value !== 'object') return value
  for (const child of Object.values(value)) deepFreeze(child)
  return Object.freeze(value)
}

/** The names §2.3 rule 7 (D3) keeps out of the catalogue, for the message. */
const RESERVED_BY_D3 =
  'level, headingLevel, tag, size, heading, color, colour, target, rel, width, height, autoplay, order'

const NAME_DEFS = /#\/\$defs\/(fieldName|typeName|enumName|reservedWords)\//

/**
 * A rejected name produces two ajv errors at the same place: the useful
 * `propertyNames` one, which carries the name, and a bare "must NOT be valid"
 * from inside the name definition, which carries nothing. Reporting both makes
 * a one-character typo look like two faults.
 */
function pruneRedundant(errors) {
  const named = new Set(
    errors
      .filter((e) => e.keyword === 'propertyNames')
      .map((e) => e.instancePath)
  )
  return errors.filter(
    (e) =>
      // An `if` error only says "must match then schema"; the branch's own
      // error, reported next to it, says which property is missing.
      e.keyword !== 'if' &&
      (e.keyword === 'propertyNames' ||
        !named.has(e.instancePath) ||
        !NAME_DEFS.test(e.schemaPath ?? ''))
  )
}

function describeAjvError(error) {
  const where = error.instancePath || '(the document root)'

  if (error.keyword === 'propertyNames') {
    return `${where}: "${error.params.propertyName}" cannot be used as a name here. Names are lowerCamelCase for fields and lower-kebab for types and variants, and the names the renderer computes for itself (${RESERVED_BY_D3}) are reserved, as are __order and __replace.`
  }

  const allowed = error.params?.allowedValues
  const detail = allowed
    ? `${error.message}: ${allowed.join(', ')}`
    : error.message
  // The offending key lives in params, not in the message: without it a
  // missing or unexpected property is reported against the whole object and
  // the editor has to guess which of eight keys ajv meant.
  const named =
    error.params?.additionalProperty ?? error.params?.missingProperty
  const suffix =
    named === undefined || detail.includes(`'${named}'`) ? '' : ` ("${named}")`
  return `${where}: ${detail}${suffix}`
}

/**
 * Walks every fields map in the catalogue: the common fields, each item type,
 * each section type and the page. Yields the map itself as well as each field,
 * because the sibling checks (`providerField`, `requiredWhen`) are answered
 * within one map.
 */
function* eachFieldMap(catalogue) {
  yield { path: 'commonFields', fields: catalogue.commonFields ?? {} }
  for (const [name, itemType] of Object.entries(catalogue.itemTypes ?? {})) {
    if (itemType?.fields) {
      yield { path: `itemTypes/${name}/fields`, fields: itemType.fields }
    }
  }
  for (const [name, sectionType] of Object.entries(
    catalogue.sectionTypes ?? {}
  )) {
    if (sectionType?.fields) {
      yield { path: `sectionTypes/${name}/fields`, fields: sectionType.fields }
    }
  }
  if (catalogue.page?.fields) {
    yield { path: 'page/fields', fields: catalogue.page.fields }
  }
}

/**
 * The rules of §2.3 that JSON Schema cannot express, because each one compares
 * a value in one part of the document with a key in another: `of` against
 * itemTypes, `enum` against enums, `providerField` against a sibling field,
 * `requiredWhen` against a sibling field, an enum `default` and every enum
 * label against that enum's values, and a variant name against its siblings.
 * They are checked here so that a catalogue naming something nobody declared
 * fails before the generator emits three artefacts built on the missing name.
 */
function crossReferenceProblems(catalogue) {
  const problems = []
  const itemTypes = catalogue.itemTypes ?? {}
  const enums = catalogue.enums ?? {}
  const knownItemTypes = Object.keys(itemTypes).sort().join(', ')
  const knownEnums = [...Object.keys(enums), VIDEO_PROVIDERS].sort().join(', ')

  for (const { path, fields } of eachFieldMap(catalogue)) {
    for (const [fieldName, field] of Object.entries(fields)) {
      const at = `${path}/${fieldName}`

      if (field.of !== undefined && !(field.of in itemTypes)) {
        problems.push(
          `${at}: "of" names the item type "${field.of}", which is not declared. Declare it under itemTypes, or use one of: ${knownItemTypes}.`
        )
      }

      if (field.enum !== undefined) {
        const enumDef =
          field.enum === VIDEO_PROVIDERS ? null : enums[field.enum]
        if (field.enum !== VIDEO_PROVIDERS && !enumDef) {
          problems.push(
            `${at}: "enum" names the value set "${field.enum}", which is not declared. Declare it under enums, or use one of: ${knownEnums}.`
          )
        } else if (enumDef && field.default !== undefined) {
          if (!enumDef.values.includes(field.default)) {
            problems.push(
              `${at}: the default ${JSON.stringify(field.default)} is not one of the "${field.enum}" values (${enumDef.values.join(', ')}). Change the default, or add the value to the enum.`
            )
          }
        }
      }

      if (field.kind === 'videoId' && field.providerField !== undefined) {
        const sibling = fields[field.providerField]
        if (!sibling) {
          problems.push(
            `${at}: "providerField" names "${field.providerField}", which is not a field of the same item. The id pattern is looked up from the provider chosen there. Add that field, or point at one of: ${Object.keys(fields).join(', ')}.`
          )
        } else if (sibling.enum !== VIDEO_PROVIDERS) {
          problems.push(
            `${at}: "providerField" names "${field.providerField}", but that field does not choose a video provider (it would need "enum": "${VIDEO_PROVIDERS}"). Without it there is no pattern to validate the id against.`
          )
        }
      }

      if (field.requiredWhen !== undefined) {
        for (const sibling of Object.keys(field.requiredWhen)) {
          if (!(sibling in fields)) {
            problems.push(
              `${at}: "requiredWhen" depends on "${sibling}", which is not a field of the same item. Point it at one of: ${Object.keys(fields).join(', ')}.`
            )
          }
        }
      }
    }
  }

  for (const [name, enumDef] of Object.entries(enums)) {
    const values = new Set(enumDef.values.map(String))
    for (const key of Object.keys(enumDef.labels ?? {})) {
      if (!values.has(key)) {
        problems.push(
          `enums/${name}/labels/${key}: there is no value "${key}" in this enum, so the label is never shown. Remove it, or add "${key}" to values.`
        )
      }
    }
  }

  for (const [name, sectionType] of Object.entries(
    catalogue.sectionTypes ?? {}
  )) {
    const seen = new Set()
    for (const variant of sectionType.variants ?? []) {
      if (seen.has(variant.name)) {
        problems.push(
          `sectionTypes/${name}/variants: the variant name "${variant.name}" is used twice. Variant names are stored in the content and must identify one variant.`
        )
      }
      seen.add(variant.name)
    }
  }

  return problems
}

/**
 * Validates any catalogue-shaped object and throws one error listing every
 * problem. Reporting only the first would make fixing a catalogue an
 * edit-run-edit-run loop, which is how a reviewer ends up fixing one typo and
 * merging four.
 */
export function validateCatalogue(catalogue, source = CATALOGUE_PATH) {
  const validate = metaValidator()
  const problems = validate(catalogue)
    ? []
    : pruneRedundant(validate.errors ?? []).map(describeAjvError)

  // Cross-references are only meaningful once the shape is known-good;
  // running them on a malformed catalogue produces noise about undefined.
  if (problems.length === 0) problems.push(...crossReferenceProblems(catalogue))

  if (problems.length > 0) {
    const list = problems.map((line, i) => `  ${i + 1}. ${line}`).join('\n')
    throw new Error(
      `${source} is not a valid catalogue (${problems.length} problem${
        problems.length === 1 ? '' : 's'
      }):\n${list}\n\nThe rules are in schema/catalogue.meta.schema.json and docs/spec-v2.md §2.3.`
    )
  }
  return catalogue
}

/**
 * Reads, validates and freezes the catalogue. Memoised: this module is
 * imported by the validator, the extractor and every generator, and each
 * process should pay for the ajv compile once.
 */
export function loadCatalogue() {
  if (!cached) {
    cached = deepFreeze(
      validateCatalogue(readJson(CATALOGUE_URL, CATALOGUE_PATH))
    )
  }
  return cached
}

/**
 * The first step of `npm run validate` (D1): a catalogue typo has to fail on
 * its own, before any consumer builds anything on top of it.
 */
export function assertCatalogueValid() {
  return loadCatalogue()
}

export function sectionTypes() {
  return loadCatalogue().sectionTypes
}

/**
 * The declared name of a section's type. Throws when the section names a type
 * the catalogue does not declare: the renderer drops such a section at runtime
 * (D4), but in CI it means the content and the catalogue are out of step and
 * an editor's work would silently disappear from the page.
 */
export function typeOf(section) {
  const name = section?.type
  const known = sectionTypes()
  if (typeof name !== 'string' || !(name in known)) {
    const where = section?.id ? `Section "${section.id}"` : 'A section'
    throw new Error(
      `${where} has type ${JSON.stringify(
        name
      )}, which is not declared in ${CATALOGUE_PATH}. Add the type to the catalogue, or use one of: ${Object.keys(known).join(', ')}.`
    )
  }
  return name
}

/**
 * The fields a section type declares for itself. The structural fields (`id`,
 * `variant`, `layout`) are deliberately not included: §1.0 has the generator
 * emit them into every branch, so a type that repeated them would produce two
 * conflicting declarations of the same key. Use commonFields() for those.
 */
export function fieldsOf(typeName) {
  const sectionType = sectionTypes()[typeName]
  if (!sectionType) {
    throw new Error(
      `${CATALOGUE_PATH} declares no section type named "${typeName}". Known types: ${Object.keys(
        sectionTypes()
      ).join(', ')}.`
    )
  }
  return sectionType.fields
}

export function itemTypeOf(name) {
  const itemTypes = loadCatalogue().itemTypes
  const itemType = itemTypes[name]
  if (!itemType) {
    throw new Error(
      `${CATALOGUE_PATH} declares no item type named "${name}". Known item types: ${Object.keys(
        itemTypes
      ).join(', ')}.`
    )
  }
  return itemType
}

/**
 * The kind of one field of a section type, falling back to the structural
 * fields every section carries. Throws rather than returning undefined: the
 * callers are the extractor and the validator, and a silent undefined there is
 * exactly the fail-open behaviour of the allowlists this replaces (D6).
 */
export function fieldKind(typeName, fieldName) {
  const field = fieldsOf(typeName)[fieldName] ?? commonFields()[fieldName]
  if (!field) {
    const known = [
      ...Object.keys(fieldsOf(typeName)),
      ...Object.keys(commonFields()),
    ].join(', ')
    throw new Error(
      `Section type "${typeName}" has no field "${fieldName}" in ${CATALOGUE_PATH}. Declare it in the catalogue, or use one of: ${known}.`
    )
  }
  return field.kind
}

/** Exactly the kinds that reach Transifex (§1.0). */
export function isTranslatable(kind) {
  return TRANSLATABLE_KINDS.has(kind)
}

/** The variant descriptors of a section type, in catalogue order. */
export function variantsOf(typeName) {
  const sectionType = sectionTypes()[typeName]
  if (!sectionType) {
    throw new Error(
      `${CATALOGUE_PATH} declares no section type named "${typeName}". Known types: ${Object.keys(
        sectionTypes()
      ).join(', ')}.`
    )
  }
  return sectionType.variants
}

/**
 * The allowed values of a named enum. `videoProviders` answers here too,
 * because an `enum` field may name it (the `video` item type's `provider`).
 */
export function enumValues(name) {
  if (name === VIDEO_PROVIDERS) return Object.keys(videoProviders())
  const enumDef = loadCatalogue().enums[name]
  if (!enumDef) {
    throw new Error(
      `${CATALOGUE_PATH} declares no enum named "${name}". Known enums: ${[
        ...Object.keys(loadCatalogue().enums),
        VIDEO_PROVIDERS,
      ].join(', ')}.`
    )
  }
  return enumDef.values
}

export function videoProviders() {
  return loadCatalogue().videoProviders
}

/** `id`, `variant` and `layout`: carried by every section, declared once. */
export function commonFields() {
  return loadCatalogue().commonFields
}

/** Document-level fields that sit alongside `sections`. */
export function pageFields() {
  return loadCatalogue().page.fields
}
