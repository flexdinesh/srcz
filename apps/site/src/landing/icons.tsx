// Small stroke icons on a 16 grid, drawn at 1.5 for the compact chrome.

import type { ReactNode } from 'react'

type IconProps = { className?: string }

function Icon({ className, children }: IconProps & { children: ReactNode }) {
  return (
    <svg
      className={className === undefined ? 'landing-icon' : `landing-icon ${className}`}
      viewBox="0 0 16 16"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="square"
      aria-hidden="true"
    >
      {children}
    </svg>
  )
}

export function ArrowRight(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M2.5 8h10M9 4.5 12.5 8 9 11.5" />
    </Icon>
  )
}

