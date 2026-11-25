import {
  BookOpen, Building2, FileSearch, Gauge, GitCompare, Lightbulb, Calendar, CalendarCheck, ChartColumn, CircleCheck, CreditCard, FilePlus2, FileText, Flame,
  LayoutGrid, MapPin, Play, ScanText, ScrollText, Settings, ShieldCheck, Sigma, Sparkles, Sun, Table2, Users, type LucideIcon,
} from 'lucide-react'

export interface NavItem { to: string; label: string; icon: LucideIcon; permission?: string }
export interface NavGroup { label: string; items: NavItem[] }

// Menu entries are hidden when the role lacks the permission; the API enforces it regardless.
export const TENANT_NAV: NavGroup[] = [
  { label: 'Workspace', items: [{ to: '/', label: 'Activity Dashboard', icon: LayoutGrid, permission: 'activity.read' }] },
  { label: 'Data Collection', items: [
    { to: '/documents', label: 'Document Centre', icon: ScanText, permission: 'activity.write' },
    { to: '/activities/new', label: 'Manual Data Entry', icon: FilePlus2, permission: 'activity.write' },
    { to: '/activities', label: 'Activity Records', icon: Table2, permission: 'activity.read' },
    { to: '/data-quality', label: 'Data Quality', icon: Gauge, permission: 'quality.read' },
    { to: '/reconciliation', label: 'Reconciliation', icon: GitCompare, permission: 'reconcile.read' },
  ] },
  { label: 'Calculations & Reports', items: [
    { to: '/calculations', label: 'Calculations', icon: Play, permission: 'calc.read' },
    { to: '/analytics', label: 'Analytics', icon: ChartColumn, permission: 'report.read' },
    { to: '/reports', label: 'Reports', icon: FileText, permission: 'report.read' },
    { to: '/carbon-intelligence', label: 'Carbon Intelligence', icon: Lightbulb, permission: 'insight.use' },
    { to: '/renewables', label: 'Renewable Energy', icon: Sun, permission: 'renewables.read' },
    { to: '/emission-factors', label: 'Factors & Fuel Data', icon: BookOpen, permission: 'factor.read' },
  ] },
  { label: 'Workflow & Governance', items: [
    { to: '/review', label: 'Review Queue', icon: CircleCheck, permission: 'activity.review' },
    { to: '/period-close', label: 'Period Close', icon: CalendarCheck, permission: 'period.lock' },
    { to: '/queries', label: 'Verification Queries', icon: ShieldCheck, permission: 'query.read' },
    { to: '/audit-workspace', label: 'Audit Workspace', icon: FileSearch, permission: 'report.read' },
  ] },
  { label: 'Administration', items: [
    { to: '/organization', label: 'Organisation Profile', icon: Building2, permission: 'org.read' },
    { to: '/facilities', label: 'Sites & Facilities', icon: MapPin, permission: 'org.read' },
    { to: '/reporting-periods', label: 'Reporting Periods', icon: Calendar, permission: 'org.read' },
    { to: '/emission-sources', label: 'Emission Sources', icon: Flame, permission: 'org.read' },
    { to: '/users', label: 'Users & Roles', icon: Users, permission: 'users.manage' },
    { to: '/settings', label: 'Tenant Settings', icon: Settings, permission: 'org.manage' },
  ] },
]

export const PLATFORM_NAV: NavGroup[] = [
  { label: 'Platform', items: [
    { to: '/platform', label: 'Dashboard', icon: LayoutGrid },
    { to: '/platform/organizations', label: 'Organisations', icon: Building2 },
    { to: '/platform/subscriptions', label: 'Subscriptions', icon: CreditCard },
    { to: '/platform/users', label: 'Users / Administrators', icon: Users },
  ] },
  { label: 'Reference & Audit', items: [
    { to: '/platform/emission-factors', label: 'Emission Factors', icon: BookOpen },
    { to: '/platform/activity-types', label: 'Formulas & Units', icon: Sigma },
    { to: '/platform/audit', label: 'Audit Trail', icon: ScrollText },
    { to: '/platform/ai', label: 'AI Service', icon: Sparkles },
  ] },
]

// Pages reached from the menu pages but not in the menu themselves.
const EXTRA: Array<{ match: RegExp; trail: string[] }> = [
  { match: /^\/activities\/(?!new$)[^/]+$/, trail: ['Data Collection', 'Activity Records', 'Record'] },
  { match: /^\/platform\/organizations\/[^/]+\/boundary$/, trail: ['Platform', 'Organisations', 'Organisation', 'Boundary Setup'] },
  { match: /^\/platform\/organizations\/[^/]+$/, trail: ['Platform', 'Organisations', 'Organisation'] },
  { match: /^\/platform\/users\/[^/]+$/, trail: ['Platform', 'Users / Administrators', 'User'] },
  { match: /^(\/platform)?\/account$/, trail: ['Account', 'Account Settings'] },
]

const LINKS: Record<string, string> = { 'Activity Records': '/activities', Organisations: '/platform/organizations', 'Users / Administrators': '/platform/users' }

export interface Crumb { label: string; to?: string }

export function breadcrumbs(path: string, groups: NavGroup[]): Crumb[] {
  const extra = EXTRA.find((e) => e.match.test(path))
  if (extra) return extra.trail.map((label, i) => ({ label, to: i < extra.trail.length - 1 ? LINKS[label] : undefined }))
  for (const g of groups) for (const it of g.items) if (it.to === path) return [{ label: g.label }, { label: it.label }]
  return []
}
