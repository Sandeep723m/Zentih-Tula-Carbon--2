import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation, useSearchParams } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { Activity, ArrowDown, ArrowRight, ArrowUp, ArrowUpRight, ArrowUpDown, BadgeCheck, Building2, CalendarDays, ChartColumn, Check, ChevronLeft, ChevronRight, CircleAlert, CircleCheck, Clock3, Download, Eye, FilePenLine, Hash, ListFilter, Plus, Search, Send, Star, X, Zap, type LucideIcon } from 'lucide-react'
import { Skeleton } from '../components/Page'
import { Pager, type Page } from '../components/Pager'
import { Tabs } from '../components/Tabs'
import { apiGet, apiPost } from '../services/apiClient'
import { CATEGORY_LABELS, STATUS_LABELS, type ActivityRecord, type SourceCategory, type ActivityStatus, type Facility, type ReportingPeriod } from '../types/api'
import { Notify } from '../components/Toast'

import { dateRange } from '../services/format'
const Badge = ({ status }: { status: ActivityStatus }) => <span className={`badge badge--${status.toLowerCase()}`}>{STATUS_LABELS[status]}</span>
type DashboardRecord = ActivityRecord & { dashboardEmissions?: string | null }
type QualityRow = { recordId?: string; severity: 'high' | 'medium' | 'low'; title: string }

const pageNumbers = (current: number, last: number): Array<number | 'ellipsis'> => {
  if (last <= 5) return Array.from({ length: last }, (_, index) => index + 1)
  if (current <= 3) return [1, 2, 3, 'ellipsis', last]
  if (current >= last - 2) return [1, 'ellipsis', last - 2, last - 1, last]
  return [1, 'ellipsis', current - 1, current, current + 1, 'ellipsis', last]
}

const DOT_MARK_HEIGHTS = [2, 3, 4, 6, 4, 3, 5, 4, 3, 5, 4, 3, 6, 4, 3, 5]
function DotMark() {
  return <svg className="dashboard-metric__mark" viewBox="0 0 116 52" aria-hidden="true">{DOT_MARK_HEIGHTS.flatMap((height, column) => Array.from({ length: 7 }, (_, row) => <circle key={`${column}-${row}`} cx={4 + column * 7} cy={4 + row * 7} r="1.65" className={row >= 7 - height ? 'is-active' : ''} />))}</svg>
}

function ActivityMetricCard({ tone, icon: Icon, title, value, detail, to }: { tone: string; icon: LucideIcon; title: string; value: number; detail: string; to: string }) {
  return (
    <Link className={`dashboard-metric dashboard-metric--${tone}`} to={to}>
      <div className="dashboard-metric__top">
        <span className="dashboard-metric__icon"><Icon size={15} strokeWidth={2} /></span>
        <span className="dashboard-metric__label">{title}</span>
        <ArrowUpRight className="dashboard-metric__arrow" size={17} />
      </div>
      <div className="dashboard-metric__bottom">
        <div className="dashboard-metric__value-wrap"><strong>{value.toLocaleString()}</strong><span>{detail}</span></div>
        <DotMark />
      </div>
    </Link>
  )
}

function RecordsTable({ rows }: { rows: ActivityRecord[] }) {
  return (
    <div className="table-wrap">
      <table className="table">
        <thead><tr><th>Facility</th><th>Source</th><th>Category</th><th>Period</th><th>Dates</th><th>Quantity</th><th>Status</th><th>By</th><th aria-label="Open" /></tr></thead>
        <tbody>{rows.map((record) => (
          <tr key={record.id}>
            <td>{record.facility.code}</td><td>{record.emissionSource.name}</td>
            <td className="nowrap"><span className="field__hint">{CATEGORY_SHORT[record.emissionSource.category]}</span></td>
            <td className="nowrap">{record.reportingPeriod.name}</td><td className="nowrap">{dateRange(record.startDate, record.endDate)}</td>
            <td className="num">{Number(record.quantity).toLocaleString(undefined, { maximumFractionDigits: 6 })} {record.unit}</td>
            <td><Badge status={record.status} /></td><td className="nowrap">{record.createdBy.name}</td>
            <td className="table__actions"><Link className="link" to={`/activities/${record.id}`}>Details <ArrowRight size={13} className="icon-inline" /></Link></td>
          </tr>
        ))}</tbody>
      </table>
    </div>
  )
}

