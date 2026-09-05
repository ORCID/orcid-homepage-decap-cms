import { readFile } from 'node:fs/promises'

/**
 * Fields whose value is prose shown to a visitor, and therefore translated.
 * Everything else in the document (ids, image paths, the Vimeo id) is
 * structure: it must be identical in every locale, so it never reaches
 * Transifex and can never be changed by a translator.
 */
export const TRANSLATABLE_FIELDS = new Set([
  'title',
  'label',
  'intro',
  'body',
  'kicker',
])

/** Keys that hold a list of items identified by a stable `id`. */
const KEYED_ARRAYS = new Set(['audiences', 'features', 'paragraphs'])

export async function readJson(path) {
  const raw = await readFile(path, 'utf8')
  try {
    return JSON.parse(raw)
  } catch (error) {
    throw new Error(`${path} is not valid JSON: ${error.message}`)
  }
}

/**
 * Walk every translatable string in a content document.
 *
 * Array items are addressed by their `id`, never by their index, so reordering
 * the audiences or renaming a tab label does not orphan a single translation.
 * Only renaming an `id` does, which is why `id` is documented as permanent and
 * why CI reports removed keys on every pull request.
 *
 * @param {object} content
 * @param {(path: string[], value: string) => void} visit
 */
export function walkTranslatable(content, visit) {
  walkNode(content, [], visit)
}

function walkNode(node, path, visit) {
  for (const [key, value] of Object.entries(node)) {
    if (key === 'meta' || key === 'schemaVersion') continue

    if (typeof value === 'string') {
      if (TRANSLATABLE_FIELDS.has(key)) visit([...path, key], value)
      continue
    }

    if (Array.isArray(value)) {
      if (!KEYED_ARRAYS.has(key)) continue
      const seen = new Set()
      for (const item of value) {
        if (!item || typeof item.id !== 'string' || item.id === '') {
          throw new Error(
            `every item in "${[...path, key].join('.')}" needs a non-empty string "id"`
          )
        }
        if (seen.has(item.id)) {
          throw new Error(
            `duplicate id "${item.id}" in "${[...path, key].join('.')}"`
          )
        }
        seen.add(item.id)
        walkNode(item, [...path, key, item.id], visit)
      }
      continue
    }

    if (value && typeof value === 'object') {
      walkNode(value, [...path, key], visit)
    }
  }
}

/**
 * Copy a content document, replacing each translatable string with whatever
 * `replace` returns for it. Returning `undefined` keeps the original, which is
 * how a locale missing one key falls back to English for that key alone
 * instead of for the whole page.
 *
 * @param {object} content
 * @param {(path: string[], value: string) => string | undefined} replace
 */
export function mapTranslatable(content, replace) {
  return mapNode(content, [], replace)
}

function mapNode(node, path, replace) {
  const out = Array.isArray(node) ? [] : {}

  for (const [key, value] of Object.entries(node)) {
    if (typeof value === 'string' && TRANSLATABLE_FIELDS.has(key)) {
      const replacement = replace([...path, key], value)
      out[key] = typeof replacement === 'string' ? replacement : value
      continue
    }

    if (Array.isArray(value)) {
      out[key] = KEYED_ARRAYS.has(key)
        ? value.map((item) => mapNode(item, [...path, key, item.id], replace))
        : value
      continue
    }

    if (value && typeof value === 'object') {
      out[key] = mapNode(value, [...path, key], replace)
      continue
    }

    out[key] = value
  }

  return out
}

/** Every translatable key in the document, as dotted paths, in document order. */
export function translatableKeys(content) {
  const keys = []
  walkTranslatable(content, (path) => keys.push(path.join('.')))
  return keys
}
