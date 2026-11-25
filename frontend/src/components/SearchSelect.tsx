import { useEffect, useRef, useState } from 'react'

interface Option { value: string; label: string }

interface Props {
  options: Option[]
  value: string
  onChange: (v: string) => void
  required?: boolean
  disabled?: boolean
  id?: string
}

// Groups options by the prefix before the first ': ' in the label.
function group(options: Option[]): Array<{ label: string; options: Option[] }> {
  const map = new Map<string, Option[]>()
  for (const o of options) {
    const colon = o.label.indexOf(': ')
    const g = colon > 0 ? o.label.slice(0, colon) : ''
    ;(map.get(g) ?? (map.set(g, []), map.get(g)!)).push({ ...o, label: colon > 0 ? o.label.slice(colon + 2) : o.label })
  }
  return Array.from(map.entries()).map(([label, opts]) => ({ label, options: opts }))
}

export default function SearchSelect({ options, value, onChange, required, disabled, id }: Props) {
  const selected = options.find((o) => o.value === value)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [cursor, setCursor] = useState(0)
  const root = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLUListElement>(null)

  const needle = query.toLowerCase()
  const filtered = needle
    ? options.filter((o) => o.label.toLowerCase().includes(needle))
    : options

  // Re-group only the filtered list
  const groups = group(filtered)
  const flat = groups.flatMap((g) => g.options) // flat index for keyboard nav

  useEffect(() => {
    if (!open) { setQuery(''); setCursor(0) }
  }, [open])

  // Close on outside click
  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  // Scroll active item into view
  useEffect(() => {
    if (!open) return
    listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [cursor, open])

  const pick = (val: string) => { onChange(val); setOpen(false) }

  const onKey = (e: React.KeyboardEvent) => {
    if (!open) { if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') { e.preventDefault(); setOpen(true) } return }
    if (e.key === 'Escape') { e.preventDefault(); setOpen(false) }
    else if (e.key === 'ArrowDown') { e.preventDefault(); setCursor((c) => Math.min(c + 1, flat.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setCursor((c) => Math.max(c - 1, 0)) }
    else if (e.key === 'Enter') { e.preventDefault(); if (flat[cursor]) pick(flat[cursor].value) }
  }

  // Flat index tracker across groups
  let idx = -1

  return (
    <div className="ss" ref={root} onKeyDown={onKey}>
      <input
        id={id}
        ref={input}
        className="input ss__input"
        value={open ? query : (selected ? selected.label : '')}
        placeholder={open ? 'Type to search…' : selected ? '' : '(not chosen)'}
        readOnly={!open}
        required={required}
        disabled={disabled}
        aria-expanded={open}
        aria-autocomplete="list"
        role="combobox"
        onClick={() => { if (!disabled) { setOpen(true); setTimeout(() => input.current?.select(), 0) } }}
        onFocus={() => { if (!disabled) setOpen(true) }}
        onChange={(e) => { setQuery(e.target.value); setCursor(0) }}
      />
      <span className="ss__arrow" aria-hidden>▾</span>
      {open && (
        <ul className="ss__list" ref={listRef} role="listbox">
          {filtered.length === 0 && <li className="ss__empty">No matches</li>}
          {groups.map((g) => (
            <li key={g.label} className="ss__group">
              {g.label && <div className="ss__group-label">{g.label}</div>}
              <ul>
                {g.options.map((o) => {
                  idx++
                  const i = idx
                  const active = cursor === i
                  return (
                    <li key={o.value} role="option" aria-selected={o.value === value} data-active={active}
                      className={`ss__opt${o.value === value ? ' ss__opt--selected' : ''}${active ? ' ss__opt--active' : ''}`}
                      onMouseEnter={() => setCursor(i)}
                      onMouseDown={(e) => { e.preventDefault(); pick(o.value) }}>
                      {o.label}
                    </li>
                  )
                })}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
