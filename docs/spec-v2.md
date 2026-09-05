# Schema Version 2 — The ORCID Homepage Content Model

**Final specification. No options, no open decisions.**

**Repos**
- **CMS** = `/Users/l.mendoza/code/orcid/orcid-homepage-decap-cms`
- **NG** = `/Users/l.mendoza/code/orcid/worktrees/orcid-angular-homepage-json` (branch `lmendoa/PD-0000-homepage-json-content`)
- **WEB** = `orcid-web` (the Java/Spring shell that serves the homepage HTML). Touched by exactly one unit of work (§10, W-SEO).

---

## 0. The decisions everything else follows from

These are stated first so the rest of the document reads as consequence, not opinion. Where a prior proposal disagreed, the disagreement is resolved here and never reopened.

**D1 — One machine-readable catalogue generates the schema, the CMS config, and the TypeScript types.** `CMS/schema/catalogue.json` is the only file a human edits when a section type, field or variant changes. `schema/home.schema.json`, the generated block of `admin/config.yml`, and `dist/types/homepage-content.generated.ts` are build artefacts, committed, and CI fails on drift. The catalogue is itself validated by `schema/catalogue.meta.schema.json`, which runs **first**, so a catalogue typo fails CI instead of emitting three broken artefacts.

**D2 — `sections` is a flat list. There is no nesting of sections, ever.** Side-by-side layout is `layout.span: "half"`, packed by a deterministic algorithm (§5.4). Rejected: a `split`/`group` container. It costs recursive heading arithmetic, recursive merge-patch, nested Decap `types` (structurally plausible but with no upstream test, doc or example), a deeper key namespace, and a much larger property-test surface — to serve one instance on the live page that `span: half` serves exactly as well.

**D3 — Accessibility is computed by the renderer, never authored.** Heading levels, ARIA roles, landmark names, focus behaviour, colour, contrast, `target`, `rel`, `lang`/`dir` are functions of position and type. The catalogue contains no field that sets any of them. The meta-schema forbids any field named `level`, `headingLevel`, `tag`, `size`, `heading`, `color`, `colour`, `target`, `rel`, `width`, `height`, `autoplay`, `order`. The only a11y inputs an editor supplies are those no machine can derive — alt text, video title, captions status, transcript, link text — and every one is `required` in the schema and quality-linted per locale.

**D4 — Additive catalogue changes are not breaking.** `schemaVersion` goes to `2` once. After that, a new section type, a new variant, or a new optional field bumps `catalogueVersion` only. The renderer validates each section independently, **drops** sections whose `type` it does not know, and **falls back** to a type's first variant for a `variant` it does not know. Without this rule the composable model buys nothing over the fixed one, because every new type would remain a coordinated two-repo release.

**D5 — Structure lives in fields, not in prose.** markdown-lite is *not* extended in v2 — still paragraphs, `**bold**`, `[text](url)`. Editors who need headed points use `feature-list`, where each point is a validated, individually-keyed, individually-translatable item at a computed heading level. Rejected: adding lists/italics/blockquotes to markdown-lite. It would grow two hand-rolled implementations that already provably disagree, put structure where the schema cannot validate it and the design system cannot style it, and defeat the purpose of a section catalogue.

**D6 — Every allowlist that currently fails open is replaced by a rule that fails closed.** Six verified today: `content.mjs:18` `KEYED_ARRAYS`, `content.mjs` `TRANSLATABLE_FIELDS`, `merge-patch.js:26` `KEYED_ARRAYS` (which does **not** contain `sections`), `images.mjs:12` `IMAGE_FIELDS = {icon, background}`, `preview.js` `key === 'icon' || key === 'background'`, `validate.mjs` `SINGLE_LINE_FIELDS`. Each is deleted and replaced (§2.5).

**D7 — Crawlability is in scope and scheduled.** The live homepage is server-rendered; a client-fetched bundle is a competence regression. W-SEO (§10) is a required, gated unit of work, not a note. It is specified in §5.7.

**D8 — Two enforcement points, both blocking.** Content CI in CMS (`npm run validate`, `npm run gen:check`), rendering CI in NG (axe + property tests + style greps + contrast specs). `yarn lint` in NG is verified to be `echo 'temporally disable Angular linter to until eslint update'` — it enforces nothing, so the greps and specs **are** the gate.

### 0.1 Corrections to the record

Three defect claims that circulated during design are **false**, verified in this worktree. They are corrected here so no implementer wastes time hunting them:

| Claim | Reality |
|---|---|
| "`news.component.html:6` is a second `<h1>`" | It is `<h2 i18n="@@home.latest_news" class="mat-headline-4" id="latest-news">`. **The JSON homepage has exactly one `<h1>` today** (the hero, `homepage-hero.component.html:2`). The extra `<h1>`s are at `home.component.html:45` and `:192`, which render **only in the static-fallback branch**. |
| "duplicate `id="main"` on the homepage" | `grep -n 'id="main"' src/app/home/pages/home/home.component.html` returns exactly one hit, line 1. There is no duplicate. |
| "the news section has no `<section>` wrapper / no name" | `news.component.html:1` is `<section [attr.aria-label]="labelHomeNews">` and is correct. Its `aria-labelledby="latest-news"` on the inner `.container` `<div>` is inert noise and is removed. |

Real, verified defects that **do** remain, and are fixed by this spec: `<main>` has no `tabindex="-1"`; the loading spinner is not in a live region; the hero has no scrim over an author-chosen photo; `mat-stretch-tabs="false"` + `[disablePagination]="false"` produces a paginated strip at 375px; `allow="autoplay; …"` on the video iframe; `rel="noopener noreferrer"` applied to internal links; `mailto:` classified as external (`new URL('mailto:x').host === ''`); `.col { display: flex; flex-wrap: wrap }` in `grid.scss:115` with no `:host{display:block}` on the new components; the exact-equality version guard at `homepage-content.ts:120`.

---

# 1. Section catalogue

## 1.0 Common vocabulary

**Field kinds.** Exactly these, closed set, enforced by the meta-schema.

| kind | Translatable | Meaning |
|---|---|---|
| `plain` | **yes** | Single line. No markdown, no links, no newlines. |
| `rich` | **yes** | markdown-lite: paragraphs, `**bold**`, `[text](url)` with host allowlist. |
| `alt` | **yes** | Single line, alt-text lint rules (§7.3). Only ever appears inside an informative `image`. |
| `note` | **no** | Editorial metadata for reviewers. Never rendered, never translated, never in the extract. |
| `id` | no | `^[a-z][a-z0-9-]{0,59}$`. |
| `href` | no | Absolute `https:` or `mailto:`, host-allowlisted. |
| `enum` | no | Closed value set named in the catalogue. |
| `integer` | no | With `min`/`max`. |
| `boolean` | no | |
| `videoId` | no | Pattern resolved from the sibling `providerField`. |
| `image` | container | `{src, focalPoint?}` when `decorative: true`; `{src, alt, focalPoint?, containsText?}` when `decorative: false`. |
| `object` | container | `of: <itemType>`. |
| `list` | container | `of: <itemType>`, `min`, `max`. |

**Structural fields every section carries.** Emitted into every schema branch by the generator; never re-specified per type.

| Field | Kind | Required | Notes |
|---|---|---|---|
| `id` | `id` | yes | Permanent translation-key root. Unique across the whole `sections` array. |
| `type` | `enum` | yes | The discriminator. Written by Decap's `typeKey`; never typed by a human. |
| `variant` | `enum` | yes | Always required. An absent variant means "whatever the renderer's default is this release", which is the silent drift this design exists to remove. |
| `layout` | `object of layout` | yes | `{span, spacing, tone}`, defaults `{full, normal, default}`. Collapsed in the CMS. |

**Item type `layout`** (structural, never translated):

| field | values | default | meaning |
|---|---|---|---|
| `span` | `full` \| `half` | `full` | At the `l` tier only. Adjacent `half`s pack 2-up (§5.4). |
| `spacing` | `compact` \| `normal` \| `loose` | `normal` | Block padding: 24/40/64px at `l`, 16/24/40px at `s`. |
| `tone` | `default` \| `surface` \| `brand-dark` \| `brand-tint` | `default` | A **contrast-verified background/foreground pair**, never a free colour. |

**Tone pairs.** Computed from `projects/orcid-tokens/tokens.json` by `tone-contrast.spec.ts`, which recomputes every ratio at test time and asserts ≥ 4.5:1 — the numbers below are the current computed values, not assertions:

| tone | background | foreground | ratio |
|---|---|---|---|
| `default` | `#ffffff` | `--orcid-color-text` `#222222` | **15.91:1** |
| `surface` | `--orcid-color-ui-background-light` `#eeeeee` | `--orcid-color-text` `#222222` | **13.71:1** |
| `brand-dark` | `--orcid-color-brand-secondary-darkest` `#003449` | `#ffffff` | **13.23:1** |
| `brand-tint` | `--orcid-color-brand-primary-lightest` `#f5f9e8` | `--orcid-color-brand-secondary-darkest` `#003449` | **12.35:1** |

`#ffffff` is the only literal not defined as a token; it and `--orcid-color-text` are declared once in `NG/src/app/home/sections/_tone.scss`, which is the **only** file in `src/app/home/**` exempt from the no-hex-literals grep. `#2E7F9F` (brand secondary) is deliberately **not** offered as a tone foreground: it is 4.51:1 on white with zero margin.

