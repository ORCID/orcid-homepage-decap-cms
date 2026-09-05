import assert from 'node:assert/strict'
import { test } from 'node:test'

import { extractPatch } from '../apply-proposal.mjs'

/** What GitHub renders an issue form into. */
function issueForm(patch, why = 'Requested by comms.') {
  return [
    '### Change',
    '',
    '```json',
    patch,
    '```',
    '',
    '### Why (optional)',
    '',
    why,
    '',
  ].join('\n')
}

test('reads the change out of an issue form body', () => {
  const body = issueForm('{\n  "hero": {\n    "title": "New"\n  }\n}')
  assert.deepEqual(extractPatch(body), { hero: { title: 'New' } })
})

test('reads a bare JSON object, for an issue written by hand', () => {
  assert.deepEqual(extractPatch('{"hero": {"title": "New"}}'), {
    hero: { title: 'New' },
  })
})

test('ignores a fenced block that is not the change', () => {
  const body = [
    'Some context first:',
    '',
    '```',
    'not json at all',
    '```',
    '',
    issueForm('{"hero": {"title": "New"}}'),
  ].join('\n')
  assert.deepEqual(extractPatch(body), { hero: { title: 'New' } })
})

test('a body with no JSON is rejected with a readable message', () => {
  assert.throws(
    () => extractPatch('Please change the headline to something friendlier.'),
    /No change found in the issue/
  )
})

test('an array is rejected: a change is always an object', () => {
  assert.throws(() => extractPatch('[1, 2, 3]'), /No change found/)
})

test('malformed JSON is rejected rather than half-read', () => {
  assert.throws(
    () => extractPatch(issueForm('{"hero": {"title": "New",}}')),
    /No change found/
  )
})
