import { useId, useState, type FormEvent } from 'react'
import SearchSelect from './SearchSelect'
import { Notify } from './Toast'

export interface Field {
  name: string
  label: string
  type?: 'text' | 'date' | 'number' | 'select' | 'searchable-select' | 'checkbox'
  options?: Array<{ value: string; label: string }>
  optionsFor?: (values: Values) => Array<{ value: string; label: string }> // options that depend on other fields
  required?: boolean
  createOnly?: boolean // shown when creating, hidden when editing
}

export type Values = Record<string, string | boolean>

// Turns a record from the API into form values (dates trimmed to YYYY-MM-DD, nulls to '').
export function toValues(fields: Field[], record: Record<string, unknown> | null): Values {
  return Object.fromEntries(fields.map((f) => {
    const v = record?.[f.name]
    if (f.type === 'checkbox') return [f.name, v === undefined ? true : Boolean(v)]
    if (f.type === 'date' && typeof v === 'string') return [f.name, v.slice(0, 10)]
    if (f.type === 'select' && v == null) return [f.name, f.options?.[0]?.value ?? '']
    return [f.name, v == null ? '' : String(v)]
  }))
}

// A select whose options depend on other fields keeps a valid value: when its options change and no longer contain
// the current value, the first option is used (what the browser shows is what is submitted).
function effective(fields: Field[], values: Values): Values {
  const out = { ...values }
  for (const f of fields) {
    if (f.type !== 'select') continue
    const options = f.optionsFor?.(out) ?? f.options ?? []
    if (options.length && !options.some((o) => o.value === out[f.name])) out[f.name] = options[0].value
  }
  return out
}

function toBody(fields: Field[], values: Values) {
  return Object.fromEntries(fields.map((f) => [f.name, f.type === 'number' ? Number(values[f.name]) : values[f.name]]))
}

interface Props {
  fields: Field[]
  initial: Values
  submitLabel: string
  readOnly?: boolean
  onSubmit: (body: Record<string, unknown>) => Promise<void>
  onCancel?: () => void
}

export default function FieldsForm({ fields, initial, submitLabel, readOnly, onSubmit, onCancel }: Props) {
  const [values, setValues] = useState(initial)
  const uid = useId()
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const set = (name: string, v: string | boolean) => setValues((s) => ({ ...s, [name]: v }))

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await onSubmit(toBody(fields, effective(fields, values)))
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const shown = effective(fields, values)
  return (
    <form className="form" onSubmit={(e) => void submit(e)}>
      <fieldset className="form__grid" disabled={readOnly || busy}>
        {fields.map((f) => (
          <label key={f.name} htmlFor={`${uid}-${f.name}`} className={f.type === 'checkbox' ? 'field field--check' : 'field'}>
            {f.type === 'checkbox' ? (
              <input id={`${uid}-${f.name}`} type="checkbox" checked={values[f.name] as boolean} onChange={(e) => set(f.name, e.target.checked)} />
            ) : (
              <span className="field__label">{f.label}{f.required && ' *'}</span>
            )}
            {f.type === 'checkbox' && <span>{f.label}</span>}
            {f.type === 'select' && (
              <select id={`${uid}-${f.name}`} className="input" value={shown[f.name] as string} required={f.required} onChange={(e) => set(f.name, e.target.value)}>
                {(f.optionsFor?.(shown) ?? f.options)?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            )}
            {f.type === 'searchable-select' && (
              <SearchSelect id={`${uid}-${f.name}`} options={f.optionsFor?.(values) ?? f.options ?? []} value={values[f.name] as string} required={f.required} disabled={readOnly || busy} onChange={(v) => set(f.name, v)} />
            )}
            {(!f.type || f.type === 'text' || f.type === 'date' || f.type === 'number') && (
              <input id={`${uid}-${f.name}`} className="input" type={f.type ?? 'text'} value={values[f.name] as string} required={f.required} onChange={(e) => set(f.name, e.target.value)} />
            )}
          </label>
        ))}
      </fieldset>
      <Notify kind="error" message={error} />
      {!readOnly && (
        <div className="actions">
          <button className="button" type="submit" disabled={busy}>{busy ? 'Saving…' : submitLabel}</button>
          {onCancel && <button className="button button--ghost" type="button" onClick={onCancel}>Cancel</button>}
        </div>
      )}
    </form>
  )
}
