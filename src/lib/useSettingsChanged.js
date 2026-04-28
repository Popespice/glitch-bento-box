import { useEffect } from 'react'

export function useSettingsChanged(services, callback) {
  useEffect(() => {
    const onChanged = (e) => {
      if (services.some((s) => e.detail?.changed?.includes(s))) callback()
    }
    window.addEventListener('bento:settings-changed', onChanged)
    return () => window.removeEventListener('bento:settings-changed', onChanged)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
}
