import { useEffect, useRef } from 'react'

// Subscribe to settings-changed events for the named services. Mirroring the
// callback into a ref keeps the listener bound to the *latest* callback closure
// without re-binding the event listener on every render — same pattern as
// usePolling.js. Without this, the listener would call the original callback
// captured at mount, missing any state the consumer closed over after mount.
export function useSettingsChanged(services, callback) {
  const cbRef = useRef(callback)
  const servicesRef = useRef(services)

  useEffect(() => {
    cbRef.current = callback
    servicesRef.current = services
  })

  useEffect(() => {
    const onChanged = (e) => {
      const list = servicesRef.current
      if (list.some((s) => e.detail?.changed?.includes(s))) cbRef.current(e)
    }
    window.addEventListener('bento:settings-changed', onChanged)
    return () => window.removeEventListener('bento:settings-changed', onChanged)
  }, [])
}
