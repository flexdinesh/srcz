// The Source Zero mark, a Z inside a zero (decision 0104), on the 32 grid at the
// docs logo's 28px. Decorative: the wordmark beside it names the product.
export function Mark() {
  return (
    <svg className="landing-mark" viewBox="0 0 32 32" aria-hidden="true">
      <path className="landing-mark-z" d="M4 2H28V8.5L14 23.5H28V30H4V23.5L18 8.5H4z" />
      <path className="landing-mark-rails" d="M4 9.5H8V18.12L4 22.4zM28 22.5H24V13.88L28 9.6z" />
    </svg>
  )
}
