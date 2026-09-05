import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  commonFields,
  enumValues,
  fieldKind,
  fieldsOf,
  isTranslatable,
  itemTypeOf,
  loadCatalogue,
  pageFields,
  sectionTypes,
  typeOf,
  validateCatalogue,
  variantsOf,
  videoProviders,
} from '../lib/catalogue.mjs'

/**
 * Each broken case starts from the catalogue that actually ships, so a test
 * cannot pass against a fixture that has drifted from the real document.
 * structuredClone also thaws it, which loadCatalogue deliberately freezes.
 */
function rejectionFor(breakIt) {
  const catalogue = structuredClone(loadCatalogue())
  breakIt(catalogue)
  try {
    validateCatalogue(catalogue)
  } catch (error) {
    return error.message
  }
  assert.fail('the broken catalogue was accepted')
}

test('the catalogue that ships in this repository is valid', () => {
  const catalogue = loadCatalogue()
  assert.equal(catalogue.schemaVersion, 2)
  assert.ok(Object.keys(catalogue.sectionTypes).length > 0)
})

test('every section type an editor can add offers a variant and a summary', () => {
  for (const [name, sectionType] of Object.entries(sectionTypes())) {
    assert.ok(
      variantsOf(name).length >= 1,
      `${name} offers no variant, so the renderer would pick one nobody chose`
    )
    assert.ok(sectionType.summary, `${name} has no summary for the CMS list`)
    assert.ok(sectionType.label && sectionType.labelSingular)
  }
})

test('exactly plain, rich and alt reach the translators', () => {
  const kinds = [
    'plain',
    'rich',
    'alt',
    'note',
    'id',
    'href',
    'enum',
    'integer',
    'boolean',
    'videoId',
    'image',
    'object',
    'list',
    'imagePath',
  ]
  assert.deepEqual(
    kinds.filter(isTranslatable),
    ['plain', 'rich', 'alt'],
    'the set of translated kinds changed; §1.0 and the extractor disagree now'
  )
})

test('a field named after something the renderer computes is refused by name', () => {
  const message = rejectionFor((c) => {
    c.sectionTypes.prose.fields.level = { kind: 'integer' }
  })
  assert.match(message, /"level" cannot be used as a name/)
  assert.match(message, /sectionTypes\/prose\/fields/)
})

test('__order and __replace cannot be field names', () => {
  for (const reserved of ['__order', '__replace']) {
    const message = rejectionFor((c) => {
      c.sectionTypes.prose.fields[reserved] = { kind: 'plain' }
    })
    assert.match(message, new RegExp(`"${reserved}" cannot be used as a name`))
  }
})

test('a kind outside the closed set is refused, and the message lists the set', () => {
  const message = rejectionFor((c) => {
    c.sectionTypes.prose.fields.body.kind = 'markdown'
  })
  assert.match(message, /\/sectionTypes\/prose\/fields\/body\/kind/)
  assert.match(message, /plain, rich, alt/)
})

test('an image field that does not say whether it is decorative is refused', () => {
  const message = rejectionFor((c) => {
    delete c.itemTypes.audience.fields.background.decorative
  })
  assert.match(message, /required property 'decorative'/)
})

test('a list field with no maximum is refused', () => {
  const message = rejectionFor((c) => {
    delete c.sectionTypes['feature-list'].fields.items.max
  })
  assert.match(message, /required property 'max'/)
})

test('a section type with no variants is refused', () => {
  const message = rejectionFor((c) => {
    c.sectionTypes.prose.variants = []
  })
  assert.match(message, /variants/)
})

test('an "of" that names an item type nobody declared is refused', () => {
  const message = rejectionFor((c) => {
    c.sectionTypes['feature-list'].fields.items.of = 'feature-itemm'
  })
  assert.match(message, /"of" names the item type "feature-itemm"/)
  assert.match(message, /use one of: .*feature-item/)
})

test('an "enum" that names a value set nobody declared is refused', () => {
  const message = rejectionFor((c) => {
    c.itemTypes.layout.fields.tone.enum = 'toneish'
  })
  assert.match(message, /"enum" names the value set "toneish"/)
})

test('videoProviders counts as a declared value set for an enum field', () => {
  assert.deepEqual(enumValues('videoProviders'), Object.keys(videoProviders()))
  assert.equal(
    loadCatalogue().itemTypes.video.fields.provider.enum,
    'videoProviders'
  )
})

test('a videoId whose providerField names no sibling is refused', () => {
  const message = rejectionFor((c) => {
    c.itemTypes.video.fields.videoId.providerField = 'supplier'
  })
  assert.match(message, /"providerField" names "supplier"/)
  assert.match(message, /point at one of: provider/)
})

