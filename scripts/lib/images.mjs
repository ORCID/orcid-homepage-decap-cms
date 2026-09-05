import { createHash } from 'node:crypto'
import { copyFile, mkdir, readFile } from 'node:fs/promises'
import path from 'node:path'

/**
 * Images are content-addressed on the way into dist/, so a published asset URL
 * never changes meaning. That is what lets the CDN cache assets for a year
 * while the JSON that points at them stays uncached: a new image is a new URL,
 * so nothing has to be purged.
 */

const IMAGE_FIELDS = new Set(['icon', 'background'])

/** Every distinct `images/…` path referenced by the document. */
export function collectImagePaths(node, found = new Set()) {
  if (!node || typeof node !== 'object') return found

  for (const [key, value] of Object.entries(node)) {
    if (typeof value === 'string') {
      if (IMAGE_FIELDS.has(key)) found.add(value)
    } else if (typeof value === 'object') {
      collectImagePaths(value, found)
    }
  }

  return found
}

export async function fingerprint(filePath) {
  const bytes = await readFile(filePath)
  return createHash('sha256').update(bytes).digest('hex').slice(0, 10)
}

/**
 * Copy every referenced image into `<outDir>/assets/` under a fingerprinted
 * name and return the `images/x.png` -> `assets/x-<hash>.png` map. Images that
 * are byte-identical collapse onto one file: the live page reuses the same
 * background across all six tabs.
 */
export async function buildAssets(content, sourceDir, outDir) {
  const assetsDir = path.join(outDir, 'assets')
  await mkdir(assetsDir, { recursive: true })

  const rewrites = new Map()
  const missing = []

  for (const reference of [...collectImagePaths(content)].sort()) {
    const sourcePath = path.join(sourceDir, path.basename(reference))
    let hash
    try {
      hash = await fingerprint(sourcePath)
    } catch {
      missing.push(reference)
      continue
    }

    const extension = path.extname(reference)
    const stem = path.basename(reference, extension)
    const name = `${stem}-${hash}${extension}`
    await copyFile(sourcePath, path.join(assetsDir, name))
    rewrites.set(reference, `assets/${name}`)
  }

  return { rewrites, missing }
}

/** Copy of the document with every image path replaced using `rewrites`. */
export function rewriteImagePaths(node, rewrites) {
  if (Array.isArray(node)) {
    return node.map((item) => rewriteImagePaths(item, rewrites))
  }
  if (!node || typeof node !== 'object') return node

  const out = {}
  for (const [key, value] of Object.entries(node)) {
    if (typeof value === 'string' && IMAGE_FIELDS.has(key)) {
      out[key] = rewrites.get(value) ?? value
    } else if (value && typeof value === 'object') {
      out[key] = rewriteImagePaths(value, rewrites)
    } else {
      out[key] = value
    }
  }
  return out
}
