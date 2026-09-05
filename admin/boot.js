/**
 * Boots the homepage editor and carries an edit over to GitHub.
 *
 * Two things happen here that a stock Decap install does not do.
 *
 * First, the CMS runs on the `test-repo` backend, which is an in-memory
 * repository that starts out empty. Before the CMS initialises, the published
 * content and its images are loaded into `window.repoFiles`, so the editor
 * opens on the real page instead of on blank fields.
 *
 * Second, saving cannot write to GitHub, because doing that from a static page
 * would mean shipping a credential to every visitor. Instead the change is
 * turned into a JSON Merge Patch and handed to GitHub as a prefilled issue.
 * GitHub asks the editor to sign in, a workflow turns the issue into a pull
 * request, and a maintainer merges it. Authentication and review are GitHub's,
 * and this page stays a plain static file with nothing to leak.
 */
import { apply, diff } from './merge-patch.js'
import { registerPreview } from './preview.js'

const REPOSITORY = 'ORCID/orcid-homepage-decap-cms'
const CONTENT_PATH = 'content/home.en.json'
const MEDIA_FOLDER = 'content/images'

/** GitHub rejects a very long URL with 414, so hand over the clipboard instead. */
const MAX_URL_LENGTH = 6000

let seed = null

function put(tree, filePath, content) {
  const segments = filePath.split('/')
  let node = tree
  while (segments.length > 1) {
    const segment = segments.shift()
    node[segment] = node[segment] || {}
    node = node[segment]
  }
  node[segments[0]] = { path: filePath, content }
}

/**
 * Decap's media library reads `fileObj` off each asset and calls
 * `URL.createObjectURL` on it, so a seeded image has to be a real File, not a
 * URL. They are fetched from the published, fingerprinted copies next door.
 */
async function seedImage(tree, name, assetUrl) {
  const response = await fetch(assetUrl)
  if (!response.ok) throw new Error(`${assetUrl} -> HTTP ${response.status}`)
  const blob = await response.blob()
  const fileObj = new File([blob], name, { type: blob.type })
  const objectUrl = URL.createObjectURL(fileObj)

  put(tree, `${MEDIA_FOLDER}/${name}`, {
    path: `${MEDIA_FOLDER}/${name}`,
    fileObj,
    toString: () => objectUrl,
  })
}

let publishedAssets = {}

async function loadSeed() {
  const [content, assets] = await Promise.all([
    fetch('./seed/home.en.json').then((r) => r.json()),
    fetch('./seed/assets.json')
      .then((r) => r.json())
      .catch(() => ({})),
  ])

  const tree = {}
  put(tree, CONTENT_PATH, `${JSON.stringify(content, null, 2)}\n`)

  await Promise.all(
    Object.entries(assets).map(([source, published]) =>
      seedImage(tree, source.split('/').pop(), `../content/${published}`).catch(
        (problem) => {
          // A missing preview must not stop the editor from opening.
          console.warn(`could not seed ${source}:`, problem.message)
        }
      )
    )
  )

  window.repoFiles = tree
  publishedAssets = assets
  return content
}

/** Whatever the editor currently holds, read back out of the in-memory repo. */
function currentContent() {
  const file = window.repoFiles?.content?.['home.en.json']
  if (!file || typeof file.content !== 'string') return null
  try {
    return JSON.parse(file.content)
  } catch {
    return null
  }
}

function issueUrl(patch, includePatch) {
  const changed = Object.keys(patch).join(', ')
  const url = new URL(`https://github.com/${REPOSITORY}/issues/new`)
  url.searchParams.set('template', 'content-proposal.yml')
  url.searchParams.set('labels', 'content-proposal')
  url.searchParams.set('title', `Homepage content: update ${changed}`)
  if (includePatch) {
    url.searchParams.set('patch', JSON.stringify(patch, null, 2))
  }
  return url.toString()
}

function setStatus(message) {
  const status = document.getElementById('propose-status')
  if (status) status.textContent = message
}

async function propose() {
  const current = currentContent()
  if (!current) {
    setStatus('Publish your change first.')
    return
  }

  const patch = diff(seed, current)
  if (Object.keys(patch).length === 0) {
    setStatus('No changes yet.')
    return
  }

  // The patch is what the workflow applies, so check here that it really does
  // reproduce what the editor sees. A silent mismatch would open a pull request
  // that does not match the preview.
  if (JSON.stringify(apply(seed, patch)) !== JSON.stringify(current)) {
    setStatus('Could not describe this change. Please report it.')
    return
  }

  const withPatch = issueUrl(patch, true)
  if (withPatch.length <= MAX_URL_LENGTH) {
    setStatus('Opening GitHub…')
    window.open(withPatch, '_blank', 'noopener')
    return
  }

  try {
    await navigator.clipboard.writeText(JSON.stringify(patch, null, 2))
    setStatus('Change copied. Paste it into the GitHub form.')
  } catch {
    setStatus('Change is too large for a link. Copy it from the console.')
    console.info(JSON.stringify(patch, null, 2))
  }
  window.open(issueUrl(patch, false), '_blank', 'noopener')
}

function addProposeBar() {
  const bar = document.createElement('div')
  bar.id = 'propose-bar'
  bar.innerHTML = `
    <p>
      Editing a local copy. Nothing here is published.
      Choose <strong>Publish</strong> to record your change, then send it to
      GitHub for review.
    </p>
    <span id="propose-status"></span>
    <button type="button" id="propose-button">Propose on GitHub</button>
  `
  document.body.appendChild(bar)
  document.getElementById('propose-button').addEventListener('click', propose)
}

async function main() {
  if (!window.CMS) {
    document.body.innerHTML =
      '<p style="font:16px system-ui;margin:2rem">The content editor could not load. Check your network connection and reload.</p>'
    return
  }

  seed = await loadSeed()

  // Registered before init so the pane is in place for the first render.
  registerPreview(publishedAssets)

  window.CMS.init()

  // Publishing offers the hand-off straight away; the button covers the case
  // where the editor has already published and comes back to it later.
  window.CMS.registerEventListener({
    name: 'postPublish',
    handler: () => {
      propose().catch((problem) => console.warn(problem))
    },
  })

  addProposeBar()
}

main().catch((problem) => {
  console.error(problem)
  document.body.innerHTML = `<p style="font:16px system-ui;margin:2rem">The content editor could not start: ${problem.message}</p>`
})
