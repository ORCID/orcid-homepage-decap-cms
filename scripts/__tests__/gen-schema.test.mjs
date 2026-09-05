import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import Ajv from 'ajv/dist/2020.js'
import addFormats from 'ajv-formats'

import { buildSchema } from '../gen/schema.mjs'
import { loadCatalogue } from '../lib/catalogue.mjs'

const committed = JSON.parse(
  readFileSync(
    new URL('../../schema/home.schema.json', import.meta.url),
    'utf8'
  )
)

/** The same construction validate.mjs uses; the schema is only correct there. */
function compile(schema = committed) {
  const ajv = new Ajv({ allErrors: true, strict: false, discriminator: true })
  addFormats(ajv)
  return ajv.compile(schema)
}

function documentWith(sections) {
  return {
    schemaVersion: 2,
    catalogueVersion: 1,
    page: {
      title: 'ORCID is for…',
      description:
        'ORCID provides a persistent digital identifier that distinguishes you from every other researcher.',
    },
    sections,
  }
}

const proseSection = () => ({
  id: 'about',
  type: 'prose',
  variant: 'default',
  layout: { span: 'full', spacing: 'normal', tone: 'default' },
  body: 'ORCID is a free, unique, persistent identifier.',
})

const quickLinksSection = () => ({
  id: 'get-started',
  type: 'quick-links',
  variant: 'bar',
  layout: { span: 'full', spacing: 'loose', tone: 'brand-tint' },
  title: 'Get started with ORCID',
  links: [
    {
      id: 'get-id',
      label: 'Get my ORCID iD',
      href: 'https://orcid.org/signin',
      icon: { src: 'images/id_icon.png', focalPoint: 'center' },
    },
    {
      id: 'membership',
      label: 'Become a member',
      href: 'https://info.orcid.org/membership/',
    },
  ],
})

const mediaImageSection = (image) => ({
  id: 'featured',
  type: 'media',
  variant: 'media-end',
  layout: { span: 'full', spacing: 'normal', tone: 'default' },
  title: 'Researchers',
  mediaKind: 'image',
  image,
})

function errorsFor(document, validate = compile()) {
  assert.equal(validate(document), false, 'expected the document to be invalid')
  return validate.errors
}

test('the committed schema is what the generator produces from the catalogue', () => {
  // Everything below asserts against the committed file, so this is what makes
  // those assertions statements about the generator and not about a stale copy.
  assert.deepEqual(committed, buildSchema(loadCatalogue()))
})

test('ajv compiles the schema when constructed with discriminator support', () => {
  assert.doesNotThrow(() => compile())
})

test('a page with one section of each declared type is valid', () => {
  const validate = compile()
  assert.equal(
    validate(documentWith([proseSection(), quickLinksSection()])),
    true,
    JSON.stringify(validate.errors)
  )
})

test('a section type the catalogue does not declare is rejected', () => {
  const errors = errorsFor(
    documentWith([{ ...proseSection(), type: 'carousel' }])
  )
  assert.ok(
    errors.some((error) => error.keyword === 'discriminator'),
    `expected a discriminator error, got ${JSON.stringify(errors)}`
  )
})

test('a variant belonging to a different section type is rejected', () => {
  // "grid" is a news-feed variant. Nothing about the value is malformed, so
  // only the per-branch enum can catch it.
  const errors = errorsFor(
    documentWith([{ ...proseSection(), variant: 'grid' }])
  )
  assert.ok(
    errors.some((error) => error.instancePath === '/sections/0/variant'),
    `expected the variant to be blamed, got ${JSON.stringify(errors)}`
  )
})

test('every variant the catalogue declares is accepted by its own type', () => {
  const validate = compile()
  for (const [name, sectionType] of Object.entries(
    loadCatalogue().sectionTypes
  )) {
    for (const variant of sectionType.variants) {
      const section = { ...proseSection(), type: name, variant: variant.name }
      const errors = validate(documentWith([section]))
        ? []
        : validate.errors.filter(
            (error) => error.instancePath === '/sections/0/variant'
          )
      assert.deepEqual(
        errors,
        [],
        `${name}/${variant.name} was rejected by its own branch`
      )
    }
  }
})

test('an informative image without alt text is rejected', () => {
  const errors = errorsFor(
    documentWith([
      mediaImageSection({ src: 'images/kaya.png', focalPoint: 'center' }),
    ])
  )
  assert.ok(
    errors.some(
      (error) =>
        error.keyword === 'required' && error.params.missingProperty === 'alt'
    ),
    `expected a missing alt, got ${JSON.stringify(errors)}`
  )
})

test('a decorative image is valid without alt text, and cannot carry one', () => {
  const validate = compile()
  assert.equal(
    validate(documentWith([quickLinksSection()])),
    true,
    JSON.stringify(validate.errors)
  )

  const withAlt = quickLinksSection()
  withAlt.links[0].icon.alt = 'An ORCID iD icon'
  const errors = errorsFor(documentWith([withAlt]), validate)
  assert.ok(
    errors.some(
      (error) =>
        error.instancePath === '/sections/0/links/0/icon' &&
        error.params.additionalProperty === 'alt'
    ),
    `expected alt to be refused on a decorative slot, got ${JSON.stringify(errors)}`
  )
})

