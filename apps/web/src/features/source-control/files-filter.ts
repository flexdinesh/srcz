import type { CompareFile } from "./compare-files.ts"

// The review Files rail's filter (decision 0117): path terms and Hide
// viewed. Pure.

export interface FilesFilter {
  // query holds whitespace-separated terms; each must occur in the path, or
  // a rename's old path, ignoring case.
  query: string
  hideViewed: boolean
}

function terms(query: string): string[] {
  return query.toLocaleLowerCase().split(/\s+/).filter(Boolean)
}

// filesFilterActive is whether the filter hides anything at all.
export function filesFilterActive(filter: FilesFilter): boolean {
  return filter.hideViewed || terms(filter.query).length > 0
}

// filterFiles keeps the files the filter shows, in their order.
export function filterFiles(files: readonly CompareFile[], filter: FilesFilter, viewed: (path: string) => boolean): readonly CompareFile[] {
  const wanted = terms(filter.query)
  if (wanted.length === 0 && !filter.hideViewed) return files
  return files.filter((file) => {
    if (filter.hideViewed && viewed(file.path)) return false
    const paths = [file.path, file.oldPath ?? ""].map((path) => path.toLocaleLowerCase())
    return wanted.every((term) => paths.some((path) => path.includes(term)))
  })
}

// emptyFilterMessage says why a filter shows no files.
export function emptyFilterMessage(filter: FilesFilter): string {
  return terms(filter.query).length > 0 ? "No files match." : "Every file is viewed."
}
