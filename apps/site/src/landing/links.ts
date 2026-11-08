export const links = {
  docs: '/docs',
  getStarted: '/docs/getting-started',
  browsing: '/docs/browsing',
  sourceControl: '/docs/browsing#source-control',
  walkthroughs: '/docs/walkthroughs',
  remote: '/docs/remote',
  desktop: '/docs/desktop',
  github: 'https://github.com/flexdinesh/srcz',
  agentSkill: 'https://github.com/flexdinesh/srcz/blob/main/skills/srcz-walkthrough/SKILL.md',
  license: 'https://github.com/flexdinesh/srcz/blob/main/LICENSE',
}

export type InstallMethod = { id: string; label: string; command: string }

export const installMethods: InstallMethod[] = [
  {
    id: 'desktop-cli',
    label: 'Desktop + CLI',
    command: 'curl -fsSL https://raw.githubusercontent.com/flexdinesh/srcz/main/scripts/install.sh | sh',
  },
  {
    id: 'cli',
    label: 'CLI only',
    command: 'curl -fsSL https://raw.githubusercontent.com/flexdinesh/srcz/main/scripts/install.sh | sh -s -- --cli-only',
  },
]
