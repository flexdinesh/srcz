import { links } from '../landing/links'
import { Mark } from '../landing/Mark'

// Vocs renders this slot below every page's content (decision 0107): the
// landing's footer band, so the docs end the way the landing does. Vocs wraps it
// in its own <footer>; `_root.css` hides it on the landing's blank layout.
export function Footer() {
  return (
    <div className="sz-footer">
      <div className="sz-footer-brand">
        <span className="sz-footer-wordmark">
          <Mark />
          Zero
        </span>
        <span className="sz-footer-muted">MIT License</span>
      </div>
      <nav aria-label="Footer" className="sz-footer-links">
        <a href={links.github}>GitHub</a>
        <a href={links.license}>License</a>
      </nav>
    </div>
  )
}
