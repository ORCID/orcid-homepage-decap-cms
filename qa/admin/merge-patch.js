/**
 * JSON Merge Patch (RFC 7396).
 *
 * The editor in the browser and the workflow that turns a proposal into a pull
 * request both need the same idea of "what changed", so this file is plain ESM
 * with no imports and is loaded by the admin page and imported by the scripts.
 *
 * A merge patch is used rather than the whole document because it travels in a
 * URL: an editor who changed one heading sends a few hundred bytes, and the
 * resulting pull request diff shows only that heading.
 *
 * The one thing a merge patch cannot express is a change inside an array: the
 * whole array is replaced. That is fine here. Arrays in this document are short
 * and their items carry stable ids, so a replaced array still produces a
 * readable diff.
 */

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** The patch that turns `source` into `target`. */
export function diff(source, target) {
  if (!isPlainObject(source) || !isPlainObject(target)) return target

  const patch = {}

  for (const key of Object.keys(target)) {
    if (!(key in source)) {
      patch[key] = target[key]
      continue
    }
    if (isPlainObject(source[key]) && isPlainObject(target[key])) {
      const nested = diff(source[key], target[key])
      if (Object.keys(nested).length > 0) patch[key] = nested
      continue
    }
    if (JSON.stringify(source[key]) !== JSON.stringify(target[key])) {
      patch[key] = target[key]
    }
  }

  for (const key of Object.keys(source)) {
    if (!(key in target)) patch[key] = null
  }

  return patch
}

/** `target` with `patch` applied. Neither argument is modified. */
export function apply(target, patch) {
  if (!isPlainObject(patch)) return patch

  const out = isPlainObject(target) ? { ...target } : {}

  for (const [key, value] of Object.entries(patch)) {
    if (value === null) {
      delete out[key]
    } else if (isPlainObject(value)) {
      out[key] = apply(out[key], value)
    } else {
      out[key] = value
    }
  }

  return out
}
