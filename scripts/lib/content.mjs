import { readFile } from 'node:fs/promises'

import {
  commonFields,
  fieldsOf,
  isTranslatable,
  itemTypeOf,
  loadCatalogue,
} from './catalogue.mjs'

/**
 * Walk a homepage document and decide, for every string in it, whether it is
 * prose that gets translated or structure that never leaves English.
 *
 * The previous version of this file answered that question with two hardcoded
 * lists: field names that count as translatable, and field names that hold
 * keyed arrays. Both failed open. Add a field to the model and forget the list,
 * and its words silently stop reaching translators — with a green build, and no
 * way to notice until a reader sees English in the middle of an Arabic page.
 *
 * Now the catalogue answers instead, and it fails closed: a field nobody
 * declared is an error naming the field and its type, not a shrug. That is the
 * whole reason the catalogue exists.
 *
 * Keys are built from ids, never from positions:
 *
 *   page.title
 *   sections.<sectionId>.<field>
 *   sections.<sectionId>.<listField>.<itemId>.<field>
 *
 * The section's *type* is deliberately absent from the key. An editor who
 * changes a section from one type to another without changing its words keeps
 * every translation; if the words change, Transifex sees a source change on a
 * key it already knows and asks for a retranslation, which is the ordinary
 * path. Putting the type in the key would throw the translations away on every
 * retype.
 */

/** Names that would collide with the merge patch's own vocabulary. */
export const RESERVED_KEY_SEGMENTS = new Set(['__order', '__replace'])

const KEY_SEGMENT = /^[a-z][a-z0-9-]{0,59}$/

export async function readJson(path) {
  const raw = await readFile(path, 'utf8')
  try {
    return JSON.parse(raw)
  } catch (error) {
    throw new Error(`${path} is not valid JSON: ${error.message}`)
  }
}

class ContentError extends Error {}

function fail(where, message) {
  throw new ContentError(`${where}: ${message}`)
}

/**
 * Whether an array is addressed by its items' ids rather than by position.
 *
 * One rule for every array in the document, so there is no list to forget. An
 * array that looks keyed but is not — objects with no id, or a mix of objects
 * and scalars — is an error rather than a skip, because silently treating it as
 * opaque is how translations disappear.
 */
export function isKeyedArray(value) {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every(
      (item) =>
        item !== null &&
        typeof item === 'object' &&
        !Array.isArray(item) &&
        typeof item.id === 'string' &&
        item.id.length > 0
    )
  )
}

function assertSegment(segment, where) {
  if (RESERVED_KEY_SEGMENTS.has(segment)) {
    fail(where, `"${segment}" is reserved and cannot be used as an id`)
  }
  if (!KEY_SEGMENT.test(segment)) {
    fail(
      where,
      `"${segment}" is not a usable key segment: lowercase letters, digits and hyphens, starting with a letter`
    )
  }
}

/**
 * Visit every declared field of one object against its catalogue description.
 *
 * `visit` is called for each translatable string with its dotted key. The same
 * traversal serves extraction and merging, so the two cannot disagree about
 * which strings are translatable — they did, when they were separate functions.
 */
function walkFields(node, fieldDescriptors, path, visit, options) {
  const { strict } = options

  for (const [name, value] of Object.entries(node)) {
    if (name === 'id' || name === 'type' || name === '$comment') continue

    const descriptor = fieldDescriptors[name]
    if (!descriptor) {
      if (strict) {
        fail(
          path.join('.') || 'document',
          `"${name}" is not a field the catalogue declares here. Add it to schema/catalogue.json, or remove it from the content.`
        )
      }
      continue
    }

    walkValue(value, descriptor, [...path, name], visit, options)
  }
}

