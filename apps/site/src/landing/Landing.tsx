import './landing.css'
import { Features } from './Features'
import { Footer } from './Footer'
import { Nav } from './Nav'

export function Landing() {
  return (
    <div className="landing">
      <a className="landing-skip" href="#landing-main">
        Skip to content
      </a>
      <div className="landing-frame">
        <Nav />
        <div id="landing-main">
          <Features />
        </div>
        <Footer />
      </div>
    </div>
  )
}
