/**
 * The "markdown-lite" subset that the Angular renderer understands:
 * paragraphs separated by a blank line, **bold**, and [text](url) links.
 *
 * The renderer builds DOM nodes from a parsed tree and never sets innerHTML, so
 * anything outside the subset is not a security hole. It is worse than that for
 * an editor: it renders as literal characters on the live homepage. This lint
 * turns that silent typo into a failed check before a pull request exists.
 *
 * The host allowlist is the one rule that is about safety. It also runs over
 * every file that comes back from translation, where a link could otherwise be
 * rewritten to point anywhere.
 */

const ALLOWED_HOSTS = new Set([
  'orcid.org',
  'info.orcid.org',
  'support.orcid.org',
  'members.orcid.org',
  'sandbox.orcid.org',
  'qa.orcid.org',
  'youtube.com',
  'www.youtube.com',
  'vimeo.com',
  'player.vimeo.com',
])

const LINK = /\[([^\]]*)\]\(([^)]*)\)/g

export function isAllowedHost(host) {
  return ALLOWED_HOSTS.has(host) || host.endsWith('.orcid.org')
}

/**
 * @param {string} value
 * @param {string} where human-readable location, used in the messages
 * @returns {string[]} problems, empty when the value is fine
 */
export function lintMarkdownLite(value, where) {
  const problems = []
  const at = (message) => problems.push(`${where}: ${message}`)

  if (/[<>]/.test(value)) {
    at('raw HTML is not supported, use **bold** or [text](https://…)')
  }
  if (/!\[/.test(value)) {
    at('inline images are not supported, use the icon field instead')
  }

  for (const line of value.split('\n')) {
    const trimmed = line.trim()
    if (/^#{1,6}\s/.test(trimmed)) {
      at('headings are not supported inside a text field')
    }
    if (/^([-*+]|\d+\.)\s/.test(trimmed)) {
      at('lists are not supported inside a text field')
    }
  }

  // A single * is italics in real markdown and renders literally here.
  if (/(^|[^*])\*([^*]|$)/.test(value.replace(/\*\*/g, ''))) {
    at('single * is not supported, use **bold**')
  }

  for (const match of value.matchAll(LINK)) {
    const [, text, url] = match
    if (text.trim() === '') {
      at('a link needs visible text')
    }
    if (url.startsWith('mailto:')) continue
    if (!url.startsWith('https://')) {
      at(`link "${url}" must start with https:// or mailto:`)
      continue
    }
    let host
    try {
      host = new URL(url).host
    } catch {
      at(`link "${url}" is not a valid URL`)
      continue
    }
    if (!isAllowedHost(host)) {
      at(`link host "${host}" is not on the allowlist`)
    }
  }

  // Catch a malformed link before it reaches the page as literal brackets.
  const linkish = (value.match(/\]\(/g) || []).length
  const parsed = [...value.matchAll(LINK)].length
  if (linkish > parsed) {
    at('a link is malformed, the shape is [text](https://…)')
  }

  return problems
}
