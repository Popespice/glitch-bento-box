import { useEffect, useRef } from 'react'

/**
 * Run `callback` immediately on mount and every `intervalMs` thereafter.
 * Pauses entirely when the window/tab is hidden (Page Visibility API),
 * resumes on return — including an immediate call so stale data refreshes.
 *
 * Pass `intervalMs = null` (or any falsy value) to disable the poll entirely
 * for the duration of that render — useful for gating a tick on state.
 *
 * @param {() => void | Promise<void>} callback
 * @param {number | null} intervalMs
 */
export function usePolling(callback, intervalMs) {
  const cbRef = useRef(callback)
  // Keep the ref current so the interval always calls the latest closure
  // without creating a dependency on `callback` in the interval effect.
  useEffect(() => {
    cbRef.current = callback
  })

  useEffect(() => {
    if (!intervalMs) return // disabled — don't even attach the visibility listener
    let id = null
    const tick = () => {
      cbRef.current()
    }

    const start = () => {
      if (id != null) return
      tick() // immediate
      id = setInterval(tick, intervalMs)
    }
    const stop = () => {
      if (id == null) return
      clearInterval(id)
      id = null
    }

    if (!document.hidden) start()

    const onVis = () => {
      document.hidden ? stop() : start()
    }
    document.addEventListener('visibilitychange', onVis)

    return () => {
      stop()
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [intervalMs])
}