test('a field the catalogue does not declare is rejected', () => {
  const errors = errorsFor(
    documentWith([{ ...proseSection(), headingLevel: 2 }])
  )
  assert.ok(
    errors.some(
      (error) =>
        error.keyword === 'additionalProperties' &&
        error.params.additionalProperty === 'headingLevel'
    ),
    `expected the unknown field to be named, got ${JSON.stringify(errors)}`
  )
})

test('a translation may run 1.6x longer than the English cap, but no further', () => {
  const validate = compile()
  // audience-selector/title is capped at 120 in the catalogue. A German
  // translation of a 120-character heading is routinely longer than that, and
  // failing the built bundle for it is the bug §3.2 removes.
  const long = (length) => 'a'.repeat(length)
  const section = () => ({
    id: 'who-we-serve',
    type: 'audience-selector',
    variant: 'stacked',
    layout: { span: 'full', spacing: 'normal', tone: 'default' },
    audiences: [
      {
        id: 'researchers',
        label: 'Researchers',
        intro: 'ORCID is for researchers.',
        features: [{ id: 'yours', body: 'Distinguish yourself.' }],
      },
    ],
  })

  assert.equal(
    validate(documentWith([{ ...section(), title: long(192) }])),
    true,
    JSON.stringify(validate.errors)
  )
  assert.equal(
    validate(documentWith([{ ...section(), title: long(193) }])),
    false
  )
})

test('a plain field refuses a line break, which only a paste can introduce', () => {
  const errors = errorsFor(
    documentWith([{ ...quickLinksSection(), title: 'Get started\nwith ORCID' }])
  )
  assert.ok(
    errors.some((error) => error.instancePath === '/sections/0/title'),
    `expected the title to be blamed, got ${JSON.stringify(errors)}`
  )
})

test('a video id is checked against the provider chosen beside it', () => {
  const validate = compile()
  const video = (provider, videoId) => ({
    id: 'featured',
    type: 'media',
    variant: 'media-below',
    layout: { span: 'full', spacing: 'normal', tone: 'default' },
    mediaKind: 'video',
    video: {
      provider,
      videoId,
      title: 'What your ORCID record can do for you',
      aspectRatio: '16:9',
      poster: {
        src: 'images/poster.png',
        focalPoint: 'center',
        alt: 'A researcher reviewing their ORCID record',
      },
      captions: { available: true, locales: ['en'], autoGenerated: false },
      audioDescription: {
        status: 'not-needed',
        justification: 'The narrator reads every on-screen label aloud.',
      },
    },
  })

  assert.equal(
    validate(documentWith([video('vimeo', '1198760040')])),
    true,
    JSON.stringify(validate.errors)
  )
  // A YouTube id under the Vimeo provider builds a player URL that 404s.
  assert.equal(validate(documentWith([video('vimeo', '1rZvFGLe7bg')])), false)
  assert.equal(
    validate(documentWith([video('youtube', '1rZvFGLe7bg')])),
    true,
    JSON.stringify(validate.errors)
  )
})

test('a section that omits the media its mediaKind promises is rejected', () => {
  const errors = errorsFor(
    documentWith([
      {
        id: 'featured',
        type: 'media',
        variant: 'media-only',
        layout: { span: 'full', spacing: 'normal', tone: 'default' },
        mediaKind: 'image',
      },
    ])
  )
  assert.ok(
    errors.some(
      (error) =>
        error.keyword === 'required' && error.params.missingProperty === 'image'
    ),
    `expected the missing image to be named, got ${JSON.stringify(errors)}`
  )
})

test('the build-generated meta block is optional and closed', () => {
  const validate = compile()
  const meta = {
    locale: 'de',
    version: 'v0.2.0',
    commit: 'a1b2c3d',
    generatedAt: '2026-09-05T10:00:00.000Z',
    translated: 40,
    total: 44,
    untranslated: ['sections.about.body'],
  }
  assert.equal(
    validate({ ...documentWith([proseSection()]), meta }),
    true,
    JSON.stringify(validate.errors)
  )
  assert.equal(
    validate({
      ...documentWith([proseSection()]),
      meta: { ...meta, locale: undefined },
    }),
    false
  )
})

test('the worked document of spec §3.1 would be rejected only for page fields the catalogue does not declare', () => {
  // Recorded as a test rather than a comment: the spec's example page block
  // carries titleStyle and documentTitle, and schema/catalogue.json declares
  // neither. The catalogue is the contract, so the schema refuses them.
  const errors = errorsFor(
    documentWith([proseSection()]).page && {
      ...documentWith([proseSection()]),
      page: {
        title: 'ORCID is for…',
        titleStyle: 'banner',
        documentTitle: 'ORCID',
        description: 'ORCID provides a persistent digital identifier.',
      },
    }
  )
  assert.deepEqual(
    errors
      .filter((error) => error.keyword === 'additionalProperties')
      .map((error) => error.params.additionalProperty)
      .sort(),
    ['documentTitle', 'titleStyle']
  )
})
