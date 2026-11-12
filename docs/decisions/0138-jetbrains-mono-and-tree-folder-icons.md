# 0138: JetBrains Mono, no ligatures, and folder icons in trees

- Status: Accepted
- Date: 2026-11-12
- Supersedes: the IBM Plex Mono face of [0130](0130-ibm-plex-mono-quiet-scm-chrome-and-container-focus.md)
  (app, site, and the brand's outlined wordmark)
- Restores: [0104](0104-source-zero-logo.md)'s outlined JetBrains Mono wordmark
- Amends: [0102](0102-sharp-slate-panes.md)'s Explorer tree, which showed
  folders with a chevron only

## Context

Zero and diffx are used side by side, and diffx sets code, paths, and chrome
in JetBrains Mono. Plex Mono, bundled the day before (0130), made zero read as
a different tool. JetBrains Mono ships code ligatures on by default: `!=` draws
as `≠`, `!==` as `≢`, `=>` as `⇒`, which is not what the file holds.

The Explorer and Source Control trees (Pierre trees) marked folders with a
chevron alone, in the same column as file icons, so folders and files read as
one undifferentiated list until a row was expanded.

## Decision

- **One mono face: JetBrains Mono, bundled.**
  `@fontsource-variable/jetbrains-mono` (one variable file per subset, 100 to
  800) leads `--font-mono` in the web app and `--sz-mono`, `--l-mono`, and
  Vocs' `--vocs-font-family-mono` on the site. The brand's lockups, docs
  logos, and social card go back to their 0104 JetBrains Mono outlines, which
  share the 600-unit advance, so layouts do not move.
- **No ligatures.** The app's and site's root set
  `font-variant-ligatures: none`; it inherits into Pierre's shadow roots, so
  source, diffs, trees, and chrome show the characters typed. Source no
  longer turns `calt` back on. Inter loses its contextual forms too (the `->`
  arrow, the raised colon in `12:30`).
- **Folders carry a folder icon.** Every Pierre tree (Explorer, Source
  Control's changes tree, the review rail) draws a two-tone folder beside the
  chevron, in Pierre's own icon idiom (a 40% body under a solid tab), closed
  or open with the row. It is `text-muted` in every state: the row's fill and
  accent ring carry hover and selection. Files keep Pierre's colored icons,
  and a folder's icon sits over its children's icons.
- **Through Pierre's icon pipeline.** The `@pierre/trees` patch adds
  `file-tree-icon-folder` and `file-tree-icon-folder-open` slots that render
  only when an icon config remaps them; `lib/tree-icons.ts` supplies the
  symbols and the remap for every tree.

## Consequences

- The embedded mono fonts shrink from about 450 KB (Plex: four weights, woff2
  and woff) to about 85 KB (six variable woff2 subsets, kept as files for the CSP).
- JetBrains Mono's x-height is larger than Plex's, so 13px source and 12px
  chrome read larger at the same size. Rows keep their 22px and 24px heights,
  bold syntax rows included.
- Folder names sit one icon column to the right of file names at the same
  depth, as in VS Code with a folder icon theme.
- The folder slots live in the Pierre patch and must be carried to the next
  `@pierre/trees` release.
