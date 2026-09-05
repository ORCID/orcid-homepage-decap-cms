#!/usr/bin/env node
/**
 * Generates the `collections` block of admin/config.yml from the catalogue
 * (spec v2 D1, §2.4 row 3, §2.7). Everything outside the BEGIN/END GENERATED
 * markers is hand-written and is never touched here.
 *
 * The YAML is built by hand rather than with a serialiser library: the block is
 * committed and drift-checked, so the output has to be byte-stable across
 * versions of anything, and it has to come out of the generator already in the
 * shape `prettier --write` would leave it in — otherwise `npm run format`
 * rewrites the committed block and the drift check fails on a file nobody
 * edited. The two places prettier reformats YAML are quoting and long flow
 * sequences, and both are reproduced exactly below.
 *
 * Usage:
 *   node scripts/gen/cms-config.mjs            rewrite admin/config.yml
 *   node scripts/gen/cms-config.mjs --check    exit 1 if the file is stale
 */
import { readFileSync, writeFileSync } from 'node:fs'

import {
  commonFields,
  itemTypeOf,
  loadCatalogue,
  pageFields,
  sectionTypes,
  variantsOf,
  videoProviders,
} from '../lib/catalogue.mjs'

const CONFIG_URL = new URL('../../admin/config.yml', import.meta.url)

/** Repo-relative, because the message is read in a CI log with no cwd. */
const CONFIG_PATH = 'admin/config.yml'

const BEGIN = '# BEGIN GENERATED'
const END = '# END GENERATED'

/**
 * §2.7: a flat list, never nested (D2), capped so an editor cannot build a page
 * that no reviewer will read to the end.
 */
const MAX_SECTIONS = 24

/**
 * The hosts markdown-lint.mjs accepts, said in a sentence rather than as a
 * list. Kept in step by hand: `ALLOWED_HOSTS` there is a module-private const,
 * so there is nothing to import. If that list gains a host, this sentence has
 * to gain it too, or an editor is told a valid link will be rejected.
 */
const ALLOWED_HOSTS_HINT =
  'Must point to orcid.org or one of its subdomains, or to youtube.com or vimeo.com. Anything else is rejected when the change is checked.'

// ---------------------------------------------------------------------------
// YAML emission
// ---------------------------------------------------------------------------

