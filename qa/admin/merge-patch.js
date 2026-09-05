/**
 * The change format that travels from the editor to a pull request.
 *
 * This is JSON Merge Patch (RFC 7396) with one addition. A merge patch cannot
 * describe a change *inside* an array: the whole array is replaced. For this
 * document that is fatal to the whole idea, because the audiences array carries
 * every tab's text and images, so correcting one heading would send several
 * kilobytes through a URL and produce a pull request diff that appears to
 * rewrite the entire page.
 *
 * So the arrays whose items carry a stable `id` are diffed by that id instead
 * of by position. Changing one feature title yields
 *
 *   { "audiences": { "researchers": { "features": {
 *       "uniquely-yours": { "title": "…" } } } } }
 *
 * which is small enough for a link and reads, in the pull request, as exactly
 * the edit that was made. It is the same id-keyed shape the translation files
 * use, for the same reason: position is not identity.
 *
 * Both sides of the hand-off load this file, the editor in the browser and the
 * workflow in Node, so it stays dependency-free ESM.
 */

/** Arrays whose items are identified by `id` rather than by position. */
const KEYED_ARRAYS = new Set(['audiences', 'features', 'paragraphs'])

/** Records an order that no longer matches the order of the keys. */
const ORDER_KEY = '__order'

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isKeyedArray(key, value) {
  return (
    KEYED_ARRAYS.has(key) &&
    Array.isArray(value) &&
    value.every((item) => isPlainObject(item) && typeof item.id === 'string')
  )
}

function byId(items) {
  return new Map(items.map((item) => [item.id, item]))
}

function sameJson(a, b) {
  return JSON.stringify(a) === JSON.stringify(b)
}

/** The patch that turns `source` into `target`. */
export function diff(source, target) {
  return diffValue(source, target, null)
}

function diffValue(source, target, key) {
  if (isKeyedArray(key, source) && isKeyedArray(key, target)) {
    return diffKeyedArray(source, target)
  }
  if (!isPlainObject(source) || !isPlainObject(target)) {
    return target
  }
  return diffObject(source, target)
}

function diffObject(source, target) {
  const patch = {}

  for (const key of Object.keys(target)) {
    if (!(key in source)) {
      patch[key] = target[key]
      continue
    }
    if (
      isKeyedArray(key, source[key]) ||
      (isPlainObject(source[key]) && isPlainObject(target[key]))
    ) {
      const nested = diffValue(source[key], target[key], key)
      if (isPlainObject(nested)) {
        if (Object.keys(nested).length > 0) patch[key] = nested
      } else if (!sameJson(source[key], target[key])) {
        patch[key] = nested
      }
      continue
    }
    if (!sameJson(source[key], target[key])) {
      patch[key] = target[key]
    }
  }

  for (const key of Object.keys(source)) {
    if (!(key in target)) patch[key] = null
  }

  return patch
}

function diffKeyedArray(source, target) {
  const before = byId(source)
  const after = byId(target)
  const patch = {}

  for (const [id, item] of after) {
    if (!before.has(id)) {
      patch[id] = item
      continue
    }
    const nested = diffObject(before.get(id), item)
    if (Object.keys(nested).length > 0) patch[id] = nested
  }

  for (const id of before.keys()) {
    if (!after.has(id)) patch[id] = null
  }

  // Order is only worth sending when it actually moved, so a text edit does not
  // carry the whole running order with it.
  const beforeOrder = [...before.keys()].filter((id) => after.has(id))
  const afterOrder = [...after.keys()]
  if (!sameJson(beforeOrder, afterOrder)) {
    patch[ORDER_KEY] = afterOrder
  }

  return patch
}

/** `target` with `patch` applied. Neither argument is modified. */
export function apply(target, patch) {
  return applyValue(target, patch, null)
}

function applyValue(target, patch, key) {
  if (isKeyedArray(key, target) && isPlainObject(patch)) {
    return applyKeyedArray(target, patch)
  }
  if (!isPlainObject(patch)) return patch
  return applyObject(target, patch)
}

function applyObject(target, patch) {
  const out = isPlainObject(target) ? { ...target } : {}

  for (const [key, value] of Object.entries(patch)) {
    if (value === null) {
      delete out[key]
    } else if (isKeyedArray(key, out[key]) && isPlainObject(value)) {
      out[key] = applyKeyedArray(out[key], value)
    } else if (isPlainObject(value)) {
      out[key] = applyObject(out[key], value)
    } else {
      out[key] = value
    }
  }

  return out
}

function applyKeyedArray(target, patch) {
  const existing = byId(target)
  const order = Array.isArray(patch[ORDER_KEY]) ? patch[ORDER_KEY] : null
  const result = new Map(existing)

  for (const [id, value] of Object.entries(patch)) {
    if (id === ORDER_KEY) continue
    if (value === null) {
      result.delete(id)
      continue
    }
    result.set(
      id,
      existing.has(id) ? applyObject(existing.get(id), value) : { id, ...value }
    )
  }

  if (!order) return [...result.values()]

  // Anything the order forgot keeps its place at the end, so a malformed
  // proposal cannot silently drop a tab.
  const ordered = order
    .filter((id) => result.has(id))
    .map((id) => result.get(id))
  const missing = [...result.keys()].filter((id) => !order.includes(id))
  return [...ordered, ...missing.map((id) => result.get(id))]
}
