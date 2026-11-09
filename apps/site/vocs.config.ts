import { defineConfig } from 'vocs/config'

export default defineConfig({
  title: 'Zero',
  description:
    'The code viewer for the agentic era: browse files and review what agents change, with diffs, commits, branches, and walkthroughs.',
  renderStrategy: 'full-static',
  accentColor: 'light-dark(#325dc8, #74ade8)',
  iconUrl: '/favicon.svg',
  logoUrl: { light: '/logo-light.svg', dark: '/logo-dark.svg' },
  ogImageUrl: (_path, { baseUrl }) => `${baseUrl ?? ''}/og.png`,
  sidebar: [
    {
      text: 'Start',
      items: [
        { text: 'Introduction', link: '/docs' },
        { text: 'Getting started', link: '/docs/getting-started' },
        { text: 'Usage', link: '/docs/usage' },
      ],
    },
    {
      text: 'Guides',
      items: [
        { text: 'Desktop app', link: '/docs/desktop' },
        { text: 'Remote hosts', link: '/docs/remote' },
        { text: 'Browsing', link: '/docs/browsing' },
        { text: 'Code navigation', link: '/docs/code-navigation' },
        { text: 'Walkthroughs', link: '/docs/walkthroughs' },
      ],
    },
  ],
  topNav: [{ text: 'GitHub', link: 'https://github.com/flexdinesh/zero' }],
})
