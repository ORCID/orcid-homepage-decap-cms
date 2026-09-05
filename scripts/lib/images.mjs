import { createHash } from 'node:crypto'
import { copyFile, mkdir, readFile } from 'node:fs/promises'
import path from 'node:path'

/**
 * Images are content-addressed on the way into dist/, so a published asset URL
 * never changes meaning. That is what lets the CDN cache assets for a year
 * while the JSON that points at them stays uncached: a new image is a new URL,
 * so nothing has to be purged.
 */

/**
 * Any string that looks like a path into the image folder.
 *
 * This used to be a list of field names — `icon` and `background` — which was
 * fine while the page had exactly one shape. With sections an editor composes,
 * an image can sit under any field of any type, and a name-based rule silently
 * misses the ones nobody thought to add: a page of broken pictures with a green
 * build. Matching on the value instead cannot miss one, and it finds images in
 * the old bare-string shape as well as the object shape that replaced it.
 */
const IMAGE_PATH = /^(images|assets)\/[A-Za-z0-9._-]+\.(png|jpe?g|svg|webp)$/

export function isImagePath(value) {
  return typeof value === 'string' && IMAGE_PATH.test(value)
}

/** Every distinct image path in the document, wherever it sits. */
export function collectImagePaths(node, found = new Set()) {
  if (isImagePath(node)) {
    found.add(node)
    return found
  }
  if (Array.isArray(node)) {
    for (const item of node) collectImagePaths(item, found)
    return found
  }
  if (node && typeof node === 'object') {
    for (const value of Object.values(node)) collectImagePaths(value, found)
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
  if (isImagePath(node)) return rewrites.get(node) ?? node
  if (Array.isArray(node)) {
    return node.map((item) => rewriteImagePaths(item, rewrites))
  }
  if (!node || typeof node !== 'object') return node

  const out = {}
  for (const [key, value] of Object.entries(node)) {
    out[key] = rewriteImagePaths(value, rewrites)
  }
  return out
}
