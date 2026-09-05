import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  isKeyedArray,
  mapTranslatable,
  translatableKeys,
  translatableStrings,
} from '../lib/content.mjs'
import { flatten, unflatten } from '../lib/flatten.mjs'

/** A small but real document: two sections, one of them with nested items. */
function fixture() {
  return {
    schemaVersion: 2,
    catalogueVersion: 1,
    page: { title: 'ORCID is for…', description: 'One sentence.' },
    sections: [
      {
        id: 'who-we-serve',
        type: 'audience-selector',
        variant: 'tabs-photo',
        layout: { span: 'full', spacing: 'normal', tone: 'brand-dark' },
        audiences: [
          {
            id: 'researchers',
            label: 'Researchers',
            intro: 'Intro for researchers',
            background: { src: 'images/bg.png', focalPoint: 'center' },
            features: [
              {
                id: 'uniquely-yours',
                title: 'Uniquely Yours',
                body: 'First feature',
                icon: { src: 'images/a.png' },
              },
              { id: 'portable', title: 'Portable', body: 'Second feature' },
            ],
          },
        ],
      },
      {
        id: 'get-started',
        type: 'quick-links',
        variant: 'bar',
        layout: { span: 'full', spacing: 'compact', tone: 'brand-tint' },
        title: 'Get started',
        titleHidden: true,
        links: [
          { id: 'sign-in', label: 'Sign in', href: 'https://orcid.org/signin' },
          { id: 'help', label: 'Get help', href: 'https://support.orcid.org/' },
        ],
      },
    ],
  }
}

test('keys are built from ids, so nothing depends on position', () => {
  assert.deepEqual(translatableKeys(fixture()), [
    'page.title',
    'page.description',
    'sections.who-we-serve.audiences.researchers.label',
    'sections.who-we-serve.audiences.researchers.intro',
    'sections.who-we-serve.audiences.researchers.features.uniquely-yours.title',
    'sections.who-we-serve.audiences.researchers.features.uniquely-yours.body',
    'sections.who-we-serve.audiences.researchers.features.portable.title',
    'sections.who-we-serve.audiences.researchers.features.portable.body',
    'sections.get-started.title',
    'sections.get-started.links.sign-in.label',
    'sections.get-started.links.help.label',
  ])
})

test('reordering sections changes no key at all', () => {
  const reordered = fixture()
  reordered.sections.reverse()

  assert.deepEqual(
    translatableKeys(reordered).sort(),
    translatableKeys(fixture()).sort()
  )
})

test('reordering items inside a section changes no key either', () => {
  const reordered = fixture()
  reordered.sections[0].audiences[0].features.reverse()

  assert.deepEqual(
    translatableKeys(reordered).sort(),
    translatableKeys(fixture()).sort()
  )
})

test('the section type is absent from the key, so retyping keeps the words', () => {
  for (const key of translatableKeys(fixture())) {
    assert.ok(
      !key.includes('audience-selector') && !key.includes('quick-links'),
      `${key} names a section type, which would orphan translations on a retype`
    )
  }
})

test('structure is never offered for translation', () => {
  const strings = translatableStrings(fixture())
  const values = Object.values(strings)

  for (const structural of [
    'images/bg.png',
    'images/a.png',
    'https://orcid.org/signin',
    'tabs-photo',
    'brand-dark',
  ]) {
    assert.ok(
      !values.includes(structural),
      `${structural} must never reach a translator`
    )
  }
})

test('a field the catalogue does not declare is an error, not a shrug', () => {
  const broken = fixture()
  broken.sections[1].subtitle = 'Nobody declared this'

  assert.throws(
    () => translatableKeys(broken),
    /"subtitle" is not a field the catalogue declares/
  )
})

test('a list item with no id is rejected, because its translations could not survive', () => {
  const broken = fixture()
  delete broken.sections[0].audiences[0].features[0].id

  assert.throws(() => translatableKeys(broken), /needs its own non-empty "id"/)
})

