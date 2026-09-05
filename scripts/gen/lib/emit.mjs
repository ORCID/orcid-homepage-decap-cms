/**
 * Turns catalogue field descriptors into JSON Schema 2020-12 fragments.
 *
 * Pure: every function takes the catalogue it should read, so a test can
 * validate a modified clone of the real catalogue instead of a hand-written
 * fixture that has quietly drifted from it.
 *
 * The rules that are not obvious from the code are all recorded here rather
 * than in the generated file, because the generated file is a diff artefact
 * that nobody should be reading for explanations.
 */

/**
 * A translation is routinely longer than its English source. Validating the
 * built German and Russian bundles against the English character cap failed
 * the build for content that was correct, so the schema caps at 1.6x and
 * validate.mjs owns the 1.0x warning on the English source (spec §3.2).
 */
export const TRANSLATION_HEADROOM = 1.6

/** Kinds whose value reaches Transifex and therefore earns the headroom. */
const TRANSLATABLE_KINDS = new Set(['plain', 'rich', 'alt'])

/**
 * §3.2: must start with a letter, so an all-digit id can never make
 * JSON.stringify reorder the extracted file or let a consumer infer
 * array-ness; no dot, which would split a translation key.
 */
export const ID_PATTERN = '^[a-z][a-z0-9-]{0,59}$'

/** §2.7. mailto: is a content case (support addresses), not an escape hatch. */
export const HREF_PATTERN = '^(https://[^\\s]+|mailto:[^\\s@]+@[^\\s@]+)$'

/** §2.5. The value rule that replaced the `{icon, background}` allowlist. */
export const IMAGE_PATH_PATTERN =
  '^(images|assets)/[A-Za-z0-9._-]+\\.(png|jpe?g|svg|webp)$'

/** A paste from a word processor is the only way a newline gets in here. */
const SINGLE_LINE_PATTERN = '^[^\\r\\n]*$'

/**
 * The item types spec §3.2 decision 5 names as `$defs`. Anything else is
 * inlined where it is used. The list only decides *where* a shape is written,
 * never what it validates, so a new item type needs no change here — it is
 * simply inlined, which is what decision 2 wants for a section's own content
 * anyway.
 */
export const VALUE_OBJECT_DEFS = [
  'layout',
  'image',
  'link',
  'action',
  'video',
  'captions',
  'audio-description',
]

/** `audio-description` is a catalogue name; `audioDescription` is a $defs key. */
export function defName(itemTypeName) {
  return itemTypeName.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())
}

/**
 * A field is required unless the catalogue says otherwise. `required: false`
 * is explicit (§2.7), a `default` supplies the value when the key is absent,
 * and `requiredWhen` makes the requirement conditional — emitted separately as
 * an if/then so that "required" still means "always present".
 */
export function isRequired(field) {
  if (field.required === true) return true
  return (
    field.required === undefined &&
    field.default === undefined &&
    field.requiredWhen === undefined
  )
}

function enumValuesOf(catalogue, name) {
  if (name === 'videoProviders') return Object.keys(catalogue.videoProviders)
  return catalogue.enums[name].values
}

function cappedLength(field, kind, where) {
  if (field.maxLength === undefined) {
    throw new Error(
      `schema/catalogue.json: ${where} is kind "${kind}" but declares no maxLength. Add one — an uncapped translatable string has no upper bound in the CMS, in Transifex or in the layout it has to fit.`
    )
  }
  if (!TRANSLATABLE_KINDS.has(kind)) return field.maxLength
  return Math.ceil(field.maxLength * TRANSLATION_HEADROOM)
}

/**
 * A `$ref` with sibling keywords: in 2020-12 the siblings apply, so the $def
 * carries the shape shared by every field of that kind and the field carries
 * its own cap. That is how §3.2 keeps the leaf primitives in `$defs` while
 * length caps still come from the catalogue per field.
 */
function cappedRef(ref, field, kind, where) {
  return { $ref: ref, maxLength: cappedLength(field, kind, where) }
}

function itemTypeRef(catalogue, itemTypeName, ctx) {
  if (VALUE_OBJECT_DEFS.includes(itemTypeName)) {
    return { $ref: `#/$defs/${defName(itemTypeName)}` }
  }
  return itemTypeSchema(catalogue, itemTypeName, ctx)
}

/**
 * The schema for one field. `where` is a catalogue path used only in error
 * messages, so a generator failure names the field an author has to fix.
 */
