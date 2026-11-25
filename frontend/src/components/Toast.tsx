import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { CircleAlert, CircleCheck, Info, TriangleAlert, X } from 'lucide-react'

type Kind = 'ok' | 'error' | 'warn' | 'info'
interface Item { id: number; kind: Kind; message: string }
type Show = (kind: Kind, message: string) => void

const ToastContext = createContext<Show>(() => {})
const ICON = { ok: CircleCheck, error: CircleAlert, warn: TriangleAlert, info: Info }
const LIFETIME = { ok: 4500, info: 5000, warn: 8000, error: 8000 }

// Pop-up messages in the corner: every confirmation, warning and action error appears here.
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Item[]>([])
  const next = useRef(1)
  const close = useCallback((id: number) => setItems((l) => l.filter((t) => t.id !== id)), [])
  const show = useCallback<Show>((kind, message) => {
    const id = next.current++
    setItems((l) => [...l.filter((t) => t.message !== message).slice(-3), { id, kind, message }])
    window.setTimeout(() => close(id), LIFETIME[kind])
  }, [close])

  return (
    <ToastContext.Provider value={show}>
      {children}
      <div className="toasts" aria-live="polite">
        {items.map((t) => {
          const Icon = ICON[t.kind]
          return (
            <div key={t.id} className={`toast toast--${t.kind}`} role={t.kind === 'error' ? 'alert' : 'status'}>
              <Icon size={18} className="toast__icon" />
              <p className="toast__text">{t.message}</p>
              <button type="button" className="toast__close" aria-label="Dismiss" onClick={() => close(t.id)}><X size={15} /></button>
            </div>
          )
        })}
      </div>
    </ToastContext.Provider>
  )
}

export const useToast = () => useContext(ToastContext)

// Drop-in for a page's message state: shows it as a pop-up whenever it changes, renders nothing itself.
export function Notify({ message, kind = 'ok' }: { message: string | null | undefined | false; kind?: Kind }) {
  const show = useToast()
  useEffect(() => { if (message) show(kind, message) }, [message, kind, show])
  return null
}