/** A plain scalar may not begin with any of these YAML indicators. */
const INDICATOR_START = /^[-?:,[\]{}#&*!|>'"%@`]/

const YAML_KEYWORD = /^(y|n|yes|no|true|false|on|off|null|~)$/i

function needsQuotes(value) {
  return (
    value === '' ||
    value !== value.trim() ||
    INDICATOR_START.test(value) ||
    // ": " opens a mapping and " #" opens a comment, in mid-scalar too.
    /: |\s#/.test(value) ||
    /:$/.test(value) ||
    /[\n\r\t]/.test(value) ||
    YAML_KEYWORD.test(value) ||
    // Anything a YAML reader would hand back as a number or a date.
    /^[-+]?[0-9]/.test(value)
  )
}

/**
 * Prettier's rule, reproduced: single quotes unless the content contains more
 * single quotes than double ones, in which case double quotes escape less.
 * Emitting the other one is not wrong YAML, it just gets rewritten by
 * `npm run format` and shows up as drift.
 */
function quote(value) {
  const singles = (value.match(/'/g) ?? []).length
  const doubles = (value.match(/"/g) ?? []).length
  if (singles > doubles) {
    return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
  }
  return `'${value.replace(/'/g, "''")}'`
}

/**
 * Regular expressions are always single-quoted: in a double-quoted YAML scalar
 * `\n` is a real newline, so a pattern like `^[^\n\r]{1,80}$` would reach Decap
 * as a character class containing an actual line break and would then match
 * nothing an editor could type.
 */
function quotePattern(value) {
  if (value.includes("'")) {
    throw new Error(
      `The pattern ${JSON.stringify(
        value
      )} contains a single quote, which cannot be emitted safely: double quotes would turn its backslash escapes into control characters. Rewrite the pattern or its message without an apostrophe.`
    )
  }
  return `'${value}'`
}

function scalar(value) {
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (typeof value === 'number') return String(value)
  if (typeof value === 'string') {
    return needsQuotes(value) ? quote(value) : value
  }
  throw new Error(
    `Cannot emit ${JSON.stringify(value)} as YAML: only strings, numbers, booleans, objects and arrays are supported.`
  )
}

/**
 * Prettier keeps a flow sequence on one line while the line fits in the print
 * width, and otherwise breaks it one item per line with a trailing comma. Both
 * shapes appear in the generated block, because the `pattern` messages differ
 * in length.
 */
function flowSequence(key, values, indent) {
  const pad = ' '.repeat(indent)
  const items = values.map(quotePattern)
  const oneLine = `${pad}${key}: [${items.join(', ')}]`
  if (oneLine.length <= 80) return [oneLine]
  return [
    `${pad}${key}:`,
    `${pad}  [`,
    ...items.map((item) => `${pad}    ${item},`),
    `${pad}  ]`,
  ]
}

function emitMapping(map, indent) {
  const pad = ' '.repeat(indent)
  const lines = []
  for (const [key, value] of Object.entries(map)) {
    if (value === undefined) continue
    if (Array.isArray(value)) {
      if (value.every((item) => item !== null && typeof item === 'object')) {
        lines.push(`${pad}${key}:`)
        for (const item of value) lines.push(...emitSequenceItem(item, indent))
      } else {
        lines.push(...flowSequence(key, value, indent))
      }
    } else if (value !== null && typeof value === 'object') {
      lines.push(`${pad}${key}:`)
      lines.push(...emitMapping(value, indent + 2))
    } else {
      lines.push(`${pad}${key}: ${scalar(value)}`)
    }
  }
  return lines
}

function emitSequenceItem(map, indent) {
  const lines = emitMapping(map, indent + 4)
  lines[0] = `${' '.repeat(indent + 2)}- ${lines[0].slice(indent + 4)}`
  return lines
}

// ---------------------------------------------------------------------------
// Catalogue → Decap field nodes
// ---------------------------------------------------------------------------

/**
 * The name of the field a collapsed row is identified by: whatever the type's
 * summary template shows first. Deriving it from the summary rather than from a
 * list of likely names means the field the editor reads in the collapsed row is
 * the same one they meet first when they open it.
 */
function identifyingFieldName(summary, fields) {
  const match = /\{\{\s*([^}|\s]+)/.exec(summary ?? '')
  if (!match) return undefined
  const name = match[1].replace(/^fields\./, '')
  return name in fields ? name : undefined
}

function labelOf(name, field) {
  if (field.label) return field.label
  if (field.kind === 'id') return commonFields().id.label
  // Nothing else in the catalogue reaches here today; a humanised name is a
  // better failure than a blank label above a text box.
  return name
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/^./, (c) => c.toUpperCase())
}

function joinHint(...parts) {
  const text = parts.filter(Boolean).join(' ')
  return text === '' ? undefined : text
}

function enumLabels(enumName) {
  if (enumName === 'videoProviders') {
    return Object.entries(videoProviders()).map(([value, provider]) => ({
      label: provider.label,
      value,
    }))
  }
  const declared = loadCatalogue().enums[enumName]
  return declared.values.map((value) => ({
    label: declared.labels?.[String(value)] ?? String(value),
    value,
  }))
}

/**
 * `requiredWhen` fields are optional to Decap and enforced by validate.mjs
 * (§2.7). Without this sentence the editor meets the rule for the first time as
 * a failed check on a pull request, with the form long since closed.
 */
function requiredWhenHint(field, siblings) {
  if (!field.requiredWhen) return undefined
  const conditions = Object.entries(field.requiredWhen).map(([name, value]) => {
    const sibling = siblings[name]
    const shown = sibling?.enum
      ? (enumLabels(sibling.enum).find((option) => option.value === value)
          ?.label ?? value)
      : value
    return `"${labelOf(name, sibling ?? {})}" is "${shown}"`
  })
  return `Required when ${conditions.join(' and ')}.`
}

/** §2.7: `plain` and `alt` are single line, and the pattern says so in words. */
function singleLinePattern(maxLength) {
  return maxLength
    ? [
        `^[^\\n\\r]{1,${maxLength}}$`,
        `One line, no line breaks, max ${maxLength} characters`,
      ]
    : ['^[^\\n\\r]+$', 'One line, no line breaks']
}

function imageFields(decorative, stack) {
  const image = itemTypeOf('image')
  const node = []
  for (const [name, field] of Object.entries(image.fields)) {
    // A decorative slot collects no alt text and no "contains words" flag: the
    // slot decides, not the editor's memory (§7.3). Asking anyway is how a
    // decorative icon ends up announced twice.
    if (decorative && field.informativeOnly) continue
    node.push(fieldNode(name, field, image.fields, stack))
  }
  return node
}

function objectFields(itemTypeName, stack) {
  if (stack.includes(itemTypeName)) {
    throw new Error(
      `The item type "${itemTypeName}" contains itself (${[...stack, itemTypeName].join(' → ')}). A Decap form cannot nest for ever; break the cycle in schema/catalogue.json.`
    )
  }
  const itemType = itemTypeOf(itemTypeName)
  const next = [...stack, itemTypeName]
  return orderedItemFields(itemType).map(([name, field]) =>
    fieldNode(name, field, itemType.fields, next)
  )
}

/** Identifying field first, `id` last — the rule of §2.7, applied to items too. */
function orderedItemFields(itemType) {
  const fields = itemType.fields ?? {}
  const identifying = identifyingFieldName(itemType.summary, fields)
  const names = Object.keys(fields)
  const ordered = [
    ...(identifying ? [identifying] : []),
    ...names.filter((name) => name !== identifying && name !== 'id'),
    ...(names.includes('id') ? ['id'] : []),
  ]
  return ordered.map((name) => [name, fields[name]])
}

/**
 * The summary of a list row. Mandatory (§2.7): without it a collapsed row shows
 * only the item label — nine identical "Feature" rows — and it is the only
 * accessible name a collapsed row has.
 */
function listSummary(field, name) {
  const itemType = itemTypeOf(field.of)
  if (itemType.scalar) return `{{fields.${SCALAR_ITEM_FIELD}}}`
  if (!itemType.summary) {
    throw new Error(
      `schema/catalogue.json: the list "${name}" holds "${field.of}", which has no "summary". A collapsed row would be labelled only "${itemType.label}". Add a summary such as "{{title}}" to itemTypes/${field.of}.`
    )
  }
  return itemType.summary
}

/**
 * A list of bare strings is a Decap list with a single `field`. Its rows are
 * labelled by `{{fields.<that field's name>}}`, so the name has to be fixed and
 * known here.
 */
const SCALAR_ITEM_FIELD = 'value'

function listNode(name, field, media) {
  const itemType = itemTypeOf(field.of)
  // Verified in decap-cms-lib-widgets/src/validations.ts: `value?.size` is
  // falsy at 0, so a min-only guard never fires on an empty list and the rule
  // it looks like it enforces silently does not exist.
  if (field.min !== undefined && field.max === undefined) {
    throw new Error(
      `schema/catalogue.json: the list "${name}" has "min" but no "max". Decap never applies a minimum without a maximum, so the rule would look enforced and would not be. Add a "max".`
    )
  }
  return {
    label: labelOf(name, field),
    label_singular: field.labelSingular,
    widget: 'list',
    min: field.min,
    max: field.max,
    collapsed: true,
    // Collapsed rows still show their summary; minimised ones collapse the
    // whole list to a single line, which hides how many items there are.
    minimize_collapsed: false,
    summary: listSummary(field, name),
    allow_add: field.allowAdd,
    allow_remove: field.allowRemove,
    allow_reorder: field.allowReorder,
    ...(itemType.scalar
      ? {
          field: {
            name: SCALAR_ITEM_FIELD,
            label: field.labelSingular,
            widget: 'string',
            pattern: itemType.pattern
              ? [itemType.pattern, `Must look like ${itemType.label}, e.g. en`]
              : undefined,
          },
        }
      : { fields: objectFields(field.of, []) }),
  }
}

/**
 * One catalogue field as one Decap field. The kind → widget mapping is §2.7 and
 * is exhaustive there; nothing is invented here.
 */
function fieldNode(name, field, siblings, stack = []) {
  const media = mediaSettings()
  const required = field.required === true ? undefined : false
  const conditional = requiredWhenHint(field, siblings)
  const base = { name, label: labelOf(name, field) }

  switch (field.kind) {
    case 'plain':
      return {
        ...base,
        widget: 'string',
        pattern: singleLinePattern(field.maxLength),
        required,
        hint: joinHint(field.hint, conditional),
      }

    case 'alt':
      return {
        ...base,
        widget: 'string',
        pattern: singleLinePattern(field.maxLength),
        required,
        hint: joinHint(
          field.hint,
          'Not the file name, and not a repeat of the words next to the picture.',
          conditional
        ),
      }

    case 'rich':
      // Deliberately `text`, not `markdown` and not `richtext`. Decap's
      // richtext deserialises pasted HTML wholesale (pasteHandler.js) and
      // `buttons:` restricts the toolbar, not the document — so a paste from
      // Word arrives as headings and lists that markdown-lite cannot
      // represent and the renderer would print as literal characters.
      // markdown-lite is a three-construct grammar; a textarea plus the live
      // preview plus markdown-lint.mjs is the only constraint here that is real.
      return {
        ...base,
        widget: 'text',
        required,
        hint: joinHint(
          field.hint,
          '**bold** and [text](https://…) links are supported; nothing else is.',
          field.maxLength ? `Up to ${field.maxLength} characters.` : undefined,
          conditional
        ),
      }

    case 'note':
      return {
        ...base,
        widget: 'text',
        // Never required in Decap even when validate.mjs will insist on it:
        // the condition lives in another field's value, which the form cannot
        // see.
        required: false,
        hint: joinHint(
          field.hint,
          'For reviewers only. Never shown on the page and never translated.',
          conditional
        ),
      }

    case 'id':
      return {
        ...base,
        widget: 'string',
        pattern: [
          '^[a-z][a-z0-9-]{0,59}$',
          'Lowercase letters, digits and hyphens; must start with a letter',
        ],
        required,
        hint: joinHint(field.hint ?? commonFields().id.hint, conditional),
      }

    case 'href':
      return {
        ...base,
        widget: 'string',
        pattern: [
          '^(https://[^\\s]+|mailto:[^\\s@]+@[^\\s@]+)$',
          'A full https:// address, or mailto:someone@example.org',
        ],
        required,
        hint: joinHint(field.hint, ALLOWED_HOSTS_HINT, conditional),
      }

    case 'enum': {
      const options = field.fromVariants
        ? variantsOf(stack[0]).map((variant) => ({
            label: variant.label,
            value: variant.name,
          }))
        : enumLabels(field.enum)
      const variantHints = field.fromVariants
        ? variantsOf(stack[0])
            .filter((variant) => variant.hint)
            .map((variant) => `${variant.label}: ${variant.hint}`)
            .join(' ')
        : undefined
      return {
        ...base,
        widget: 'select',
        options,
        // A variant is always required (§1.0), and the first one in the
        // catalogue is the recommended one, so a new section starts valid
        // instead of starting on a save-blocking empty select.
        default: field.fromVariants ? options[0].value : field.default,
        required,
        hint: joinHint(field.hint, variantHints, conditional),
      }
    }

    case 'boolean':
      return {
        ...base,
        widget: 'boolean',
        default: field.default,
        // Decap treats an unticked box as missing, so a required boolean can
        // never be saved as false. Requiredness of booleans is validate.mjs's.
        required: false,
        hint: joinHint(field.hint, conditional),
      }

    case 'integer':
      return {
        ...base,
        widget: 'number',
        value_type: 'int',
        min: field.min,
        max: field.max,
        default: field.default,
        required,
        hint: joinHint(field.hint, conditional),
      }

    case 'videoId': {
      const providers = Object.entries(videoProviders())
      const union = providers
        .map(([, provider]) => provider.pattern.replace(/^\^|\$$/g, ''))
        .join('|')
      const examples = providers
        .map(([, provider]) => `${provider.label}: ${provider.example}`)
        .join(', ')
      return {
        ...base,
        widget: 'string',
        pattern: [`^(${union})$`, `The ID only. ${examples}`],
        required,
        hint: joinHint(field.hint, conditional),
      }
    }

    case 'imagePath':
      return {
        ...base,
        widget: 'image',
        allow_multiple: false,
        choose_url: false,
        media_folder: media.mediaFolder,
        public_folder: media.publicFolder,
        required,
        hint: joinHint(field.hint, conditional),
      }

    case 'image':
      return {
        ...base,
        widget: 'object',
        // An informative picture needs its description read and written, so it
        // opens; a decorative one is two settings and stays out of the way.
        collapsed: field.decorative === true,
        required,
        hint: joinHint(field.hint, conditional),
        fields: imageFields(field.decorative === true, stack),
      }

    case 'object':
      return {
        ...base,
        widget: 'object',
        collapsed: field.collapsed,
        required,
        hint: joinHint(field.hint, conditional),
        fields: objectFields(field.of, stack),
      }

    case 'list':
      return {
        name,
        ...listNode(name, field, media),
        required,
        hint: joinHint(field.hint, conditional),
      }

    default:
      throw new Error(
        `schema/catalogue.json: the field "${name}" has kind "${field.kind}", which scripts/gen/cms-config.mjs has no widget for. Add it to the table in docs/spec-v2.md §2.7 and to this switch.`
      )
  }
}

// ---------------------------------------------------------------------------
// The document
// ---------------------------------------------------------------------------

/**
 * Identifying field, then `variant`, then the content fields, then `layout`,
 * then `id` (§2.7). Tab order matches reading order and the id is plumbing, not
 * content, so it goes at the bottom where it is not in the way.
 */
function sectionTypeNode(typeName) {
  const type = sectionTypes()[typeName]
  const own = type.fields
  const common = commonFields()
  const identifying = identifyingFieldName(type.summary, own)
  const ordered = [
    ...(identifying ? [[identifying, own[identifying]]] : []),
    ['variant', common.variant],
    ...Object.entries(own).filter(([name]) => name !== identifying),
    ['layout', common.layout],
    ['id', common.id],
  ]
  return {
    name: typeName,
    label: type.label,
    widget: 'object',
    summary: type.summary,
    fields: ordered.map(([name, field]) =>
      // The type name is the bottom of the stack so that the `variant` field
      // can read this type's variants.
      fieldNode(name, field, { ...own, ...common }, [typeName])
    ),
  }
}

function sectionsNode() {
  return {
    name: 'sections',
    label: 'Sections',
    label_singular: 'Section',
    widget: 'list',
    // Never overridden: EditorPreviewPane.js:180 hardcodes
    // `t.get('name') === val.get('type')`, so a different key silently
    // disables the preview for every section.
    typeKey: 'type',
    min: 1,
    max: MAX_SECTIONS,
    allow_reorder: true,
    collapsed: true,
    minimize_collapsed: false,
    // Each type carries its own summary and Decap prefers it; this one is the
    // backstop for a type that somehow reaches the form without one.
    summary: '{{fields.id}}',
    hint: 'The page from top to bottom. Drag a section to move it.',
    types: Object.keys(sectionTypes()).map(sectionTypeNode),
  }
}

function collectionsNode() {
  const catalogue = loadCatalogue()
  return [
    {
      name: 'homepage',
      label: 'Homepage',
      label_singular: 'Homepage',
      description:
        'The content of orcid.org. Edit the English text here. Translations are handled separately and are matched to each item by its ID, so changing an ID discards that item’s translations.',
      format: 'json',
      files: [
        {
          name: 'home',
          label: 'Homepage content',
          file: 'content/home.en.json',
          fields: [
            // Decap writes back only the fields it knows about, so a version
            // that is not declared here is dropped from the document the first
            // time an editor saves.
            {
              name: 'schemaVersion',
              label: 'Schema version',
              widget: 'hidden',
              default: catalogue.schemaVersion,
            },
            {
              name: 'catalogueVersion',
              label: 'Catalogue version',
              widget: 'hidden',
              default: catalogue.catalogueVersion,
            },
            {
              name: 'page',
              label: 'Page',
              widget: 'object',
              fields: Object.entries(pageFields()).map(([name, field]) =>
                fieldNode(name, field, pageFields())
              ),
            },
            sectionsNode(),
          ],
        },
      ],
    },
  ]
}

// ---------------------------------------------------------------------------
// Media folders, read back from the hand-written half of the file
// ---------------------------------------------------------------------------

let media = null

/**
 * Decap resolves a *field-level* `media_folder` against the directory of the
 * entry file (selectMediaFolder in reducers/collections.ts), so the top-level
 * `content/images` would become `content/content/images` if it were copied down
 * verbatim. A leading slash means "from the repository root" and reproduces the
 * top-level setting exactly. `public_folder` is used as written and must stay
 * relative, because the stored value has to match the imagePath pattern
 * `^(images|assets)/…`.
 */
function readMediaSettings(text) {
  const head = text.split(BEGIN)[0]
  const read = (key) => {
    const match = new RegExp(`^${key}:[ \\t]*(\\S+)[ \\t]*$`, 'm').exec(head)
    if (!match) {
      throw new Error(
        `${CONFIG_PATH} has no top-level "${key}:" above the ${BEGIN} marker. The generated image fields copy it, so add it back to the hand-written part of the file.`
      )
    }
    return match[1].replace(/^['"]|['"]$/g, '')
  }
  const mediaFolder = read('media_folder')
  return {
    mediaFolder: mediaFolder.startsWith('/') ? mediaFolder : `/${mediaFolder}`,
    publicFolder: read('public_folder'),
  }
}

function mediaSettings() {
  if (!media) media = readMediaSettings(readFileSync(CONFIG_URL, 'utf8'))
  return media
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** The whole generated block, markers included, with no trailing newline. */
export function generateCollectionsBlock() {
  const header = [
    `${BEGIN} — scripts/gen/cms-config.mjs from schema/catalogue.json.`,
    '# Do not edit inside the markers by hand. Run `npm run gen` after changing',
    '# the catalogue; CI fails when the committed block and the catalogue differ.',
  ]
  return [
    ...header,
    'collections:',
    ...collectionsNode().flatMap((collection) =>
      emitSequenceItem(collection, 0)
    ),
  ].join('\n')
}

/** Replaces the marked block in an existing config, leaving the rest alone. */
export function spliceGeneratedBlock(existing, block) {
  const begin = existing.indexOf(BEGIN)
  const end = existing.indexOf(END)
  if (begin === -1 || end === -1 || end < begin) {
    throw new Error(
      `${CONFIG_PATH} must contain a "${BEGIN}" line followed by a "${END}" line: the collections block is generated between them and everything outside them is hand-written. Add both markers where the collections block belongs.`
    )
  }
  return `${existing.slice(0, begin)}${block}\n${existing.slice(end)}`
}

export function renderConfig() {
  const existing = readFileSync(CONFIG_URL, 'utf8')
  return spliceGeneratedBlock(existing, generateCollectionsBlock())
}

function main(argv) {
  const wanted = renderConfig()
  const existing = readFileSync(CONFIG_URL, 'utf8')
  if (argv.includes('--check')) {
    if (wanted !== existing) {
      process.stderr.write(
        `${CONFIG_PATH} does not match schema/catalogue.json. Run \`node scripts/gen/cms-config.mjs\` and commit the result.\n`
      )
      process.exitCode = 1
    }
    return
  }
  if (wanted !== existing) writeFileSync(CONFIG_URL, wanted)
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main(process.argv.slice(2))
}
