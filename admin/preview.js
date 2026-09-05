/**
 * The preview pane, rendered by the real homepage renderer.
 *
 * Decap's default preview lists the fields of an entry. For this content that
 * is close to useless: it shows markdown links as their source, a full-bleed
 * background image at its natural size, and no sense of the tabbed layout the
 * page actually has. An editor cannot tell from it whether a change looks
 * right.
 *
 * Writing a lookalike preview in here would only move the problem: it would be
 * a second implementation of the homepage, drifting from the first the moment
 * either changed. So the pane embeds the registry front end itself, on a route
 * that renders a draft it receives by postMessage. One renderer, and what the
 * editor sees is what the page will do.
 *
 * The renderer runs somewhere else, so its URL is configurable:
 *
 *   …/admin/?renderer=http://localhost:4230/homepage-preview
 *
 * With no renderer configured the pane says so, rather than showing a preview
 * that cannot be trusted.
 */

/** The width the homepage is laid out for; the pane is scaled down from it. */
const DESKTOP_WIDTH = 1280

const MESSAGE_TYPE = 'orcid-homepage-preview'
const READY_TYPE = 'orcid-homepage-preview-ready'

/** Where the published images live, relative to this page. */
const PUBLISHED_CONTENT = '../content/'

function rendererUrl() {
  const configured = new URLSearchParams(window.location.search).get('renderer')
  return configured ? configured.trim() : ''
}

/**
 * A draft names images the way the repository does (`images/icon.png`), but the
 * renderer needs something a browser can fetch. The published, fingerprinted
 * copies are next door, so the seed's map turns one into the other.
 */
function withResolvedImages(content, assets) {
  const resolve = (value) => {
    if (typeof value !== 'string') return value
    const published = assets[value]
    return new URL(
      published || value,
      new URL(PUBLISHED_CONTENT, window.location.href)
    ).toString()
  }

  const walk = (node) => {
    if (Array.isArray(node)) return node.map(walk)
    if (!node || typeof node !== 'object') return node
    const out = {}
    for (const [key, value] of Object.entries(node)) {
      if (key === 'icon' || key === 'background') out[key] = resolve(value)
      else if (value && typeof value === 'object') out[key] = walk(value)
      else out[key] = value
    }
    return out
  }

  return walk(content)
}

function message(text, detail) {
  return window.h(
    'div',
    {
      style: {
        font: '14px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif',
        color: '#2e3d49',
        padding: '24px',
        maxWidth: '46ch',
      },
    },
    window.h('p', { style: { marginTop: 0, fontWeight: 600 } }, text),
    detail ? window.h('p', { style: { color: '#6b7b86' } }, detail) : null
  )
}

export function registerPreview(assets) {
  // The pane is a bare document; without this the embedded page sits inside the
  // browser's default body margin.
  window.CMS.registerPreviewStyle(
    'html,body{margin:0;padding:0;height:100%;overflow:hidden}',
    { raw: true }
  )

  window.CMS.registerPreviewTemplate(
    'home',
    window.createClass({
      getInitialState() {
        return { width: 0 }
      },

      /** The pane can be dragged wider, so the scale is measured, not assumed. */
      measure() {
        if (!this.container) return
        const width = this.container.clientWidth
        if (width && width !== this.state.width) this.setState({ width })
      },

      componentDidMount() {
        this.onResize = () => this.measure()
        // The renderer asks for the draft once it is listening, which avoids a
        // race with the iframe's own startup. It announces itself to its own
        // parent, which is the preview pane's frame rather than this window, so
        // both are listened to.
        this.onReady = (event) => {
          if (event.data && event.data.type === READY_TYPE) this.send()
        }
        this.listeningOn = new Set([window])
        window.addEventListener('message', this.onReady)
        this.send()
      },

      componentDidUpdate() {
        this.send()
      },

      componentWillUnmount() {
        for (const target of this.listeningOn || []) {
          target.removeEventListener('message', this.onReady)
          target.removeEventListener('resize', this.onResize)
        }
      },

      send() {
        const frame = this.frame
        if (!frame || !frame.contentWindow) return
        const entry = this.props.entry
        const data = entry && entry.get('data')
        if (!data) return
        frame.contentWindow.postMessage(
          {
            type: MESSAGE_TYPE,
            content: withResolvedImages(data.toJS(), assets),
          },
          '*'
        )
      },

      render() {
        const url = rendererUrl()

        if (!url) {
          return message(
            'The live preview is not connected.',
            'This pane shows the homepage drawn by the registry front end itself. Add ?renderer=<url of the front end>/homepage-preview to this page’s address to connect it.'
          )
        }

        if (
          window.location.protocol === 'https:' &&
          url.startsWith('http://')
        ) {
          return message(
            'The live preview cannot load over an insecure connection.',
            'This page is served over https, so it cannot embed ' +
              url +
              '. Open the editor from the same machine over http, or point the renderer at an https address.'
          )
        }

        // The homepage is laid out for a desktop, and the pane is a column a
        // third that wide. Rendering at the real width and scaling the result
        // down shows the whole page rather than a cropped left edge.
        const scale = this.state.width
          ? Math.min(1, this.state.width / DESKTOP_WIDTH)
          : 1

        return window.h(
          'div',
          {
            ref: (element) => {
              this.container = element
              this.measure()
            },
            style: {
              width: '100%',
              height: '100vh',
              overflow: 'hidden',
              background: '#fff',
            },
          },
          window.h('iframe', {
            ref: (element) => {
              this.frame = element
              // The pane is its own document, so the renderer's "ready" and the
              // pane's own resizes arrive there rather than in this window.
              const paneWindow =
                element &&
                element.ownerDocument &&
                element.ownerDocument.defaultView
              if (
                paneWindow &&
                this.listeningOn &&
                !this.listeningOn.has(paneWindow)
              ) {
                this.listeningOn.add(paneWindow)
                paneWindow.addEventListener('message', this.onReady)
                paneWindow.addEventListener('resize', this.onResize)
              }
            },
            src: url,
            title: 'Homepage preview',
            style: {
              width: DESKTOP_WIDTH + 'px',
              // Taller than the pane by the same factor, so the scaled result
              // still fills it from top to bottom.
              height: 100 / scale + 'vh',
              border: 0,
              display: 'block',
              background: '#fff',
              transform: 'scale(' + scale + ')',
              transformOrigin: 'top left',
            },
          })
        )
      },
    })
  )
}
