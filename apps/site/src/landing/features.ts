// The landing is a column of feature rows (decision 0106): copy on the left,
// the feature's app pane on the right. A feature's tint marks its row's top edge
// and its pane's framing.

export type FeatureTint = 'blue' | 'green' | 'coral'

export type FeatureId = 'overview' | 'browse' | 'diffs' | 'walkthroughs' | 'remote' | 'lean'

export type Feature = { id: FeatureId; label: string; tint: FeatureTint }

export const features: Feature[] = [
  { id: 'overview', label: 'overview', tint: 'blue' },
  { id: 'browse', label: 'browse', tint: 'blue' },
  { id: 'diffs', label: 'diffs', tint: 'green' },
  { id: 'walkthroughs', label: 'walkthroughs', tint: 'blue' },
  { id: 'remote', label: 'remote', tint: 'coral' },
  { id: 'lean', label: 'lean', tint: 'green' },
]
