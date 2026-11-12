import type { FileTreeIconConfig } from "@pierre/trees"

// Folder glyphs in Pierre's two-tone idiom: a 40% body under a solid tab
// (closed) or front flap (open), on its 16 grid (decision 0138).
const folderSymbols = `<svg xmlns="http://www.w3.org/2000/svg" style="display:none">
<symbol id="zero-folder" viewBox="0 0 16 16"><path fill="currentColor" opacity=".4" d="M1 4.5A1.5 1.5 0 0 1 2.5 3h3.38a1.5 1.5 0 0 1 1.06.44L8.5 5h5A1.5 1.5 0 0 1 15 6.5v6a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 1 12.5z"/><path fill="currentColor" d="M1 4.5A1.5 1.5 0 0 1 2.5 3h3.38a1.5 1.5 0 0 1 1.06.44L8.5 5H1z"/></symbol>
<symbol id="zero-folder-open" viewBox="0 0 16 16"><path fill="currentColor" opacity=".4" d="M1 4.5A1.5 1.5 0 0 1 2.5 3h3.38a1.5 1.5 0 0 1 1.06.44L8.5 5h4A1.5 1.5 0 0 1 14 6.5V7H4.3a1.5 1.5 0 0 0-1.4.97L1 13z"/><path fill="currentColor" d="M3.37 8.47A1.5 1.5 0 0 1 4.77 7.5h9.9a.75.75 0 0 1 .7 1.02l-1.84 4.5a1.5 1.5 0 0 1-1.39.98H1.75a.75.75 0 0 1-.7-1.02z"/></symbol>
</svg>`

// treeIcons is the icon set every Pierre tree shares: Pierre's colored file
// icons, plus folder icons beside the chevron through the patched
// file-tree-icon-folder slots (patches/@pierre__trees@1.0.0-beta.6.patch).
export const treeIcons: FileTreeIconConfig = {
  set: "complete",
  colored: true,
  spriteSheet: folderSymbols,
  remap: {
    "file-tree-icon-folder": "zero-folder",
    "file-tree-icon-folder-open": "zero-folder-open",
  },
}
