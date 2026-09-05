import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  mapTranslatable,
  translatableKeys,
  walkTranslatable,
} from '../lib/content.mjs'
import { flatten, unflatten } from '../lib/flatten.mjs'

function fixture() {
  return {
    schemaVersion: 1,
    hero: { title: 'Hero' },
    audiences: [
      {
        id: 'researchers',
        label: 'Researchers',
        background: 'images/bg.png',
        intro: 'Intro',
        features: [
          { id: 'one', icon: 'images/a.png', title: 'One', body: 'First' },
          { id: 'two', icon: 'images/b.png', title: 'Two', body: 'Second' },
        ],
      },
    ],
    featuredNews: {
      kicker: 'NEWS',
      title: 'News',
      body: 'Body',
      vimeoId: '123',
    },
    integrate: {
      title: 'Integrate',
      paragraphs: [{ id: 'hub', body: 'Hub' }],
    },
  }
}

test('translatable keys address list items by id, never by index', () => {
  assert.deepEqual(translatableKeys(fixture()), [
    'hero.title',
    'audiences.researchers.label',
    'audiences.researchers.intro',
    'audiences.researchers.features.one.title',
    'audiences.researchers.features.one.body',
    'audiences.researchers.features.two.title',
    'audiences.researchers.features.two.body',
    'featuredNews.kicker',
    'featuredNews.title',
    'featuredNews.body',
    'integrate.title',
    'integrate.paragraphs.hub.body',
  ])
})

test('reordering features does not change any key', () => {
  const reordered = fixture()
  reordered.audiences[0].features.reverse()
  assert.deepEqual(
    translatableKeys(reordered).sort(),
    translatableKeys(fixture()).sort()
  )
})

test('structure is never treated as translatable', () => {
  const seen = []
  walkTranslatable(fixture(), (path, value) => seen.push(value))
  for (const structural of [
    'images/bg.png',
    'images/a.png',
    '123',
    'researchers',
  ]) {
    assert.ok(!seen.includes(structural), `${structural} must not be extracted`)
  }
})

test('a list item without an id is rejected', () => {
  const broken = fixture()
  delete broken.audiences[0].features[0].id
  assert.throws(() => translatableKeys(broken), /needs a non-empty string "id"/)
})

test('a duplicate id in one list is rejected', () => {
  const broken = fixture()
  broken.audiences[0].features[1].id = 'one'
  assert.throws(() => translatableKeys(broken), /duplicate id "one"/)
})

test('the same id in two different lists is fine', () => {
  const content = fixture()
  content.audiences.push({
    ...content.audiences[0],
    id: 'publishers',
    label: 'Publishers',
  })
  // Six more keys: the label, the intro and a title and body per feature.
  assert.equal(translatableKeys(content).length, 18)
})

test('mapTranslatable replaces prose and leaves structure alone', () => {
  const translated = mapTranslatable(fixture(), (path) => `<${path.at(-1)}>`)
  assert.equal(translated.hero.title, '<title>')
  assert.equal(translated.audiences[0].features[0].body, '<body>')
  assert.equal(translated.audiences[0].background, 'images/bg.png')
  assert.equal(translated.featuredNews.vimeoId, '123')
  assert.equal(translated.audiences[0].id, 'researchers')
})

test('an undefined replacement keeps the English string', () => {
  const partial = mapTranslatable(fixture(), (path) =>
    path.join('.') === 'hero.title' ? 'Nadpis' : undefined
  )
  assert.equal(partial.hero.title, 'Nadpis')
  assert.equal(partial.featuredNews.body, 'Body')
})

test('mapTranslatable does not modify its input', () => {
  const original = fixture()
  mapTranslatable(original, () => 'changed')
  assert.deepEqual(original, fixture())
})

test('flatten and unflatten round trip', () => {
  const nested = { a: { b: 'x', c: { d: 'y' } }, e: 'z' }
  const flat = flatten(nested)
  assert.deepEqual(flat, { 'a.b': 'x', 'a.c.d': 'y', e: 'z' })
  assert.deepEqual(unflatten(flat), nested)
})

test('flatten drops non-string leaves rather than inventing keys', () => {
  assert.deepEqual(flatten({ a: 'x', b: 3, c: null, d: ['y'] }), { a: 'x' })
})
