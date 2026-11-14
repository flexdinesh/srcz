import { Link } from 'vocs'

// The docs home's feature index (decision 0144): a mono section label over two
// columns of rows on hairlines, each a feature's name and one line. A row with
// `to` links to the section that documents it. The label and grid are siblings
// so the article's section-label rule applies.
export function FeatureGroup(props: { label: string; children: React.ReactNode }) {
  return (
    <>
      <div className="sz-section-label">{props.label}</div>
      <div className="sz-features">{props.children}</div>
    </>
  )
}

export function Feature(props: { title: string; to?: string; children: React.ReactNode }) {
  const body = (
    <>
      <span className="sz-feature-title">
        {props.title}
        {props.to === undefined ? null : (
          <svg aria-hidden="true" viewBox="0 0 24 24">
            <path d="M5 12h14M13 6l6 6-6 6" />
          </svg>
        )}
      </span>
      <span className="sz-feature-text">{props.children}</span>
    </>
  )
  if (props.to === undefined) return <div className="sz-feature">{body}</div>
  return (
    <Link className="sz-feature" to={props.to}>
      {body}
    </Link>
  )
}
