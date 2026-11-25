import { useLayoutEffect, useRef, useState } from 'react'
import type { LucideIcon } from 'lucide-react'
import { fadeAfter } from './motion'

// A row of tabs with counts. Keys live in the URL (the caller's onChange), so a tab can be linked and kept on reload.
export interface Tab { key: string; label: string; count?: number; alert?: boolean; icon?: LucideIcon }

export function Tabs({ tabs, active, onChange, label, small = false }: { tabs: Tab[]; active: string; onChange: (key: string) => void; label: string; small?: boolean }) {
  const row = useRef<HTMLDivElement>(null)
  const [bar, setBar] = useState<{ left: number; width: number } | null>(null)

  // The underline slides to the selected tab (and follows it when counts change its width).
  useLayoutEffect(() => {
    const el = row.current?.querySelector<HTMLElement>('[aria-selected="true"]')
    const next = el ? { left: el.offsetLeft, width: el.offsetWidth } : null
    setBar((b) => (b?.left === next?.left && b?.width === next?.width ? b : next))
  })

  return (
    <div ref={row} className={`tabs ${small ? 'tabs--small' : ''}`} role="tablist" aria-label={label}>
      {tabs.map((t) => (
        <button
          key={t.key}
          type="button"
          role="tab"
          aria-selected={t.key === active}
          className={`tab ${t.key === active ? 'tab--active' : ''}`}
          onClick={() => { if (t.key !== active) { onChange(t.key); fadeAfter(row.current) } }}
        >
          {t.icon && <t.icon className="tab__icon" size={16} aria-hidden="true" />}
          {t.label}
          {t.count != null && <span className={`tab__count ${t.alert && t.count > 0 ? 'tab__count--alert' : ''}`}>{t.count.toLocaleString()}</span>}
        </button>
      ))}
      {!small && bar && <span className="tabs__indicator" style={{ transform: `translateX(${bar.left}px)`, width: bar.width }} aria-hidden="true" />}
    </div>
  )
}
