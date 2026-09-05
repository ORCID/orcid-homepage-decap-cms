/**
 * Nested translation objects <-> dotted keys.
 *
 * The files under i18n/ are nested objects because that is what Transifex's
 * KEYVALUEJSON format reads most cleanly, but every lookup in the build is by
 * the dotted path that `walkTranslatable` produces. These two functions are the
 * only place that conversion happens.
 */

/** `{a: {b: 'x'}}` -> `{'a.b': 'x'}`. Non-string leaves are dropped. */
export function flatten(node, prefix = []) {
  const out = {}
  if (!node || typeof node !== 'object') return out

  for (const [key, value] of Object.entries(node)) {
    const path = [...prefix, key]
    if (typeof value === 'string') {
      out[path.join('.')] = value
    } else if (value && typeof value === 'object' && !Array.isArray(value)) {
      Object.assign(out, flatten(value, path))
    }
  }

  return out
}

/** `{'a.b': 'x'}` -> `{a: {b: 'x'}}`. */
export function unflatten(flat) {
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
    cursor[parts.at(-1)] = value
  }

  return out
}
