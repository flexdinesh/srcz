// treeCSS is the Pierre tree styling every tree shares: square corners over
// Pierre's own radii (decision 0102), 12px chevrons, the selection mark beside
// the selection tint, which alone is under 3:1 (WCAG 1.4.11), no native
// scrollbar for fine pointers, which get the overlay (decision 0140), else
// the square, inset thumb (decision 0055), and the folder icon beside
// the chevron, muted in every state so row fills carry state, and pulled in
// to sit over its children's icons, one indent level in (decision 0138).
// Tokens inherit into the tree's shadow root.
export const treeCSS = `*, ::before, ::after, ::-webkit-scrollbar-thumb { border-radius: 0 !important; }
[data-icon-name="file-tree-icon-chevron"] { width: 12px; height: 12px; }
[data-item-section="folder-icon"] { display: flex; flex: none; align-items: center; justify-content: center; width: var(--trees-icon-width); margin-inline-start: calc(var(--trees-level-gap) - var(--trees-icon-width) / 2 - 0.5px); color: var(--color-text-muted); }
[data-item-selected="true"] { box-shadow: inset 0 0 0 1px var(--color-selected-border); }
[data-file-tree-virtualized-scroll="true"]::-webkit-scrollbar-thumb { border: 2px solid transparent; }
@media (pointer: fine) {
  :is([data-file-tree-virtualized-scroll="true"], [data-file-tree-scrollbar-measure="true"]) { scrollbar-width: none; }
  :is([data-file-tree-virtualized-scroll="true"], [data-file-tree-scrollbar-measure="true"])::-webkit-scrollbar { display: none; }
}`
