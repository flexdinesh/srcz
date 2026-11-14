import { Link } from 'vocs'

// The docs home's page cards (decision 0142): one grid of panes on shared
// hairlines, each a title, an arrow, and a one-line summary of the page.
export function DocCards(props: { columns: 2 | 3; children: React.ReactNode }) {
  return (
    <div className="sz-cards" data-columns={props.columns}>
      {props.children}
    </div>
  )
}

export function DocCard(props: { title: string; to: string; children: React.ReactNode }) {
  return (
    <Link className="sz-card" to={props.to}>
      <span className="sz-card-title">
        {props.title}
        <svg aria-hidden="true" viewBox="0 0 24 24">
          <path d="M5 12h14M13 6l6 6-6 6" />
        </svg>
      </span>
      <span className="sz-card-text">{props.children}</span>
    </Link>
  )
}
