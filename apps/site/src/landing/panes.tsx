// Each feature row's visual: a Stageshow scene of the app (decision 0141).
// Every file, branch, and message in them is synthetic demo content.

import type { FeatureId } from './features'
import { BrowseScene } from './scenes/BrowseScene'
import { DiffsScene } from './scenes/DiffsScene'
import { FeedbackScene } from './scenes/FeedbackScene'
import { HeroScene } from './scenes/HeroScene'
import { LeanScene } from './scenes/LeanScene'
import { RemoteScene } from './scenes/RemoteScene'
import { WalkthroughScene } from './scenes/WalkthroughScene'
import './scenes/zero.css'

export function FeaturePane({ id }: { id: FeatureId }) {
  switch (id) {
    case 'overview':
      return <HeroScene />
    case 'browse':
      return <BrowseScene />
    case 'diffs':
      return <DiffsScene />
    case 'walkthroughs':
      return <WalkthroughScene />
    case 'feedback':
      return <FeedbackScene />
    case 'remote':
      return <RemoteScene />
    case 'lean':
      return <LeanScene />
  }
}
