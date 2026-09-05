# orcid-homepage-decap-cms

The content of the orcid.org homepage, and the editor for it.

The page itself is drawn by the ORCID registry front end. This repository owns
what the page says: one JSON document per language, published as a static bundle
that the front end fetches at runtime. Changing the words on the homepage does
not require a release of the registry.

- **Editor** — <https://orcid.github.io/orcid-homepage-decap-cms/qa/admin/>
- **QA bundle** — <https://orcid.github.io/orcid-homepage-decap-cms/qa/>
- **Production bundle** — <https://orcid.github.io/orcid-homepage-decap-cms/prod/>

> This is a demonstration. The bundles are served from GitHub Pages, and the
> registry only reads them in local development. Moving them to the existing
> `homepage-{qa,fallback,prod}.orcid.org` buckets is a change to one workflow
> and one URL; see [Moving to S3](#moving-to-s3).

## Changing the homepage

1. Open the [editor](https://orcid.github.io/orcid-homepage-decap-cms/qa/admin/).
   There is no password. It opens on the content that is live, loaded into your
   own browser, and nothing you do there is published.
2. Make your change and choose **Publish**. That records it locally.
3. Choose **Propose on GitHub**. GitHub asks you to sign in, then shows a
   prefilled form. Submit it.
4. A few seconds later the issue becomes a pull request with your change. Once
   someone on the team merges it, the QA bundle rebuilds within a few minutes.
5. Production is a separate, deliberate step: run the **Release to production**
   workflow, check QA, and approve.

If your change cannot be applied, a comment on the issue says why. Edit the
issue to fix it and the check runs again.

### Why it works this way

Decap CMS normally writes to GitHub directly, which needs a server holding an
OAuth client secret. A demo that is open to everyone should not ship a
credential to every visitor, so the editor here writes nothing at all: it hands
the change to GitHub, GitHub authenticates the person, and a maintainer reviews
it. The editor stays a static file with no secrets and no server behind it.

## What an editor can and cannot change

Text, images and the featured video ID are editable. The shape of the page is
not: exactly two features per audience tab, at most eight tabs, at most five
closing paragraphs. `schema/home.schema.json` is the contract, and the renderer
in the registry is written against it.

Text fields accept a small subset of markdown, and nothing else:

| Written             | Rendered        |
| ------------------- | --------------- |
| `**important**`     | **important**   |
| `[text](https://…)` | a link          |
| a blank line        | a new paragraph |

Links must be `https://` (or `mailto:`) and point at an `orcid.org`, YouTube or
Vimeo address. Headings, lists, italics, inline images and raw HTML are
rejected, because the renderer would print them as literal characters.

Every item in a list carries an **ID**. That ID is the translation key. Renaming
it silently discards every translation of that item, so pull requests report
added and removed keys for a reviewer to check.

## Translations

English is edited here. Other languages come from Transifex, are matched to each
item by its ID, and fall back to English per string, so a partly translated
language shows the rest of the page in English rather than nothing.

`i18n/home.en.json` is generated from the content file, never committed, and
pushed to Transifex by CI. `i18n/home.<locale>.json` is written by `tx pull`.

**Not yet connected.** The Transifex project and resource do not exist yet, so
`pull-translations.yml` and `push-translation-source.yml` skip themselves until
`TRANSIFEX_TOKEN` and `GH_PAT` are set. The translation files in `i18n/` today
were copied from the pages that are live, which are **machine translations** made
by GTranslate on the WordPress site. They are a realistic placeholder, not
approved ORCID translations.

## Working on it locally

```bash
npm ci
npm run validate -- --strict   # content and translations
npm test                       # unit tests
npm run build                  # writes dist/
npm run serve                  # serves dist/ on http://localhost:8082
```

To point the registry front end at a local bundle, set `HOMEPAGE_CONTENT_URL` to
`http://localhost:8082/content` in the orcid-angular environment file you are
running, regenerate the runtime environment, and start it.

### Layout

| Path                   | What it is                                                     |
| ---------------------- | -------------------------------------------------------------- |
| `content/home.en.json` | The edited source: structure, English text, image paths        |
| `content/images/`      | Images, referenced as `images/<name>`                          |
| `i18n/`                | One file of translated strings per language                    |
| `schema/`              | The JSON Schema the registry is written against                |
| `admin/`               | The editor: Decap CMS, seeded and wired to the GitHub hand-off |
| `scripts/`             | Validate, extract, build, and the post-deploy check            |

`npm run build` writes `dist/`: one document per language with images
fingerprinted into `content/assets/`, a `version.json` for the post-deploy
check, and a copy of the editor seeded with the current content.

Images are content-addressed, so an asset URL never changes meaning and can be
cached indefinitely, while the JSON stays uncached and picks up edits.

## Releasing

| Where      | How                                                              |
| ---------- | ---------------------------------------------------------------- |
| QA         | Automatic on every merge to `main`                               |
| Production | Run **Release to production**, then approve the `orcid.org` gate |
| Rollback   | Run the same workflow with an earlier tag in the version field   |

Each release is a tag. Production only ever publishes a tag that has already
been built and checked on QA, and every deployment is verified from the outside
afterwards: the published `version.json` must match, every language must load,
and every image it references must resolve.

## Moving to S3

The registry reads a URL, so moving the bundle is a deployment change, not a
code change:

1. Replace the GitHub Pages step in `pages-qa.yml` and `release-prod.yml` with
   the three-stage `reggionick/s3-deploy` job used by
   `orcid-wordpress-home-page-deploy`, keeping the existing `QA_AWS_BUCKET`,
   `FALLBACK_AWS_BUCKET` and `PROD_AWS_BUCKET` variables.
2. Add `and http.request.uri.path.extension ne "json"` to the three
   `*_homepage_cache` rules in the Cloudflare Terraform. Without it the bundles
   inherit a 186-day edge cache and content edits never appear.
3. Confirm the buckets return CORS headers for `orcid.org` and `qa.orcid.org`.
   Their configuration is not in Terraform; read it with
   `aws s3api get-bucket-cors`.
4. Point `HOMEPAGE_CONTENT_URL` at the bucket in the registry's environment
   files, and add a fallback URL alongside it.

`scripts/validate-deploy.mjs` is host-agnostic and needs no change.
