// Unsent comment and reply text, kept for this page's session so a composer
// or reply field that closes and reopens at the same place keeps its text
// (decision 0120). Never stored.

const drafts = new Map<string, string>()

export function readDraft(key: string): string {
  return drafts.get(key) ?? ""
}

export function writeDraft(key: string, text: string): void {
  if (text) drafts.set(key, text)
  else drafts.delete(key)
}

// replyKey names a thread's reply draft.
export function replyKey(project: string, id: string, thread: number): string {
  return JSON.stringify([project, id, thread])
}
