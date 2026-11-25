import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import FieldsForm, { toValues, type Field } from '../components/FieldsForm'
import ResourcePage from '../components/ResourcePage'
import { apiGet, apiPatch } from '../services/apiClient'
import { CATEGORY_LABELS, type ActivityTypeRef, type EmissionSource, type Facility, type Organization, type ReportingPeriod, type SourceCategory } from '../types/api'
import { useLoad } from '../hooks/useLoad'
import { Skeleton } from '../components/Page'
import { Notify } from '../components/Toast'

const useCan = (permission: string) => useAuth().me?.permissions.includes(permission) ?? false
const yesNo = (b: boolean) => (b ? 'Active' : 'Inactive')

export function FacilitiesPage() {
  return (
    <ResourcePage<Facility>
      title="Sites & Facilities"
      singular="facility"
      subtitle="Physical sites whose activity data is reported."
      endpoint="/api/facilities"
      canWrite={useCan('facility.manage')}
      emptyText="No facilities yet."
      fields={[
        { name: 'name', label: 'Name', required: true },
        { name: 'code', label: 'Code', required: true },
        { name: 'country', label: 'Country' },
        { name: 'city', label: 'City' },
        { name: 'address', label: 'Address' },
        { name: 'isActive', label: 'Active', type: 'checkbox' },
      ]}
      columns={[
        { label: 'Code', render: (f) => f.code },
        { label: 'Name', render: (f) => f.name },
        { label: 'Location', render: (f) => [f.city, f.country].filter(Boolean).join(', ') || '—' },
        { label: 'Status', render: (f) => yesNo(f.isActive) },
      ]}
    />
  )
}

export function ReportingPeriodsPage() {
  const canClose = useCan('period.lock')
  return (
    <ResourcePage<ReportingPeriod>
      title="Reporting Periods"
      singular="reporting period"
      subtitle="The reporting years your data and reports belong to."
      endpoint="/api/reporting-periods"
      canWrite={useCan('period.manage')}
      emptyText="No reporting periods yet."
      fields={[
        { name: 'name', label: 'Name', required: true },
        { name: 'startDate', label: 'Start date', type: 'date', required: true },
        { name: 'endDate', label: 'End date (inclusive)', type: 'date', required: true },
      ]}
      columns={[
        { label: 'Name', render: (p) => p.name },
        { label: 'From', render: (p) => p.startDate.slice(0, 10) },
        { label: 'To', render: (p) => p.endDate.slice(0, 10) },
        { label: 'Status', render: (p) => (p.status === 'LOCKED' ? 'Locked' : 'Open') },
        ...(canClose ? [{ label: 'Close', render: (p: ReportingPeriod) => <Link className="link" to={`/period-close?period=${p.id}`}>{p.status === 'LOCKED' ? 'Lock history' : 'Checklist & lock'}</Link> }] : []),
      ]}
    />
  )
}

