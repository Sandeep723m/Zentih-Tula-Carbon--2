import { createContext, useContext, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'

interface Options {
  title: string
  message?: ReactNode
  confirmLabel?: string
  danger?: boolean
  input?: { label: string; required?: boolean; placeholder?: string }
}
interface Open extends Options { resolve: (value: string | null) => void }
type Ask = (o: Options) => Promise<string | null>

const DialogContext = createContext<Ask | null>(null)

// Resolves with the typed text ('' when there is no input) on confirm, or null on cancel.
export function DialogProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState<Open | null>(null)
  const [value, setValue] = useState('')
  const [error, setError] = useState<string | null>(null)
  const ref = useRef<HTMLDialogElement>(null)

  useEffect(() => { if (open) ref.current?.showModal() }, [open])

  const ask: Ask = (o) => new Promise((resolve) => { setValue(''); setError(null); setOpen({ ...o, resolve }) })
  const close = (result: string | null) => { ref.current?.close(); open?.resolve(result); setOpen(null) }

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (open?.input?.required && !value.trim()) return setError(`${open.input.label} is required.`)
    close(open?.input ? value.trim() : '')
  }

  return (
    <DialogContext.Provider value={ask}>
      {children}
      {open && (
        <dialog ref={ref} className="dialog" aria-labelledby="dialog-title"
          onCancel={(e) => { e.preventDefault(); close(null) }}
          onClick={(e) => { if (e.target === e.currentTarget) close(null) }}>
          <form onSubmit={submit} className="dialog__body">
            <h2 id="dialog-title" className="dialog__title">{open.title}</h2>
            {open.message && <div className="dialog__message">{open.message}</div>}
            {open.input && (
              <label className="field">
                <span className="field__label">{open.input.label}{open.input.required && ' *'}</span>
                <textarea className={error ? 'input input--invalid' : 'input'} rows={3} autoFocus value={value}
                  placeholder={open.input.placeholder} onChange={(e) => { setValue(e.target.value); setError(null) }} />
                {error && <span className="field__error" role="alert">{error}</span>}
              </label>
            )}
            <div className="dialog__actions">
              <button type="button" className="button button--ghost" onClick={() => close(null)}>Cancel</button>
              <button type="submit" className={`button${open.danger ? ' button--solid-danger' : ''}`} autoFocus={!open.input}>
                {open.confirmLabel ?? 'OK'}
              </button>
            </div>
          </form>
        </dialog>
      )}
    </DialogContext.Provider>
  )
}

export function useDialog() {
  const ask = useContext(DialogContext)
  if (!ask) throw new Error('useDialog needs <DialogProvider>')
  return {
    confirm: async (o: Omit<Options, 'input'>) => (await ask(o)) !== null,
    prompt: (o: Options & { input: NonNullable<Options['input']> }) => ask(o),
  }
}