function walkValue(value, descriptor, path, visit, options) {
  const where = path.join('.')
  const kind = descriptor.kind

  if (value === undefined || value === null) return

  if (isTranslatable(kind)) {
    if (typeof value !== 'string') {
      fail(
        where,
        `expected text, found ${Array.isArray(value) ? 'a list' : typeof value}`
      )
    }
    visit(path, value, descriptor)
    return
  }

  if (kind === 'object' || kind === 'image') {
    if (typeof value !== 'object' || Array.isArray(value)) {
      fail(where, 'expected a group of fields')
    }
    const fields =
      kind === 'image'
        ? itemTypeOf('image').fields
        : itemTypeOf(descriptor.of).fields
    walkFields(value, fields, path, visit, options)
    return
  }

  if (kind === 'list') {
    if (!Array.isArray(value)) fail(where, 'expected a list')
    if (value.length === 0) return

    const itemType = itemTypeOf(descriptor.of)
    // A list of plain scalars (locale tags, for instance) has nothing to
    // translate and no ids to key by; anything else must be id-keyed.
    if (itemType.scalar) return

    if (!isKeyedArray(value)) {
      fail(
        where,
        'every item in this list needs its own non-empty "id"; without one its translations cannot survive being reordered'
      )
    }

    const seen = new Set()
    for (const item of value) {
      assertSegment(item.id, where)
      if (seen.has(item.id)) {
        fail(where, `two items share the id "${item.id}"`)
      }
      seen.add(item.id)
      walkFields(item, itemType.fields, [...path, item.id], visit, options)
    }
    return
  }

  // Everything else — ids, hrefs, enums, numbers, booleans, video ids, notes —
  // is structure. It is identical in every language and never extracted.
}

/**
 * Visit every translatable string in a document.
 *
 * @param {object} document a v2 homepage document
 * @param {(path: string[], value: string, descriptor: object) => void} visit
 * @param {{strict?: boolean}} [options] strict rejects undeclared fields
 */
export function walkTranslatable(document, visit, options = {}) {
  const resolved = { strict: options.strict !== false }
  loadCatalogue()

  if (document.page) {
    walkFields(document.page, pageFieldDescriptors(), ['page'], visit, resolved)
  }

  const sections = document.sections ?? []
  if (!Array.isArray(sections)) {
    fail('sections', 'expected a list of sections')
  }

  const seen = new Set()
  for (const section of sections) {
    if (!section || typeof section !== 'object') {
      fail('sections', 'every section must be a group of fields')
    }
    if (typeof section.id !== 'string' || section.id.length === 0) {
      fail('sections', 'every section needs its own non-empty "id"')
    }
    assertSegment(section.id, 'sections')
    if (seen.has(section.id)) {
      fail('sections', `two sections share the id "${section.id}"`)
    }
    seen.add(section.id)

    const fields = { ...fieldsOf(section.type), ...commonFieldDescriptors() }
    walkFields(section, fields, ['sections', section.id], visit, resolved)
  }
}

function pageFieldDescriptors() {
  const catalogue = loadCatalogue()
  return catalogue.page?.fields ?? {}
}

function commonFieldDescriptors() {
  const common = commonFields()
  // `id` and `type` are skipped by the walker; `variant` and `layout` are
  // structure. They are declared so an undeclared-field error cannot fire on
  // fields every section is required to carry.
  return {
    variant: common.variant,
    layout: common.layout,
  }
}

/** Every translatable key in the document, in document order. */
export function translatableKeys(document, options) {
  const keys = []
  walkTranslatable(document, (path) => keys.push(path.join('.')), options)
  return keys
}

/** Every translatable key mapped to its English value. */
export function translatableStrings(document, options) {
  const out = {}
  walkTranslatable(
    document,
    (path, value) => {
      out[path.join('.')] = value
    },
    options
  )
  return out
}

/**
 * A copy of the document with each translatable string replaced by whatever
 * `replace` returns for its key. Returning undefined keeps the English, which
 * is how a partly translated language shows the rest of the page in English
 * rather than showing nothing.
 */
export function mapTranslatable(document, replace, options = {}) {
  const replacements = new Map()
  walkTranslatable(
    document,
    (path, value, descriptor) => {
      const next = replace(path, value, descriptor)
      if (typeof next === 'string') replacements.set(path.join('.'), next)
    },
    options
  )

  return substitute(document, [], replacements)
}

function substitute(node, path, replacements) {
  if (Array.isArray(node)) {
    return node.map((item) =>
      substitute(
        item,
        item && typeof item === 'object' && typeof item.id === 'string'
          ? [...path, item.id]
          : path,
        replacements
      )
    )
  }
  if (node === null || typeof node !== 'object') return node

  const out = {}
  for (const [key, value] of Object.entries(node)) {
    // `sections` is addressed by section id, and the ids are added by the array
    // branch above, so the field name itself is the only segment added here.
    const at = [...path, key]
    if (typeof value === 'string') {
      const replacement = replacements.get(at.join('.'))
      out[key] = replacement === undefined ? value : replacement
    } else {
      out[key] = substitute(value, at, replacements)
    }
  }
  return out
}

export { isTranslatable }
