import { Layout, Link, MdxPageContextProvider } from 'vocs'

// Replaces Vocs' default not-found route (decision 0142) inside the docs layout,
// so the sidebar and its search stay in reach: a way home, a way to start, and
// the search shortcut.
export default function NotFound() {
  return (
    <MdxPageContextProvider frontmatter={{ showAskAi: false, outline: false }}>
      <Layout>
        <div className="sz-nf">
          <div className="sz-nf-code">404</div>
          <h1>This page doesn't exist</h1>
          <p>The link may be old, or the page moved. Search the docs or start from the top.</p>
          <div className="sz-nf-actions">
            <Link className="sz-button sz-button-primary" to="/docs">
              Docs home
            </Link>
            <Link className="sz-button" to="/docs/getting-started">
              Getting started
            </Link>
          </div>
          <p className="sz-nf-hint">
            Search with <kbd>Ctrl</kbd> <kbd>K</kbd> (<kbd>⌘</kbd> <kbd>K</kbd> on macOS).
          </p>
        </div>
      </Layout>
    </MdxPageContextProvider>
  )
}