export function EmissionSourcesPage() {
  const canWrite = useCan('source.manage')
  const [facilities, setFacilities] = useState<Facility[] | null>(null)
  const types = useLoad<ActivityTypeRef[]>('/api/reference/activity-types').data
  useEffect(() => { void apiGet<Facility[]>('/api/facilities').then(setFacilities) }, [])
  if (!facilities || !types) return <Skeleton />
  // Fuels, gases and grids the engine calculates, labelled with their category; the server checks the pairing.
  const calculable = types.filter((t) => t.calculable && t.sourceCategory)
  if (canWrite && facilities.length === 0) return (
    <section className="card">
      <p className="status">Add a facility first. Every emission source belongs to one.</p>
      <Link className="button" to="/facilities">Go to Sites &amp; Facilities</Link>
    </section>
  )

  return (
    <ResourcePage<EmissionSource>
      title="Emission Sources"
      singular="emission source"
      subtitle="What produces emissions at each facility."
      endpoint="/api/emission-sources"
      groups={[
        ...(Object.keys(CATEGORY_LABELS) as SourceCategory[]).map((c) => ({ key: c, label: CATEGORY_LABELS[c], match: (s: EmissionSource) => s.category === c })),
        { key: 'unresolved', label: 'Needs a fuel or gas', match: (s: EmissionSource) => !s.activityCode && (s.category === 'FUEL_COMBUSTION' || s.category === 'FUGITIVE_GAS' || s.category === 'PROCESS') },
      ]}
      canWrite={canWrite}
      emptyText="No emission sources yet."
      fields={[
        { name: 'facilityId', label: 'Facility', type: 'select', required: true, options: facilities.map((f) => ({ value: f.id, label: `${f.code} — ${f.name}` })) },
        { name: 'name', label: 'Name', required: true },
        { name: 'category', label: 'Category', type: 'select', required: true, options: Object.entries(CATEGORY_LABELS).map(([value, label]) => ({ value, label })) },
        {
          name: 'activityCode', label: 'Fuel, gas or type', type: 'searchable-select',
          options: [{ value: '', label: '(choose one)' }, ...calculable.map((t) => ({ value: t.code, label: `${CATEGORY_LABELS[t.sourceCategory!]}: ${t.name}` }))],
          optionsFor: (v) => [{ value: '', label: '(choose one)' }, ...calculable.filter((t) => !v.category || t.sourceCategory === v.category).map((t) => ({ value: t.code, label: `${CATEGORY_LABELS[t.sourceCategory!]}: ${t.name}` }))],
        },
        { name: 'material', label: 'Description (e.g. HSD from IOCL)' },
        { name: 'defaultUnit', label: 'Default unit (e.g. L, kg, kWh)' },
        { name: 'isActive', label: 'Active', type: 'checkbox' },
      ]}
      columns={[
        { label: 'Facility', render: (s) => s.facility.code },
        { label: 'Name', render: (s) => s.name },
        { label: 'Category', render: (s) => CATEGORY_LABELS[s.category as SourceCategory] },
        { label: 'Scope', render: (s) => s.scope },
        { label: "Fuel, gas or type", render: (s) => s.activityType ? s.activityType.name
          : s.category === 'PURCHASED_ELECTRICITY' ? 'Grid electricity (default)'
          : s.category === 'PURCHASED_ENERGY' ? <span className="field__hint">Not calculated yet</span>
          : <span className="badge badge--returned" title="Edit the source and choose the fuel or gas">Choose the fuel or gas</span> },
        { label: 'Description', render: (s) => s.material ?? '—' },
        { label: 'Unit', render: (s) => s.defaultUnit ?? '—' },
        { label: 'Status', render: (s) => yesNo(s.isActive) },
      ]}
    />
  )
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

// Organization Profile and Tenant Settings: one record, different fields and endpoints.
function OrganizationForm({ title, subtitle, endpoint, fields }: { title: string; subtitle: string; endpoint: string; fields: Field[] }) {
  const { refresh } = useAuth()
  const canWrite = useCan('org.manage')
  const [org, setOrg] = useState<Organization | null>(null)
  const [saved, setSaved] = useState(false)
  useEffect(() => { void apiGet<Organization>('/api/organizations/current').then(setOrg) }, [])

  const save = async (body: Record<string, unknown>) => {
    for (const k of ['fiscalYearStartMonth', 'qualityAnomalyPercent', 'qualityMinHistory']) if (k in body) body[k] = Number(body[k])
    setOrg(await apiPatch<Organization>(endpoint, body))
    setSaved(true)
    await refresh() // organisation name is shown in the menu
  }

  return (
    <>
      <header className="page__header">
        <h1 className="page__title">{title}</h1>
        <p className="page__subtitle">{subtitle}</p>
      </header>
      <section className="card">
        {!org ? <Skeleton /> : (
          <FieldsForm fields={fields} initial={toValues(fields, org as unknown as Record<string, unknown>)} submitLabel="Save" readOnly={!canWrite} onSubmit={save} />
        )}
        <Notify message={saved && 'Saved.'} />
      </section>
    </>
  )
}

export function OrganizationProfilePage() {
  return (
    <OrganizationForm
      title="Organisation Profile"
      subtitle="Legal and contact details of this organisation."
      endpoint="/api/organizations/current"
      fields={[
        { name: 'name', label: 'Display name', required: true },
        { name: 'legalName', label: 'Legal name' },
        { name: 'country', label: 'Country' },
        { name: 'industry', label: 'Industry' },
        { name: 'address', label: 'Registered address' },
      ]}
    />
  )
}

export function TenantSettingsPage() {
  return (
    <OrganizationForm
      title="Tenant Settings"
      subtitle="Organisation-wide preferences."
      endpoint="/api/organizations/current/settings"
      fields={[
        { name: 'timezone', label: 'Time zone (e.g. Asia/Kolkata)', required: true },
        { name: 'fiscalYearStartMonth', label: 'Fiscal year starts in', type: 'select', options: MONTHS.map((m, i) => ({ value: String(i + 1), label: m })) },
        { name: 'requireEvidenceOnSubmit', label: 'Require supporting evidence before activity data can be submitted', type: 'checkbox' },
        { name: 'qualityAnomalyPercent', label: 'Flag a month that differs from usual by at least (%)', type: 'number' },
        { name: 'qualityMinHistory', label: 'Months of history needed before comparing', type: 'number' },
      ]}
    />
  )
}
