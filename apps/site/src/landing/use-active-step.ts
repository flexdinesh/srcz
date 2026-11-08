'use client'

import { useEffect, useState } from 'react'

// The active step is the section crossing a band just above the middle of the
// viewport. Sections carry `data-step-index`; the first one is active until
// any section reports.
export function useActiveStep(count: number): number {
  const [active, setActive] = useState(0)

  useEffect(() => {
    const sections = Array.from(document.querySelectorAll<HTMLElement>('[data-step-index]'))
    if (sections.length === 0 || typeof IntersectionObserver === 'undefined') return

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue
          const index = Number(entry.target.getAttribute('data-step-index'))
          if (Number.isInteger(index) && index >= 0 && index < count) setActive(index)
        }
      },
      { rootMargin: '-40% 0px -55% 0px' },
    )
    for (const section of sections) observer.observe(section)
    return () => observer.disconnect()
  }, [count])

  return active
}