**Rejected outright, and absent from the catalogue rather than discouraged in documentation:** a `spacer` section type (rhythm is `layout.spacing`; an empty section is an empty landmark and 7 `aria-hidden` divs are the WordPress residue this rebuild escapes); free colour or spacing pickers; carousels, sliders, auto-advancing anything (SC 2.2.2, 2.5.7); background-video heroes (SC 1.4.3 unverifiable); modal/interstitial on load; text-as-image banners; a `draft` flag (a draft's strings still reach Transifex; the PR is the draft); a raw `html`/`embed` type (breaks the parse-to-nodes invariant on which every other guarantee rests).

---

## 1.1 `audience-selector` — the "ORCID is for…" chooser

**Purpose.** The live page's tabbed audience hero (S2). The page's primary navigation device and the thing the current implementation gets most wrong.

**Fields**

| name | kind | required | translatable | maxLength | editor label / hint |
|---|---|---|---|---|---|
| `title` | `plain` | no | yes | 120 | *Heading.* "Leave empty when the page title above already says it." |
| `audiences` | `list of audience` (min 1, max 8) | yes | — | — | *Audiences.* |

**Item type `audience`**

| name | kind | required | translatable | maxLength | notes |
|---|---|---|---|---|---|
| `id` | `id` | yes | — | — | |
| `label` | `plain` | yes | yes | **60** | Tab/accordion header. 60, not 300 — six long labels force pagination even on desktop. |
| `intro` | `rich` | yes | yes | 800 | |
| `background` | `image` (**decorative**) | no | — | — | `{src, focalPoint}`. No alt field exists; renderer always emits `alt="" aria-hidden="true"`. |
| `features` | `list of feature-item` (min 1, max 4) | yes | — | — | v1's hard "exactly 2" is gone. |

**Variants**

| name | editor label | description |
|---|---|---|
| `tabs-photo` | Tabs with background photo (recommended) | Live-page look. Photo under a mandatory scrim, white text, translucent bordered feature cards. Becomes an accordion below 1024px. |
| `tabs-flat` | Tabs, flat brand colour | Same structure, no photograph; flat `#003449`. The safe default when no good image exists. |
| `stacked` | Stacked list — every audience always visible | No widget. Each audience is a headed block. All content in the DOM, the outline, print, find-in-page and search at every viewport. |

**Responsive**

| tier | `tabs-photo` / `tabs-flat` | `stacked` |
|---|---|---|
| `s` (<600) | **accordion**, one full-width ≥48px header per audience, single-expand, chevron; feature cards 1-up | headed blocks, cards 1-up |
| `m` (600–839) | accordion; cards 2-up | headed blocks, cards 2-up |
| `l` (≥840) | **accordion 840–1023.98; APG tab strip at ≥1024**; cards 2-up | headed blocks, cards 2-up |

Background photo is `display:none` below 1024 (the flat tone shows through); shown with `object-fit: cover` and `object-position` from `focalPoint` at ≥1024.

**Accessibility contract**
- `<section [attr.aria-labelledby]>` when it has a title; a plain `<div>` when it does not. Never an unnamed `<section>`, never `role="region"` with an invented `aria-label`.
- **Tabs mode** (≥1024): Angular Material `mat-tab-group`; `animationDuration="0ms"`; `[disablePagination]="true"`; `mat-stretch-tabs` default; labels **wrap** (`.mdc-tab__text-label { white-space: normal }`); `aria-label` on the tablist from `$localize` `@@home.audienceTablist` ("Choose who you are"), asserted in the rendered DOM by a spec; automatic activation; Home/End; tabpanel `tabindex="0"` **always**; RTL arrow mapping asserted against an RTL fixture.
- **Accordion mode** (<1024): each header is `<button type="button">` inside an `app-heading` at the computed level, with `aria-expanded` and `aria-controls`; panel is `role="region"` + `aria-labelledby` (valid: max 8 panels, each uniquely named); single-expand with exactly one always open; clicking the open header is a no-op but it stays focusable with `aria-expanded="true"` — never `aria-disabled`, never removed from tab order; content stays in the DOM once opened and hides with the `hidden` attribute; no roving tabindex — every header is an ordinary tab stop; Up/Down/Home/End are a convenience, never the only path.
- **All panels' text is in the DOM at all times** in `stacked`; in `tabs-*` non-selected panels are rendered and `hidden` (no `matTabContent` lazy templates), so find-in-page, print and reader mode reach every audience and there is no height jump on tab change.
- Selected/open state is **never colour alone**: colour + 3px bottom `border` (not `box-shadow`, which forced-colors removes) + `font-weight: 600` + `aria-selected`/`aria-expanded` + chevron rotation.
- `tabs-photo` mandates the scrim (§7.2). Alpha is a component constant; no editor field reduces it.
- `selectedAudienceId` survives the tabs↔accordion switch; focus moves to the equivalent control, never to `<body>` (SC 1.3.4).
- Chevron mirrors under `[dir='rtl']` and rotates only when `prefers-reduced-motion: no-preference`.

---

## 1.2 `media` — prose beside a video or an image

**Purpose.** The live page's S5 left column (Featured News + Vimeo), generalised. Also the home for every standalone video.

**Fields**

| name | kind | required | translatable | maxLength |
|---|---|---|---|---|
| `kicker` | `plain` | no | yes | 40 |
| `title` | `plain` | no | yes | 200 |
| `body` | `rich` | no | yes | 1200 |
| `mediaKind` | `enum` `video` \| `image` | yes | — | — |
| `media` | `object of video` when `mediaKind=video`; `object of image` (**informative**) when `mediaKind=image` | yes | mixed | — |
| `actions` | `list of action` (max 2) | no | `label` only | — |

**Variants:** `media-end` (prose start / media end at `l`), `media-below` (prose then full-width media), `media-only` (media plus optional caption; title and body omitted).

Rejected: `media-start`. Putting media first visually at `l` requires either `order:`/`row-reverse` (forbidden: breaks focus order, and a video iframe is focusable) or media-before-heading in the DOM (a player announced before the heading that explains it).

**Responsive.** `s`/`m`: always stacked, prose first, regardless of variant. `l`: `media-end` is a 58/42 split (`col l7` / `col l5`); media is `max-width: 720px`; `media-below` centres the media at `max-width: 800px`. Prose is `max-width: 68ch` at every tier.

**Accessibility.** The kicker is a styled `<p>`, never a heading, and carries **no** `text-transform: uppercase` — the source string carries its own casing (`text-transform` is locale-sensitive only when `lang` is set, which mis-cases Turkish `i`), and `letter-spacing` is dropped under `:lang(ar)` because it breaks Arabic joining. `title` is an `app-heading` at the computed level. `mediaKind: image` is an **informative** slot: `alt` required. Video contract is §6. The `*ngIf` for the media column is on the **column**, not an inner div — a null media never leaves an empty padded half-row.

---

## 1.3 `feature-list` — a heading plus repeating headed points

**Purpose.** The live page's S5 right column (`integrate`: heading + three sub-headed paragraphs with rules) **and** generic benefit/card grids. Replaces `integrate.paragraphs[]`, which cannot express a sub-heading at all.

**Fields**

| name | kind | required | translatable | maxLength |
|---|---|---|---|---|
| `title` | `plain` | no | yes | 200 |
| `intro` | `rich` | no | yes | 600 |
| `columns` | `enum` `2` \| `3` | no (default `3`) | — | — |
| `items` | `list of feature-item` (min 1, max 9) | yes | — | — |

**Item type `feature-item` — shared with `audience.features`.** This reuse is the composability win.

| name | kind | required | translatable | maxLength | notes |
|---|---|---|---|---|---|
| `id` | `id` | yes | — | — | |
| `title` | `plain` | no | yes | 80 | When present, an `app-heading` at the computed level. |
| `body` | `rich` | yes | yes | 500 | |
| `icon` | `image` (**decorative**) | no | — | — | Rendered `alt="" aria-hidden="true"` beside its own title. |
| `link` | `object of link` | no | `label` only | — | `{label, href}` — the URL leaves the translated string. |

**Variants:** `cards` (bordered, 8px radius, 16px padding, icon above title), `columns` (no card chrome — today's `integrate`), `panel` (tinted panel, single column, `<hr>` between items), `checklist` (icon inline-start, dense single column).

**Responsive.** `cards`/`columns`: 1-up at `s`, 2-up at `m`, `columns`-up at `l`, laid out with `grid-template-columns: repeat(auto-fit, minmax(240px, 1fr))` so a ragged last row is impossible. `panel`/`checklist`: single column at every tier. Icons hidden below 600px in `columns` only (matching the live page's ≤767 rule); always shown in `cards` and `checklist`.

**Accessibility.** An item with a `title` emits an `app-heading`; an item without one emits no heading at all — so mixing titled and untitled items cannot punch a hole in the outline. `validate.mjs` **errors** if `variant: panel` or `checklist` is used with any untitled item (those variants are visually a definition list). `panel`'s separator is `<hr>` with `border-top: 1px solid var(--orcid-color-border-subtle, #dddddd)` (≥3:1) — the live page's white-on-#f0edf0 rule is 1.16:1 and invisible. Cards are `min-height`, never `height`, and `align-items: stretch`.

---

## 1.4 `quick-links` — the icon quick-links navigation

**Purpose.** The live page's S4. **Has no representation whatsoever in v1.** Six links, each with its own icon, in a bordered tinted card. It is the page's primary conversion path ("Get my ORCID iD and record"); omitting it fails requirement 1 outright.

**Fields**

| name | kind | required | translatable | maxLength | notes |
|---|---|---|---|---|---|
| `title` | `plain` | **yes** | yes | 120 | Names the `<nav>`. Required in every variant so the landmark can never be anonymous. |
| `titleHidden` | `boolean` | no (default **true**) | — | — | Renders the heading `cdk-visually-hidden`; the region keeps its name. |
| `links` | `list of link-item` (min 2, max 8) | yes | — | — | |

**Item type `link-item`:** `{ id, label (plain, req, transl, ≤60), href (href, req), description (plain, opt, transl, ≤120), icon (image, decorative, opt) }`.

**Variants:** `bar` (single bordered tinted row — the live look), `grid` (cards; forces `titleHidden: false`), `list` (vertical, `description` shown; forces `titleHidden: false`).

**Responsive.** `bar`: full-width vertical list with ≥48px rows and 16px labels at `s`; two-row wrap at `m`; single row with `justify-content: space-around` and **`flex-wrap: wrap`** at `l` (the live page's `nowrap` guarantees overflow in German). `grid`/`list`: 1/2/3-up.

**Accessibility.** `<nav [attr.aria-labelledby]>` → `<ul>` → `<li>` → `<a>`; the whole row is the anchor and is ≥44×44. Icons are real `<img alt="" aria-hidden="true">` with intrinsic `width`/`height` — never CSS `background-image`, which vanishes under forced-colors (the live page's do). `validate.mjs` enforces nav-name uniqueness within the document.

---

## 1.5 `prose` — a heading and a body

**Purpose.** The escape hatch. Without one, editors abuse `feature-list` with a single item, or ask for markdown extensions.

| name | kind | required | translatable | maxLength |
|---|---|---|---|---|
| `title` | `plain` | no | yes | 200 |
| `body` | `rich` | yes | yes | 2000 |

**Variants:** `default` (start-aligned, `68ch`), `lead` (larger type, `56ch`), `centered` (centred block, `56ch`).
**Responsive:** measure only; type scale steps down one step at `s`.
**Accessibility:** inherits the rich-text contract (§7.5).

---

## 1.6 `cta-band` — heading, sentence, up to two actions

**Purpose.** The static fallback page that v1 degrades to has exactly this ("Distinguish yourself in three easy steps" with REGISTER / SIGN IN / FIND OUT MORE). There is currently **no way at all** to express a button — only an inline markdown link. Shipping a composable model with no CTA primitive guarantees a breaking addition within a quarter, which is what D4 exists to prevent.

| name | kind | required | translatable | maxLength |
|---|---|---|---|---|
| `title` | `plain` | yes | yes | 200 |
| `body` | `rich` | no | yes | 600 |
| `actions` | `list of action` (min 1, max 2) | yes | `label` only | — |

**Item type `action`:** `{ id, label (plain, req, transl, ≤60), href (href, req), style (enum `primary`|`secondary`) }`. `style` is a **role**, mapped by the renderer to `orcidBrandSecondaryDarkButton` / an outlined variant from `@orcid/ui`. It is not a colour.

**Variants:** `band` (full-bleed tone band), `panel` (contained card), `inline` (text flow, no chrome).
**Responsive:** actions side by side at `m`/`l`, stacked full-width at `s`.
**Accessibility:** actions are `<a>` styled as buttons (they navigate), ≥44×44, distinguished by fill + border + contrast, never colour alone.

---

## 1.7 `news-feed` — the WordPress news strip

**Purpose.** `<app-news>` is on the page today, sits outside the content model, cannot be reordered, retitled or removed, and is invisible to the CMS preview. Making it a section type costs almost nothing and fixes all four.

| name | kind | required | translatable |
|---|---|---|---|
| `title` | `plain` | yes | yes |
| `source` | `enum` (currently only `orcid-blog`) | yes | — |
| `maxItems` | `integer` (2–6, default 3) | no | — |

**Variants:** `grid` (3-up), `list` (compact vertical).
**Responsive:** 1/2/3-up.
**Accessibility.** Named `<section>`; `app-heading` at the computed level (never `h1`); each article title an `app-heading` one level deeper, wrapped in `<a>`; `<time datetime>` for dates. Feed items are **untrusted third-party content**: rendered as text nodes only, never `innerHTML`, titles truncated to 120 characters by the renderer with the full string in a `title` attribute. Its own async load uses `role="status"` and `orcid-skeleton-placeholder` from `@orcid/ui`, not a spinner. **A failed or empty feed renders nothing at all** — not an empty named region, not an error announced to a visitor. Every item link is external and gets the new-tab treatment (§7.5).

---

## 1.8 Item types recap

`layout`, `audience`, `feature-item`, `link-item`, `action`, plus the value objects `image`, `video`, `captions`, `audio-description`, `link`. **Ten item types serve seven section types**, because `feature-item` is shared by `audience` and `feature-list`, and `action` by `media` and `cta-band`. That reuse is why the catalogue stays small without authoring becoming cryptic.

---

# 2. The descriptor table

## 2.1 Exact files

| File | Status |
|---|---|
| `CMS/schema/catalogue.json` | **Hand-edited. The only source of truth.** ~700 lines. |
| `CMS/schema/catalogue.meta.schema.json` | Hand-edited. Validates the catalogue. Runs first in `npm run validate`. |
| `CMS/scripts/lib/catalogue.mjs` | Loader + `typeOf`, `fieldKind`, `isTranslatable`, `variantsOf`, `fieldsOf`, `itemTypeOf`. Node only. |
| `CMS/admin/catalogue-browser.js` | Dependency-free ESM wrapper for the browser admin (same role as the existing `admin/merge-patch.js`). Re-exports the same four predicates by `fetch`ing `catalogue.json`. |
| `CMS/schema/home.schema.json` | **Generated** by `scripts/gen/schema.mjs`. Committed. CI drift-checked. |
| `CMS/admin/config.yml` | The `sections` block **generated** by `scripts/gen/cms-config.mjs` between `# BEGIN GENERATED` / `# END GENERATED` markers. Committed. CI drift-checked. Everything outside the markers stays hand-written. |
| `CMS/dist/types/homepage-content.generated.ts` | **Generated** by `scripts/gen/ts-types.mjs`. Published by the build; vendored into NG. |
| `CMS/dist/catalogue.json` | Published by the build for the renderer's CI check. |

Plain JSON rather than TypeScript or JS so that Node scripts, the browser admin, a future consumer and a human reviewer all read the same bytes with no build step.

## 2.2 Exact shape

```jsonc
{
  "catalogueVersion": 1,
  "schemaVersion": 2,

  "enums": {
    "span":        { "values": ["full", "half"], "labels": { "full": "Full width", "half": "Half width (pairs with the next half-width section)" } },
    "spacing":     { "values": ["compact", "normal", "loose"], "labels": { "compact": "Tight", "normal": "Normal", "loose": "Roomy" } },
    "tone":        { "values": ["default", "surface", "brand-dark", "brand-tint"],
                     "labels": { "default": "White", "surface": "Light grey", "brand-dark": "Dark blue (white text)", "brand-tint": "Pale green" } },
    "focalPoint":  { "values": ["center", "top", "bottom", "start", "end"], "labels": { "start": "Left in LTR, right in RTL", "end": "Right in LTR, left in RTL" } },
    "aspectRatio": { "values": ["16:9", "4:3", "1:1", "9:16"] },
    "actionStyle": { "values": ["primary", "secondary"], "labels": { "primary": "Solid button", "secondary": "Outlined button" } },
    "columns":     { "values": [2, 3] },
    "mediaKind":   { "values": ["video", "image"] },
    "adStatus":    { "values": ["described-track", "not-needed"],
                     "labels": { "described-track": "The video has an audio-description track",
                                 "not-needed": "No audio description is needed — explain why below" } },
    "newsSource":  { "values": ["orcid-blog"] }
  },

  "videoProviders": {
    "vimeo":   { "label": "Vimeo",   "pattern": "^[0-9]{1,20}$",
                 "example": "1198760040",
                 "host": "player.vimeo.com",
                 "embed": "https://player.vimeo.com/video/{id}?dnt=1&title=0&autoplay={autoplay}{start}",
                 "startParam": "#t={start}s",
                 "watchUrl": "https://vimeo.com/{id}" },
    "youtube": { "label": "YouTube", "pattern": "^[A-Za-z0-9_-]{11}$",
                 "example": "1rZvFGLe7bg",
                 "host": "www.youtube-nocookie.com",
                 "embed": "https://www.youtube-nocookie.com/embed/{id}?rel=0&modestbranding=1&cc_load_policy=1&autoplay={autoplay}{start}",
                 "startParam": "&start={start}",
                 "watchUrl": "https://www.youtube.com/watch?v={id}" }
  },

  "commonFields": {
    "id":      { "kind": "id",   "required": true,  "label": "ID",
                 "hint": "Permanent translation key. Changing it discards every translation of this section." },
    "variant": { "kind": "enum", "required": true,  "fromVariants": true, "label": "How it displays" },
    "layout":  { "kind": "object", "of": "layout", "required": true, "collapsed": true, "label": "Layout" }
  },

  "itemTypes": {
    "layout": {
      "label": "Layout",
      "fields": {
        "span":    { "kind": "enum", "enum": "span",    "default": "full",
                     "hint": "Half-width sections pair with the very next half-width section on wide screens." },
        "spacing": { "kind": "enum", "enum": "spacing", "default": "normal" },
        "tone":    { "kind": "enum", "enum": "tone",    "default": "default",
                     "hint": "Each choice is a tested background/text colour pair. Colours are not editable individually." }
      }
    },

    "image": {
      "label": "Image",
      "variantsByDecorative": true,
      "fields": {
        "src":          { "kind": "imagePath", "required": true, "label": "File" },
        "focalPoint":   { "kind": "enum", "enum": "focalPoint", "default": "center",
                          "hint": "Which part of the picture stays in view when it is cropped." },
        "alt":          { "kind": "alt", "required": true, "maxLength": 150, "informativeOnly": true,
                          "label": "Describe this picture",
                          "hint": "What would you say if you were reading the page aloud? Do not start with \"image of\"." },
        "containsText": { "kind": "boolean", "default": false, "informativeOnly": true,
                          "label": "This picture has words in it" }
      }
    },

    "feature-item": {
      "label": "Feature",
      "summary": "{{title | default('(untitled)') | truncate(48)}}",
      "fields": {
        "id":    { "kind": "id" },
        "title": { "kind": "plain", "maxLength": 80,  "required": false },
        "body":  { "kind": "rich",  "maxLength": 500, "required": true },
        "icon":  { "kind": "image", "decorative": true, "required": false,
                   "hint": "Small decorative icon. The title carries the meaning, so no description is collected." },
        "link":  { "kind": "object", "of": "link", "required": false }
      }
    },

    "link":   { "inline": true, "fields": {
                  "label": { "kind": "plain", "required": true, "maxLength": 80 },
                  "href":  { "kind": "href",  "required": true } } },

    "action": { "summary": "{{label}}", "fields": {
                  "id":    { "kind": "id" },
                  "label": { "kind": "plain", "required": true, "maxLength": 60 },
                  "href":  { "kind": "href",  "required": true },
                  "style": { "kind": "enum", "enum": "actionStyle", "default": "primary" } } },

    "captions": { "label": "Captions", "fields": {
                    "available":     { "kind": "boolean", "const": true, "required": true,
                                       "label": "The video has captions",
                                       "hint": "ORCID does not publish videos without captions. This cannot be unticked." },
                    "locales":       { "kind": "list", "of": "locale-tag", "min": 1, "max": 30, "required": true,
                                       "label": "Caption languages", "hint": "Must include en." },
                    "autoGenerated": { "kind": "boolean", "default": false,
                                       "label": "These are auto-generated captions",
                                       "hint": "Auto-generated captions do not meet WCAG 1.2.2. Ticking this blocks publishing." } } },

    "audio-description": { "label": "Audio description", "fields": {
                    "status":        { "kind": "enum", "enum": "adStatus", "required": true },
                    "justification": { "kind": "note", "maxLength": 400, "requiredWhen": { "status": "not-needed" },
                                       "label": "Why no audio description is needed",
                                       "hint": "A reviewer reads this. Example: 'the narrator reads every on-screen label aloud'." } } },

    "video": {
      "label": "Video",
      "fields": {
        "provider":        { "kind": "enum", "enum": "videoProviders", "required": true },
        "videoId":         { "kind": "videoId", "providerField": "provider", "required": true,
                             "hint": "The provider's ID only, never the whole web address. Vimeo: 1198760040. YouTube: 1rZvFGLe7bg." },
        "title":           { "kind": "plain", "required": true, "maxLength": 120,
                             "hint": "The video's own title. Screen readers announce this instead of 'iframe'." },
        "aspectRatio":     { "kind": "enum", "enum": "aspectRatio", "default": "16:9" },
        "durationSeconds": { "kind": "integer", "min": 1, "max": 36000, "required": false },
        "startAt":         { "kind": "integer", "min": 0, "required": false },
        "poster":          { "kind": "image", "decorative": false, "responsive": true, "required": true,
                             "hint": "Shown before anyone presses play, and to visitors who decline cookies." },
        "captions":        { "kind": "object", "of": "captions", "required": true },
        "audioDescription":{ "kind": "object", "of": "audio-description", "required": true },
        "transcript":      { "kind": "rich", "required": true, "maxLength": 20000,
                             "hint": "The full spoken content. Shown on the page under the player, in both cookie states." }
      }
    },

    "audience": {
      "label": "Audience",
      "summary": "{{label | default('(no name)')}}",
      "fields": {
        "id":         { "kind": "id" },
        "label":      { "kind": "plain", "required": true, "maxLength": 60,
                        "hint": "Short. It has to fit a tab across six of them, in German." },
        "intro":      { "kind": "rich", "required": true, "maxLength": 800 },
        "background": { "kind": "image", "decorative": true, "responsive": true, "required": false },
        "features":   { "kind": "list", "of": "feature-item", "min": 1, "max": 4,
                        "labelSingular": "Feature", "allowReorder": true }
      }
    },

    "link-item": { "summary": "{{label}}", "fields": {
        "id":          { "kind": "id" },
        "label":       { "kind": "plain", "required": true, "maxLength": 60 },
        "href":        { "kind": "href",  "required": true },
        "description": { "kind": "plain", "required": false, "maxLength": 120 },
        "icon":        { "kind": "image", "decorative": true, "required": false } } },

    "locale-tag": { "scalar": "string", "pattern": "^[a-z]{2}(-[A-Za-z0-9]{2,8})?$" }
  },

  "sectionTypes": {
    "audience-selector": {
      "label": "Audience selector",
      "labelSingular": "Audience selector",
      "summary": "Audience selector — {{title | default('(no heading)') | truncate(40)}}",
      "maxPerPage": 2,
      "emitsItemHeadings": true,
      "variants": [
        { "name": "tabs-photo", "label": "Tabs with background photo (recommended)",
          "hint": "Matches orcid.org today. Becomes an accordion below 1024px." },
        { "name": "tabs-flat",  "label": "Tabs, flat brand colour" },
        { "name": "stacked",    "label": "Stacked list — every audience always visible",
          "hint": "Best for search engines and for screen readers. No interaction needed." }
      ],
      "fields": {
        "title":     { "kind": "plain", "required": false, "maxLength": 120 },
        "audiences": { "kind": "list", "of": "audience", "min": 1, "max": 8,
                       "labelSingular": "Audience", "allowReorder": true, "allowAdd": true, "allowRemove": true }
      }
    }
    /* media, feature-list, quick-links, prose, cta-band, news-feed — same shape */
  }
}
```

The seven `sectionTypes` entries are fully specified by §1: each declares `label`, `labelSingular`, `summary`, `maxPerPage`, `emitsItemHeadings`, `titleRequired` where §1 says the title is required, `variants` (name/label/hint), and `fields` with the kinds, requiredness, `maxLength` and hints from the §1 tables.

## 2.3 The meta-schema

`schema/catalogue.meta.schema.json` enforces, and `npm run validate` runs it **before anything else**:

1. Every `of` resolves to a declared `itemTypes` key; every `enum` reference resolves to a declared `enums` key or to `videoProviders`.
2. Every field has a `kind` from the closed set of §1.0.
3. Every `image` field declares `decorative: true|false`.
4. Every `videoId` field names an existing sibling `providerField`.
5. Every section type has ≥1 variant, a `summary`, a `label` and a `labelSingular`; every list field has a `labelSingular`, a `min` **and** a `max`.
6. `emitsItemHeadings: true` ⇒ `titleRequired: true` is permitted but not mandated — the level rule (§4.4) makes it unnecessary; the flag drives the CMS field ordering only.
7. **No field is named** `level`, `headingLevel`, `tag`, `size`, `heading`, `color`, `colour`, `target`, `rel`, `width`, `height`, `autoplay`, `order` (D3).
8. No `id`, item id or reserved word equals `__order` or `__replace`.
9. `additionalProperties: false` throughout.

## 2.4 How each consumer derives

| # | Consumer | Derivation | Enforcement |
|---|---|---|---|
| 1 | `schema/home.schema.json` | `scripts/gen/schema.mjs`, committed | `npm run gen:check` regenerates to a temp dir and diffs; non-identical ⇒ CI fail, with a message naming `npm run gen` |
| 2 | `scripts/validate.mjs` | imports `scripts/lib/catalogue.mjs` at runtime; nothing generated | meta-schema + §7.3 checks |
| 3 | `admin/config.yml` `sections` block | `scripts/gen/cms-config.mjs`, between `BEGIN/END GENERATED` markers, committed | `npm run gen:check` |
| 4 | `scripts/lib/content.mjs` (extraction/translation) | imports `catalogue.mjs`; **undeclared field throws** | fail-closed by construction |
| 5 | NG types + per-type guards | `scripts/gen/ts-types.mjs` → `dist/types/homepage-content.generated.ts`; NG vendors it plus `dist/catalogue.json` | NG spec `catalogue-coverage.spec.ts`: every `sectionTypes` key has a component; every variant is handled; every `requiredA11yFields` entry is consumed. `npm run sync:catalogue` refreshes the vendored copies; a scheduled weekly job opens the refresh PR; **staleness is bounded** by the check in §2.6. |
| 6 | `admin/merge-patch.js` | **needs no catalogue** — the universal keyed-array rule (§8.6) is type-agnostic, so it stays dependency-free browser+Node ESM | property test |
| 7 | `admin/preview.js` and NG `withAbsoluteAssets` | **need no catalogue** — image discovery is by value (§2.5) | build sweep |

## 2.5 The six fail-open allowlists, and their fail-closed replacements

| Deleted (verified present today) | Replaced by |
|---|---|
| `content.mjs` `TRANSLATABLE_FIELDS` | catalogue `kind ∈ {plain, rich, alt}`. **An undeclared field throws** `unknown field "x" on type "y"`. |
| `content.mjs:18` `KEYED_ARRAYS` | Universal rule: an array is keyed iff it is non-empty and every item is a plain object with a non-empty string `id`. An array mixing objects and non-objects, or objects without ids, is a **hard error**, not a skip. Consequence enforced in the meta-schema: repeated prose is always id-keyed objects, never an array of strings. |
| `merge-patch.js:26` `KEYED_ARRAYS` (does not contain `sections`) | The same universal predicate, inlined — no import needed. |
| `images.mjs:12` `IMAGE_FIELDS = {icon, background}` | **Value rule**: any *string* matching the `imagePath` pattern `^(images\|assets)/[A-Za-z0-9._-]+\.(png\|jpe?g\|svg\|webp)$`, found by walking any shape. |
| `preview.js` `key === 'icon' \|\| key === 'background'` | Same value rule. |
| `validate.mjs` `SINGLE_LINE_FIELDS` | `kind: 'plain'` and `kind: 'alt'` imply single-line, enforced by `lintPlainText`. |
| NG `withAbsoluteAssets` hardcoded paths | Same value rule, applied by a generic walk. |

Plus a belt-and-braces sweep in `build.mjs` after `rewriteImagePaths`: walk the built document for any surviving string matching `^images/` and **fail the build**. Two independent checks make the silent-404-with-green-build impossible.

**The v1→v2 image shape change is explicitly covered.** v1 stores `background: "images/x.png"` (a bare string); v2 stores `{src: "images/x.png"}`. The value rule finds the path either way, so an unwrapped string would still be fingerprinted — and then the schema rejects it, because every image slot is `type: object` with `required: ["src"]`. So an unwrapped string fails closed at validate time. Additionally, `002-sections.mjs` asserts, and `v1-adapter.spec.ts` asserts, that after transformation **no string matching `imagePath` sits anywhere except at a `.src` key**.

## 2.6 Cross-repo drift, bounded

The vendored copy in NG is refreshed by a scheduled job, so a window exists between a CMS catalogue change and that PR merging. It is bounded, not hoped away:

- `build.mjs` writes `catalogueVersion` into `dist/version.json`.
- NG CI step `check:catalogue-freshness` fetches the **QA** bundle's `version.json` and fails if `catalogueVersion` **exceeds the vendored copy's by more than one**, or if the vendored copy is more than 14 days behind the published `generatedAt`. A single-version lag is tolerated (that is the normal state during a refresh PR); anything beyond it is red.
- The failure is a red build in NG, whose fix is "merge the open refresh PR" — an action, not an investigation. If no refresh PR is open, that itself is the bug.
- CMS CI step `check:renderer-coverage` fetches NG's published `SUPPORTED` manifest (§4.8) from the QA build and **warns** (never blocks a content PR) when a catalogue type has no renderer.

## 2.7 The kind → Decap widget mapping

This is the core of `gen/cms-config.mjs` and is specified exhaustively so no implementer invents it.

| kind | Decap widget | Emitted options |
|---|---|---|
| `plain` | `string` | `required`, `hint`, `pattern: ['^[^\n\r]{1,<maxLength>}$', 'One line, no line breaks, max <maxLength> characters']` |
| `alt` | `string` | as `plain`, plus the alt hint |
| `rich` | **`text`** | `required`, `hint`. **Not `markdown` and not `richtext`.** Decap's richtext deserialises pasted HTML wholesale (`pasteHandler.js`) and `buttons:` restricts the toolbar, not the document — so a paste from Word inserts headings and lists that markdown-lite cannot represent. markdown-lite is a three-construct grammar; a plain textarea plus the live preview plus `markdown-lint.mjs` is the correct fit and the only one whose constraint is real. |
| `note` | `text` | `required: false` unless `requiredWhen` (then `required: false` in Decap, enforced by `validate.mjs`) |
| `id` | `string` | `pattern: ['^[a-z][a-z0-9-]{0,59}$', 'Lowercase letters, digits and hyphens; must start with a letter']`, the permanence hint |
| `href` | `string` | `pattern: ['^(https://[^\\s]+\|mailto:[^\\s@]+@[^\\s@]+)$', 'A full https:// address, or mailto:someone@example.org']`, hint listing the allowed hosts. Host allowlist enforced by `validate.mjs`. |
| `enum` | `select` | `options: [{label, value}]` from `enums[<name>].labels` (falling back to the value), `default`, `hint` |
| `boolean` | `boolean` | `required: false` always; a `const: true` field emits `default: true` plus the hint, and `validate.mjs` enforces the constant |
| `integer` | `number` | `value_type: int`, `min`, `max` |
| `videoId` | `string` | `pattern` = the union of all `videoProviders[*].pattern`, message naming both examples. Per-provider pattern enforced by `validate.mjs`. |
| `imagePath` | `image` | `allow_multiple: false`, `choose_url: false`, `media_folder`/`public_folder` from the existing config |
| `image` (decorative) | `object`, `collapsed: true` | fields: `src` (image), `focalPoint` (select). **No `alt`, no `containsText`.** |
| `image` (informative) | `object`, `collapsed: false` | fields: `src` (image), `alt` (string, **required**), `focalPoint` (select), `containsText` (boolean) |
| `object` | `object` | `collapsed` from the catalogue, `fields` recursed |
| `list` | `list` | `label_singular`, `summary`, `min` **and** `max` (never one without the other), `collapsed: true`, `minimize_collapsed: false`, `allow_add`/`allow_remove`/`allow_reorder` from the catalogue |
| top-level `sections` | `list` with `types` | `typeKey: type` (**never overridden** — `EditorPreviewPane.js:180` hardcodes `t.get('name') === val.get('type')`), one `types` entry per section type, `min: 1`, `max: 24`, `allow_reorder: true` |

**Emission rules the generator applies to every field, because getting them wrong is invisible:**
- `summary` is **mandatory** on every type and every list. Without it a collapsed row shows only the type label — six identical "Feature list" rows — and it is the only accessible name a collapsed row has.
- `label_singular` on every list; it is the accessible name of the "Add X" button.
- The identifying field is emitted **first** in every type (title/label), then `variant`, then content fields, then `layout` (collapsed), then `id` last. Tab order matches reading order; `id` is plumbing, not content.
- `required: false` is emitted **explicitly** on every optional field. Decap defaults `required` to `true`; omitting it produces unexplained save blocks.
- `min` is **never** emitted without `max`. Verified in `decap-cms-lib-widgets/src/validations.ts`: `value?.size` is falsy at 0, so a `min`-only guard never fires on an empty list.
- `hint` on every non-obvious field, written as *why*, not *what*.
- **No `i18n:` block anywhere.** Decap forces file collections to `single_file` i18n (`actions/config.ts:149`), which would interleave 15 languages into one file and destroy the per-key Transifex design. Editors author English only.
- **No custom widget.** A thumbnail template-picker would be our React inside Decap's unversioned internals, inheriting an accessibility burden we would have to audit ourselves, with thumbnails that go stale on the next restyle. The live preview renders the *real* component for the chosen variant — strictly more accurate, and free.

---

# 3. Schema v2 JSON

## 3.1 Worked document

`CMS/content/home.en.json`, abridged to two of six audiences. The `media` and `feature-list` sections use `layout.span: "half"` and therefore pack side by side at `l`, reproducing the live page's S5 with no nesting.

```jsonc
{
  "schemaVersion": 2,
  "catalogueVersion": 1,

  "page": {
    "title": "ORCID is for…",
    "titleStyle": "banner",
    "documentTitle": "ORCID",
    "description": "ORCID provides a persistent digital identifier that distinguishes you from every other researcher."
  },

  "sections": [
    {
      "id": "who-we-serve",
      "type": "audience-selector",
      "variant": "tabs-photo",
      "layout": { "span": "full", "spacing": "normal", "tone": "brand-dark" },
      "audiences": [
        {
          "id": "researchers",
          "label": "Researchers",
          "intro": "ORCID is a free, unique, persistent identifier (PID) for individuals to use as they engage in research, scholarship, and innovation activities. [Learn more about ORCID for Researchers.](https://info.orcid.org/researchers)",
          "background": { "src": "images/kaya_background.png", "focalPoint": "top" },
          "features": [
            {
              "id": "uniquely-yours",
              "icon": { "src": "images/account_circle.png", "focalPoint": "center" },
              "title": "Uniquely Yours",
              "body": "Distinguish yourself and claim credit for your work no matter how many people have your same (or similar) name.",
              "link": { "label": "Register for an ORCID iD", "href": "https://orcid.org/register" }
            },
            {
              "id": "portable-profile-data",
              "icon": { "src": "images/laptop_windows.png", "focalPoint": "center" },
              "title": "Portable profile data",
              "body": "Easily share data between your record and funding, publications, data repositories, and other research workflows."
            }
          ]
        },
        {
          "id": "universities-research-institutes",
          "label": "Universities & Research Institutes",
          "intro": "ORCID allows universities and research institutions to stay up to date with their researchers’ outputs, reduce administrative burden and input errors. [Learn more.](https://info.orcid.org/orcid-for-universities-and-research-institutions/)",
          "background": { "src": "images/kaya_background.png", "focalPoint": "top" },
          "features": [
            {
              "id": "support-research-productivity",
              "icon": { "src": "images/biotech.png", "focalPoint": "center" },
              "title": "Support research productivity",
              "body": "Let your researchers spend more time on their research by reducing administrative burden."
            },
            {
              "id": "track-careers",
              "icon": { "src": "images/school.png", "focalPoint": "center" },
              "title": "Track careers",
              "body": "Track researchers’ and graduates’ careers after they leave your institution."
            }
          ]
        }
      ]
    },

    {
      "id": "featured-news",
      "type": "media",
      "variant": "media-below",
      "layout": { "span": "half", "spacing": "normal", "tone": "surface" },
      "kicker": "Featured news",
      "title": "Researchers: Learn What Your ORCID Record Can Do For You",
      "body": "Managing your research across different systems, institutions, and stages of your career can be exhausting. ORCID is here for you—across your career, disciplines, and borders. [Read more about what your record can do.](https://info.orcid.org/researchers/)",
      "mediaKind": "video",
      "media": {
        "provider": "vimeo",
        "videoId": "1198760040",
        "title": "What Your ORCID Record Can Do For You",
        "aspectRatio": "16:9",
        "durationSeconds": 154,
        "poster": {
          "src": "images/what-your-record-can-do-poster.png",
          "focalPoint": "center",
          "alt": "A researcher at a laptop reviewing their ORCID record",
          "containsText": false
        },
        "captions": {
          "available": true,
          "locales": ["en", "es", "fr"],
          "autoGenerated": false
        },
        "audioDescription": {
          "status": "not-needed",
          "justification": "All on-screen text and interface shown in the video is spoken aloud by the narrator as it appears; the only other visuals are stock footage of people at desks. Reviewed by A. Editor, 2026-09."
        },
        "transcript": "**Narrator:** Managing your research across different systems, institutions and stages of your career can be exhausting.\n\nORCID gives you one identifier that follows you across institutions, funders and publishers.\n\nSign in once, connect the systems you trust, and let them keep your record up to date — so you spend less time re-entering the same information and more time on your research."
      },
      "actions": [
        { "id": "watch-on-youtube", "label": "Watch this video on YouTube", "href": "https://www.youtube.com/watch?v=1rZvFGLe7bg", "style": "secondary" }
      ]
    },

    {
      "id": "integrate",
      "type": "feature-list",
      "variant": "panel",
      "layout": { "span": "half", "spacing": "normal", "tone": "surface" },
      "title": "Integrate with ORCID for a Stronger, more Robust Research Ecosystem",
      "columns": 3,
      "items": [
        {
          "id": "hub",
          "title": "One hub for research activity",
          "body": "From employment affiliations, research outputs, funding, peer review activity and research resources, ORCID connects people with their research activities. [Discover ORCID’s workflows and integrations](https://info.orcid.org/documentation/)."
        },
        {
          "id": "certified-service-providers",
          "title": "Certified service providers",
          "body": "Find ORCID-enabled scholarly service providers, including manuscript submission, repository and research information systems. [View our full list of certified CSPs](https://info.orcid.org/vendors-and-service-providers/orcid-certified-service-providers-list/)."
        },
        {
          "id": "getting-started",
          "title": "Getting started",
          "body": "Getting started with ORCID is easier than it might seem. [Read our ORCID for Researchers page](https://info.orcid.org/researchers/) and [register for an ORCID record today](https://orcid.org/signin)."
        }
      ]
    },

    {
      "id": "quick-links",
      "type": "quick-links",
      "variant": "bar",
      "layout": { "span": "full", "spacing": "loose", "tone": "brand-tint" },
      "title": "Get started with ORCID",
      "titleHidden": true,
      "links": [
        { "id": "get-id",       "label": "Get my ORCID iD and record", "href": "https://orcid.org/signin",                                    "icon": { "src": "images/id_icon.png", "focalPoint": "center" } },
        { "id": "troubleshoot", "label": "Troubleshoot my record",     "href": "https://support.orcid.org/hc/en-us",                          "icon": { "src": "images/troubleshoot.png", "focalPoint": "center" } },
        { "id": "membership",   "label": "Become a member",            "href": "https://info.orcid.org/membership/",                          "icon": { "src": "images/members.png", "focalPoint": "center" } },
        { "id": "integrate",    "label": "Integrate ORCID",            "href": "https://info.orcid.org/documentation/",                       "icon": { "src": "images/integrate.png", "focalPoint": "center" } },
        { "id": "about",        "label": "About ORCID",                "href": "https://info.orcid.org/what-is-orcid/",                       "icon": { "src": "images/about.png", "focalPoint": "center" } },
        { "id": "news",         "label": "News and events",            "href": "https://info.orcid.org/news-events/",                         "icon": { "src": "images/news.png", "focalPoint": "center" } }
      ]
    },

    {
      "id": "latest-news",
      "type": "news-feed",
      "variant": "grid",
      "layout": { "span": "full", "spacing": "normal", "tone": "default" },
      "title": "Latest news",
      "source": "orcid-blog",
      "maxItems": 3
    }
  ],

  "meta": {
    "locale": "en",
    "version": "v0.2.0",
    "commit": "a1b2c3d",
    "generatedAt": "2026-09-05T10:00:00.000Z",
    "translated": 44,
    "total": 44,
    "untranslated": []
  }
}
```

`meta` is build-generated and never authored. `meta.untranslated` is the list of keys that fell back to English (§8.7).

## 3.2 JSON Schema approach

**Discriminated `oneOf`, fully inlined, generated.**

```jsonc
"sections": {
  "type": "array", "minItems": 1, "maxItems": 24,
  "items": {
    "type": "object",
    "discriminator": { "propertyName": "type" },
    "required": ["type"],
    "oneOf": [
      { "type": "object", "additionalProperties": false,
        "required": ["id", "type", "variant", "layout", "audiences"],
        "properties": {
          "type":    { "const": "audience-selector" },
          "variant": { "enum": ["tabs-photo", "tabs-flat", "stacked"] },
          "id":      { "$ref": "#/$defs/id" },
          "layout":  { "$ref": "#/$defs/layout" },
          "title":   { "type": "string", "minLength": 1, "maxLength": 120 },
          "audiences": {
            "type": "array", "minItems": 1, "maxItems": 8,
            "items": { /* the `audience` item type, inlined in full */ }
          }
        } },
      /* one fully-inlined branch per section type */
    ]
  }
}
```

Five decisions inside that, each forced by a verified mechanic:

1. **ajv is constructed as `new Ajv({ allErrors: true, strict: false, discriminator: true })`.** Without the discriminator, one bad field in one section produces an error list from all seven branches and is unreadable; with it, ajv reports errors only against the branch whose `type` matched.
2. **Branches are fully inlined, not `$ref`s.** ajv's discriminator does not resolve `$ref` at the top of a `oneOf` branch. Inlining sidesteps it entirely and makes a catalogue change legible in the schema diff — which is the point of committing a generated artefact.
3. **`additionalProperties: false` everywhere.** This is what makes the catalogue authoritative: a field not in the catalogue cannot appear in the document. It also cannot compose through `allOf`, which is the second reason the eight common fields are inlined into every branch rather than layered — and the third reason the schema must be generated.
4. **`variant` is a per-branch `enum`.** "The variant belongs to this type's set" becomes a schema fact, not a code check. That is requirement 4 made structural.
5. **`$defs` holds only the leaf primitives** whose `$ref`s do not sit under a discriminator: `id`, `plainText`, `richText`, `altText`, `href`, `imagePath`, `decorativeImage`, `informativeImage`, `layout`, `link`, `action`, `video`, `captions`, `audioDescription`, `meta`, `page`.

**Two distinct image `$defs` is load-bearing.** A decorative slot generates `decorativeImage`, which has **no `alt` property at all** and `additionalProperties: false` — so an editor can neither supply one nor forget one. An informative slot generates `informativeImage`, which requires it. The decision belongs to the slot, declared in the catalogue, never to the editor's memory.

**Length caps come from the catalogue per field**, replacing the blanket `plainText: 300` / `richText: 2000`. Translations get **1.6× headroom**: `validate.mjs` warns at 1.0× and errors at 1.6×, fixing the current behaviour where a legitimately longer German or Russian translation fails the build.

**`id` pattern is `^[a-z][a-z0-9-]{0,59}$`** — must start with a letter, so an all-digit id can never make `JSON.stringify` reorder the extracted Transifex file or make a consumer infer array-ness; no `.` (would split a translation key); `__order` and `__replace` reserved.

---

# 4. Angular architecture

## 4.1 The tree

```
HomeComponent                          route; owns the fetch and the mode branch
└─ HomepagePageComponent               app-homepage-page  ← THE ONLY page composition
   ├─ <app-heading [level]="1">        page.title, the one h1, in the banner band
   └─ HomepageSectionsComponent        app-homepage-sections  ← packs half-spans into rows
      └─ HomepageSectionComponent      app-homepage-section   ← @switch on section.type
         ├─ AudienceSelectorSectionComponent
         ├─ MediaSectionComponent
         ├─ FeatureListSectionComponent
         ├─ QuickLinksSectionComponent
         ├─ ProseSectionComponent
         ├─ CtaBandSectionComponent
         └─ NewsFeedSectionComponent

HomepagePreviewComponent → <app-homepage-page [content]="draft"> and nothing else
```

`HomepagePreviewComponent`'s template is exactly one element. That deletes the duplicated section list (verified: `home.component.html:4-13` and `homepage-preview.component.html:3-12` are two hand-maintained copies, in a component whose own doc comment says its purpose is "exactly one renderer"), and it makes the CMS preview **structurally identical to the live page**, `<h1>` and news section included — the precondition for the preview being an accessibility preview at all.

## 4.2 Section chrome, implemented once

`SectionShellComponent` (`app-section-shell`, `<ng-content>`):

```html
<section *ngIf="title; else unnamed"
         [id]="'section-' + section.id"
         [attr.aria-labelledby]="headingId"
         [class]="chromeClasses">
  <div class="container"><ng-content></ng-content></div>
</section>
<ng-template #unnamed>
  <div [id]="'section-' + section.id" [class]="chromeClasses">
    <div class="container"><ng-content></ng-content></div>
  </div>
</ng-template>
```

`chromeClasses = "section section--<type> section--<variant> tone--<tone> spacing--<spacing>"`. Every section type wraps its body in this, so the landmark rule, the tone pair, the spacing scale, the anchor id and the container are implemented exactly once and cannot be got wrong in the eighth section type someone adds in 2028.

## 4.3 The switch

```html
<!-- homepage-section.component.html -->
@switch (section.type) {
  @case ('audience-selector') { <app-audience-selector-section [section]="section" [level]="level" /> }
  @case ('media')             { <app-media-section             [section]="section" [level]="level" /> }
  @case ('feature-list')      { <app-feature-list-section      [section]="section" [level]="level" /> }
  @case ('quick-links')       { <app-quick-links-section       [section]="section" [level]="level" /> }
  @case ('prose')             { <app-prose-section             [section]="section" [level]="level" /> }
  @case ('cta-band')          { <app-cta-band-section          [section]="section" [level]="level" /> }
  @case ('news-feed')         { <app-news-feed-section         [section]="section" [level]="level" /> }
}
```

**`@switch`, not `*ngSwitch`, and this is the one deliberate departure from the `*ngIf`/`*ngFor` house style inside `src/app/home`.** Angular's `@switch` narrows a discriminated union in the template, so under `strictTemplates: true` each child receives its exact type and a field that does not exist on that type is a compile error. `*ngSwitchCase` does not narrow and would force `$any(section)` at the boundary — a typing hole at precisely the point where a wrong section shape reaches a component. `@if`/`@for` are already in use elsewhere in the app (63 occurrences), so this is within the codebase's grain. Everything *inside* a section component uses `*ngIf`/`*ngFor` to match its neighbours.

There is no `@default`: an unknown type never reaches this component because it is dropped during parsing (§4.6). Exhaustiveness is additionally checked by an `assertNever` in the parser, so adding a catalogue type without adding a component is a **compile error**, not a blank space on the homepage.

Rejected: `ngComponentOutlet` + a `Type<>` registry. The app has zero dynamic-component machinery, it defeats `strictTemplates` input checking, and it moves "which component renders this type" from compile time to runtime. If the catalogue ever exceeds ~12 types, revisit with `@defer (on viewport)` per section, not with `ngComponentOutlet`.

## 4.4 Heading levels — the rule and the proof

**The rule**, one pure function, used everywhere:

```ts
// NG/src/app/home/heading-level.ts
export type HeadingLevel = 1 | 2 | 3 | 4 | 5 | 6
export const SECTION_HEADING_LEVEL: HeadingLevel = 2
export function nextLevel(level: HeadingLevel, parentHasTitle: boolean): HeadingLevel {
  return parentHasTitle ? (Math.min(6, level + 1) as HeadingLevel) : level
}
```

```
h1                          = page.title            (always present, always first, exactly one)
section title (if present)  = 2
item title in a section     = section.title ? 3 : 2
sub-item title              = itemTitleLevel + 1
```

Because the increment applies **only when the parent has a title**, an untitled ancestor contributes no level and therefore no gap. This is stronger than "a section with sub-headings must have a title", because it asks nothing of the editor: an untitled section simply promotes its children rather than orphaning them.

Applied to the worked document: `h1 "ORCID is for…"` → the audience selector has no title, so audience labels are `h2 "Researchers"` → their features are `h3 "Uniquely Yours"` → then `h2 "Researchers: Learn What Your ORCID Record Can Do For You"` → `h2 "Integrate with ORCID…"` with `h3` items → `h2 "Get started with ORCID"` (visually hidden) → `h2 "Latest news"` with `h3` articles.

**Why it cannot be broken.**

1. **Level is never authorable.** The meta-schema forbids the field names (§2.3, rule 7); `additionalProperties: false` means such a field cannot appear in a document; the schema is generated so it cannot be reintroduced by hand.
2. **One heading primitive.**

```ts
// NG/src/app/home/components/heading/heading.component.ts
@Component({
  selector: 'app-heading',
  standalone: false,
  template: `
    @switch (clamped) {
      @case (1) { <h1 [id]="id" [class]="visualClass" [class.cdk-visually-hidden]="hidden" [attr.lang]="lang" [attr.dir]="dir"><ng-content/></h1> }
      @case (2) { <h2 [id]="id" [class]="visualClass" [class.cdk-visually-hidden]="hidden" [attr.lang]="lang" [attr.dir]="dir"><ng-content/></h2> }
      @case (3) { <h3 ...><ng-content/></h3> }
      @case (4) { <h4 ...><ng-content/></h4> }
      @case (5) { <h5 ...><ng-content/></h5> }
      @default  { <h6 ...><ng-content/></h6> }
    }`,
})
export class HeadingComponent {
  @Input({ required: true }) level!: HeadingLevel
  @Input() id?: string
  /** Visual size is independent of semantic level. */
  @Input() visualClass = 'orc-font-heading'
  @Input() hidden = false
  /** Set when this string fell back to English inside a non-English page. */
  @Input() lang?: string
  @Input() dir?: string
  get clamped(): HeadingLevel { return Math.min(6, Math.max(1, this.level)) as HeadingLevel }
}
```

`SectionShellComponent` clamps to a floor of 2 before passing down, so a section can never emit `h1`. Raw `<h1>`–`<h6>` are **forbidden** in `src/app/home/**` except in `heading.component.ts`; a CI grep enforces it.

3. **`h1` is structurally unique.** `page.title` is a required top-level field, not a section type — it cannot be deleted, duplicated or moved. Rejected: a `page-title` section type, which would need `required` + `maxPerPage: 1` + `mustBeFirst` — three cross-item cardinality rules that neither JSON Schema nor Decap can express — to reproduce what one required field gives free.
4. **Ids are derived from content ids, never from translated text**: `section-<sectionId>-title`, `section-<sectionId>-<itemId>-title`. `aria-labelledby` therefore survives translation and reordering.
5. **It is proven.** `heading-order.property.spec.ts` generates 200 random valid documents (random types, variants, item counts, titled/untitled at every level), renders each through `HomepagePageComponent` at 375, 800 and 1280, extracts the outline from the DOM, and asserts: exactly one `h1`; the first section heading is `h2`; no level skipped; no empty heading; no heading outside a renderer-produced container; **and the outline is identical at all three widths** — which is what pins the hidden-`h3`-inside-tabpanel design of §5.5 and makes the tier switch invisible to assistive technology.

## 4.5 Variants

> **If two variants differ only in visual arrangement, they share one template and differ by a host class. If they differ in DOM structure or semantics, they are separate `ng-template` branches inside the same component. A variant is never a separate component.**

```ts
@Component({ selector: 'app-feature-list-section', standalone: false, /* … */ })
export class FeatureListSectionComponent {
  @Input({ required: true }) section!: FeatureListSection
  @Input({ required: true }) level!: HeadingLevel
  get itemLevel(): HeadingLevel { return nextLevel(this.level, !!this.section.title) }
}
```

- `feature-list`: all four variants are one template plus CSS — same DOM, same headings, same links.
- `audience-selector`: two structural branches (`tabs` and `accordion`, chosen responsively) plus one content branch (`stacked`) — three `ng-template`s in one component. **Never both rendered with one CSS-hidden**: that produces duplicate ids, duplicated content for screen readers and doubled `aria-controls`.
- `media`: `media-end`/`media-below`/`media-only` are host classes; `media-only` additionally `*ngIf`s away the prose column.
- `quick-links`: `bar` vs `grid`/`list` differ only in whether the title renders visibly — one `@if` in one template.

Keeping variants inside the component is what prevents a variant from drifting out of the accessibility contract: one place for tab/accordion semantics, one spec file, one axe run.

## 4.6 Parsing — per-section, fail-soft, typed

```ts
// NG/src/app/types/homepage-content.ts
export const SUPPORTED_SCHEMA_MAJORS = [1, 2] as const

export interface ParsedHomepageContent {
  page: HomepagePage
  sections: HomepageSection[]
  meta?: HomepageContentMeta
  /** Sections the document contained that this build cannot render. */
  dropped: Array<{ id: string; type: string; reason: string }>
  /** Variants that fell back to the type's first variant. */
  coerced: Array<{ id: string; requested: string; used: string }>
}

export function parseHomepageContent(value: unknown): ParsedHomepageContent | null
```

- Unsupported `schemaVersion` major ⇒ `null` (caller falls back to the static page).
- `schemaVersion === 1` ⇒ `adaptV1(value)` first (§9.1), then parse as v2.
- Each section validated **independently** by a per-type guard generated alongside the types. Invalid or unknown ⇒ pushed to `dropped`, skipped; the rest render. This replaces the current whole-document guard, under which one empty `kicker` anywhere discards the entire page.
- Unknown `variant` ⇒ the type's first variant, recorded in `coerced`.
- Zero surviving sections ⇒ `null`, so a wholly foreign document still hits the static page.
- `dropped` and `coerced` are logged once and reported to the app's error channel. In the preview route they are additionally posted back to the CMS (§4.8) and rendered as a visible banner.

Guards are **generated** (`homepage-content.generated.ts` exports the types and `isXSection` per type), so the hand-written parallel implementation of the schema — which today disagrees with it in three verified places — cannot recur.

Service fixes in `homepage-content.service.ts`: `timeout(8000)`; `retry({ count: 2, delay: 500 })`; `shareReplay({ bufferSize: 1, refCount: true })` so a transient failure is not replayed for the life of the tab; the English fallback fires **only** on a network/404 error, never on a schema rejection (today the `throw` for an unsupported major flows into the same `catchError` and triggers a second, guaranteed-to-fail request); and `withAbsoluteAssets` becomes a generic value-matching walk (§2.5).

## 4.7 Module, styles, budget

- All new components are `standalone: false` and declared in `HomeModule`, matching the verified 259-to-6 house convention.
- **Every new component sets `:host { display: block }`.** Verified: `grid.scss:115` sets `.col { display: flex; flex-wrap: wrap }`, so a content component dropped on a `.col` turns its own paragraphs into row-direction flex items. This is the cause of multi-paragraph rich text and the featured-news kicker/heading/body rendering side by side at *every* breakpoint. It is latent today only because every shipped field happens to be one paragraph. `RichTextComponent` gets it too, plus `.rich-text-paragraph { display: block }`.
- Section components never receive a grid class from their parent; each owns its own `.container > .row > .col`.
- `MatTabsModule` stays (the tabs branch). `MatExpansionModule` is **not** added — the accordion is hand-rolled from `<button>`s, which is less code than configuring Material to emit a heading-wrapped trigger.
- Shared section chrome (`.section`, `tone--*`, `spacing--*`) lives in `src/app/home/sections/_section.scss` and `_tone.scss`; per-component SCSS stays well under `angular.json`'s 6 KB `anyComponentStyle` warning.
- Tree-shaking, honestly: `@switch` keeps all seven components in the `HomeModule` chunk, which is already lazy. The real size win is deleting `wordpress-styles.scss` (6,500+ lines, currently in `HomeComponent.styleUrls` and downloaded by every visitor in every mode) when the WordPress path is retired — worth far more than per-section splitting.
- `preserveWhitespaces` returns to the default on `HomeComponent`.

## 4.8 Preview contract

`HomepagePreviewComponent` extends the existing postMessage protocol with two messages the CMS consumes:

- On boot it posts `{ type: 'SUPPORTED', catalogueVersion, sectionTypes: {...variants} }` — the exact set this renderer build can render.
- After every draft render it posts `{ type: 'RENDER_REPORT', dropped, coerced, a11yErrors }`, where `a11yErrors` counts elements carrying `data-a11y-error` (§7.3).

`admin/preview.js` renders a **visible banner** above the frame when `dropped` is non-empty: *"This section type is not yet supported by the live site. It will not appear on orcid.org until the renderer is released."* — naming the section ids. This closes the gap where an editor could compose, preview and publish a section that silently never appears.

The preview route also keeps its existing origin behaviour, made explicit: `event.origin` is checked against a configured allowlist rather than only `event.source === parent`, and `/homepage-preview` is documented as deliberately exempt from the site-wide `frame-ancestors` policy.

## 4.9 File-by-file plan under `NG/src/app/home/`

```
heading-level.ts                                  new  the level rule + constants
components/heading/heading.component.ts           new  the one heading primitive
components/homepage-page/                         new  page composition, owns the h1
components/homepage-sections/                     new  half-span packing (§5.4)
components/homepage-section/                      new  the @switch
components/section-shell/                         new  landmark + tone + spacing + container
sections/_section.scss                            new  shared chrome
sections/_tone.scss                               new  the four tone pairs (only hex-exempt file)
sections/audience-selector/                       new  3 template branches + accordion
sections/media/                                   new
sections/feature-list/                            new
sections/quick-links/                             new
sections/prose/                                   new
sections/cta-band/                                new
sections/news-feed/                               new  wraps the RSS fetch
components/video-embed/                           new  facade + player + aspect frame
components/video-consent/                         new  consent-blocked state
components/disclosure/                            new  transcript disclosure
components/content-image/                         new  srcset + width/height + focalPoint
components/rich-text/                             edit :host{display:block}; <bdi>; rel only when _blank;
                                                       mailto: is internal; lang/dir on fallback nodes
pages/home/home.component.*                       edit <main tabindex="-1">; role="status" loading region;
                                                       [@.disabled] under reduced motion; retire WordPress path
pages/homepage-preview/                           edit renders <app-homepage-page> and nothing else; SUPPORTED/RENDER_REPORT
components/homepage-hero/                         DELETE
components/homepage-feature-card/                 DELETE
components/homepage-featured-news/                DELETE
components/homepage-integrate/                    DELETE
components/news/                                  edit  becomes the news-feed section's inner list; drops the
                                                       inert aria-labelledby on .container
pipes/vimeo-embed-url.ts                          replace by video/player-url.ts (multi-provider)
home.module.ts                                    edit  declare all new components
```

---

# 5. Responsive rules

## 5.1 Page-wide strategy

**CSS-first, three tiers, one documented exception.**

- Layout is expressed in SCSS against the two existing breakpoints — `$size4-up-breakpoint: 599.99px`, `$size8-up-breakpoint: 839.99px` — the same numbers `PlatformInfoService` observes. No section invents a breakpoint for layout.
- `PlatformInfoService` / `BreakpointObserver` is used **only where the DOM must differ**. Across the whole catalogue that is exactly one place: the audience selector's tabs↔accordion switch.
- **Container queries: rejected.** Zero uses in `src/` or `projects/`, no browserslist story, and every section is either full-viewport-width or exactly half at `l`, so viewport queries are sufficient and far easier to test at fixed widths.
- **Type scale:** all sizes in `rem`, no `px` font sizes in `src/app/home/**`. `orc-font-*` classes, stepping down one step at `s`. Body copy is **16px minimum** (today every feature body, featured-news body and integrate paragraph is `mat-body-1` = 14px).
- **Vertical rhythm** comes from `layout.spacing`: 24/40/64px at `l`, 16/24/40px at `s`.
- **No fixed `height` on anything containing text, ever — `min-height` only.** The live page's `.fixed-height-column { height: 190px }` overflows by up to 70px in Russian and 60px in German at 1024px, spilling the intro onto the cards below. This rule is what prevents it recurring; a CI grep enforces it.
- **No `overflow: hidden` on a text container.** Clipping lives on a wrapper around the background `<img>` only.
- **Reflow floor is 320px.** `.container` gives 8px padding and a 16px gutter, leaving 304px; every fixed-width element must fit or wrap. Tested explicitly, because 320 sits inside the `s` tier and no breakpoint marks it.
- **Measure:** `max-width: 68ch` on every prose block (`56ch` for `prose` `lead`/`centered`).
- **Images:** every content image carries build-injected `width`/`height` and `srcset`; `loading="lazy"` on everything except the first section's image, which is eager with `fetchpriority="high"`.

## 5.2 Per-section summary

| Section | `s` (<600) | `m` (600–839) | `l` (≥840) |
|---|---|---|---|
| `audience-selector` `tabs-*` | accordion; cards 1-up | accordion; cards 2-up | accordion 840–1023.98; **tabs ≥1024**; cards 2-up |
| `audience-selector` `stacked` | headed blocks, cards 1-up | cards 2-up | cards 2-up |
| `media` | prose then media, stacked | stacked | `media-end` 58/42; media ≤720px; `media-below` centred ≤800px |
| `feature-list` `cards`/`columns` | 1-up | 2-up | `columns`-up via `auto-fit` |
| `feature-list` `panel`/`checklist` | 1-up | 1-up | 1-up |
| `quick-links` `bar` | vertical list, ≥48px rows, 16px labels | wrapped 2-row | single row, `space-around`, `flex-wrap: wrap` |
| `quick-links` `grid`/`list` | 1-up | 2-up | 3-up |
| `prose` | measure only | measure only | measure only |
| `cta-band` | actions stacked full width | side by side | side by side |
| `news-feed` | 1-up | 2-up | 3-up |

## 5.3 RTL

- **Logical properties only** in `src/app/home/**` (`margin-inline-*`, `padding-inline-*`, `inset-inline-*`, `text-align: start|end`); physical `left`/`right`/`margin-left`/`padding-right` are grep-banned. Where a physical property is unavoidable, `[dir='rtl'] :host & { … }` — with `:host`, or the rule silently never matches under view encapsulation.
- `focalPoint` uses `start`/`end`, not `left`/`right`, so it flips for Arabic. `object-position` is never `transform: scaleX(-1)` on a photograph.
- Mirror under RTL: accordion chevrons, arrows, the external-link glyph. **Do not mirror:** the play triangle (media time direction is universal), the ORCID logo, the iD icon, checkmarks.
- `[dir]` is never bound by a section; the app binds it once in `app.component.html`.
- `:lang(ar) { line-height: 1.6 }` minimum, an explicit Arabic face in the stack, and no `letter-spacing` under `:lang(ar)`.
- Material's `Directionality` flips the tab keyboard model; asserted in a spec against an RTL fixture rather than trusted.

## 5.4 `layout.span` — the exact packing algorithm

Ambiguity is removed by specification, not by a hint.

```
Input:  sections[] in document order
Output: rows[] of 1 or 2 sections

i = 0
while i < sections.length:
  if sections[i].layout.span == 'half' and i+1 < length and sections[i+1].layout.span == 'half':
      emit row [sections[i], sections[i+1]];  i += 2
  else:
      emit row [sections[i]];                 i += 1
```

Greedy, left-to-right, **adjacent only**. Consequences, all deterministic:
- Three consecutive `half`s ⇒ the first two pair; the **third** renders full width.
- A `full` between two `half`s breaks the pair; both halves render full width.
- A `half` at the end of the array renders full width.

A row is `display: block` at `s`/`m` and `display: grid; grid-template-columns: 1fr 1fr; gap: 32px` at `l`. DOM order is preserved exactly, so RTL flips for free and focus order always matches visual order.

**`validate.mjs` errors — not warns — on any `half` that the algorithm above would render full width.** The document cannot express an ambiguous intent; the error message names the section id and says which of the three cases applied. `validate.mjs` prints the resulting row plan in the CI summary so a reviewer sees the layout on every content PR.

## 5.5 The definitive mobile decision for the audience selector

**Below 1024px the audience selector is not a tabs widget. It is a single-select accordion following the APG accordion pattern. At ≥1024px it is an APG tab strip.**

The reasoning, in the order that decides it:

1. **The current implementation is the worst of the three options.** `mat-stretch-tabs="false"` plus `[disablePagination]="false"` produces a horizontally scrolling strip with chevron pagination at 375px; tabs 3–6 are reachable by pointer *only* through ~32px unlabelled chevrons. The live page does not do this.
2. **The live page's vertical tablist is better but still wrong**, and copying it is not an option: `role="tab"` on `<li>` rather than `<button>`; every tab shares an `id` with the panel it controls, so `aria-controls` is self-referential; the tablist has no accessible name and no `aria-orientation` despite rendering vertically; only ArrowLeft/ArrowRight are handled, so the arrow keys matching the visual axis do nothing; and the roving tabindex is **inverted** (`state.isActive ? -1 : 0`), making the selected tab the one tab a keyboard user can never reach.
3. **Tabs presuppose adjacency, and stacking destroys it.** With six full-width rows, the panel for audience 1 is five controls and several screens from its trigger in both visual and DOM order.
4. **The decisive argument: headings.** Each accordion header is a `<button>` inside a real heading element, so the six audiences appear in a screen reader's heading list and rotor and a user can jump straight to "Funders & Facilities". With `role="tab"` the labels are not headings and that navigation does not exist. On a small screen, where the page is never visible at once, heading navigation is the primary way to move.
5. **It removes machinery.** No roving tabindex, no automatic-activation semantics, no `aria-orientation` to keep in sync with the rendered axis, no focus-into-panel rule. Fewer moving parts, fewer regressions.

**The flip point is `1023.98px`**, one exported constant `AUDIENCE_TABS_MIN_WIDTH` shared by the SCSS (via a CSS custom property) and the `BreakpointObserver` query, documented in the component as *"six wrapping labels need ~1000px in the longest supported locale"*. It is **not** a fourth grid tier — the grid tiers still govern columns — and it matches the live page's own 1024 flip, so a side-by-side comparison at any width is honest. The accordion is the safe side: if the number is wrong, the failure mode is "a wide screen shows an accordion", not "a narrow screen shows a broken tab strip".

**First paint is resolved, not left to the implementer.** `AudienceSelectorSectionComponent` subscribes to `BreakpointObserver.observe('(min-width: 1024px)')` **in its constructor**. CDK's `BreakpointObserver` emits the current match state synchronously on subscribe, so the first change-detection pass already has the correct mode and there is no visible flip on load and no wrong-mode LCP. The spec `audience-selector.first-paint.spec.ts` asserts exactly this: with `matchMedia` stubbed to `matches: true`, the very first `detectChanges()` produces `role="tablist"` and zero accordion buttons; with `matches: false`, the inverse. Nothing SSR-dependent is assumed, because there is no SSR.

**Both modes:** labels **wrap** (`white-space: normal` overriding `.mdc-tab__text-label`), pagination is disabled entirely, and if labels still do not fit at `l` the result is a taller tab strip, never a scrolling one. `selectedAudienceId` survives the switch; focus moves to the equivalent control.

## 5.6 Motion, contrast, forced colors, print

```scss
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: .01ms !important; animation-iteration-count: 1 !important;
    transition-duration: .01ms !important; scroll-behavior: auto !important;
  }
}
```
Angular animations are **not** covered by that rule: `<main @enterAnimation>` gets `[@.disabled]="reducedMotion"` from a `matchMedia('(prefers-reduced-motion: reduce)')` signal, and every section component that uses an Angular animation does the same.

`prefers-contrast: more`: scrim alpha rises to 0.92; borders 1px → 2px; the selected indicator 3px → 4px; a purely atmospheric background photo is hidden.

`forced-colors: active`: selected tab / open accordion header get `border-bottom: 3px solid Highlight`; cards, the video frame and the consent placeholder get `1px solid CanvasText`; `:focus-visible { outline-color: Highlight }`; Material's ink bar is overridden explicitly (it is a coloured element and collapses). **Every SVG icon uses `fill="currentColor"`/`stroke="currentColor"`**, never a hardcoded hex. `forced-color-adjust: none` only on the ORCID logo and the iD icon.

Focus, one global rule, no exceptions in homepage scope:
```scss
:where(a, button, [tabindex], iframe, summary, [role='tab']):focus-visible {
  outline: 3px solid var(--orcid-focus-ring, #003449);
  outline-offset: 2px; border-radius: inherit;
}
.tone--brand-dark, .video-consent { --orcid-focus-ring: #ffffff; }
```
`outline: none` is grep-banned. The ring is **never** `#A6CE39` (brand green on white is 1.82:1). Every focusable element and every heading with an `id` gets `scroll-margin-top: calc(var(--orcid-header-height) + 8px)` so a focused element is never hidden behind the sticky header (SC 2.4.11).

**Print** (new; none of the current components define one): `@media print` renders `audience-selector` in its `stacked` form regardless of variant, expands every accordion and disclosure, replaces the video facade with the poster plus the transcript, drops `tone--brand-dark` to black-on-white, and prints link hrefs after external link text.

## 5.7 Crawlability — decided (W-SEO)

The page being replaced is server-rendered; a client-fetched bundle means every word of marketing copy is absent from the initial HTML. This is a competence regression against requirement 1, so it is **in scope, specified, and gated**.

**The decision: `orcid-web` inlines the published bundle into the shell it already serves.** Concretely, three changes in WEB, all in the existing homepage FreeMarker template:

1. **Head metadata**, server-rendered from the bundle for the requested locale: `<title>{page.documentTitle} — {page.title}</title>`, `<meta name="description">`, `og:title` / `og:description` / `og:image` (the first section's image), `<link rel="canonical">`, and `<html lang dir>`.
2. **A JSON island**: `<script type="application/json" id="orcid-homepage-content">…</script>` containing the whole bundle for that locale. WEB fetches `home.<locale>.json` server-side with the same cache it already uses for static assets, with a 2s timeout and a stale-while-revalidate cache; on failure the island is omitted and the app falls back to its CDN fetch exactly as today. `HomepageContentService` reads the island **first** (synchronously, zero round trips) and only fetches when it is absent. This removes the fetch waterfall in front of LCP and puts every content string in the initial HTML byte stream, which is what most crawlers and text-extracting agents actually read.
3. **A `<noscript>` semantic mirror**: `page.title` as an `<h1>` and every section's title and prose rendered as plain `<h2>`/`<h3>`/`<p>`/`<a>`, generated by a small FreeMarker macro driven by the same section list. It is text-only — no images, no video, no interaction — and it is replaced by the Angular app on boot.

Rejected: Angular prerendering/SSG for the `/` route. The bundle is published independently of the app on a different cadence, so a prerendered route would bake stale marketing copy — the exact failure the two-repo design exists to avoid.

W-SEO is a launch gate: production release is blocked until items 1 and 2 are live on QA and verified with `curl` (the copy must be present in the raw response body).

---

# 6. Video

## 6.1 What the editor supplies

The `video` item type (catalogue shape in §2.2; worked instance in §3.1). Every field below is `required` in the generated schema, so **an inaccessible video cannot be published**:

| field | why it is required |
|---|---|
| `provider` + `videoId` | Narrow per-provider regex, never a URL. |
| `title` | The iframe's accessible name and the facade button's label. |
| `poster` + `poster.alt` | Shown before play and to anyone who declines cookies; it is real content, so it is an **informative** slot. |
| `captions.available` (`const true`) | SC 1.2.2, Level A. ORCID does not publish an uncaptioned homepage video; making it unrepresentable is cheaper than a policy nobody reads. |
| `captions.locales` (min 1, must include `en`) | |
| `captions.autoGenerated` must be `false` | Auto-captions fail 1.2.2 on accuracy, speaker identification and punctuation. A hard validation error. |
| `audioDescription.status` ∈ `described-track` \| `not-needed`, with a written `justification` when `not-needed` | **At AA a transcript does not substitute for audio description.** SC 1.2.3 (A) can be met by a text alternative, but SC 1.2.5 (AA) requires an actual described track whenever there is visual information the audio does not convey. The only legitimate escape is that none exists — hence typed prose a reviewer can check, not a checkbox. `justification` is `kind: 'note'`: structural, never translated, never rendered. |
| `transcript` (rich, translatable) | Required regardless of AD status. Rendered **in the page**, not linked off-site. |

Optional: `aspectRatio` (enum, default `16:9`), `durationSeconds`, `startAt`.

**Two providers, Vimeo and YouTube.** The live page's own news paragraph links to the YouTube copy of the video it embeds from Vimeo — a single-`vimeoId` model cannot represent what is on the page today. `validate.mjs` asserts every `videoProviders[*].host` and `watchUrl` host is on the `markdown-lint.mjs` allowlist, so the two lists cannot diverge.

**Transcript quality is linted, not merely required** (this is what stops "TODO" prose being pasted in to unblock a publish):

- Error if the transcript matches `/\b(TODO|TBD|FIXME|lorem ipsum|placeholder|coming soon)\b/i`.
- Error if it is byte-identical to, or a substring of, the section `body` or the video `title`.
- Error if `durationSeconds` is present and `words < durationSeconds * 0.3` (a spoken video is roughly 2–3 words per second; 0.3 catches an order-of-magnitude stub).
- Warning if `durationSeconds` is present and `words < durationSeconds * 0.8`.
- Error if it contains fewer than two paragraph breaks **and** exceeds 600 characters (an unbroken wall is not a usable transcript).

**The operational escape, first-class and documented.** `mediaKind: "image"` — poster plus an `actions` link to the video on its host — is a **valid, complete state**, not a workaround. If a transcript does not exist on migration day, the section ships as `mediaKind: image` with the existing "watch on YouTube" link in the body, and the video returns in a later content-only PR. No information is lost and nothing about requirement 3 is regressed: the video *is* editable, it simply is not published without its transcript. **Named owner: the Communications lead who owns the homepage content; the transcript is a tracked, dated deliverable in the migration PR checklist (§10, W-CONTENT).**

## 6.2 Rendering

URL assembly keeps the shape of the current `vimeoEmbedUrl` — verified as the only place the homepage bypasses Angular's sanitiser, and safe solely because the id is regex-narrowed and the URL is a constant:

```ts
// NG/src/app/home/components/video-embed/player-url.ts
const PROVIDERS = {
  vimeo: {
    pattern: /^\d{1,20}$/,
    url: (id: string, t?: number) =>
      `https://player.vimeo.com/video/${id}?dnt=1&title=0&autoplay=1${t ? `#t=${t}s` : ''}`,
    watch: (id: string) => `https://vimeo.com/${id}`,
  },
  youtube: {
    pattern: /^[A-Za-z0-9_-]{11}$/,
    url: (id: string, t?: number) =>
      `https://www.youtube-nocookie.com/embed/${id}?rel=0&modestbranding=1&cc_load_policy=1&autoplay=1${t ? `&start=${t}` : ''}`,
    watch: (id: string) => `https://www.youtube.com/watch?v=${id}`,
  },
} as const

export function playerUrl(video: HomepageVideo, s: DomSanitizer): SafeResourceUrl | null {
  const p = PROVIDERS[video.provider as keyof typeof PROVIDERS]
  if (!p || !p.pattern.test(video.videoId)) return null   // no player, never a guessed one
  return s.bypassSecurityTrustResourceUrl(p.url(video.videoId, video.startAt))
}
```

`autoplay=1` appears **only** in a URL built at the moment of a user click. Content never supplies a URL that reaches `bypassSecurityTrustResourceUrl`.

**Aspect ratio is real, not accidental.** The live page's `wp-embed-aspect-16-9` classes match zero CSS rules; its shape survives only because `width="500" height="281"` happens to be 16:9, and below 500px it letterboxes into a 249×281 near-square. Ours:

```scss
.video-frame {
  position: relative;
  aspect-ratio: var(--video-aspect, 16 / 9);
  width: 100%; max-width: 720px;
  iframe, img, button { position: absolute; inset: 0; width: 100%; height: 100%; }
}
```
`--video-aspect` is set from the `aspectRatio` enum. No `width`/`height` attributes on the iframe, no fixed pixel height anywhere.

## 6.3 Consent, the facade, and the three states

**The iframe is never rendered until the viewer asks for it.** Two independent reasons, one design.

*Consent.* OneTrust rewrites third-party iframe `src` to `data-src` until functional cookies are accepted. Today's result is a titled, focusable, empty frame: a keyboard user tabs into nothing, a screen reader announces a frame containing nothing, a sighted user sees an empty box — a 1.1.1 and 4.1.2 failure produced by a third party mutating our DOM.

*Performance.* The current iframe loads `player.vimeo.com` on first paint. A facade removes a third-party connection from the critical path.

```html
<figure class="video">
  <div class="video-frame" [style.--video-aspect]="aspect">

    <!-- 1. Consent granted, not yet playing -->
    <button *ngIf="consented && !playing" type="button" class="video-play"
            (click)="play()" [attr.aria-label]="playLabel">
      <app-content-image [image]="video.poster" [informative]="true"></app-content-image>
      <svg class="play-glyph" aria-hidden="true" focusable="false" fill="currentColor">…</svg>
      <span class="video-duration" *ngIf="durationLabel">{{ durationLabel }}</span>
    </button>

    <!-- 2. Playing -->
    <iframe *ngIf="playing" #player
            [src]="playerUrl" [title]="frameTitle"
            allow="fullscreen; picture-in-picture; encrypted-media"
            referrerpolicy="strict-origin-when-cross-origin"
            allowfullscreen></iframe>

    <!-- 3. Consent withheld -->
    <app-video-consent *ngIf="!consented" [video]="video"
                       (allow)="openPreferenceCentre()"></app-video-consent>
  </div>

  <figcaption class="orc-font-body-small">{{ video.title }}</figcaption>

  <app-disclosure i18n-label="@@home.videoTranscript" label="Read the transcript">
    <app-rich-text [markdown]="video.transcript"></app-rich-text>
  </app-disclosure>
</figure>
```

- **State 1** is one `<button>` wrapping the poster. The poster is informative here and carries its real `alt`; the button's accessible name is `$localize` **`Play video: {title}`** (`@@home.playVideo`) — never the bare word "Play". The glyph is `aria-hidden`, `currentColor`, and does **not** mirror under RTL. The button is the full frame, so target size is never an issue.
- **Play** sets `playing = true`, mounts the iframe with `autoplay=1`, and moves focus to the iframe. Focus moves because the user asked for it, so SC 3.2.2 is satisfied.
- **State 2**'s `title` is `"<video title> (video)"` (`@@home.videoFrameTitle`) — the *video's* title plus a type hint, unique in the page (axe `frame-title-unique`). The current code binds the section heading, which is a different string and would collide the moment a section held two videos.
- **`allow` never contains `autoplay`** before the click, and never contains `clipboard-write` or `web-share`. Nothing plays without a gesture, which is why `prefers-reduced-motion` has no autoplay to suppress — by construction rather than by handling.
- **State 3** is real content, not an error: the poster with its real alt, a plain sentence (*"This video is hosted by Vimeo. Playing it here needs functional cookies."*, `@@home.videoConsentExplain`), a `<button>` opening the OneTrust preference centre, and an always-working *"Watch on vimeo.com (opens in a new tab)"* link. No heading, so the outline is unchanged. Border ≥3:1; its text sits over the poster under the same scrim as the hero, so ≥4.5:1.
- **State 3 is also the default** when consent never resolves (OneTrust blocked, script failed) — a broken third-party script degrades to a poster and a transcript, never to a void.
- **The transcript disclosure is present in all three states.** This is the load-bearing consequence: a viewer who declines cookies still receives the video's complete information content.
- No `tabindex` on the iframe or any ancestor; no `overflow: hidden` clipping fullscreen or the focus ring.

## 6.4 Multiple videos

Any number, anywhere: each `media` section with `mediaKind: 'video'` carries one. `frame-title-unique` holds because the title is the video's own. The one-video-per-page limit disappears with no special case.

---

# 7. Accessibility contract

## 7.1 What the system enforces vs what it asks the editor

| Guaranteed — the editor cannot break it | Asked of the editor — validated, but requires judgement |
|---|---|
| Exactly one `h1`; no skipped heading level at any depth, tier or arrangement | Alt text that actually describes the image |
| Every named section is a `region`; names unique; unnamed sections are `<div>` | Link text that makes sense out of context |
| Every interactive control is a real `<button>`/`<a>`, ≥44×44 | That captions are accurate and human-authored (`autoGenerated: true` is rejected; accuracy is not machine-checkable) |
| Focus ring on every focusable element, ≥3:1 on its surface, never obscured by the sticky header | The `audioDescription: "not-needed"` justification |
| Text/background contrast — four verified tone pairs, no free colour | A transcript that matches the video (length and placeholder heuristics only) |
| Scrim ≥0.70 over every background image, proven arithmetically in CI | Whether a background photo is *appropriate* (readability is guaranteed regardless) |
| No autoplay, ever; no iframe rendered without consent | Which variant suits the content |
| `rel`/`target`/"opens in a new tab" on external links; `mailto:` treated as internal | Section order and the resulting narrative |
| Reduced motion, forced colors, RTL, `lang="en"` on English fallback strings | |
| No fixed heights on text; reflow at 320px; SC 1.4.12 text-spacing survives | |
| Image discovery, fingerprinting, intrinsic dimensions, and a build failure on any unresolved path | |
| Translation-key coverage — an undeclared field is a build error, not a silent English leak | |

## 7.2 The scrim — the one check axe cannot do

```scss
$scrim-base:  #003449;   // --orcid-color-brand-secondary-darkest
$scrim-alpha: 0.75;      // exported to TS as HERO_SCRIM_ALPHA / HERO_SCRIM_BASE

.tone--brand-dark .panel { background-color: $scrim-base; isolation: isolate; position: relative; }
.panel-media { position: absolute; inset: 0; overflow: hidden; z-index: 0; }  /* clipping lives HERE */
.panel::before { content: ''; position: absolute; inset: 0; z-index: 1; pointer-events: none;
                 background-color: rgba(0, 52, 73, $scrim-alpha); }
.panel-content { position: relative; z-index: 2; color: #fff; }
```

axe's `color-contrast` returns **incomplete**, never **fail**, whenever text overlaps an image — so there is no automated safety net unless one is built. `hero-scrim.spec.ts` imports the two constants, composites them over `#FFFFFF`, computes the WCAG ratio against white and asserts ≥ 4.5:1. Computed values:

| alpha | worst-case ratio (pure-white photo) | verdict |
|---|---|---|
| 0.75 (specified) | **6.16:1** | pass |
| 0.70 (floor) | **5.28:1** | pass |
| 0.60 | **3.93:1** | **fail** |

A designer who lightens the scrim breaks CI with an explanatory message. The scrim is a **component style, not a content field** — an editor cannot reduce it. A scrim *layer* is used, never `opacity` on the image (unpredictable against whatever is behind) and never `filter: brightness()` (unbounded, dropped in forced-colors).

## 7.3 Alt text and image slots

The slot decides, not the editor's memory (§3.2). Renderer behaviour when content is nevertheless wrong:

- Missing/empty `alt` on an informative slot ⇒ the renderer emits `alt=""` **plus** `data-a11y-error="missing-alt"` and one `console.warn` naming the item id. It never invents alt from the filename or the title (worse than silence) and never removes the image (removing published content at runtime is a bigger failure).
- NG CI asserts `document.querySelectorAll('[data-a11y-error]').length === 0` on every fixture. The preview pane outlines such elements in red with a message and reports the count in `RENDER_REPORT`, so the editor sees it before publishing.

`validate.mjs` alt quality rules — **errors, per locale**, not English only:
- must not start with `image of`, `picture of`, `photo of`, `graphic of`, `logo of` (case-insensitive);
- must not equal the filename, contain a file extension, or be a URL;
- must not be byte-identical to the adjacent title or body in the same item;
- must not be `image`, `photo`, `decorative`, empty or whitespace;
- `containsText: true` is an **error** on any slot behind text and a **warning** elsewhere, requiring the words to be repeated in the adjacent copy (SC 1.4.5).

`alt` is `kind: 'alt'` and therefore translatable, in `TRANSLATABLE_FIELDS`-equivalent terms — an untranslated alt is a real defect for an Arabic screen-reader user, and the current pipeline would silently ship English.

## 7.4 Live regions and async state

- The loading container is `<div role="status" aria-live="polite" aria-atomic="true">` with visible text, present in the DOM **before** the fetch starts so the live region is registered. On success its text is emptied and focus is not moved.
- A fallback to the static page announces nothing — a complete page is not an error state. Technical failures are never announced to visitors; they go to the app's error channel.
- Announcements elsewhere go through `AnnouncerService.liveAnnounce`, not a hand-rolled `aria-live`.

## 7.5 Links

- Body links are **always underlined**, never underline-on-hover; colour alone never marks a link.
- `rel="noopener noreferrer"` **only** when `target="_blank"` (today it is unconditional, needlessly stripping same-site referrers).
- `target="_blank"` only for non-`orcid.org` hosts. **`mailto:` is internal** — verified bug: `new URL('mailto:support@orcid.org').host === ''`, which is neither `orcid.org` nor `*.orcid.org`, so the current code returns `isExternal === true` and opens a blank tab for a reachable content case.
- External links carry an `aria-hidden focusable="false"` `currentColor` glyph at ≥3:1 that mirrors under RTL, plus a `cdk-visually-hidden` "(opens in a new tab)" span **inside** the anchor so it is part of the accessible name.
- Link text is wrapped in `<bdi>` so a Latin-script link inside an Arabic sentence cannot reorder the surrounding text.
- Anchors are never `<div (click)>` and never `routerLink=""` + `(click)` (which the current static fallback does — it breaks middle-click, Ctrl-click and "open in new tab").

`validate.mjs` link-text lint, **per locale, over every built bundle**:
- **Errors:** text matches the per-locale stop list in `scripts/lib/link-text-stoplist.json` (`click here`, `here`, `read more`, `more`, `link`, `this`, `learn more`, `more info`, `download`, `go`, and their translations) — a missing locale entry falls back to English **plus a warning**, so adding a language cannot silently disable the check; text is a bare URL; text under 4 characters (except an ORCID iD); text over 100 characters; two links in the same section with identical text and different hrefs; a `mailto:` whose text is neither the address nor a descriptive phrase; an href failing `safeHref` (today the runtime degrades gracefully to literal text, which is right — but the editor should never be able to publish it).
- **Warnings** (shown in the preview, non-blocking): the same visible text pointing to different hrefs across sections; the same href with different text in different sections (SC 3.2.4).

## 7.6 Mixed direction and the English fallback

`build.mjs` merges translations **per key**, so a partially translated Arabic bundle contains English strings inside an RTL page **by design** — a guaranteed SC 3.1.2 failure, not a hypothetical one.

- `build.mjs` emits `meta.untranslated: string[]` (it already computes `translated`/`total`; the list costs a few hundred bytes).
- The renderer sets `lang="en" dir="ltr"` on the element rendering any key in that list — the only way a screen reader switches voice instead of reading English through an Arabic engine. `app-heading` and `app-rich-text` both accept `lang`/`dir` inputs for this.
- Independently, every element rendering CMS text carries `dir="auto"` as a backstop for strings the build cannot classify.

## 7.7 The Decap authoring UI — the honest position and the concrete mitigation

**Requirement 5 is fully achievable for the rendered page and is not fully achievable for the Decap authoring UI today.** State this to stakeholders explicitly rather than discovering it in an audit. Two upstream defects, verified in Decap source at HEAD:

1. **List reordering is pointer-only and advertises a keyboard path that does not exist.** `ListControl.js` registers `MouseSensor` and `TouchSensor` and **no `KeyboardSensor` anywhere in the repo**, while dnd-kit's default attributes give the handle `role="button"`, `tabIndex=0` and an `aria-describedby` telling screen-reader users to press space. Nothing happens. WCAG 2.1.1 — and worse than an inaccessible control, because it is a false affordance.
2. **Per-item collapse and remove buttons have no accessible name.** `ListItemTopBar.js` renders `<button>` wrapping an unlabelled SVG; the June 2026 a11y pass (PR #7720) labelled seven other components and did not touch that file. In a twelve-section list that is 24 anonymous buttons, one of which destroys a section.

**We cannot mitigate (1) with `allow_reorder: false` on `sections` — reordering sections *is* requirement 2.** So the mitigation is concrete work, not a caveat:

- **`CMS/admin/a11y-patch.js`** (new, ~80 lines, loaded by `admin/index.html` after the Decap bundle): a `MutationObserver` that (a) labels every `ListItemTopBar` collapse/remove button from its row's summary text — `Collapse "Featured news"` / `Remove "Featured news"` — and (b) removes the misleading `aria-describedby` and `role="button"`/`tabindex` from drag handles where no keyboard path exists, replacing the handle with an adjacent pair of real `<button>`s labelled *"Move section up"* / *"Move section down"* that reorder by dispatching the same store action Decap's own sort uses. This is DOM augmentation over Decap's output, no fork, and it turns a WCAG 2.1.1 failure into a working keyboard path.
- **`decap-cms-app` is pinned to an exact version** in `package.json` (no `^`), with a renovate-style upgrade PR that must re-run the a11y patch's own spec.
- **Two upstream PRs are filed and tracked**: the `KeyboardSensor` wiring (`useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })`, roughly six lines) and the `ListItemTopBar` `aria-label`s (the localisation-key pattern already exists from #7720). The patch is removed when both land.
- **`allow_reorder: false`** is still emitted for lists whose order is not editorially meaningful (`captions.locales`), so the broken affordance appears in as few places as possible.
- **Owner and date**: the a11y patch and the two upstream PRs are unit **W-CMS-A11Y** (§10) with a named owner; the editor guide records the residual gap. **An actual NVDA + VoiceOver pass on the real `admin/` build is a required acceptance step** before any promise is made about editor-side accessibility.

Also recorded: Decap validates single fields only. Every rule that matters — id uniqueness, markdown-lite conformance, host allowlist, cardinality, alt quality, video-id-per-provider, heading outline, span pairing, translation coverage — lives in `validate.mjs` and is gated in CI. `CMS.registerEventListener('preSave')` running a browser build of the validator is a worthwhile safety net for fast feedback, but its failure is a generic toast rather than a field-level error and a direct git commit bypasses it entirely. **CI is the gate.**

## 7.8 How the contract is tested

See §11 in full. The short form: axe over every component and the assembled page at nine widths and four locales; a 200-document heading property test; arithmetic contrast specs for the scrim and the four tone pairs; blocking style greps; and a manual assistive-technology checklist that is run and recorded in the PR for every content-model change and every renderer release.

---

# 8. Migration

## 8.1 Verified baseline

`content/home.en.json` contains **44 translatable keys**. There are 15 files in `i18n/` — `en` plus `ar, cs, de, es, fr, it, ja, ko, pl, pt, ru, tr, zh-CN, zh-TW` — and all 14 non-English files carry exactly 44 keys, zero missing, zero extra. The migration is therefore a total, mechanically checkable rewrite of **616 strings**.

## 8.2 Key scheme

```
page.<field>
sections.<sectionId>.<field>
sections.<sectionId>.<listField>.<itemId>.<field>
sections.<sectionId>.<listField>.<itemId>.<listField>.<itemId>.<field>
sections.<sectionId>.<objectField>.<field>
```

`type` is deliberately **not** in the key. Retyping a section without rewriting its words keeps `sections.about.title` and its 14 translations; if the words change, Transifex sees a source change on an existing key and asks for retranslation, which is the normal path. Putting the type in the key would orphan everything on every retype.

**The kind-change rule** (this closes the gap the judges found): when a section is retyped, `key-diff.mjs` compares, for every surviving key, the field `kind` under the old type and the new one. **A key whose kind changes is reported and treated as removed-and-added, and the migration/patch drops its translations.** Independently and always, `validate.mjs` lints every locale's value against the **current** kind via `i18n/home.en.keys.json` — so a `rich` string that landed in a `plain` field is a hard error, not a silent mismatch. Reuse across a kind change is therefore impossible rather than merely discouraged.

**Key-segment constraints**, enforced in the schema pattern **and** in the walker (which is what constructs the key):
`^[a-z][a-z0-9-]{0,59}$`; no `.`; never `__order` or `__replace`; section ids unique document-wide; item ids unique within their own list.

The extracted Transifex file stays array-free by construction: `unflatten` only ever creates plain objects, and "repeated prose is always id-keyed objects, never an array of strings" keeps arrays out of the source content too. Additionally, `flatten` currently drops array-valued nodes silently — if a *returned* translation file ever contains an array those strings vanish with no error; that becomes a reported problem in `localeProblems`.

## 8.3 The exact mapping

Section ids: `who-we-serve`, `featured-news`, `integrate`. Every item id preserved verbatim; the map is a pure prefix rewrite. **43 renamed + 1 moved (`hero.title` → `page.title`) = 44 accounted for, 0 removed.**

| v1 key | v2 key |
|---|---|
| `hero.title` | `page.title` |
| `audiences.<A>.label` | `sections.who-we-serve.audiences.<A>.label` |
| `audiences.<A>.intro` | `sections.who-we-serve.audiences.<A>.intro` |
| `audiences.<A>.features.<F>.title` | `sections.who-we-serve.audiences.<A>.features.<F>.title` |
| `audiences.<A>.features.<F>.body` | `sections.who-we-serve.audiences.<A>.features.<F>.body` |
| `featuredNews.kicker` | `sections.featured-news.kicker` |
| `featuredNews.title` | `sections.featured-news.title` |
| `featuredNews.body` | `sections.featured-news.body` |
| `integrate.title` | `sections.integrate.title` |
| `integrate.paragraphs.<P>.body` | `sections.integrate.items.<P>.body` |

**Preserving the old keys was considered and rejected.** Dropping the `sections.` prefix and naming sections `hero`/`featuredNews`/`integrate` would preserve 5 of 44. The other 39 cannot be preserved at any price: in v1 `audiences` **is** the top-level array (`audiences.<A>.…`); in v2 it is a field *of* a section (`sections.<S>.audiences.<A>.…`) — there is always one extra segment. Preserving 5 of 44 produces a key-diff that looks half-broken, which teaches reviewers to ignore the repo's loudest warning.

## 8.4 New keys, and the translation-readiness gate

v2 adds keys v1 has no source for: `page.documentTitle`, `page.description`, the video's `title` / `poster.alt` / `transcript`, `sections.who-we-serve.title` (if used), and the entire `quick-links` section (7 keys: title + 6 labels). These fall back to English per key; `meta.untranslated` marks them; the renderer sets `lang="en" dir="ltr"` on them.

That is correct handling, but shipping the page's primary conversion path in English to Arabic, Japanese and Chinese readers is not acceptable indefinitely, so the gap is **sized and gated**:

> **The translation-readiness gate.** `validate.mjs --gate=production` **fails** if, in any locale whose overall translation coverage is ≥ 90%, a single section has **zero** translated keys. `--gate=qa` reports the same condition as a warning.

Effect: the migration and the new sections land on QA immediately; production release waits for one Transifex round trip on the new keys. `quick-links` therefore reaches orcid.org translated, not English-only, without holding the rest of the release. The gate is passed from the deploy workflow, not remembered.

## 8.5 Pipeline changes shipped with the migration

`scripts/lib/content.mjs` — the highest-leverage file:
- Delete `KEYED_ARRAYS`; universal keyed-array rule, hard error on a malformed array.
- Delete `TRANSLATABLE_FIELDS`; translatability from catalogue `kind`; **undeclared field throws**.
- **Collapse `walkNode` and `mapNode` into one traversal**, with `walkTranslatable` implemented as `mapTranslatable` returning `undefined`. They already implement the same rules twice and already differ (`mapNode` does no id validation); `build.mjs` counts with the walk and substitutes with the map, so a divergence yields a wrong `meta.translated` alongside silently unsubstituted strings, with nothing reporting it. With per-type rules they *will* drift.
- Guard key segments in the walker.

`scripts/extract.mjs` additionally emits `i18n/home.en.keys.json` (`key → {type, variant, field, kind, maxLength, singleLine}`), **not pushed to Transifex**, consumed by `validate.mjs` to enforce per-field rules on what comes back. Today `localeProblems` checks only emptiness and markdown-lite, so a translation with a newline in a `title` or 4,000 characters in a `body` ships.

## 8.6 The merge patch

**(a) The hardcoded array names.** Verified: `admin/merge-patch.js:26` is `new Set(['audiences', 'features', 'paragraphs'])` and contains no `sections`. An array outside the set falls through `diffValue` to `return target`, so editing one word would send the **entire `sections` array** — several kB, over the verified `boot.js:26` `MAX_URL_LENGTH = 6000`, dropping every edit into the clipboard fallback and producing a PR that appears to rewrite the whole page. Fix — delete the set, keep the predicate already present:

```js
function isKeyedArray(_key, value) {
  return Array.isArray(value) && value.length > 0 &&
    value.every((i) => isPlainObject(i) && typeof i.id === 'string' && i.id !== '')
}
```

`diff` decides keyed-ness from both source and target while `apply` decides from the target alone; empty-array transitions are safe in both directions but are newly reachable, so a **seeded-PRNG property test** asserts `apply(before, diff(before, after))` deep-equals `after` over generated sections documents. The current suite covers hand-written cases only.

**(b) A retype is an explicit whole-item replacement.**

```js
// diffKeyedArray
if (before.get(id)?.type !== item.type) { patch[id] = { __replace: item }; continue }
// applyKeyedArray
if (isPlainObject(value) && '__replace' in value) { result.set(id, { ...value.__replace, id }); continue }
```

`__order` and `__replace` are exported from one constant, excluded by the schema generator, and rejected as ids by the walker. `apply-proposal.mjs`'s `guardPatch` rejects any top-level `__*` key and any `__replace` payload without a `type` — the issue body is untrusted public input. `boot.js` summarises `changed-fields` one level deeper than `sections` (`sections: featured-news, integrate`) so PR titles stay informative.

The clipboard fallback path (reached when adding a whole section exceeds 6000 characters) is documented in the editor guide as a **first-class flow**, not an apology, and is covered by the manual test plan.

## 8.7 Build changes

- **`meta.untranslated: string[]`** (§7.6).
- **Image discovery by value**, plus the fail-closed `^images/` sweep (§2.5).
- **Intrinsic dimensions**: `image-size` (pure JS, no native dependency) reads each asset and the build injects `width`/`height` into every image object. Fixes CLS and the verified 80×80-served-at-54px feature-icon layout shift.
- **`srcset`** for slots marked `responsive: true` (backgrounds, posters), generated with `sharp` at 480/960/1600w. This is the one cut item (§10.4).
- `buildAssets` currently resolves sources as `path.join(sourceDir, path.basename(reference))`, which would collapse two same-named files in different folders once there are more image fields; resolve relative to the repo root.
- `version.json` gains `catalogueVersion`; `dist/catalogue.json` and `dist/types/homepage-content.generated.ts` are new published outputs.
- `validate-deploy.mjs` gains `--supported-majors`.

## 8.8 The migration script

`scripts/migrations/002-sections.mjs` — committed, one-shot, deriving content and key map from **one** transform so they cannot disagree.

**Step 0 — the supplement.** `scripts/migrations/002.supplement.json`, authored by a human, containing exactly the values v1 has no source for: `page.documentTitle`, `page.description`, the video block (title, poster src + alt, captions, audioDescription, transcript) **or** the decision to migrate `featured-news` as `mediaKind: image`, the `feature-list` item titles, the `quick-links` section, and each audience's `background.focalPoint`. **The script refuses to run without it and never writes a placeholder.** No `"TODO"` reaches `main`; the content is either right or the PR does not open.

**Steps 1–6.**
1. Read v1 `content/home.en.json` + the supplement.
2. From a single code path, produce the v2 document **and** the `oldKey → newKey` map.
3. Write `content/home.en.json` at v2.
4. For each of the 14 locale files: `flatten` → remap → `unflatten` → write.
5. **Assert, failing the migration otherwise:** every locale still has exactly 44 keys; every mapped key ∈ `translatableKeys(v2)`; no old key unmapped; every mapped value byte-identical to before; **no string matching the `imagePath` pattern exists anywhere except at a `.src` key** (the image-shape assertion); every image slot's object shape matches the catalogue's `decorative` flag.
6. Write `scripts/migrations/002-sections.map.json` as the committed audit trail.

**`key-diff.mjs --map <file>`** so the migration PR reports **44 renamed, N added, 0 removed** rather than 44 removed + 44 added — otherwise it trips its own "removing a key discards every existing translation" warning at full volume and reviewers learn the warning is noise. `key-diff` additionally reports **retyped** sections and, for each, which keys survive and which are orphaned by a kind change (§8.2).

## 8.9 Transifex

Rewriting keys means the resource sees 43 strings deleted and 44 added; translation memory will not auto-refill unless the project has TM autofill on. The rewritten locale files must therefore be pushed **up** (`tx push -t`) in the same change as the new source, or the translations are lost on the Transifex side even though they are correct in git.

**Take the free window.** The README records that the Transifex project and resource **do not exist yet**, and both workflows self-skip on a missing `TRANSIFEX_TOKEN`. If the schema change lands before the resource is created, none of the above applies — the first `tx push -s` is simply the v2 key set. This is a real, time-limited saving and the ship order (§9) is arranged to capture it.

## 8.10 The validator, complete

Beyond the existing schema + markdown lint + id checks:

1. Catalogue meta-schema, **first**.
2. Every `type` known; every required field present; no undeclared fields.
3. `variant` present and in the type's set (also enforced by the schema).
4. Ids: unique document-wide (sections) and per-list (items); pattern; reserved words; no `.`.
5. `key-diff` reports retyped sections and kind-change orphans.
6. Heading outline: exactly one `h1`; no skipped level; region names unique; no variant renders a heading whose title field is empty.
7. **Span pairing** (§5.4): unpaired `half` is an error; the row plan is printed.
8. Alt text presence and quality (§7.3), per locale.
9. Video: per-provider id pattern with a dedicated "you pasted a URL — keep only this part" message; `captions.available === true`; `autoGenerated !== true`; `locales` includes `en`; `audioDescription.status` present; `justification` non-empty when `not-needed`; transcript present and passing the quality lint (§6.1); poster with alt; every provider host on the markdown-lint allowlist.
10. `lintPlainText` (no links, no bold, no newlines) / `lintRichText` (today's `lintMarkdownLite`, with the link regex aligned to the renderer's stricter `\[([^\]]+)\]\(([^)\s]+)\)` — closing the proven divergence where `[space url](https://orcid.org/a b)` passes lint and renders as literal brackets). `SINGLE_LINE_FIELDS` deleted.
11. Length caps and single-line rules applied to **returned translations**, driven by `home.en.keys.json`, with 1.6× headroom.
12. Link-text lint, per locale (§7.5).
13. Composition: `maxPerPage`; 1–24 sections; nav names unique; `feature-list` `panel`/`checklist` requires every item titled.
14. `validateDist` **structural identity**: strip every translatable string from each locale document and assert deep-equality with English's stripped form — general, replacing the four hand-written field checks in `build.test.mjs`. Catches any regression where a translation leaks into a structural field.
15. **Translation-readiness gate** under `--gate=production` (§8.4).
16. A **golden markdown-lite fixture** (input → expected node tree) committed in both repos and asserted by a spec on each side, so the parser and the linter can never diverge again.

---

# 9. Ship order

The hard constraint, verified: `NG/src/app/types/homepage-content.ts:120` tests `version !== HOMEPAGE_CONTENT_SCHEMA_MAJOR` with the constant `= 1` — **exact equality**. A deployed renderer pinned to 1 refuses a `schemaVersion: 2` document and falls back to the 2019 static page. Bundle and app release independently from different repos on different cadences — that is the entire point of the design — so a flag day is impossible. Two windows must never open:

- **W1**: bundle publishes v2 before the new renderer deploys ⇒ static fallback everywhere.
- **W2**: renderer deploys v2-only before the bundle flips ⇒ refuses the live v1 document ⇒ static fallback everywhere.

### Step 1 — NG: dual-major renderer, adapter in front, the whole rebuild

Change the guard to `SUPPORTED_SCHEMA_MAJORS = [1, 2]`. Add `adaptV1(doc): HomepageContentV2` (~50 lines) wrapping `hero` / `audiences` / `featuredNews` / `integrate` into `page` plus three sections with **exactly** the ids from §8.3, and **wrapping every bare image string into `{src}`**. Every component from here speaks only v2 sections.

Ship the entire mobile / responsive / accessibility rebuild in this release — it can be, because the adapter feeds the new components sections from today's live v1 bundle. This release renders the current live content **better than today**: accordion instead of a pagination strip, the scrim, focus rings, `<main tabindex="-1">`, the `role="status"` loading region, no autoplay, correct `rel`/`mailto:`, `:host{display:block}`.

Two adapter details that will bite if missed:
- The v1 video has no poster, transcript, captions or title. `adaptV1` synthesises a `video` with `captions.available: false` and no transcript, and the renderer therefore renders **the facade with the section title as the frame title, no transcript disclosure, and one `console.warn`**. It does not fabricate compliance.
- The adapter's section ids live in `NG/src/app/core/homepage-content/v1-section-ids.ts` and **the identical fixture is committed to both repos** (`CMS/scripts/__tests__/fixtures/v1-adapter-contract.json`, `NG/src/app/core/homepage-content/v1-adapter-contract.json`) with a byte-identity test on each side. Without it the CMS preview and the eventual v2 bundle render differently and nobody notices.

### Step 2 — CMS: land the whole pipeline with the document still at v1

Catalogue, meta-schema, three generators, new walker, new merge-patch, new validator, migration script, preview viewport switcher and capability banner, the Decap a11y patch, and all tests — but **do not flip `content/home.en.json`**. CI stays green; v2 is exercised entirely by unit tests and a committed v2 fixture. `dist/catalogue.json` and `dist/types/` start publishing.

### Step 3 — Prove both majors on QA

Publish a v2 bundle to a side path (`qa-v2/`), point a QA renderer build at it, run `validate-deploy.mjs --supported-majors 1,2`, and assert that the adapter's v1 output and the real v2 document produce **byte-identical DOM** for the same content (one fixture, both paths). This step exists to catch an id mismatch between the two repos.

### Step 4 — WEB: W-SEO on QA

Head metadata, JSON island, `<noscript>` mirror. Verified with `curl` against QA: the marketing copy must be present in the raw response body. This is a launch gate.

### Step 5 — CMS: run the migration

One PR: the supplement, the rewritten `content/home.en.json`, all 14 rewritten locale files, and the committed key map. `key-diff --map` shows 44 renamed, N added, 0 removed. Merge → QA rebuilds → check QA in `en`, `ar`, the pseudo-locale, at 375 and 1280.

### Step 6 — Transifex round trip for the new keys

Push source (and, if the resource already exists, translations). Wait for the new keys. `validate.mjs --gate=production` blocks the release until no ≥90%-translated locale has a fully untranslated section.

### Step 7 — Release to production

The existing tagged workflow. **No window exists**: whichever of {old v1 bundle, new v2 bundle} the CDN is serving at any instant, the deployed renderer accepts it.

### Step 8 — Editorial: everything else is a content-only PR

Adding a `cta-band`, reordering sections, swapping a variant. No release in either repo. This is the proof the model works.

### Step 9 — Retire v1, much later, under enforcement

`release-prod.yml` can redeploy any earlier tag, and every earlier tag is a v1 document, so v1 support must outlive every v1 tag that is a legitimate rollback target. Keep the adapter for **a minimum of two production releases**. Enforce it rather than remembering it: pass `--supported-majors 1,2` to `validate-deploy.mjs` from the workflow and fail the deploy if the bundle's major is outside the set.

### Make the fallback visible

A refused document today is a silent downgrade to the stale static page — no alert, no log anyone reads (the same failure family as the invisible orcid-web 500s). `homepage-content.service.ts` already throws a precise message; route it to the app's error channel, and add an NG CI step that fetches QA's `version.json` and fails if `schemaVersion` is outside the supported set or `catalogueVersion` is more than one ahead of the vendored copy (§2.6). That turns W1/W2 from an invisible weeks-long degradation into a red build in the repo that can fix it.

---

# 10. Implementation work breakdown

Ordered. Each unit is independently implementable and names the exact files it creates or changes. **⚠ SHARED** marks a unit that touches a file another unit also touches — those files have a single named owner and the units are sequenced, never parallelised across people.

### Phase A — CMS foundations (must be first)

**W-CAT — The catalogue and its meta-schema.** ⚠ SHARED (owner of `schema/`)
Creates `CMS/schema/catalogue.json`, `CMS/schema/catalogue.meta.schema.json`, `CMS/scripts/lib/catalogue.mjs`, `CMS/admin/catalogue-browser.js`, `CMS/scripts/__tests__/catalogue.test.mjs`. Wires the meta-schema as the first step of `npm run validate`. **Blocks everything else in CMS.**

**W-GEN-SCHEMA — Schema generator.** Depends: W-CAT. ⚠ SHARED (owner of `schema/home.schema.json`)
Creates `CMS/scripts/gen/schema.mjs`, `CMS/scripts/gen/lib/emit.mjs`; regenerates `CMS/schema/home.schema.json`; adds `gen` and `gen:check` to `package.json`; adds the CI drift job. Tests: branch inlining, `discriminator: true` under ajv, `additionalProperties: false` everywhere, per-branch `variant` enum, no `$ref` under a discriminator.

**W-GEN-CMS — Decap config generator.** Depends: W-CAT. ⚠ SHARED (owner of `admin/config.yml`)
Creates `CMS/scripts/gen/cms-config.mjs` implementing the §2.7 mapping table exactly; rewrites the `sections` block of `CMS/admin/config.yml` between `# BEGIN GENERATED` / `# END GENERATED`; drift-checked by `gen:check`. Tests: every emission rule in §2.7 (mandatory `summary`, `label_singular`, explicit `required: false`, `min` never without `max`, field ordering, `typeKey: type`, no `i18n:` block).

**W-GEN-TS — TypeScript generator.** Depends: W-CAT.
Creates `CMS/scripts/gen/ts-types.mjs` emitting the discriminated union, the per-type guards and `SECTION_TYPES`/`VARIANTS` constants to `dist/types/homepage-content.generated.ts`.

**W-WALK — Fail-closed walker.** Depends: W-CAT. ⚠ SHARED (owner of `scripts/lib/content.mjs`)
Rewrites `CMS/scripts/lib/content.mjs`: deletes both allowlists, single traversal, key-segment guards. Updates `CMS/scripts/__tests__/content.test.mjs`. Also makes `flatten` report array-valued nodes.

**W-IMG — Value-based image discovery.** Depends: W-CAT.
Rewrites `CMS/scripts/lib/images.mjs` (value rule, `image-size` dimensions); changes `CMS/admin/preview.js` image resolution; adds the fail-closed `^images/` sweep to `CMS/scripts/build.mjs`; fixes `buildAssets` path resolution.

**W-LINT — Prose and link lint.** Depends: W-CAT.
Splits `CMS/scripts/lib/markdown-lint.mjs` into `lintPlainText` / `lintRichText`, aligns the link regex to the renderer's, creates `CMS/scripts/lib/link-text-stoplist.json`, adds `CMS/scripts/__tests__/fixtures/markdown-lite.golden.json`.

**W-VAL — The validator.** Depends: W-CAT, W-WALK, W-IMG, W-LINT. ⚠ SHARED (owner of `scripts/validate.mjs`)
Implements all 16 checks in §8.10 in `CMS/scripts/validate.mjs`; adds `--gate=qa|production`; deletes `SINGLE_LINE_FIELDS`; enables ajv `discriminator: true`; prints the heading outline and the span row plan in the CI summary.

**W-PATCH — Merge patch.** Depends: none (independent of W-CAT). ⚠ SHARED (owner of `admin/merge-patch.js`)
Rewrites `isKeyedArray` in `CMS/admin/merge-patch.js`; adds `__replace`; exports the reserved-word constant; changes `CMS/admin/boot.js` `changed-fields` summarisation; hardens `CMS/scripts/apply-proposal.mjs` `guardPatch`. Adds `CMS/scripts/__tests__/merge-patch.property.test.mjs` (seeded PRNG round-trip).

**W-BUILD — Build outputs.** Depends: W-WALK, W-IMG. ⚠ SHARED (owner of `scripts/build.mjs`)
`meta.untranslated`; `catalogueVersion` in `version.json`; publishes `dist/catalogue.json` and `dist/types/`; `CMS/scripts/extract.mjs` emits `i18n/home.en.keys.json`; `CMS/scripts/key-diff.mjs` gains `--map` and retype/kind-change reporting; `CMS/scripts/validate-deploy.mjs` gains `--supported-majors`.

### Phase B — NG foundations (parallel with Phase A after W-GEN-TS)

**W-NG-TYPES — Types, guards, adapter.** Depends: W-GEN-TS. ⚠ SHARED (owner of `src/app/types/homepage-content.ts`)
Vendors `homepage-content.generated.ts` and `catalogue.json`; rewrites `homepage-content.ts` with `SUPPORTED_SCHEMA_MAJORS`, `parseHomepageContent`, `assertNever`; creates `v1-adapter.ts`, `v1-section-ids.ts`, `v1-adapter-contract.json`; adds `sync:catalogue` and the freshness check.

**W-NG-SERVICE — Content service.** Depends: W-NG-TYPES.
`homepage-content.service.ts`: JSON-island-first read, generic asset walk, timeout, retry, `refCount` shareReplay, schema errors routed to the error channel and not to the English fallback.

**W-NG-HEAD — Heading primitive and level rule.** Depends: none.
Creates `heading-level.ts`, `components/heading/heading.component.{ts,spec.ts}`; adds the raw-heading CI grep.

**W-NG-SHELL — Page, sections, section host, shell, tone.** Depends: W-NG-TYPES, W-NG-HEAD. ⚠ SHARED (owner of `src/app/home/sections/_section.scss` and `_tone.scss`)
Creates `components/homepage-page/`, `components/homepage-sections/` (span packing), `components/homepage-section/` (`@switch`), `components/section-shell/`, `sections/_section.scss`, `sections/_tone.scss`, `tone-contrast.spec.ts`.

**W-NG-STYLE — Global homepage a11y styles + CI greps.** Depends: none. ⚠ SHARED (owner of `src/assets/scss/`)
Global `:focus-visible`, `prefers-reduced-motion`, `prefers-contrast`, `forced-colors`, `@media print`, `scroll-margin-top`. Adds the blocking grep script `scripts/check-home-styles.sh` and wires it into CI (because `yarn lint` is a no-op).

### Phase C — NG section components (fully parallel; one owner each)

Each unit creates one directory under `src/app/home/sections/` with component, template, SCSS and spec, and adds one declaration line to `home.module.ts` (⚠ SHARED — `home.module.ts` has a single owner who batches these).

**W-SEC-AUD** `audience-selector/` — three template branches, accordion, tabs, `AUDIENCE_TABS_MIN_WIDTH`, scrim, `hero-scrim.spec.ts`, `audience-selector.first-paint.spec.ts`. *Largest unit; assign first.*
**W-SEC-MEDIA** `media/` — depends on W-VIDEO.
**W-SEC-FEAT** `feature-list/`.
**W-SEC-LINKS** `quick-links/`.
**W-SEC-PROSE** `prose/`.
**W-SEC-CTA** `cta-band/`.
**W-SEC-NEWS** `news-feed/` — wraps the existing RSS fetch; removes the inert `aria-labelledby` from `news.component.html`.

**W-VIDEO — Video embed, facade, consent, disclosure.** Depends: W-NG-TYPES.
Creates `components/video-embed/{component,player-url.ts,spec}`, `components/video-consent/`, `components/disclosure/`; deletes `pipes/vimeo-embed-url.ts`.

**W-IMAGE-CMP — Content image component.** Depends: none.
Creates `components/content-image/` (srcset, width/height, focalPoint, decorative vs informative, `data-a11y-error`).

**W-RICH — Rich text fixes.** Depends: none.
`components/rich-text/`: `:host{display:block}`, `<bdi>`, conditional `rel`, `mailto:` internal, external-link glyph + visually-hidden text, `lang`/`dir` inputs. Adds the golden markdown-lite fixture spec.

### Phase D — Integration and cleanup

**W-NG-HOME — Home and preview routes.** Depends: all of Phase C. ⚠ SHARED (owner of `pages/home/`)
`home.component.*`: `<main tabindex="-1">`, `role="status"` region, `[@.disabled]`, JSON mode renders `<app-homepage-page>`, retire the WordPress branch and `wordpress-styles.scss`, delete the static-fallback markup or (if retained) fix its two `h1`s and pseudo-links. `pages/homepage-preview/`: renders `<app-homepage-page>` only; `SUPPORTED` and `RENDER_REPORT` messages; origin allowlist.
**W-NG-DELETE** — delete `homepage-hero/`, `homepage-feature-card/`, `homepage-featured-news/`, `homepage-integrate/`.

**W-CMS-PREVIEW — Preview usability.** Depends: W-GEN-CMS.
`CMS/admin/preview.js`: viewport switcher (`role="radiogroup"`, Phone 375 / Tablet 768 / Desktop 1280, phone and tablet at **true** width with no CSS scaling, persisted in `localStorage`); capability banner from `SUPPORTED`/`RENDER_REPORT`; red outlining of `data-a11y-error`. *Highest editor value in the whole programme — today `DESKTOP_WIDTH = 1280` makes the mobile layout literally unviewable to an editor.*

**W-CMS-A11Y — Decap authoring accessibility.** Depends: W-GEN-CMS. **Named owner required.**
Creates `CMS/admin/a11y-patch.js` (§7.7) and `CMS/scripts/__tests__/a11y-patch.test.mjs`; pins `decap-cms-app` to an exact version; files the two upstream PRs; adds the residual-gap note to the editor guide; schedules the NVDA + VoiceOver pass as an acceptance step.

**W-SEO — Crawlability (WEB).** Depends: W-BUILD. **Launch gate.**
Changes the `orcid-web` homepage FreeMarker template: head metadata, the JSON island, the `<noscript>` semantic mirror; adds the server-side bundle fetch with a 2s timeout and stale-while-revalidate cache. Verified with `curl` on QA.

### Phase E — Migration and release

**W-MIGRATE — The migration.** Depends: all of Phase A. ⚠ SHARED (owner of `content/` and `i18n/`)
Creates `CMS/scripts/migrations/002-sections.mjs`, `002.supplement.json` (human-authored), `002-sections.map.json`, `CMS/scripts/__tests__/migration-002.test.mjs`.

**W-CONTENT — The editorial supplement.** Depends: nothing technical. **Named owner: Communications.**
The video transcript, poster still and its alt text, the captions attestation, the audio-description justification, the `quick-links` labels and icons, `page.description`. Dated deliverable; if the transcript is not ready, the documented decision is `mediaKind: image` (§6.1) recorded in the migration PR.

**W-TEST — Test harness.** Depends: Phases B–C.
Adds `axe-core` to NG devDependencies; creates `axe.spec.ts`, `heading-order.property.spec.ts`, `catalogue-coverage.spec.ts`; wires the nine widths and four locales; creates the manual AT checklist as `NG/src/app/home/A11Y-CHECKLIST.md` (§11.3) and adds it to the PR template.

**W-RELEASE — Ship.** Depends: everything. Executes §9 steps 3–9.

### Cut list, if time runs short — in this order, none breaking D4

1. **`srcset` generation.** Ship `width`/`height` via `image-size` (which fixes CLS, the important half); one image per slot. Drops the `sharp` dependency. *~1 day.*
2. **`news-feed` as a section type.** Keep `<app-news>` rendered by `HomepagePageComponent` after the sections at a fixed `h2`. Loses reorderability. *~0.5 day.*
3. **`prose`.** `feature-list` with one untitled item stands in. *~0.5 day.*
4. **`stacked` and `tabs-flat` variants.** Ship `tabs-photo` only; requirement 4 is still met by `media`, `feature-list` and `quick-links` variants. *~1 day.*
5. **YouTube provider.** Vimeo only, but keep the `provider` field and the provider table so adding YouTube is data, not code. *~0.5 day.*
6. **`cta-band`.** *~1 day — resist: it is the type most likely to be requested within a quarter.*

**Never cut, at any budget:** the catalogue and its meta-schema; per-section fail-soft parsing and the supported-major **set**; the heading primitive and level rule; the hero scrim and its arithmetic guard; the required video accessibility fields; the single-traversal fail-closed walker; `:host { display: block }` on every new component; the accordion below 1024; the video consent facade; W-SEO; W-CMS-A11Y. And **do not cut the generated `admin/config.yml`** — it is the artefact most likely to drift because it is the one nobody tests, and the generator is what makes requirement 4 self-maintaining.

---

# 11. Test plan

## 11.1 CMS unit tests (`node --test`, blocking)

| Spec | Asserts |
|---|---|
| `catalogue.test.mjs` | The catalogue validates against the meta-schema; every `of`/`enum` reference resolves; no forbidden field name; every list has `min` **and** `max`, a `labelSingular` and a `summary`. |
| `gen-schema.test.mjs` | Regenerated schema is byte-identical to the committed one; ajv compiles it with `discriminator: true`; no `$ref` under a discriminator; a document with an unknown `variant` fails; a document with an extra property fails. |
| `gen-cms-config.test.mjs` | Regenerated `sections` block byte-identical; every §2.7 emission rule; `typeKey` is `type`; no `i18n:` key anywhere. |
| `content.test.mjs` | Keyed-array universal rule; malformed array throws; undeclared field throws; `walkTranslatable` and `mapTranslatable` visit the identical key set over 100 generated documents; key-segment guards. |
| `images.test.mjs` | Value-based discovery over arbitrary shapes; a surviving `^images/` string fails the build; intrinsic dimensions injected; two same-named files in different folders do not collapse. |
| `markdown-lint.test.mjs` | The golden fixture produces the identical node tree as NG's parser; the previously-divergent `[space url](https://orcid.org/a b)` case now fails lint. |
| `validate.test.mjs` | All 16 checks in §8.10, each with a passing and a failing fixture; the span row plan for the three ambiguity cases; the translation-readiness gate. |
| `merge-patch.property.test.mjs` | Seeded-PRNG: `apply(before, diff(before, after))` deep-equals `after` over 500 generated sections documents, including empty-array transitions in both directions and retypes. |
| `migration-002.test.mjs` | All five step-5 assertions; the image-shape assertion; the committed map matches a fresh run. |
| `build.test.mjs` | `meta.untranslated` correctness; structural identity across locales after stripping translatable strings; `catalogueVersion` stamped. |
| `a11y-patch.test.mjs` | Against a fixture of Decap's real `ListItemTopBar` DOM: every icon button acquires an accessible name; the misleading drag `aria-describedby` is removed; the up/down buttons reorder. |

## 11.2 NG unit and a11y tests (Karma, blocking)

**Per section component** (`W-SEC-*`), each spec covers:
1. renders with valid content;
2. renders a safe fallback with minimum/malformed content;
3. the accessibility contract — landmark presence and name, heading tag and level, `alt`, `aria-*`, target size, focus behaviour;
4. **every variant**, asserted structurally;
5. the responsive branch — drive a `PlatformInfoService`/`BreakpointObserver` stub from `columns4` to `columns12` and assert the DOM actually differs.

**Cross-cutting specs:**

| Spec | Asserts |
|---|---|
| `heading-order.property.spec.ts` | 200 random valid documents × 3 widths: exactly one `h1`; first section heading is `h2`; no skipped level; no empty heading; no heading outside a renderer container; **outline identical at 375 / 800 / 1280**. |
| `hero-scrim.spec.ts` | Composite of `HERO_SCRIM_BASE` at `HERO_SCRIM_ALPHA` over `#FFFFFF` gives ≥4.5:1 against white. Currently 6.16:1. |
| `tone-contrast.spec.ts` | Reads `projects/orcid-tokens/tokens.json`, **recomputes** all four tone pairs, asserts ≥4.5:1. No hardcoded ratios. |
| `catalogue-coverage.spec.ts` | Every `sectionTypes` key in the vendored catalogue has a component in the `@switch`; every variant is handled; every `requiredA11yFields` entry is consumed; no component exists for an unknown type. |
| `v1-adapter.spec.ts` | The adapter's output matches the committed cross-repo contract fixture byte-for-byte; every v1 image string is wrapped into `{src}`; no `imagePath`-shaped string survives outside a `.src`. |
| `resilience.spec.ts` | A document with an invented `type` renders every other section; an invented `variant` renders the first variant; an unsupported major returns `null`; zero survivors returns `null`; `dropped`/`coerced` are populated and reported. |
| `audience-selector.first-paint.spec.ts` | With `matchMedia` matching, the **first** `detectChanges()` yields `role="tablist"` and zero accordion buttons; with it not matching, the inverse. No flip. |
| `span-packing.spec.ts` | The three ambiguity cases of §5.4 produce the specified rows. |
| `player-url.spec.ts` | Both provider patterns; a non-matching id returns `null`; `autoplay=1` present only in the click-built URL; no content-supplied string reaches `bypassSecurityTrustResourceUrl`. |
| `axe.spec.ts` | axe-core over each section component and the assembled page. |

**axe configuration.** Widths **320, 375, 599, 600, 839, 840, 1023, 1024, 1280**, plus 1280 at 400% zoom emulation. Locales **`en`, `ar` (RTL), `xx` (pseudo-locale, expansion), and a deliberately 50%-translated bundle**. Rules explicitly enabled and required to pass: `region`, `landmark-one-main`, `landmark-unique`, `landmark-no-duplicate-main`, `page-has-heading-one`, `heading-order`, `empty-heading`, `duplicate-id-aria`, `image-alt`, `role-img-alt`, `link-name`, `link-in-text-block`, `button-name`, `frame-title`, `frame-title-unique`, `aria-allowed-attr`, `aria-required-attr`, `aria-required-children`, `aria-required-parent`, `aria-valid-attr-value`, `aria-hidden-focus`, `nested-interactive`, `scrollable-region-focusable`, `color-contrast`, `html-has-lang`, `valid-lang`, `meta-viewport`, `list`, `listitem`, `bypass`, and **`target-size`** (off by default in axe — enable it explicitly).

## 11.3 Blocking CI greps (`scripts/check-home-styles.sh`)

Over `NG/src/app/home/**`, because `yarn lint` is verified to be a no-op:

- no `outline: none`
- no `order:` property
- no `flex-direction: row-reverse` / `column-reverse`
- no physical `left:`/`right:`/`margin-left`/`margin-right`/`padding-left`/`padding-right` (use logical properties)
- no fixed `height:` on a selector that also sets a text property (heuristic: any rule containing both `height:` with a length and `font-`/`line-height`/`color`)
- no `overflow: hidden` on a `.…-content`/`.…-text`/`.prose` selector
- no raw `<h1>`–`<h6>` outside `components/heading/heading.component.ts` and the page component's `<h1>`
- no hex colour literals outside `sections/_tone.scss`
- no `px` font sizes

## 11.4 Visual and responsive checks

- **Fixed-width screenshots** of the assembled page at 320 / 375 / 600 / 840 / 1024 / 1280, in `en` and `ar`, committed as reference images and diffed in CI (tolerance-based; regenerated deliberately, never automatically).
- **No horizontal overflow**: assert `document.scrollWidth === window.innerWidth` at every one of the nine widths.
- **SC 1.4.12 text spacing**: apply `line-height: 1.5em; letter-spacing: .12em; word-spacing: .16em; p { margin-bottom: 2em }` to the whole page at 375 and 1280 and assert no clipping and no overlap (measured by comparing each text node's scroll and client dimensions).
- **CLS**: assert every content `<img>` has both `width` and `height` attributes.
- **Pseudo-locale (`xx`)** run confirms tab labels wrap rather than truncate and that no section overflows at 375.

## 11.5 Manual assistive-technology checklist

Run and **recorded in the PR** for every content-model change and every renderer release. Kept as `NG/src/app/home/A11Y-CHECKLIST.md`.

1. **Keyboard only, no mouse, at 1280 and 375.** Tab from page load to the footer. Every stop is visible (nothing hidden behind the sticky header), the ring is obvious on every surface including the dark hero, order matches visual order, nothing unreachable or inescapable.
2. **The audience widget.** Desktop: arrows move and activate, Home/End work, Tab from a tab lands in the panel. Mobile: each header is a heading in the rotor, Enter/Space toggles, `aria-expanded` flips. Resize across 1024 with focus inside — focus survives on the same audience.
3. **Screen readers.** NVDA + Firefox, JAWS + Chrome, VoiceOver + Safari (macOS), VoiceOver + Safari (iOS at 375). For each: list the headings (is the outline sensible?), list the landmarks (are region names meaningful and unique?), list the links (is every link's purpose clear out of context?). The heading and link lists read aloud out of context are the highest-yield five minutes here.
4. **Alt-text quality.** A human reads every informative alt and asks: if the image vanished, would this sentence carry the same information?
5. **Video, both consent states.** Decline functional cookies, reload: poster, explanation, working "allow and play", working off-site link, transcript. Accept: player mounts, focus moves, captions default on, nothing autoplays, Escape works from fullscreen. Watch with sound off — do the captions make sense? Watch with the screen off — is anything visual-only that the `not-needed` justification claimed was not?
6. **Zoom and spacing.** 200% and 400% at 1280; then the WCAG text-spacing bookmarklet at 100% and 200%. Look at tab labels, feature-card titles, the hero intro.
7. **Windows High Contrast** (Windows 11 Contrast Themes). Is the selected tab identifiable? Are icons visible? Is the hero text legible without the photo? Is the focus ring visible?
8. **Reduced motion on.** No page-enter animation, no chevron rotation, no transitions.
9. **Arabic build** (`yarn start:ar`) with a deliberately partial translation. Mirrored layout, chevrons flipped and play glyph not, untranslated English reads LTR in place, the screen reader switches voice, diacritics do not clip.
10. **Hero photo sanity.** Swap in the brightest photograph anyone might plausibly upload; confirm the text is comfortably readable and the scrim is actually in the render tree.
11. **The 375px comparison.** Rebuilt page beside the live orcid.org homepage at 375px. The rebuild must be at least as good on every count — in particular no horizontally scrolling tab strip and no pagination arrows.
12. **The CMS, keyboard only.** Add a section, reorder two sections, change a variant, remove a section, publish — using only the keyboard, with NVDA running. Records the residual Decap gaps (§7.7) and verifies the `a11y-patch.js` up/down buttons work.
13. **The clipboard fallback.** Add a whole section with a transcript so the proposal exceeds `MAX_URL_LENGTH = 6000`; confirm the fallback flow is comprehensible and produces a valid proposal.