export function fieldSchema(catalogue, field, where, ctx = {}) {
  switch (field.kind) {
    case 'plain':
      return cappedRef('#/$defs/plainText', field, 'plain', where)
    case 'alt':
      return cappedRef('#/$defs/altText', field, 'alt', where)
    case 'rich':
      return cappedRef('#/$defs/richText', field, 'rich', where)
    case 'note':
      return {
        type: 'string',
        minLength: 1,
        maxLength: cappedLength(field, 'note', where),
      }
    case 'id':
      return { $ref: '#/$defs/id' }
    case 'href':
      return { $ref: '#/$defs/href' }
    case 'imagePath':
      return { $ref: '#/$defs/imagePath' }
    case 'enum':
      if (field.fromVariants) {
        throw new Error(
          `schema/catalogue.json: ${where} draws its values from the section type's variants, which only the section branch knows. Emit it there, not through fieldSchema.`
        )
      }
      return { enum: [...enumValuesOf(catalogue, field.enum)] }
    case 'integer':
      return { type: 'integer', minimum: field.min, maximum: field.max }
    case 'boolean':
      return field.const === undefined
        ? { type: 'boolean' }
        : { type: 'boolean', const: field.const }
    case 'videoId':
      // The pattern depends on the sibling provider, so it cannot live on the
      // field. objectSchema adds one if/then per provider around it.
      return { type: 'string', minLength: 1 }
    case 'image':
      return {
        $ref: field.decorative
          ? '#/$defs/decorativeImage'
          : '#/$defs/informativeImage',
      }
    case 'object':
      return itemTypeRef(catalogue, field.of, ctx)
    case 'list':
      return {
        type: 'array',
        minItems: field.min,
        maxItems: field.max,
        items: itemTypeRef(catalogue, field.of, ctx),
      }
    default:
      throw new Error(
        `schema/catalogue.json: ${where} has kind "${field.kind}", which scripts/gen/lib/emit.mjs cannot emit. A new kind needs a case here, in the CMS config generator and in the renderer.`
      )
  }
}

/**
 * `requiredWhen: {mediaKind: "video"}` becomes "if mediaKind is video then
 * video is required". Expressed on the containing object because that is the
 * only place both fields are visible.
 */
function requiredWhenCondition(fieldName, field) {
  const [sibling, value] = Object.entries(field.requiredWhen)[0]
  return {
    $comment: `"${fieldName}" is required only when "${sibling}" is ${JSON.stringify(value)}.`,
    if: {
      properties: { [sibling]: { const: value } },
      required: [sibling],
    },
    then: { required: [fieldName] },
  }
}

/**
 * A Vimeo id and a YouTube id look nothing alike, and pasting one under the
 * other provider produces a player that 404s at runtime with a green build.
 * One if/then per provider makes the id pattern a schema fact.
 */
function videoIdConditions(catalogue, fieldName, field) {
  return Object.entries(catalogue.videoProviders).map(
    ([provider, descriptor]) => ({
      $comment: `A ${descriptor.label} id looks like ${descriptor.example}.`,
      if: {
        properties: { [field.providerField]: { const: provider } },
        required: [field.providerField],
      },
      then: {
        properties: { [fieldName]: { pattern: descriptor.pattern } },
      },
    })
  )
}

/**
 * Properties, required list and cross-field conditions for one map of fields.
 * Returned unwrapped so a section branch can prepend the structural fields
 * before the object is closed — `additionalProperties: false` cannot compose
 * through `allOf` (§3.2 decision 3), so everything has to be in one object.
 */
export function emitFields(catalogue, fields, where, ctx = {}) {
  const properties = {}
  const required = []
  const conditions = []

  for (const [name, field] of Object.entries(fields)) {
    const at = `${where}/${name}`
    properties[name] = fieldSchema(catalogue, field, at, ctx)
    if (field.default !== undefined) properties[name].default = field.default
    if (isRequired(field)) required.push(name)
    if (field.requiredWhen) conditions.push(requiredWhenCondition(name, field))
    if (field.kind === 'videoId') {
      conditions.push(...videoIdConditions(catalogue, name, field))
    }
  }

  return { properties, required, conditions }
}

/** A closed object schema for one map of fields. */
export function objectSchema(catalogue, fields, where, ctx = {}) {
  const { properties, required, conditions } = emitFields(
    catalogue,
    fields,
    where,
    ctx
  )
  return closedObject(properties, required, conditions)
}

export function closedObject(properties, required, conditions = []) {
  const schema = { type: 'object', additionalProperties: false }
  if (required.length > 0) schema.required = required
  schema.properties = properties
  if (conditions.length > 0) schema.allOf = conditions
  return schema
}

/**
 * The schema for an item type used inline. The stack is a cycle guard: an
 * item type that reached itself would inline for ever and the generator would
 * hang with no output and no message.
 */
export function itemTypeSchema(catalogue, name, ctx = {}) {
  const itemType = catalogue.itemTypes[name]
  const stack = ctx.stack ?? []
  if (stack.includes(name)) {
    throw new Error(
      `schema/catalogue.json: item type "${name}" contains itself (${[...stack, name].join(' → ')}). Sections are a flat list (spec D2) and item types cannot nest into a cycle; break the loop.`
    )
  }
  if (itemType.scalar) {
    return { type: itemType.scalar, pattern: itemType.pattern }
  }
  return objectSchema(catalogue, itemType.fields, `itemTypes/${name}/fields`, {
    ...ctx,
    stack: [...stack, name],
  })
}

