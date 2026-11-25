import { useEffect, useState } from 'react'
import { apiGet } from '../services/apiClient'

interface Option { id: string; name: string }

// Search-as-you-type organisation selector: asks the server for matches (first page only),
// so it works the same with 10 or 10,000 organisations.
export default function OrgPicker({ value, onChange }: { value: Option | null; onChange: (org: Option | null) => void }) {
  const [text, setText] = useState('')
  const [options, setOptions] = useState<Option[]>([])
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!open) return
    const t = setTimeout(() => {
      apiGet<{ rows: Option[] }>(`/api/platform/organizations?q=${encodeURIComponent(text.trim())}`)
        .then((r) => setOptions(r.rows))
        .catch(() => setOptions([]))
    }, 250) // wait for a pause in typing
    return () => clearTimeout(t)
  }, [text, open])

  if (value) {
    return (
      <span className="picked">
        <strong>{value.name}</strong>
        <button type="button" className="button button--ghost button--small" onClick={() => { onChange(null); setText('') }}>Change</button>
      </span>
    )
  }
  return (
    <span className="picker">
      <input
        className="input"
        type="search"
        placeholder="Type to find an organisation…"
        aria-label="Organisation"
        value={text}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)} // let a click on an option land first
        onChange={(e) => { setText(e.target.value); setOpen(true) }}
      />
      {open && (
        <ul className="picker__list" role="listbox">
          {options.length === 0 && <li className="picker__empty">No organisations match.</li>}
          {options.map((o) => (
            <li key={o.id} role="option" aria-selected="false">
              <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => { onChange({ id: o.id, name: o.name }); setOpen(false) }}>{o.name}</button>
            </li>
          ))}
        </ul>
      )}
    </span>
  )
}