test('two items sharing an id are rejected', () => {
  const broken = fixture()
  broken.sections[0].audiences[0].features[1].id = 'uniquely-yours'

  assert.throws(() => translatableKeys(broken), /share the id "uniquely-yours"/)
})

test('two sections sharing an id are rejected', () => {
  const broken = fixture()
  broken.sections[1].id = 'who-we-serve'

  assert.throws(() => translatableKeys(broken), /share the id "who-we-serve"/)
})

test('the same item id under two different sections is fine', () => {
  const content = fixture()
  content.sections[1].links[0].id = 'researchers'

  assert.ok(
    translatableKeys(content).includes(
      'sections.get-started.links.researchers.label'
    )
  )
})

test('a reserved word cannot be used as an id', () => {
  const broken = fixture()
  broken.sections[1].links[0].id = '__order'

  assert.throws(() => translatableKeys(broken), /reserved/)
})

test('an id that could not be a key segment is rejected', () => {
  const broken = fixture()
  broken.sections[1].links[0].id = 'Has Spaces'

  assert.throws(() => translatableKeys(broken), /not a usable key segment/)
})

test('translated strings replace the English and leave structure alone', () => {
  const translated = mapTranslatable(fixture(), (path) => `<${path.join('.')}>`)

  assert.equal(translated.page.title, '<page.title>')
  assert.equal(
    translated.sections[0].audiences[0].features[0].body,
    '<sections.who-we-serve.audiences.researchers.features.uniquely-yours.body>'
  )
  assert.equal(translated.sections[0].variant, 'tabs-photo')
  assert.equal(
    translated.sections[0].audiences[0].background.src,
    'images/bg.png'
  )
  assert.equal(translated.sections[1].links[0].href, 'https://orcid.org/signin')
  assert.equal(translated.sections[1].links[0].id, 'sign-in')
})

test('a language missing one string keeps the English for that string only', () => {
  const partial = mapTranslatable(fixture(), (path) =>
    path.join('.') === 'page.title' ? 'ORCID je pro…' : undefined
  )

  assert.equal(partial.page.title, 'ORCID je pro…')
  assert.equal(partial.page.description, 'One sentence.')
  assert.equal(partial.sections[1].links[0].label, 'Sign in')
})

test('translating does not modify the document it was given', () => {
  const original = fixture()
  mapTranslatable(original, () => 'changed')

  assert.deepEqual(original, fixture())
})

describe_keyed_arrays()

function describe_keyed_arrays() {
  test('an array of id-carrying objects is keyed', () => {
    assert.ok(isKeyedArray([{ id: 'a' }, { id: 'b' }]))
  })

  test('an empty array is not keyed, because there is nothing to key by', () => {
    assert.ok(!isKeyedArray([]))
  })

  test('an array of scalars is not keyed', () => {
    assert.ok(!isKeyedArray(['a', 'b']))
  })

  test('an array mixing objects and scalars is not keyed', () => {
    assert.ok(!isKeyedArray([{ id: 'a' }, 'b']))
  })

  test('an object with an empty id does not count', () => {
    assert.ok(!isKeyedArray([{ id: '' }]))
  })
}

test('flatten and unflatten round trip', () => {
  const nested = { a: { b: 'x', c: { d: 'y' } }, e: 'z' }
  const flat = flatten(nested)

  assert.deepEqual(flat, { 'a.b': 'x', 'a.c.d': 'y', e: 'z' })
  assert.deepEqual(unflatten(flat), nested)
})

test('the real content walks without error', async () => {
  const { readJson } = await import('../lib/content.mjs')
  const content = await readJson(
    new URL('../../content/home.en.json', import.meta.url).pathname
  )

  const keys = translatableKeys(content)
  assert.ok(keys.length > 0)
  assert.ok(keys.includes('page.title'))
  assert.equal(new Set(keys).size, keys.length, 'every key is unique')
})
