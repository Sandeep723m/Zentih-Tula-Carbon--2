import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Link, NavLink, useLocation } from 'react-router-dom'
import { ChevronDown, ChevronRight, LogOut, Menu, PanelLeftClose, PanelLeftOpen, Repeat, Search, UserCog } from 'lucide-react'
import { breadcrumbs, type NavGroup } from './nav'
import { ErrorBoundary } from './ErrorBoundary'
import { introShell, revealIn } from './motion'

interface Props {
  groups: NavGroup[]
  home: string
  context?: ReactNode
  counts?: Record<string, number> // items waiting, shown beside a menu entry
  user: { name: string; email: string; role: string }
  accountTo: string
  onSwitchOrg?: boolean
  onLogout: () => void
  children: ReactNode
}

const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('')

export function Shell({ groups, home, context, counts, user, accountTo, onSwitchOrg, onLogout, children }: Props) {
  const { pathname } = useLocation()
  const [q, setQ] = useState('')
  const [navOpen, setNavOpen] = useState(false)
  const [collapsed, setCollapsed] = useState(false)
  const search = useRef<HTMLInputElement>(null)
  const menu = useRef<HTMLDetailsElement>(null)
  const appRef = useRef<HTMLDivElement>(null)
  const mainRef = useRef<HTMLElement>(null)
  useEffect(() => introShell(appRef.current), [])
  useEffect(() => revealIn(mainRef.current), [pathname])
  useEffect(() => {
    document.querySelector<HTMLElement>('.sidebar .nav-link.active')?.scrollIntoView({ block: 'nearest' })
  }, [pathname, groups])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        if (collapsed) { setCollapsed(false); requestAnimationFrame(() => search.current?.focus()) }
        else search.current?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [collapsed])
  const closeMenus = () => { setNavOpen(false); if (menu.current) menu.current.open = false }

  const term = q.trim().toLowerCase()
  const shown = groups.map((g) => ({ ...g, items: g.items.filter((i) => !term || i.label.toLowerCase().includes(term)) })).filter((g) => g.items.length)
  const crumbs = breadcrumbs(pathname, groups)

  return (
    <div className={`app${collapsed ? ' app--sidebar-collapsed' : ''}`} ref={appRef}>
      <header className="topbar">
        <button className="topbar__menu" aria-label="Open menu" aria-expanded={navOpen} onClick={() => setNavOpen((o) => !o)}><Menu size={20} /></button>
        <Link to={home} className="topbar__brand" aria-label="Tula Carbon home"><img src="/Assets/Logos/Tula%20Carbon%20Dot%20Grid%20Logo.png" alt="Tula Carbon" /></Link>
        <div className="topbar__context">{context}</div>
        <details className="usermenu" ref={menu}>
          <summary className="pill pill--user">
            <span className="avatar">{initials(user.name)}</span>
            <span className="usermenu__name">{user.name}</span>
            <ChevronDown size={14} />
          </summary>
          <div className="usermenu__panel" onClick={closeMenus}>
            <div className="usermenu__who"><strong>{user.name}</strong><span>{user.email}</span><span className="badge badge--soft">{user.role}</span></div>
            <Link className="usermenu__item" to={accountTo}><UserCog size={16} /> Account settings</Link>
            {onSwitchOrg && <Link className="usermenu__item" to="/organizations"><Repeat size={16} /> Switch organisation</Link>}
            <button className="usermenu__item usermenu__item--danger" onClick={onLogout}><LogOut size={16} /> Sign out</button>
          </div>
        </details>
      </header>

      <aside className={`sidebar${navOpen ? ' sidebar--open' : ''}${collapsed ? ' sidebar--collapsed' : ''}`}>
        <div className="sidebar__top">
          <button className="sidebar__collapse" type="button" aria-label={collapsed ? 'Expand sidebar navigation' : 'Collapse sidebar navigation'} aria-expanded={!collapsed} onClick={() => { setQ(''); setCollapsed((value) => !value) }}>
            {collapsed ? <PanelLeftOpen size={19} /> : <PanelLeftClose size={19} />}
          </button>
          <label className="sidebar__search">
            <Search size={16} />
            <input ref={search} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search menu…" aria-label="Search menu" />
            <kbd>⌘K</kbd>
          </label>
          <button className="sidebar__search-trigger" type="button" aria-label="Search menu" title="Search menu" onClick={() => { setCollapsed(false); requestAnimationFrame(() => search.current?.focus()) }}><Search size={19} /></button>
        </div>
        <nav aria-label="Primary navigation">
          {shown.map((g) => (
            <div key={g.label} className="sidebar__group">
              <p className="sidebar__label">{g.label}</p>
              {g.items.map(({ to, label, icon: Icon }) => (
                <NavLink key={to} to={to} end={to === '/' || to === '/activities/new'} className="nav-link" title={collapsed ? label : undefined} aria-label={collapsed ? label : undefined} onClick={closeMenus}>
                  <Icon size={19} strokeWidth={1.85} /> <span className="nav-link__label">{label}</span>
                  {!!counts?.[to] && <span className="nav-link__count" aria-label={`${counts[to]} waiting`}>{counts[to]}</span>}
                </NavLink>
              ))}
            </div>
          ))}
          {!shown.length && <p className="sidebar__empty">No menu item matches “{q}”.</p>}
        </nav>
      </aside>
      {navOpen && <div className="sidebar__scrim" onClick={() => setNavOpen(false)} />}

      <main className="main" ref={mainRef}>
        {crumbs.length > 0 && (
          <nav className="crumbs" aria-label="Breadcrumb">
            {crumbs.map((c, i) => (
              <span key={c.label + i} className="crumbs__item">
                {i > 0 && <ChevronRight size={13} />}
                {c.to ? <Link to={c.to}>{c.label}</Link> : <span aria-current={i === crumbs.length - 1 ? 'page' : undefined}>{c.label}</span>}
              </span>
            ))}
          </nav>
        )}
        <ErrorBoundary resetKey={pathname}>{children}</ErrorBoundary>
      </main>
    </div>
  )
}
