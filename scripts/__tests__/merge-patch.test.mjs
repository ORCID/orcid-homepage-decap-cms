import assert from 'node:assert/strict'
import { test } from 'node:test'

import { apply, diff } from '../../admin/merge-patch.js'

test('a patch describes only what changed', () => {
  const before = { hero: { title: 'A' }, featuredNews: { vimeoId: '1' } }
  const after = { hero: { title: 'B' }, featuredNews: { vimeoId: '1' } }
  assert.deepEqual(diff(before, after), { hero: { title: 'B' } })
})

test('an unchanged document produces an empty patch', () => {
  const document = { hero: { title: 'A' }, list: [1, 2] }
  assert.deepEqual(diff(document, structuredClone(document)), {})
})

test('applying a patch reproduces the target', () => {
  const before = {
    schemaVersion: 1,
    hero: { title: 'ORCID is for…' },
    audiences: [{ id: 'a', label: 'A' }],
  }
  const after = structuredClone(before)
  after.hero.title = 'ORCID is for everyone'
  after.audiences[0].label = 'Researchers'

  assert.deepEqual(apply(before, diff(before, after)), after)
})

test('an array is replaced whole, which keeps reordering lossless', () => {
  const before = { items: [{ id: 'a' }, { id: 'b' }] }
  const after = { items: [{ id: 'b' }, { id: 'a' }] }
  assert.deepEqual(apply(before, diff(before, after)), after)
})

test('a removed key becomes an explicit null and is deleted on apply', () => {
  const before = { a: 'x', b: 'y' }
  const after = { a: 'x' }
  assert.deepEqual(diff(before, after), { b: null })
  assert.deepEqual(apply(before, { b: null }), { a: 'x' })
})

test('apply does not modify the document it is given', () => {
  const before = { hero: { title: 'A' } }
  apply(before, { hero: { title: 'B' } })
  assert.deepEqual(before, { hero: { title: 'A' } })
})

test('a patch that changes nothing is safe to apply twice', () => {
  const document = { hero: { title: 'A' } }
  const patch = { hero: { title: 'B' } }
  assert.deepEqual(apply(apply(document, patch), patch), {
    hero: { title: 'B' },
  })
})

// Arrays whose items carry an id are diffed by that id, not by position. This
// is what keeps a one-word edit small enough to travel in a URL, and what makes
// the resulting pull request show one line instead of a rewritten page.

function page() {
  return {
    schemaVersion: 1,
    hero: { title: 'ORCID is for…' },
    audiences: [
      {
        id: 'researchers',
        label: 'Researchers',
        background: 'images/bg.png',
        intro: 'Intro one',
        features: [
          {
            id: 'uniquely-yours',
            icon: 'images/a.png',
            title: 'Uniquely Yours',
            body: 'A',
          },
          {
            id: 'portable',
            icon: 'images/b.png',
            title: 'Portable',
            body: 'B',
          },
        ],
      },
      {
        id: 'publishers',
        label: 'Publishers',
        background: 'images/bg.png',
        intro: 'Intro two',
        features: [
          {
            id: 'know-authors',
            icon: 'images/c.png',
            title: 'Know authors',
            body: 'C',
          },
          {
            id: 'portable',
            icon: 'images/b.png',
            title: 'Portable',
            body: 'B',
          },
        ],
      },
    ],
  }
}

test('editing one feature title patches only that feature', () => {
  const before = page()
  const after = page()
  after.audiences[0].features[0].title = 'Uniquely yours, always'

  const patch = diff(before, after)
  assert.deepEqual(patch, {
    audiences: {
      researchers: {
        features: { 'uniquely-yours': { title: 'Uniquely yours, always' } },
      },
    },
  })
  assert.deepEqual(apply(before, patch), after)
})

test('a small edit stays small enough to travel in a URL', () => {
  const before = page()
  const after = page()
  after.audiences[1].intro = 'A shorter introduction.'

  const encoded = encodeURIComponent(JSON.stringify(diff(before, after)))
  assert.ok(encoded.length < 500, `patch was ${encoded.length} characters`)
})

test('reordering audiences is recorded without resending their content', () => {
  const before = page()
  const after = page()
  after.audiences.reverse()

  const patch = diff(before, after)
  assert.deepEqual(patch, {
    audiences: { __order: ['publishers', 'researchers'] },
  })
  assert.deepEqual(apply(before, patch), after)
})

test('adding and removing an audience round trips', () => {
  const before = page()
  const after = page()
  after.audiences.pop()
  after.audiences.push({
    id: 'funders',
    label: 'Funders',
    background: 'images/bg.png',
    intro: 'Intro three',
    features: [
      {
        id: 'know-researchers',
        icon: 'images/d.png',
        title: 'Know researchers',
        body: 'D',
      },
      { id: 'impact', icon: 'images/e.png', title: 'Impact', body: 'E' },
    ],
  })

  const patch = diff(before, after)
  assert.equal(patch.audiences.publishers, null)
  assert.equal(patch.audiences.funders.label, 'Funders')
  assert.deepEqual(apply(before, patch), after)
})

test('the same feature id under two audiences is patched independently', () => {
  const before = page()
  const after = page()
  after.audiences[1].features[1].body = 'Only the publishers copy changes'

  const patch = diff(before, after)
  assert.equal(patch.audiences.researchers, undefined)
  assert.deepEqual(apply(before, patch).audiences[0], before.audiences[0])
  assert.equal(
    apply(before, patch).audiences[1].features[1].body,
    'Only the publishers copy changes'
  )
})

test('an order that forgets an id keeps it rather than dropping it', () => {
  const before = page()
  const patched = apply(before, { audiences: { __order: ['publishers'] } })
  assert.deepEqual(
    patched.audiences.map((a) => a.id),
    ['publishers', 'researchers']
  )
})

test('an unchanged page still produces an empty patch', () => {
  assert.deepEqual(diff(page(), page()), {})
})