/**
 * The two image shapes (§3.2). A decorative slot has no `alt` property at all
 * and is closed, so an editor can neither supply one nor forget one; the
 * decision belongs to the slot in the catalogue, never to the editor's memory.
 */
export function imageDefs(catalogue) {
  const fields = catalogue.itemTypes.image.fields
  const decorativeFields = Object.fromEntries(
    Object.entries(fields).filter(([, field]) => !field.informativeOnly)
  )

  const decorative = objectSchema(
    catalogue,
    decorativeFields,
    'itemTypes/image/fields'
  )
  decorative.description =
    'A picture that carries no information: the renderer always emits alt="" aria-hidden="true", so there is no alt property to fill in or to forget.'

  const informative = objectSchema(catalogue, fields, 'itemTypes/image/fields')
  informative.description =
    'A picture that carries information. alt is required here and nowhere else.'

  return { decorativeImage: decorative, informativeImage: informative }
}

/** The leaf primitives every field kind refs, with the caps left to the field. */
export function leafDefs() {
  return {
    id: {
      type: 'string',
      pattern: ID_PATTERN,
      description:
        'Stable translation key. Renaming it orphans every translation of that item.',
    },
    plainText: {
      type: 'string',
      minLength: 1,
      pattern: SINGLE_LINE_PATTERN,
      description:
        'One line of text. maxLength is set per field from the catalogue, with 1.6x headroom for translations.',
    },
    richText: {
      type: 'string',
      minLength: 1,
      description:
        'markdown-lite: paragraphs, **bold** and [text](https://…) links only. The grammar is enforced by scripts/lib/markdown-lint.mjs, not here.',
    },
    altText: {
      type: 'string',
      minLength: 1,
      pattern: SINGLE_LINE_PATTERN,
      description:
        'Alt text. Quality rules (no "image of", not the filename, not empty on an informative image) are enforced by validate.mjs.',
    },
    href: {
      type: 'string',
      pattern: HREF_PATTERN,
      description:
        'A full https:// address or mailto:someone@example.org. The host allowlist is enforced by validate.mjs.',
    },
    imagePath: {
      type: 'string',
      pattern: IMAGE_PATH_PATTERN,
      description:
        'images/… in the source file, rewritten to the fingerprinted assets/… by the build.',
    },
  }
}

/**
 * `meta` is written by the build and never authored, which is why it is not in
 * the catalogue: no editor ever sees these fields.
 */
export function metaDef() {
  return {
    type: 'object',
    additionalProperties: false,
    required: [
      'locale',
      'version',
      'commit',
      'generatedAt',
      'translated',
      'total',
    ],
    properties: {
      locale: { type: 'string', minLength: 2, maxLength: 10 },
      version: { type: 'string', minLength: 1 },
      commit: { type: 'string', minLength: 1 },
      generatedAt: { type: 'string', format: 'date-time' },
      translated: { type: 'integer', minimum: 0 },
      total: { type: 'integer', minimum: 0 },
      untranslated: {
        type: 'array',
        items: { type: 'string', minLength: 1 },
        description:
          'Keys that fell back to English (§8.7). Absent on a fully translated bundle.',
      },
    },
    description:
      'Written by scripts/build.mjs. Absent from the source file, present on every built bundle.',
  }
}

/** One `oneOf` branch: a whole section type, structural fields included. */
export function sectionBranch(catalogue, typeName) {
  const sectionType = catalogue.sectionTypes[typeName]
  const where = `sectionTypes/${typeName}/fields`

  // `type` is the discriminator. It is not in commonFields because no editor
  // types it: Decap writes it from the chosen widget (§2.7, typeKey).
  const properties = { type: { const: typeName } }
  const required = ['type']

  for (const [name, field] of Object.entries(catalogue.commonFields)) {
    properties[name] = field.fromVariants
      ? {
          enum: sectionType.variants.map((variant) => variant.name),
          description:
            'The variants of this section type only. A renderer that does not know the value falls back to the first one listed (D4).',
        }
      : fieldSchema(catalogue, field, `commonFields/${name}`)
    if (isRequired(field)) required.push(name)
  }

  const own = emitFields(catalogue, sectionType.fields, where)

  // Spreading own fields over the structural ones would let a section type
  // silently replace its own `id` or `variant` with a different shape, and the
  // branch would still compile.
  for (const name of Object.keys(own.properties)) {
    if (name in properties) {
      throw new Error(
        `schema/catalogue.json: ${where}/${name} redeclares the structural field "${name}", which every section already carries (§1.0). Remove it from the section type.`
      )
    }
  }

  return closedObject(
    { ...properties, ...own.properties },
    [...required, ...own.required],
    own.conditions
  )
}
