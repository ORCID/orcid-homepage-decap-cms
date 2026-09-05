# Content still needed

Engineering decisions are made. These are the ones only Communications can make,
each with what it blocks and what happens until it arrives.

## 1. The featured video

**What is on the page today.** The live homepage embeds Vimeo `1198760040`, "What
Your ORCID Record Can Do For You", 3 minutes 8 seconds. It has no poster image,
no transcript, and no statement anywhere that it is captioned.

**What version 2 does about it.** The section is migrated as a picture that links
to the video, using the video's own still. That is what the section's body text
already tells the reader to do, so nothing is lost. The player itself is built,
tested and available in the editor; it is not used here because using it would
mean asserting accessibility facts nobody has verified.

**To turn it back into a player, three things are needed:**

| Needed | Why | Who |
| --- | --- | --- |
| The full transcript | A transcript is the only route into a video for someone who cannot hear it, cannot play it, or has declined cookies. Required before production. | Communications |
| Confirmation the video is captioned, and in which languages | WCAG 1.2.2. Auto-generated captions do not satisfy it. | Communications |
| Either an audio-description track, or a sentence saying why none is needed | WCAG 1.2.5. "The narrator reads every on-screen label aloud" is a valid answer. | Communications |

Until then the release gate refuses to publish a video without a transcript, so
this cannot be forgotten and cannot ship half-done.

## 2. Two quick links share one address

On the live homepage, "Adopt ORCID at my institution" and "Get data from ORCID's
APIs" both point at
`https://info.orcid.org/documentation/api-tutorials/api-tutorial-read-data-on-a-record/`.
Both were copied verbatim rather than guessed at. One of them is probably meant
to go somewhere else, most likely the membership or documentation landing page.

## 3. Translations for the new text

Version 2 adds source strings that version 1 had nowhere to keep: the page
description, the quick-links labels, and the picture description. They fall back
to English per string, and the page marks them so a screen reader announces them
in English rather than mispronouncing them in the reader's language.

That is correct handling, not an acceptable resting place. The quick links are
the page's main route to signing up, and the release gate fails if a
well-translated language has a section with nothing translated in it at all. One
Transifex round trip clears it.
