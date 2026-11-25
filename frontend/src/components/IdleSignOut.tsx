import { useEffect, useRef } from 'react'
import { useAuth } from '../auth/AuthContext'
import { useToast } from './Toast'

const WARN_AT = 28 * 60 * 1000
const SIGN_OUT_AT = 30 * 60 * 1000

// Signs out a session left unattended (shared or unlocked computers), with a warning two minutes before.
export function IdleSignOut() {
  const { me, logout } = useAuth()
  const toast = useToast()
  const last = useRef(Date.now())
  const warned = useRef(false)

  useEffect(() => {
    if (!me) return
    last.current = Date.now(); warned.current = false
    const active = () => { last.current = Date.now(); warned.current = false }
    const events = ['pointerdown', 'pointermove', 'keydown', 'scroll', 'touchstart'] as const
    events.forEach((e) => window.addEventListener(e, active, { passive: true }))
    const timer = window.setInterval(() => {
      const idle = Date.now() - last.current
      if (idle >= SIGN_OUT_AT) {
        void logout().finally(() => toast('info', 'You were signed out after 30 minutes without activity, to keep your data safe.'))
      } else if (idle >= WARN_AT && !warned.current) {
        warned.current = true
        toast('warn', 'You will be signed out in 2 minutes because of inactivity. Move the mouse or press a key to stay signed in.')
      }
    }, 15_000)
    return () => { events.forEach((e) => window.removeEventListener(e, active)); window.clearInterval(timer) }
  }, [me, logout, toast])

  return null
}
