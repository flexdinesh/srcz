import './landing.css'
import { Footer } from './Footer'
import { Nav } from './Nav'
import { Walkthrough } from './Walkthrough'

export function Landing() {
  return (
    <div className="landing">
      <a className="landing-skip" href="#landing-main">
        Skip to content
      </a>
      <div className="landing-frame">
        <Nav />
        <div id="landing-main">
          <Walkthrough />
        </div>
        <Footer />
      </div>
    </div>
  )
}
