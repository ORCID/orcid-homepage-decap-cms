import assert from 'node:assert/strict'
import { test } from 'node:test'

import { isAllowedHost, lintMarkdownLite } from '../lib/markdown-lint.mjs'

const accepted = [
  ['plain prose', 'Distinguish yourself and claim credit for your work.'],
  ['bold', 'ORCID is **free** for researchers.'],
  ['a link', 'Read more at [our site](https://info.orcid.org/researchers).'],
  ['a mailto link', 'Write to [support](mailto:support@orcid.org).'],
  ['two paragraphs', 'First paragraph.\n\nSecond paragraph.'],
  ['an apostrophe and an ellipsis', 'ORCID is for…  researchers’ work.'],
]

for (const [name, value] of accepted) {
  test(`accepts ${name}`, () => {
    assert.deepEqual(lintMarkdownLite(value, 'field'), [])
  })
}

const rejected = [
  ['raw HTML', 'Use <b>bold</b> here.', /raw HTML/],
  ['an inline image', 'Look ![icon](https://orcid.org/a.png)', /inline images/],
  ['a heading', '# Heading\n\ntext', /headings/],
  ['a bullet list', '- one\n- two', /lists/],
  ['a numbered list', '1. one\n2. two', /lists/],
  ['italics', 'This is *emphasis* text.', /single \*/],
  ['an http link', 'See [here](http://orcid.org).', /must start with https/],
  [
    'a javascript link',
    'Click [here](javascript:alert(1))',
    /must start with https/,
  ],
  [
    'an off-allowlist host',
    'Go [there](https://example.com/x).',
    /not on the allowlist/,
  ],
  ['a link with no text', 'Click [](https://orcid.org).', /needs visible text/],
  ['a malformed link', 'Broken ](https://orcid.org) link', /malformed/],
]

for (const [name, value, expected] of rejected) {
  test(`rejects ${name}`, () => {
    const problems = lintMarkdownLite(value, 'field')
    assert.ok(problems.length > 0, `expected a problem for: ${value}`)
    assert.match(problems.join(' | '), expected)
  })
}

test('every ORCID subdomain is allowed, lookalikes are not', () => {
  assert.ok(isAllowedHost('orcid.org'))
  assert.ok(isAllowedHost('info.orcid.org'))
  assert.ok(isAllowedHost('anything.orcid.org'))
  assert.ok(!isAllowedHost('orcid.org.example.com'))
  assert.ok(!isAllowedHost('notorcid.org'))
})

test('the location is included so an editor knows which field to fix', () => {
  const [problem] = lintMarkdownLite('<b>x</b>', 'audiences.researchers.intro')
  assert.match(problem, /^audiences\.researchers\.intro: /)
})