export function ActivityDashboardPage() {
  const { me } = useAuth()
  const flash = (useLocation().state as { flash?: string } | null)?.flash
  const [params, setParams] = useSearchParams()
  const [data, setData] = useState<(Page<DashboardRecord> & { counts: { status: Partial<Record<ActivityStatus, number>> } }) | null>(null)
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<'updated' | 'activity' | 'quantity'>('updated')
  const [ascending, setAscending] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [qualityRows, setQualityRows] = useState<QualityRow[] | null>(null)
  const [qualityError, setQualityError] = useState(false)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [refreshToken, setRefreshToken] = useState(0)
  const selectAllRef = useRef<HTMLInputElement>(null)
  const canWrite = me?.permissions.includes('activity.write')
  const canSubmit = me?.permissions.includes('activity.submit')
  const canReadQuality = me?.permissions.includes('quality.read') ?? false

  useEffect(() => {
    apiGet<ReportingPeriod[]>('/api/reporting-periods')
      .then((p) => {
        const current = [...p].sort((a, b) => b.startDate.localeCompare(a.startDate)).find((period) => period.status === 'OPEN')
        const imagePeriod = p.find((period) => period.name === 'FY 2024-25')
        const defaultPeriod = imagePeriod ?? current
        const periodInUrl = p.find((period) => period.id === params.get('reportingPeriodId'))
        // Replace the previous implicit current-period default with the requested historical demo dataset.
        const useDemoPeriod = !periodInUrl || periodInUrl.id === current?.id
        if (useDemoPeriod || !params.has('pageSize')) {
          setParams((previous) => {
            const next = new URLSearchParams(previous)
            if (useDemoPeriod && defaultPeriod) next.set('reportingPeriodId', defaultPeriod.id)
            if (!next.has('pageSize')) next.set('pageSize', '12')
            return next
          }, { replace: true })
        }
      })
      .catch((e: Error) => setError(e.message))
  // The initial query parameters are intentionally read only on mount.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const query = params.toString()
  useEffect(() => {
    let live = true
    apiGet<Page<DashboardRecord> & { counts: { status: Partial<Record<ActivityStatus, number>> } }>(`/api/activities${query ? `?${query}` : ''}`)
      .then((result) => { if (live) setData(result) })
      .catch((e: Error) => { if (live) setError(e.message) })
    return () => { live = false }
  }, [query, refreshToken])

  const qualityPeriodId = params.get('reportingPeriodId')
  useEffect(() => {
    if (!qualityPeriodId || !canReadQuality) { setQualityRows(null); return }
    let live = true
    setQualityRows(null)
    setQualityError(false)
    apiGet<{ rows: QualityRow[] }>(`/api/data-quality?reportingPeriodId=${encodeURIComponent(qualityPeriodId)}&state=open`)
      .then((result) => { if (live) setQualityRows(result.rows) })
      .catch(() => { if (live) setQualityError(true) })
    return () => { live = false }
  }, [qualityPeriodId, canReadQuality])

  useEffect(() => { setSelectedIds([]) }, [query])

  const count = (status?: ActivityStatus) => status ? data?.counts.status[status] ?? 0 : data?.total ?? 0
  const totalAcrossStatuses = data ? Object.values(data.counts.status).reduce((sum, value) => sum + (value ?? 0), 0) : 0
  const changeParam = (key: string, value: string) => setParams((previous) => {
    const next = new URLSearchParams(previous)
    if (value) next.set(key, value); else next.delete(key)
    next.delete('page')
    return next
  })
  const rows = useMemo(() => {
    const needle = search.trim().toLowerCase()
    const filtered = (data?.rows ?? []).filter((record) => !needle || [record.id, record.emissionSource.name, record.facility.name, record.facility.code, record.createdBy.name].some((value) => value.toLowerCase().includes(needle)))
    return filtered.sort((a, b) => {
      const delta = sort === 'activity' ? a.emissionSource.name.localeCompare(b.emissionSource.name) : sort === 'quantity' ? Number(a.quantity) - Number(b.quantity) : a.updatedAt.localeCompare(b.updatedAt)
      return ascending ? delta : -delta
    })
  }, [data, search, sort, ascending])

  const selectedRecords = (data?.rows ?? []).filter((record) => selectedIds.includes(record.id))
  const visibleIds = rows.map((record) => record.id)
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedIds.includes(id))
  const someVisibleSelected = visibleIds.some((id) => selectedIds.includes(id))
  useEffect(() => { if (selectAllRef.current) selectAllRef.current.indeterminate = someVisibleSelected && !allVisibleSelected }, [someVisibleSelected, allVisibleSelected])
  const canSubmitSelected = !!canSubmit && selectedRecords.length > 0 && selectedRecords.every((record) =>
    (record.status === 'DRAFT' || record.status === 'RETURNED') && record.reportingPeriod.status === 'OPEN'
    && (record.createdBy.id === me?.user.id || me?.role === 'TENANT_ADMIN'))
  const qualityByRecord = useMemo(() => {
    const grouped = new Map<string, QualityRow[]>()
    for (const finding of qualityRows ?? []) if (finding.recordId) grouped.set(finding.recordId, [...(grouped.get(finding.recordId) ?? []), finding])
    return grouped
  }, [qualityRows])

  const toggleRecord = (id: string) => setSelectedIds((current) => current.includes(id) ? current.filter((selected) => selected !== id) : [...current, id])
  const toggleVisible = () => setSelectedIds((current) => allVisibleSelected
    ? current.filter((id) => !visibleIds.includes(id))
    : [...new Set([...current, ...visibleIds])])
  const exportSelected = () => {
    const csvValue = (value: string | number | null | undefined) => `"${String(value ?? '').replaceAll('"', '""')}"`
    const lines = [
      ['Record ID', 'Activity', 'Facility', 'Reporting period', 'Start date', 'End date', 'Quantity', 'Unit', 'Emissions (tCO2e)', 'Workflow status'],
      ...selectedRecords.map((record) => [record.id, record.emissionSource.name, record.facility.code, record.reportingPeriod.name, record.startDate.slice(0, 10), record.endDate.slice(0, 10), record.quantity, record.unit, record.dashboardEmissions ?? '', STATUS_LABELS[record.status]]),
    ].map((line) => line.map(csvValue).join(','))
    const blobUrl = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' }))
    const anchor = document.createElement('a')
    anchor.href = blobUrl
    anchor.download = 'tula-activity-records.csv'
    anchor.click()
    URL.revokeObjectURL(blobUrl)
  }
  const submitSelected = async () => {
    if (!canSubmitSelected) return
    setSubmitting(true)
    setError(null)
    const result = await Promise.allSettled(selectedRecords.map((record) => apiPost(`/api/activities/${record.id}/submit`)))
    const submitted = result.filter((item) => item.status === 'fulfilled').length
    const failed = result.length - submitted
    setNotice(`${submitted} record${submitted === 1 ? '' : 's'} submitted for review${failed ? `; ${failed} could not be submitted` : ''}.`)
    setSelectedIds([])
    setSubmitting(false)
    if (submitted) setRefreshToken((value) => value + 1)
  }

  const statusTabs: Array<{ key: string; label: string; count?: number; alert?: boolean; icon?: LucideIcon }> = [
    { key: '', label: 'All activity', count: totalAcrossStatuses, icon: Star },
    { key: 'DRAFT', label: 'Draft', count: count('DRAFT'), icon: FilePenLine },
    { key: 'SUBMITTED', label: 'Submitted', count: count('SUBMITTED'), icon: Send },
    { key: 'RETURNED', label: 'Needs attention', count: count('RETURNED'), alert: true, icon: CircleAlert },
    { key: 'APPROVED', label: 'Approved', count: count('APPROVED'), icon: BadgeCheck },
  ]

  return (
    <>
      <header className="dashboard-head">
        <div className="dashboard-head__identity">
          <h1>Activity dashboard</h1>
          <p>{me?.organization?.name} <span aria-hidden="true">·</span> Monitor activity, evidence, and review progress.</p>
        </div>
        <div className="dashboard-head__controls">
          <div className="dashboard-head__actions">
            {me?.permissions.includes('report.read') && <a className="button button--warm" href="https://tula-karbon-ze-d1.vercel.app/" target="_blank" rel="noopener noreferrer"><ChartColumn size={16} /> View analytics</a>}
            {canWrite && <Link className="button" to="/activities/new"><Plus size={16} /> Add activity</Link>}
          </div>
        </div>
      </header>
      <Notify message={flash} />
      <Notify message={notice} />
      <Notify kind="error" message={error} />
      {!data && !error && <Skeleton />}

      {data && (
        <>
          <section className="dashboard-metrics" aria-label="Activity summary">
            <ActivityMetricCard tone="violet" icon={Activity} title="Activity records" value={totalAcrossStatuses} detail="In selected view" to="/activities" />
            <ActivityMetricCard tone="green" icon={CircleCheck} title="Approved records" value={count('APPROVED')} detail="Reviewed and approved" to="/activities?status=APPROVED" />
            <ActivityMetricCard tone="orange" icon={CircleAlert} title="Returned" value={count('RETURNED')} detail="Needs correction" to="/activities?status=RETURNED" />
            <ActivityMetricCard tone="blue" icon={Clock3} title="Pending review" value={count('SUBMITTED')} detail="Submitted for review" to={me?.permissions.includes('activity.review') ? '/review' : '/activities?status=SUBMITTED'} />
          </section>

          <Tabs label="Activity status" active={params.get('status') ?? ''} onChange={(key) => changeParam('status', key)} tabs={statusTabs} />

          <section className="dashboard-ledger" aria-label="Activity data ledger">
            <div className="dashboard-ledger__head">
              <div className="dashboard-ledger__title"><h2>Activity data ledger</h2><p>Review entries, supporting evidence, and workflow status.</p></div>
              <div className="dashboard-ledger__tools">
                <label className="dashboard-search"><Search size={17} /><input value={search} onChange={(event) => { setSearch(event.target.value); setSelectedIds([]) }} placeholder="Search activity records" aria-label="Search activity records" /></label>
                <Link className="button button--ghost dashboard-filter" to="/activities"><ListFilter size={16} /> Filter</Link>
                <div className="dashboard-sort"><ArrowUpDown size={15} /><select aria-label="Sort records" value={sort} onChange={(event) => setSort(event.target.value as typeof sort)}><option value="updated">Last updated</option><option value="activity">Activity name</option><option value="quantity">Quantity</option></select><button type="button" aria-label={ascending ? 'Sort descending' : 'Sort ascending'} onClick={() => setAscending((value) => !value)}>{ascending ? <ArrowUp size={14} /> : <ArrowDown size={14} />}</button></div>
              </div>
            </div>
            <div className="table-wrap dashboard-records-wrap">
              <table className="table dashboard-table">
                <thead><tr>
                  <th className="dashboard-select-col"><input ref={selectAllRef} className="dashboard-row-checkbox" type="checkbox" checked={allVisibleSelected} onChange={toggleVisible} aria-label="Select all visible records" /></th>
                  <th><span className="dashboard-th">Activity</span></th>
                  <th><span className="dashboard-th"><Building2 />Facility</span></th>
                  <th><span className="dashboard-th"><Hash />Quantity</span></th>
                  <th><span className="dashboard-th"><CalendarDays />Date / period</span></th>
                  <th><span className="dashboard-th"><Zap />Category</span></th>
                  <th title="Record status reflects workflow approval; data-quality checks are shown separately."><span className="dashboard-th"><BadgeCheck />Status</span></th>
                  <th><span className="dashboard-th"><CircleAlert />Data quality</span></th>
                  <th><span className="dashboard-th dashboard-th--action">Action</span></th>
                </tr></thead>
                <tbody>{rows.map((record) => {
                  const isSelected = selectedIds.includes(record.id)
                  const findings = qualityByRecord.get(record.id) ?? []
                  const highestSeverity = findings.some((finding) => finding.severity === 'high') ? 'high' : findings.some((finding) => finding.severity === 'medium') ? 'medium' : 'low'
                  return (
                    <tr key={record.id} className={isSelected ? 'is-selected' : ''}>
                      <td className="dashboard-select-col"><input className="dashboard-row-checkbox" type="checkbox" checked={isSelected} onChange={() => toggleRecord(record.id)} aria-label={`Select ${record.emissionSource.name} at ${record.facility.code}`} /></td>
                      <td className="dashboard-record-cell"><span className="dashboard-record-name" title={record.emissionSource.name}>{record.emissionSource.name}</span><Link className="dashboard-record-id" to={`/activities/${record.id}`} title={`Open activity ${record.id}`}>ACT-…{record.id.slice(-4).toUpperCase()}</Link></td>
                      <td><strong title={record.facility.name}>{record.facility.code}</strong></td>
                      <td className="dashboard-quantity">{Number(record.quantity).toLocaleString(undefined, { maximumFractionDigits: 6 })} <span>{record.unit}</span></td>
                      <td className="dashboard-date-period" title={`${record.reportingPeriod.name}: ${dateRange(record.startDate, record.endDate)}`}><strong>{record.reportingPeriod.name}</strong><span>{dateRange(record.startDate, record.endDate)}</span></td>
                      <td><span className="dashboard-category">{CATEGORY_SHORT[record.emissionSource.category]}</span></td>
                      <td title="Record status reflects workflow approval; data-quality checks are shown separately."><Badge status={record.status} /></td>
                      <td>{qualityRows === null ? <span className="dashboard-quality-muted">{!canReadQuality || qualityError ? 'Unavailable' : 'Checking'}</span> : findings.length ? <span className={`dashboard-quality dashboard-quality--${highestSeverity}`} title={findings.map((finding) => finding.title).join('; ')}>{highestSeverity[0]!.toUpperCase() + highestSeverity.slice(1)} · {findings.length}</span> : <span className="dashboard-quality-clear"><Check size={14} />No flagged issues</span>}</td>
                      <td className="table__actions"><Link className="dashboard-row-action" to={`/activities/${record.id}`} aria-label={`View details for ${record.emissionSource.name} at ${record.facility.code}`} title="View activity details"><Eye size={18} /></Link></td>
                    </tr>
                  )
                })}{!rows.length && <tr><td className="dashboard-empty" colSpan={9}>{search ? 'No records match this search on the current page.' : 'No activity records match these filters.'}</td></tr>}</tbody>
              </table>
            </div>
            {selectedRecords.length > 0 && <div className="dashboard-bulk-toolbar" role="toolbar" aria-label="Selected activity actions">
              <span className="dashboard-bulk-count">{selectedRecords.length} selected</span>
              {canSubmitSelected && <button className="button button--small" type="button" disabled={submitting} onClick={() => void submitSelected()}>{submitting ? 'Submitting…' : <><Check size={15} />Submit for review</>}</button>}
              <button className="button button--ghost button--small" type="button" onClick={exportSelected}><Download size={15} />Export CSV</button>
              <button className="dashboard-bulk-clear" type="button" onClick={() => setSelectedIds([])} aria-label="Clear selection" title="Clear selection"><X size={17} /></button>
            </div>}
            <div className="dashboard-ledger__foot">
              <span className="dashboard-ledger__range">Showing {data.total ? ((data.page - 1) * data.pageSize + 1).toLocaleString() : 0}–{Math.min(data.page * data.pageSize, data.total).toLocaleString()} of {data.total.toLocaleString()} records</span>
              <div className="dashboard-ledger__pagination">
                <label className="dashboard-ledger__page-size">Rows per page
                  <select aria-label="Rows per page" value={data.pageSize} onChange={(event) => changeParam('pageSize', event.target.value)}>
                    {[12, 24, 50].map((size) => <option key={size} value={size}>{size}</option>)}
                  </select>
                </label>
                <button className="dashboard-page-button" type="button" aria-label="Previous page" disabled={data.page <= 1} onClick={() => changeParam('page', String(data.page - 1))}><ChevronLeft size={16} /></button>
                {pageNumbers(data.page, Math.max(1, Math.ceil(data.total / data.pageSize))).map((page, index) => page === 'ellipsis'
                  ? <span className="dashboard-page-ellipsis" key={`ellipsis-${index}`}>…</span>
                  : <button className={`dashboard-page-button${page === data.page ? ' is-active' : ''}`} type="button" key={page} aria-label={`Page ${page}`} aria-current={page === data.page ? 'page' : undefined} onClick={() => changeParam('page', String(page))}>{page}</button>)}
                <button className="dashboard-page-button" type="button" aria-label="Next page" disabled={data.page >= Math.ceil(data.total / data.pageSize)} onClick={() => changeParam('page', String(data.page + 1))}><ChevronRight size={16} /></button>
              </div>
            </div>
          </section>
        </>
      )}
    </>
  )
}

// The reviewer's queue is the record list fixed to submitted records, oldest first to review.
const STATUS_TABS: Array<[ActivityStatus, string, boolean]> = [['DRAFT', 'Drafts', false], ['SUBMITTED', 'Awaiting review', true], ['RETURNED', 'Returned', true], ['APPROVED', 'Approved', false]]
const CATEGORY_SHORT: Record<SourceCategory, string> = {
  PURCHASED_ELECTRICITY: 'Electricity', FUEL_COMBUSTION: 'Fuels', FUGITIVE_GAS: 'Refrigerants', PURCHASED_ENERGY: 'Steam / heat / cooling', PROCESS: 'Process', REMOVAL: 'Removals',
}

export function ReviewQueuePage() {
  const { me } = useAuth()
  if (!me?.permissions.includes('activity.review')) return <p className="status">The review queue is for reviewers. You do not have permission to review records.</p>
  return <ActivitiesPage queue />
}

export function ActivitiesPage({ queue = false }: { queue?: boolean }) {
  const { me } = useAuth()
  const flash = (useLocation().state as { flash?: string } | null)?.flash
  const [params, setParams] = useSearchParams()
  const [data, setData] = useState<(Page<ActivityRecord> & { counts: { status: Partial<Record<ActivityStatus, number>>; category: Partial<Record<SourceCategory, number>> } }) | null>(null)
  const [facilities, setFacilities] = useState<Facility[]>([])
  const [periods, setPeriods] = useState<ReportingPeriod[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    Promise.all([apiGet<Facility[]>('/api/facilities'), apiGet<ReportingPeriod[]>('/api/reporting-periods')])
      .then(([f, p]) => { setFacilities(f); setPeriods(p) })
      .catch((e: Error) => setError(e.message))
  }, [])

  const query = queue ? new URLSearchParams({ ...Object.fromEntries(params), status: 'SUBMITTED' }).toString() : params.toString()
  const [loadedQuery, setLoadedQuery] = useState<string | null>(null)
  const loading = loadedQuery !== query
  useEffect(() => {
    apiGet<NonNullable<typeof data>>(`/api/activities${query ? `?${query}` : ''}`)
      .then((d) => { setData(d); setLoadedQuery(query) })
      .catch((e: Error) => setError(e.message))
  }, [query])

  const filter = (name: string, value: string) => {
    const next = new URLSearchParams(params)
    if (value) next.set(name, value)
    else next.delete(name)
    if (name !== 'page') next.delete('page') // new filter → back to page 1
    setParams(next)
  }

  return (
    <>
      <header className="page__header page__header--row">
        <div>
          <h1 className="page__title">{queue ? 'Review Queue' : 'Activity Records'}</h1>
          <p className="page__subtitle">{queue ? 'Submitted records waiting for approval. Open one to see its evidence and calculation preview, then approve or return it.' : `All activity data for ${me?.organization?.name}.`}</p>
        </div>
        {!queue && me?.permissions.includes('activity.write') && <Link className="button" to="/activities/new">New activity record</Link>}
      </header>
      <Notify message={flash} />
      {!queue && (
        <Tabs
          label="Status"
          active={params.get('status') ?? ''}
          onChange={(k) => filter('status', k)}
          tabs={[
            { key: '', label: 'All', count: data ? Object.values(data.counts.status).reduce((a, b) => a + (b ?? 0), 0) : undefined },
            ...STATUS_TABS.map(([st, label, alert]) => ({ key: st, label, count: data ? data.counts.status[st] ?? 0 : undefined, alert })),
          ]}
        />
      )}
      <Tabs
        small
        label="Category"
        active={params.get('category') ?? ''}
        onChange={(k) => filter('category', k)}
        tabs={[
          { key: '', label: 'All categories' },
          ...(Object.keys(CATEGORY_LABELS) as SourceCategory[])
            .filter((c) => !data || (data.counts.category[c] ?? 0) > 0 || params.get('category') === c)
            .map((c) => ({ key: c, label: CATEGORY_SHORT[c], count: data?.counts.category[c] ?? 0 })),
        ]}
      />
      <div className="filters">

        <select className="input" aria-label="Facility" value={params.get('facilityId') ?? ''} onChange={(e) => filter('facilityId', e.target.value)}>
          <option value="">All facilities</option>
          {facilities.map((f) => <option key={f.id} value={f.id}>{f.code} — {f.name}</option>)}
        </select>
        <select className="input" aria-label="Reporting period" value={params.get('reportingPeriodId') ?? ''} onChange={(e) => filter('reportingPeriodId', e.target.value)}>
          <option value="">All periods</option>
          {periods.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </div>
      <section className={`card ${loading && data ? 'is-loading' : ''}`} aria-busy={loading}>
        <Notify kind="error" message={error} />
        {!data && !error && <Skeleton />}
        {data?.total === 0 && <p className="status">{queue ? 'Nothing waiting for review.' : 'No records match.'}</p>}
        {!!data?.rows.length && <RecordsTable rows={data.rows} />}
        {data && <Pager data={data} onPage={(p) => filter('page', String(p))} />}
      </section>
    </>
  )
}

// What this person should do now, in the order the process runs: enter → review → calculate → lock → verify.
