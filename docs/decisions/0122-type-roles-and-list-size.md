# 0122: Type roles and the list size

- Status: Accepted
- Date: 2026-11-10
- Revises: [0033](0033-design-tokens-and-ui-primitives.md) (type roles)

Sidebar rows (Explorer, Search, Source Control, Walkthroughs, Feedback) read a
step smaller than the document beside them. They were 13px Inter in
`text-secondary`, while source is 13px monospace and prose 14px. Matching
pixel sizes across faces did not match optical size: monospace sets wider and
reads larger.

- Sidebar rows use a new `--text-list` role, 14px at the default Font Size,
  with `text-primary` names. List rows grow from 22 to 24px (`--row-list`,
  Pierre's desktop row height); narrow screens keep 32px. `ListRow` uses
  `text-primary` ink at every density, pickers included.
- The UI uses three steps: metadata 12px, label 13px, list 14px. Further
  hierarchy comes from weight and color, not 1px size steps. The 11px
  `--text-status` role is removed; git status letters are 12px 600.
- 12px is for metadata only: counts, ages, folders beside names, stats, ref
  chips, kbd, the status bar, and chrome labels. Interactive controls
  (segmented items, small buttons, the copy button) and notices move to the
  label size; monospace content (review file paths, navigation snippets,
  branch names, walkthrough targets) uses `--text-code`.
- The activity badge grows from 9 to 10px (`--text-badge`), on a 16px box.
- The Search field's option toggles show their faces as type (`ToggleGlyph`:
  `Aa`, underlined `ab`, `.*` in Inter 500 at 12px) instead of Lucide icons,
  whose geometric letter drawings looked stretched at 14px.

Preview type (`--preview-*`) and source are unchanged. Every size stays in
rem, so the Font Size setting still scales the whole interface together.
24px rows show about 9% fewer lines per screen.
