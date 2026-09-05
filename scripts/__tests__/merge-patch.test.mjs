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