test('a videoId pointing at a field that chooses no provider is refused', () => {
  const message = rejectionFor((c) => {
    c.itemTypes.video.fields.videoId.providerField = 'title'
  })
  assert.match(message, /does not choose a video provider/)
})

test('an enum default that is not one of that enum values is refused', () => {
  const message = rejectionFor((c) => {
    c.itemTypes.layout.fields.tone.default = 'lilac'
  })
  assert.match(message, /default "lilac" is not one of the "tone" values/)
})

test('a requiredWhen that depends on a field of another item is refused', () => {
  const message = rejectionFor((c) => {
    c.sectionTypes.media.fields.video.requiredWhen = { kindOfMedia: 'video' }
  })
  assert.match(message, /"requiredWhen" depends on "kindOfMedia"/)
})

test('a label for a value the enum does not have is refused', () => {
  const message = rejectionFor((c) => {
    c.enums.tone.labels['brand-light'] = 'Pale'
  })
  assert.match(message, /there is no value "brand-light" in this enum/)
})

test('a variant name used twice in one section type is refused', () => {
  const message = rejectionFor((c) => {
    c.sectionTypes.prose.variants.push({ name: 'lead', label: 'Also lead' })
  })
  assert.match(message, /variant name "lead" is used twice/)
})

test('every problem is reported at once, not just the first', () => {
  const message = rejectionFor((c) => {
    delete c.sectionTypes.prose.summary
    delete c.sectionTypes.media.labelSingular
    c.sectionTypes['cta-band'].variants = []
  })
  assert.match(message, /\(3 problems\)/)
  assert.match(message, /sectionTypes\/prose/)
  assert.match(message, /sectionTypes\/media/)
  assert.match(message, /sectionTypes\/cta-band/)
})

test('the failure names the file, so a CI log says which one to open', () => {
  const message = rejectionFor((c) => {
    delete c.sectionTypes.prose.summary
  })
  assert.match(message, /^schema\/catalogue\.json is not a valid catalogue/)
})

test('a section whose type is not in the catalogue is refused, not ignored', () => {
  assert.equal(typeOf({ id: 'intro', type: 'prose' }), 'prose')
  assert.throws(
    () => typeOf({ id: 'carousel-1', type: 'carousel' }),
    (error) => {
      assert.match(error.message, /Section "carousel-1"/)
      assert.match(error.message, /"carousel"/)
      assert.match(error.message, /prose/)
      return true
    }
  )
})

test('the structural fields are answered for every section type', () => {
  for (const name of Object.keys(sectionTypes())) {
    assert.equal(fieldKind(name, 'id'), 'id')
    assert.equal(fieldKind(name, 'variant'), 'enum')
    assert.equal(fieldKind(name, 'layout'), 'object')
  }
  assert.equal(fieldKind('prose', 'body'), 'rich')
})

test('asking for a field the type does not declare throws instead of returning undefined', () => {
  assert.throws(
    () => fieldKind('prose', 'subtitle'),
    /Section type "prose" has no field "subtitle"/
  )
})

test('a section type does not redeclare the structural fields', () => {
  const structural = Object.keys(commonFields())
  for (const name of Object.keys(sectionTypes())) {
    for (const field of structural) {
      assert.ok(
        !(field in fieldsOf(name)),
        `${name} redeclares "${field}"; the generator emits it into every branch already`
      )
    }
  }
})

test('an unknown item type or enum is named in the error, with the known ones', () => {
  assert.equal(itemTypeOf('feature-item').label, 'Feature')
  assert.throws(
    () => itemTypeOf('feature'),
    /declares no item type named "feature"/
  )
  assert.deepEqual(enumValues('columns'), [2, 3])
  assert.throws(() => enumValues('column'), /declares no enum named "column"/)
})

test('the page carries the one h1 and the search description', () => {
  assert.equal(pageFields().title.kind, 'plain')
  assert.equal(pageFields().title.required, true)
  assert.equal(pageFields().description.required, true)
})

test('a consumer cannot mutate the loaded catalogue for everyone else', () => {
  const catalogue = loadCatalogue()
  assert.throws(() => {
    catalogue.sectionTypes.prose.label = 'Something else'
  }, TypeError)
  assert.equal(loadCatalogue().sectionTypes.prose.label, 'Text')
})

test('loading twice returns the same validated catalogue, not a second parse', () => {
  assert.equal(loadCatalogue(), loadCatalogue())
})
