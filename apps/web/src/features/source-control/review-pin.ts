// A review pins a revealed file while the diffs around it load and grow
// (decisions 0034, 0135). Input lets go of the pin, but WebKit sends no
// input event for a scrollbar drag or a kinetic scroll, so the pin also ends
// on its own once the reveal settles: nothing pulls the pane back after it.

// pinQuietMs is how long the content must keep its size, once the pinned
// file's diff shows, for the reveal to settle.
export const pinQuietMs = 300
// pinLimitMs is the longest a pin holds, whatever still loads.
export const pinLimitMs = 3_000

// PinClock is when a pin began, when the content last changed size or the
// pinned file's diff showed, and whether that diff shows.
export interface PinClock {
  pinnedAt: number
  changedAt: number
  shows: boolean
}

// pinSettled tells whether a pin ends on its own at now.
export function pinSettled(now: number, clock: PinClock): boolean {
  return now - clock.pinnedAt >= pinLimitMs || (clock.shows && now - clock.changedAt >= pinQuietMs)
}

// pinWait is how long until a pin with no further changes settles.
export function pinWait(now: number, clock: PinClock): number {
  const limit = clock.pinnedAt + pinLimitMs - now
  const quiet = clock.shows ? clock.changedAt + pinQuietMs - now : limit
  return Math.max(0, Math.min(limit, quiet))
}
