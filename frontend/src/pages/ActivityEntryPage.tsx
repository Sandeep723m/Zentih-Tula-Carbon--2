import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { useDialog } from '../components/Dialog'
import { ApiError, apiDelete, apiGet, apiPatch, apiPost, apiUpload, evidenceUrl } from '../services/apiClient'
import {
  CATEGORY_LABELS, EVIDENCE_EXTENSIONS, LINE_LABELS, MAX_EVIDENCE_BYTES, STATUS_LABELS,
  type ActivityRecord, type ActivityTypeRef, type SourceCategory, type UnitRef, type EmissionSource, type Facility, type Organization, type ReportingPeriod,
} from '../types/api'
import { appliedValues, isoDay, humanize, recordT, factorLabel } from '../services/format'
import { ResultStatus } from '../components/CalcResultStatus'
import { ScanText } from 'lucide-react'
import { useLoad } from '../hooks/useLoad'
import type { DocumentPrefill } from './DocumentsPage'
import { Skeleton } from '../components/Page'
import { Notify } from '../components/Toast'

type Values = Record<'facilityId' | 'reportingPeriodId' | 'emissionSourceId' | 'startDate' | 'endDate' | 'quantity' | 'unit' | 'notes', string>
const EMPTY: Values = { facilityId: '', reportingPeriodId: '', emissionSourceId: '', startDate: '', endDate: '', quantity: '', unit: '', notes: '' }
const day = (iso: string) => iso.slice(0, 10)
const formatSize = (n: number) => (n < 1024 * 1024 ? `${Math.ceil(n / 1024)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`)

// Same rules as the server (activities.controller.ts); the server re-checks everything.
// The one active facility whose name or code is written in the site text as whole words, else none.
function facilityFromSite(site: string, list: Facility[]) {
  const words = (s: string) => ` ${s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()} `
  const hits = list.filter((f) => f.isActive && (words(site).includes(words(f.name)) || words(site).includes(words(f.code))))
  return hits.length === 1 ? hits[0].id : ''
}

// Values from a read document: the facility named on it, else the one this supplier's last bill used, and that bill's source.
function prefillValues(prefill: DocumentPrefill | undefined, facilities: Facility[], sources: EmissionSource[]): Values {
  const fromSite = prefill?.site ? facilityFromSite(prefill.site, facilities) : ''
  const hint = prefill?.suggestion
  const facilityId = fromSite || (hint && facilities.some((f) => f.id === hint.facilityId && f.isActive) ? hint.facilityId : '')
  const emissionSourceId = hint && facilityId === hint.facilityId && sources.some((x) => x.id === hint.emissionSourceId && x.isActive) ? hint.emissionSourceId : ''
  return { ...EMPTY, ...prefill?.values, facilityId, emissionSourceId }
}

function validate(v: Values, period: ReportingPeriod | undefined, zeroAllowed: boolean): Partial<Values> {
  const e: Partial<Values> = {}
  if (!v.facilityId) e.facilityId = 'Select a facility'
  if (!v.reportingPeriodId) e.reportingPeriodId = 'Select a reporting period'
  if (!v.emissionSourceId) e.emissionSourceId = 'Select an emission source'
  if (!v.startDate) e.startDate = 'Enter a start date'
  if (!v.endDate) e.endDate = 'Enter an end date'
  else if (v.startDate && v.endDate < v.startDate) e.endDate = 'End date must be on or after the start date'
  if (period && v.startDate && v.endDate && (v.startDate < day(period.startDate) || v.endDate > day(period.endDate))) {
    e.startDate = `Dates must fall within ${period.name} (${day(period.startDate)} to ${day(period.endDate)})`
  }
  if (!v.quantity.trim()) e.quantity = 'Enter a quantity'
  else if (!/^\d{1,14}(\.\d{1,6})?$/.test(v.quantity.trim())) e.quantity = 'Enter a positive number with at most 6 decimal places'
  else if (Number(v.quantity) <= 0 && !(zeroAllowed && Number(v.quantity) === 0)) e.quantity = 'Quantity must be greater than zero'
  if (!v.unit.trim()) e.unit = 'Enter a unit'
  else if (v.unit.trim().length > 20) e.unit = 'At most 20 characters'
  return e
}

function fileProblem(f: File) {
  const ext = f.name.slice(f.name.lastIndexOf('.')).toLowerCase()
  if (!EVIDENCE_EXTENSIONS.includes(ext)) return `${f.name}: type not allowed (${EVIDENCE_EXTENSIONS.join(', ')})`
  if (f.size === 0) return `${f.name}: file is empty`
  if (f.size > MAX_EVIDENCE_BYTES) return `${f.name}: larger than ${formatSize(MAX_EVIDENCE_BYTES)}`
  return null
}

export default function ActivityEntryPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const navState = useLocation().state as { flash?: string; error?: string; prefill?: DocumentPrefill } | null
  const prefill = !id ? navState?.prefill : undefined // values read from an uploaded document; the person checks them here
  const [notice, setNotice] = useState<string | null>(null)
  const { me } = useAuth()
  const can = (p: string) => me?.permissions.includes(p) ?? false
  const dialog = useDialog()
  const activityTypes = useLoad<ActivityTypeRef[]>('/api/reference/activity-types').data ?? []
  const units = useLoad<UnitRef[]>('/api/reference/units').data ?? []
  // The activity a source is calculated as: its own fuel/gas/grid, else every activity of its category.
  const typesFor = (s?: EmissionSource) => activityTypes.filter((t) => s && (s.activityCode ? t.code === s.activityCode : t.sourceCategory === s.category))
  // Units the calculation accepts (V-16); empty = free text (not calculated yet).
  const unitsFor = (s?: EmissionSource) => [...new Set(typesFor(s).flatMap((t) => t.allowedUnits))]
  // Extra inputs the source's calculation method asks for (density, NCV, instrument MWh…).
  const fieldsFor = (s?: EmissionSource) => (s?.activityCode ? typesFor(s)[0]?.fields : typesFor(s).find((t) => t.calculable)?.fields) ?? []

  const [record, setRecord] = useState<ActivityRecord | null>(null)
  const [facilities, setFacilities] = useState<Facility[]>([])
  const [periods, setPeriods] = useState<ReportingPeriod[]>([])
  const [sources, setSources] = useState<EmissionSource[]>([])
  const [org, setOrg] = useState<Organization | null>(null)
  const [values, setValues] = useState<Values>(EMPTY)
  const [params, setParams] = useState<Record<string, string>>({})
  const [category, setCategory] = useState<SourceCategory | ''>('')
  const [touched, setTouched] = useState<Partial<Record<keyof Values, boolean>>>({})
  const [files, setFiles] = useState<File[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [clashId, setClashId] = useState<string | null>(null)
  const [busy, setBusy] = useState<'draft' | 'submit' | null>(null)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    Promise.all([
      apiGet<Facility[]>('/api/facilities'),
      apiGet<ReportingPeriod[]>('/api/reporting-periods'),
      apiGet<EmissionSource[]>('/api/emission-sources'),
      apiGet<Organization>('/api/organizations/current'),
      id ? apiGet<ActivityRecord>(`/api/activities/${id}`) : Promise.resolve(null),
    ])
      .then(([f, p, s, o, r]) => {
        setFacilities(f); setPeriods(p); setSources(s); setOrg(o); setRecord(r)
        setValues(r
          ? { facilityId: r.facilityId, reportingPeriodId: r.reportingPeriodId, emissionSourceId: r.emissionSourceId, startDate: isoDay(r.startDate), endDate: isoDay(r.endDate), quantity: r.quantity, unit: r.unit, notes: r.notes ?? '' }
          : prefillValues(prefill, f, s))
        setCategory(prefill?.category ?? '')
        setParams(r?.parameters ?? {})
        setTouched({}); setFiles([]); setError(navState?.error ?? null); setNotice(navState?.flash ?? null)
        setLoaded(true)
      })
      .catch((e: Error) => setLoadError(e.message))
  }, [id]) // eslint-disable-line react-hooks/exhaustive-deps -- flash is read once per record

  const period = periods.find((p) => p.id === values.reportingPeriodId)
  const source = sources.find((s) => s.id === values.emissionSourceId)
  const errors = useMemo(() => validate(values, period, source?.category === 'FUGITIVE_GAS'), [values, period, source])
  const editable = can('activity.write') && (!record || ((record.status === 'DRAFT' || record.status === 'RETURNED') && record.reportingPeriod.status === 'OPEN' && (record.createdBy.id === me?.user.id || me?.role === 'TENANT_ADMIN')))
  const dimension = units.find((u) => u.code.toLowerCase() === values.unit.trim().toLowerCase())?.dimension ?? ''
  const fields = fieldsFor(source).filter((f) => relevant(f.name, dimension, params))

  // Selectable options: active facilities and sources, open periods (plus whatever the record already uses).
  const facilityOptions = facilities.filter((f) => f.isActive || f.id === record?.facilityId)
  const periodOptions = periods.filter((p) => p.status === 'OPEN' || p.id === record?.reportingPeriodId)
  const facilitySources = sources.filter((s) => s.facilityId === values.facilityId && (s.isActive || s.id === record?.emissionSourceId))
  // The category picked, or the chosen source's; it filters the source list and decides the inputs below.
  const activeCategory = category || source?.category || ''
  const sourceOptions = facilitySources.filter((s) => !activeCategory || s.category === activeCategory)

  const set = (name: keyof Values, value: string) => {
    setTouched((t) => ({ ...t, [name]: true }))
    if (name === 'unit') {
      const dim = units.find((u) => u.code === value)?.dimension ?? ''
      const guess = dim === 'Volume (gas)' ? 'kg/m3' : dim === 'Volume' || dim === 'Distance' ? 'kg/l' : ''
      if (guess) setParams((p) => (p.densityUnit ? p : { ...p, densityUnit: guess }))
    }
    setValues((v) => {
      const next = { ...v, [name]: value }
      if (name === 'facilityId') { next.emissionSourceId = ''; setCategory(prefill?.category ?? '') } // sources belong to one facility
      if (name === 'emissionSourceId') {
        setParams({})
        const s = sources.find((x) => x.id === value)
        const allowed = unitsFor(s)
        if (allowed.length && !allowed.includes(v.unit)) next.unit = s?.defaultUnit && allowed.includes(s.defaultUnit) ? s.defaultUnit : allowed[0]
        else if (s?.defaultUnit && !v.unit) next.unit = s.defaultUnit
      }
      return next
    })
  }
  const show = (name: keyof Values) => (touched[name] ? errors[name] : undefined)
  // Choosing a source can switch the unit to one it accepts while the bill's number stays as it was.
  const unitChanged = !!prefill?.values.unit && !!values.unit && values.unit.toLowerCase() !== prefill.values.unit.toLowerCase()

  // Live check: the server runs the save, overlap (V-07) and calculation rules on the unsaved values, so a
  // missing density or a wrong unit shows here, with what to do, before anyone submits.
  type Finding = { code: string; severity: string; message: string; clashId?: string }
  const [check, setCheck] = useState<{ issues: Finding[]; outcomes: Array<{ formulaCode: string; title: string; status: string; tCO2e: string | null; biogenicTCO2: string | null; issues: Finding[] }> | null } | null>(null)
  const checkKey = editable && !Object.keys(errors).length ? JSON.stringify({ ...values, notes: undefined, params, id: record?.id }) : ''
  useEffect(() => {
    if (!checkKey) return setCheck(null)
    const t = setTimeout(() => {
      const parameters = Object.fromEntries(Object.entries(params).filter(([k, v]) => v.trim() && fields.some((f) => f.name === k)).map(([k, v]) => [k, v.trim()]))
      apiPost<NonNullable<typeof check>>('/api/activities/check', { ...values, notes: undefined, quantity: values.quantity.trim(), unit: values.unit.trim(), parameters, id: record?.id })
        .then(setCheck).catch(() => setCheck(null))
    }, 500)
    return () => clearTimeout(t)
  }, [checkKey]) // eslint-disable-line react-hooks/exhaustive-deps -- checkKey captures every input
  const findings: Finding[] = [...(check?.issues ?? []), ...(check?.outcomes ?? []).flatMap((o) => o.issues)]
  const blocked = findings.some((f) => f.severity === 'BLOCK')

  const pickFiles = (list: FileList | null) => {
    const picked = [...(list ?? [])]
    const problems = picked.map(fileProblem).filter(Boolean)
    setError(problems.length ? problems.join('. ') : null)
    setFiles((f) => [...f, ...picked.filter((x) => !fileProblem(x))])
  }

  const evidenceCount = (record?.evidence?.length ?? 0) + files.length + (prefill ? 1 : 0)
  const evidenceMissing = !!org?.requireEvidenceOnSubmit && evidenceCount === 0

  // Save (create or update), then upload pending files, then optionally submit.
  const save = async (mode: 'draft' | 'submit', e?: FormEvent) => {
    e?.preventDefault()
    setTouched(Object.fromEntries(Object.keys(EMPTY).map((k) => [k, true])))
    if (Object.keys(errors).length) return setError('Fix the highlighted fields first.')
    if (mode === 'submit' && evidenceMissing) return setError('This organisation requires supporting evidence before submitting. Attach a file.')
    setBusy(mode)
    setError(null)
    setClashId(null)
    setNotice(null)
    let saved = record
    try {
      const parameters = Object.fromEntries(Object.entries(params).filter(([k, v]) => v.trim() && fields.some((f) => f.name === k)).map(([k, v]) => [k, v.trim()]))
      const body = { ...values, quantity: values.quantity.trim(), unit: values.unit.trim(), parameters }
      saved = record ? await apiPatch<ActivityRecord>(`/api/activities/${record.id}`, body) : await apiPost<ActivityRecord>('/api/activities', body)
      setRecord(saved)
      for (const f of files) {
        await apiUpload(`/api/activities/${saved.id}/evidence`, f)
        setFiles((list) => list.filter((x) => x !== f))
      }
      if (prefill && !record) await apiPost(`/api/documents/${prefill.documentId}/link`, { activityRecordId: saved.id, invoiceIndex: prefill.invoiceIndex }) // the bill becomes the record's evidence
      if (mode === 'submit') await apiPost(`/api/activities/${saved.id}/submit`)
      if (mode === 'submit') return navigate('/', { state: { flash: 'Record submitted for review.' } })
      if (record) { setRecord(await apiGet<ActivityRecord>(`/api/activities/${saved.id}`)); setNotice('Draft saved.') } // same URL: refresh evidence list
      else navigate(`/activities/${saved.id}`, { replace: true, state: { flash: 'Draft saved.' } })
    } catch (err) {
      const message = (err as Error).message
      if (err instanceof ApiError && err.clashId) setClashId(err.clashId)
      // A new draft was created before the failure: open it, carrying the error across the reload.
      if (saved && !record) navigate(`/activities/${saved.id}`, { replace: true, state: { error: `${message} The draft itself was saved; attach the file again.` } })
      else setError(message)
    } finally {
      setBusy(null)
    }
  }

  const removeEvidence = async (evidenceId: string) => {
    if (!(await dialog.confirm({ title: 'Remove this file?', message: 'The evidence file is detached from this record.', confirmLabel: 'Remove', danger: true }))) return
    try {
      await apiDelete(`/api/evidence/${evidenceId}`)
      setRecord(await apiGet<ActivityRecord>(`/api/activities/${record!.id}`))
    } catch (e) { setError((e as Error).message) }
  }

  const deleteDraft = async () => {
    if (!(await dialog.confirm({ title: 'Delete this draft?', message: 'The draft and its attached files are deleted. This cannot be undone.', confirmLabel: 'Delete draft', danger: true }))) return
    try {
      await apiDelete(`/api/activities/${record!.id}`)
      navigate('/', { replace: true })
    } catch (e) { setError((e as Error).message) }
  }

  const reload = async () => setRecord(await apiGet<ActivityRecord>(`/api/activities/${record!.id}`))
  const act = async (fn: () => Promise<unknown>, message: string) => {
    setError(null); setNotice(null)
    try { await fn(); await reload(); setNotice(message) } catch (e) { setError((e as Error).message) }
  }
  const approve = async () => {
    const warned = record?.preview?.some((p) => p.issues.length)
    if (!(await dialog.confirm({
      title: 'Approve this record?',
      message: warned ? 'Approval accepts the data; the calculation warnings shown still need confirming with a reason after the run.' : 'Approved records are included in the next calculation run.',
      confirmLabel: 'Approve',
    }))) return
    await reviewAndNext(() => apiPost(`/api/activities/${record!.id}/approve`), 'Approved.')
  }
  // After a review, open the next record waiting, so a reviewer works through the queue without going back.
  const reviewAndNext = async (fn: () => Promise<unknown>, done: string) => {
    setError(null)
    try {
      await fn()
      const queue = await apiGet<{ rows: ActivityRecord[]; total: number }>('/api/activities?status=SUBMITTED')
      const next = queue.rows.find((r) => r.id !== record!.id && r.createdBy.id !== me?.user.id)
      if (next) navigate(`/activities/${next.id}`, { state: { flash: `${done} ${queue.total - (queue.rows.some((r) => r.id === record!.id) ? 1 : 0)} record(s) left in the queue; here is the next one.` } })
      else navigate('/review', { state: { flash: `${done} The review queue is empty. Next: run the calculation for the period.` } })
    } catch (e) { setError((e as Error).message) }
  }
  const sendBack = async () => {
    const reason = await dialog.prompt({ title: 'Return for correction?', message: 'The person who entered it can correct and resubmit it.', input: { label: 'What needs correcting', required: true }, confirmLabel: 'Return record' })
    if (reason !== null) await reviewAndNext(() => apiPost(`/api/activities/${record!.id}/return`, { reason }), 'Returned for correction.')
  }
  const raiseQuery = async () => {
    const message = await dialog.prompt({ title: 'Raise a verification query', message: 'The organisation is notified on its Verification Queries page.', input: { label: 'Your question', required: true }, confirmLabel: 'Send query' })
    if (message === null) return
    await act(() => apiPost('/api/queries', {
      reportingPeriodId: record!.reportingPeriodId, activityRecordId: record!.id,
      subject: `${record!.facility.name} · ${record!.emissionSource.name} (${day(record!.startDate)} to ${day(record!.endDate)})`, message,
    }), 'Query sent. Follow it on the Verification Queries page.')
  }
  const reviewable = !!record && can('activity.review') && record.reportingPeriod.status === 'OPEN' && (record.status === 'SUBMITTED' || record.status === 'APPROVED')
  const ownRecord = me?.role !== 'TENANT_ADMIN' && record && (record.createdBy.id === me?.user.id || record.updatedBy?.id === me?.user.id)

  if (loadError) return <p className="status status--error" role="alert">{loadError}</p>
  if (!loaded) return <Skeleton />
  if (!record && !can('activity.write')) return <p className="status">You do not have permission to enter activity data.</p>
  if (!record && (!facilityOptions.length || !periodOptions.length || !sources.length)) {
    const steps = [
      { done: facilityOptions.length > 0, label: 'At least one active facility', to: '/facilities', perm: 'facility.manage' },
      { done: periodOptions.length > 0, label: 'An open reporting period', to: '/reporting-periods', perm: 'period.manage' },
      { done: sources.length > 0, label: 'At least one emission source', to: '/emission-sources', perm: 'source.manage' },
    ]
    return (
      <section className="card">
        <h1 className="card__title">Finish setup before entering data</h1>
        <ul className="checklist">
          {steps.map((s) => (
            <li key={s.to} className={`checklist__item ${s.done ? 'checklist__item--ok' : 'checklist__item--advice'}`}>
              <span aria-hidden className="checklist__mark">{s.done ? '✓' : '○'}</span>
              <span className="checklist__body">{s.label}{s.done && ' — done'}</span>
              {!s.done && (can(s.perm) ? <Link className="button button--small" to={s.to}>Set up</Link> : <span className="field__hint">Ask a Tenant Admin</span>)}
            </li>
          ))}
        </ul>
      </section>
    )
  }

  const field = (name: keyof Values, label: string, input: React.ReactNode, hint?: string) => (
    <label className="field">
      <span className="field__label">{label}</span>
      {input}
      {show(name) ? <span className="field__error" role="alert">{show(name)}</span> : hint && <span className="field__hint">{hint}</span>}
    </label>
  )
  const invalid = (name: keyof Values) => (show(name) ? 'input input--invalid' : 'input')
  const facilityName = facilities.find((f) => f.id === values.facilityId)
  const allFields = fieldsFor(source)
  const next = nextStep(record, { me: me?.user.id, role: me?.role, can, reviewable: !!reviewable, ownRecord: !!ownRecord })

  return (
    <>
      <header className="page__header page__header--row">
        <div>
          <h1 className="page__title">{record ? `${record.facility.name} · ${record.emissionSource.name}` : 'New activity record'}</h1>
          <p className="page__subtitle">
            {record ? <>Entered by {record.createdBy.name} · {record.reportingPeriod.name}</> : 'Enter one bill, meter reading or log entry. Save a draft at any time.'}
          </p>
        </div>
        <Link className="button button--ghost" to={can('activity.review') && record?.status === 'SUBMITTED' ? '/review' : '/activities'}>{can('activity.review') && record?.status === 'SUBMITTED' ? 'Review queue' : 'All records'}</Link>
      </header>

      {prefill && (
        <div className="callout">
          <ScanText size={18} />
          <span className="callout__text"><strong>Filled in from {prefill.documentName}.</strong> <em>Check every value against the document, and complete the facility, source and period. Saving attaches the document as evidence.</em></span>
        </div>
      )}
      {prefill && (prefill.checks.length > 0 || unitChanged) && (
        <div className="checks checks--warn">
          <strong>Before you save</strong>
          <ul>
            {unitChanged && <li>The document gives this quantity in {prefill.values.unit}, but the form now shows {values.unit}. Convert the quantity, or choose the unit the document uses.</li>}
            {prefill.checks.map((c) => <li key={c}>{c}</li>)}
          </ul>
        </div>
      )}
      {prefill && (
        <details className="card doc-preview" open>
          <summary className="field__label">Original document{prefill.invoiceIndex > 0 && `, invoice ${prefill.invoiceIndex + 1}`}</summary>
          {prefill.mimeType.startsWith('image/')
            ? <img className="doc-preview__frame" src={prefill.fileUrl} alt={`Original ${prefill.documentName}`} />
            : prefill.mimeType === 'application/pdf'
              ? <iframe className="doc-preview__frame" src={prefill.fileUrl} title={`Original ${prefill.documentName}`} />
              : <a className="link" href={prefill.fileUrl} target="_blank" rel="noreferrer">Download {prefill.documentName}</a>}
        </details>
      )}
      <Lifecycle record={record} />
      {next && (
        <div className={`next ${next.problem ? 'next--problem' : ''}`} role="status">
          <p><strong>{next.title}</strong>{next.detail && <><br /><span className="field__hint">{next.detail}</span></>}</p>
          <div className="actions">
            {next.action === 'review' && !ownRecord && record?.status === 'SUBMITTED' && <button className="button" onClick={() => void approve()}>Approve</button>}
            {next.action === 'review' && !ownRecord && <button className="button button--ghost button--danger" onClick={() => void sendBack()}>Return for correction</button>}
            {next.action === 'calculate' && <Link className="button" to={`/calculations?period=${record!.reportingPeriodId}`}>Go to calculations</Link>}
            {next.action === 'query' && <button className="button button--ghost" onClick={() => void raiseQuery()}>Raise a verification query</button>}
          </div>
        </div>
      )}
      {error && <p className="status status--error" role="alert">{error}{clashId && <> — <Link to={`/activities/${clashId}`}>View the conflicting record →</Link></>}</p>}
      <Notify message={!error && notice} />

      {record && !editable ? (
        <section className="card card--spaced">
          <dl className="summary">
            <div><dt>Facility</dt><dd>{record.facility.code} — {record.facility.name}</dd></div>
            <div><dt>Emission source</dt><dd>{record.emissionSource.name}<div className="field__hint">{CATEGORY_LABELS[record.emissionSource.category]}{source?.activityType && ` · ${source.activityType.name}`}</div></dd></div>
            <div><dt>Reporting period</dt><dd>{record.reportingPeriod.name}{record.reportingPeriod.status === 'LOCKED' && ' (locked)'}</dd></div>
            <div><dt>Activity dates</dt><dd>{day(record.startDate)}{record.endDate !== record.startDate && ` to ${day(record.endDate)}`}</dd></div>
            <div><dt>Quantity</dt><dd>{Number(record.quantity).toLocaleString(undefined, { maximumFractionDigits: 6 })} {record.unit}</dd></div>
            {Object.entries(record.parameters ?? {}).map(([k, v]) => (
              <div key={k}><dt>{allFields.find((f) => f.name === k)?.label ?? k}</dt><dd>{allFields.find((f) => f.name === k)?.options?.find((o) => o.value === v)?.label ?? v}</dd></div>
            ))}
            {record.notes && <div className="summary__wide"><dt>Notes</dt><dd className="summary__text">{record.notes}</dd></div>}
          </dl>
          <EvidenceList record={record} files={[]} editable={false} onRemove={() => {}} onDrop={() => {}} />
        </section>
      ) : (
        <form className="card card--spaced" noValidate onSubmit={(e) => void save('draft', e)}>
          <fieldset className="entry-fieldset" disabled={!!busy}>
            <div className="section">
              <h2 className="section__title">1. Where and when</h2>
              <div className="grid-cols">
                {field('facilityId', 'Facility *', (
                  <select className={invalid('facilityId')} value={values.facilityId} onChange={(e) => set('facilityId', e.target.value)}>
                    <option value="">Select…</option>
                    {facilityOptions.map((f) => <option key={f.id} value={f.id}>{f.code} — {f.name}</option>)}
                  </select>
                ))}
                <label className="field">
                  <span className="field__label">Category *</span>
                  <select className="input" value={activeCategory} disabled={!values.facilityId}
                    onChange={(e) => { setCategory(e.target.value as SourceCategory | ''); if (source && source.category !== e.target.value) set('emissionSourceId', '') }}>
                    <option value="">{values.facilityId ? 'Select…' : 'Select a facility first'}</option>
                    {(Object.keys(CATEGORY_LABELS) as SourceCategory[]).map((c) => {
                      const n = facilitySources.filter((s) => s.category === c).length
                      return <option key={c} value={c}>{CATEGORY_LABELS[c]} · {CATEGORY_SCOPE[c]}{n ? '' : ' (no source yet)'}</option>
                    })}
                  </select>
                  {activeCategory && <span className="field__hint">{CATEGORY_HINT[activeCategory]}</span>}
                </label>
                {field('emissionSourceId', 'Emission source *', (
                  <select className={invalid('emissionSourceId')} value={values.emissionSourceId} onChange={(e) => set('emissionSourceId', e.target.value)} disabled={!values.facilityId || !activeCategory}>
                    <option value="">{!values.facilityId ? 'Select a facility first' : !activeCategory ? 'Select a category first' : sourceOptions.length ? 'Select…' : 'No source of this category here'}</option>
                    {sourceOptions.map((s) => <option key={s.id} value={s.id}>{s.name}{s.activityType ? ` (${s.activityType.name})` : ''}</option>)}
                  </select>
                ), source ? `${source.activityType ? source.activityType.name : 'No fuel or gas chosen'} · Scope ${source.scope}` : undefined)}
                {values.facilityId && activeCategory && !sourceOptions.length && (
                  <p className="field__hint field--wide">
                    {facilityName?.name} has no {CATEGORY_LABELS[activeCategory].toLowerCase()} source yet.{' '}
                    {can('source.manage') ? <Link className="link" to="/emission-sources">Add one on Emission Sources</Link> : 'Ask a Tenant Admin to add it on Emission Sources.'}
                  </p>
                )}
                {field('reportingPeriodId', 'Reporting period *', (
                  <select className={invalid('reportingPeriodId')} value={values.reportingPeriodId} onChange={(e) => set('reportingPeriodId', e.target.value)}>
                    <option value="">Select…</option>
                    {periodOptions.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                ), period ? `${day(period.startDate)} to ${day(period.endDate)}` : undefined)}
              </div>
              <div className="grid-cols">
                {field('startDate', 'From *', (
                  <input className={invalid('startDate')} type="date" value={values.startDate} min={period && isoDay(period.startDate)} max={period && isoDay(period.endDate)} onChange={(e) => set('startDate', e.target.value)} />
                ))}
                {field('endDate', 'To (inclusive) *', (
                  <input className={invalid('endDate')} type="date" value={values.endDate} min={values.startDate || (period && isoDay(period.startDate))} max={period && isoDay(period.endDate)} onChange={(e) => set('endDate', e.target.value)} />
                ), 'Same as "from" for a single day')}
              </div>
            </div>

            <div className="section">
              <h2 className="section__title">2. How much</h2>
              <div className="grid-cols">
                {field('quantity', 'Quantity *', (
                  <input className={invalid('quantity')} inputMode="decimal" placeholder="e.g. 1200000" value={values.quantity} onChange={(e) => set('quantity', e.target.value)} />
                ), 'As printed on the bill or log')}
                {field('unit', 'Unit *', unitsFor(source).length ? (
                  <select className={invalid('unit')} value={values.unit} onChange={(e) => set('unit', e.target.value)}>
                    {!unitsFor(source).includes(values.unit) && <option value={values.unit}>{values.unit || 'Select…'}</option>}
                    {unitsFor(source).map((u) => <option key={u} value={u}>{u}</option>)}
                  </select>
                ) : (
                  <input className={invalid('unit')} value={values.unit} onChange={(e) => set('unit', e.target.value)} placeholder={source?.defaultUnit ?? 'e.g. kWh'} />
                ))}
              </div>
            </div>

            {fields.length > 0 && (
              <div className="section">
                <h2 className="section__title">3. Calculation details</h2>
                <p className="section__hint">Only what the calculation needs for this source and unit.</p>
                <div className="grid-cols">
                  {fields.map((f) => (
                    <label key={f.name} className="field">
                      <span className="field__label">{f.label}</span>
                      {f.kind === 'select' ? (
                        <select className="input" value={params[f.name] ?? ''} onChange={(e) => setParams((p) => ({ ...p, [f.name]: e.target.value }))}>
                          <option value="">—</option>
                          {f.options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                        </select>
                      ) : (
                        <input className="input" inputMode={f.kind === 'decimal' ? 'decimal' : undefined} value={params[f.name] ?? ''} onChange={(e) => setParams((p) => ({ ...p, [f.name]: e.target.value }))} />
                      )}
                      {f.hint && <span className="field__hint">{humanize(f.hint)}</span>}
                    </label>
                  ))}
                </div>
              </div>
            )}

            <div className="section">
              <h2 className="section__title">{fields.length ? '4' : '3'}. Evidence and notes</h2>
              {org?.requireEvidenceOnSubmit && <p className="section__hint">This organisation requires at least one file before submitting.</p>}
              <EvidenceList record={record} files={files} editable={can('evidence.write')} onRemove={(id) => void removeEvidence(id)} onDrop={(f) => setFiles((l) => l.filter((x) => x !== f))} />
              {can('evidence.write') && (
                <label className="field">
                  <span className="field__label">Attach bill, invoice or log ({EVIDENCE_EXTENSIONS.join(', ')}; up to {formatSize(MAX_EVIDENCE_BYTES)})</span>
                  <input type="file" multiple accept={EVIDENCE_EXTENSIONS.join(',')} onChange={(e) => { pickFiles(e.target.files); e.target.value = '' }} />
                </label>
              )}
              <label className="field">
                <span className="field__label">Notes (optional)</span>
                <textarea className="input" rows={2} maxLength={2000} value={values.notes} onChange={(e) => set('notes', e.target.value)} />
              </label>
            </div>
          </fieldset>

          {editable && check && (
            <section className={`checks ${blocked ? 'checks--block' : findings.length ? 'checks--warn' : 'checks--ok'}`} aria-live="polite">
              {!findings.length ? (
                <p><strong>✓ Checks passed.</strong> {check.outcomes?.filter((o) => o.tCO2e).map((o) => `${o.formulaCode}: ${recordT(o.tCO2e)} tCO2e`).join(' · ') || 'Ready to submit.'}</p>
              ) : (
                <>
                  <p><strong>{blocked ? 'Fix before submitting' : 'Good to know (you can submit)'}</strong>{blocked && <span className="field__hint"> — you can still save a draft.</span>}</p>
                  <ul className="plain">
                    {findings.map((f, i) => (
                      <li key={`${f.code}-${i}`} className={f.severity === 'BLOCK' ? 'field__error' : 'field__hint'}>
                        <strong>{f.severity === 'BLOCK' ? '✕' : 'ⓘ'}</strong> {humanize(f.message)}
                        {f.clashId && <> <Link to={`/activities/${f.clashId}`}>Open that record →</Link></>}
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </section>
          )}

          {editable && (
            <div className="actions sticky-actions">
              {can('activity.submit') && (
                <button className="button" type="button" disabled={!!busy || blocked} title={blocked ? 'Fix the issues listed above first' : undefined} onClick={() => void save('submit')}>{busy === 'submit' ? 'Submitting…' : record?.status === 'RETURNED' ? 'Resubmit for review' : 'Submit for review'}</button>
              )}
              <button className="button button--ghost" type="submit" disabled={!!busy}>{busy === 'draft' ? 'Saving…' : 'Save draft'}</button>
              {record?.status === 'DRAFT' && <button className="button button--ghost button--danger" type="button" disabled={!!busy} onClick={() => void deleteDraft()}>Delete draft</button>}
            </div>
          )}
        </form>
      )}

      {reviewable && record?.preview && (
        <section className="card card--spaced">
          <h2 className="card__title">What the calculation will give</h2>
          {record.preview.some((p) => p.status === 'BLOCKED') ? (
            <p className="status status--error" role="alert">
              This record has blocking issues and <strong>will not be calculated</strong> until they are fixed.
              {!ownRecord && ' Return it for correction so the data entry person can fix the issue below.'}
              {ownRecord && ' Ask a reviewer to return it so you can fix the issue below.'}
            </p>
          ) : (
            <p className="field__hint">A preview using today's factors. Warnings are confirmed after the calculation.</p>
          )}
          <Outcomes items={record.preview.map((p) => ({ key: p.formulaCode, title: `${p.formulaCode} ${p.title}`, status: p.status, tCO2e: p.tCO2e, biogenic: p.biogenicTCO2, issues: p.issues }))} />
          {record.preview.some((p) => p.status === 'BLOCKED') && !ownRecord && (
            <div className="actions">
              <button className="button button--ghost button--danger" onClick={() => void sendBack()}>Return for correction</button>
            </div>
          )}
        </section>
      )}

      {!!record?.calculations?.length && (
        <section className="card card--spaced">
          <h2 className="card__title">Calculated emissions</h2>
          {record.calculations.map((c) => (
            <div key={c.id} className="stack stack--sm">
              <p>
                <strong>{recordT(c.tCO2e)} tCO2e</strong> · {LINE_LABELS[c.line]} ({c.formulaCode})
                {c.biogenicTCO2 && <> · + {recordT(c.biogenicTCO2)} t biogenic CO₂ (reported separately)</>}
                {c.emissionFactor && !appliedValues(c.inputs).ownCO2 && <span className="field__hint"> · {c.emissionFactor.code}, {c.emissionFactor.source} {c.emissionFactor.sourceVersion}{c.emissionFactor.tier && ` · ${factorLabel({ organizationId: c.emissionFactor.organizationId, tier: c.emissionFactor.tier })}`}</span>}
              </p>
              {appliedValues(c.inputs).ownCO2 && (
                <p className="field__hint">Calculated with this record's own CO₂ factor of <strong>{appliedValues(c.inputs).ownCO2}</strong>{c.emissionFactor && <>, instead of the standard factor {c.emissionFactor.code}</>}.</p>
              )}
              {!!appliedValues(c.inputs).parts.length && <p className="field__hint">Values used are {appliedValues(c.inputs).parts.join(', ')}.</p>}
              <ResultStatus r={c} canRun={false} />
            </div>
          ))}
          <p className="field__hint">Run of {record.calculations[0].run && new Date(record.calculations[0].run.createdAt).toLocaleString()} · <Link className="link" to={`/calculations?period=${record.reportingPeriodId}&run=${record.calculations[0].run?.id}`}>Open the run</Link></p>
        </section>
      )}

      {!!record?.reviews?.length && (
        <section className="card">
          <h2 className="card__title">History</h2>
          <ul className="plain">
            {record.reviews.map((r) => (
              <li key={r.id} className="todo">
                <span>{r.actor.name} · {STATUS_LABELS[r.fromStatus]} → <strong>{STATUS_LABELS[r.toStatus]}</strong>{r.comment && <> · “{r.comment}”</>}</span>
                <span className="field__hint">{new Date(r.createdAt).toLocaleString()}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  )
}

// Which calculation inputs matter for the chosen unit and method; the rest stay hidden.
function relevant(name: string, dimension: string, p: Record<string, string>) {
  const volume = dimension.startsWith('Volume') || dimension === 'Distance'
  switch (name) {
    case 'density': case 'densityUnit': return volume
    case 'energyBasis': return dimension === 'Energy'
    case 'ncv': return dimension !== 'Energy' && dimension !== ''
    case 'fuelEconomy': return dimension === 'Distance'
    case 'instrumentType': case 'instrumentReference': return Number(p.instrumentMWh) > 0
    case 'disposedKg': case 'recoveredKg': return p.method !== 'SCREENING'
    case 'leakRate': return p.method === 'SCREENING'
    case 'mcf': return dimension === 'Pollutant load' // wastewater kg BOD
    default: return true
  }
}

// Where a record is in its life: entered → submitted → approved → calculated → final.
function Lifecycle({ record }: { record: ActivityRecord | null }) {
  const s = record?.status ?? 'NEW'
  const calculated = !!record?.calculations?.length
  const final = record?.reportingPeriod.status === 'LOCKED' && s === 'APPROVED'
  const steps: Array<{ label: string; state: 'done' | 'current' | 'problem' | '' }> = [
    { label: 'Entered', state: s === 'NEW' || s === 'DRAFT' ? 'current' : 'done' },
    { label: s === 'RETURNED' ? 'Returned for correction' : 'Submitted', state: s === 'RETURNED' ? 'problem' : s === 'SUBMITTED' ? 'current' : s === 'APPROVED' ? 'done' : '' },
    { label: 'Approved', state: s === 'APPROVED' ? (calculated ? 'done' : 'current') : '' },
    { label: 'Calculated', state: s === 'APPROVED' && calculated ? (final ? 'done' : 'current') : '' },
    { label: 'Final (period locked)', state: final ? 'done' : '' },
  ]
  return (
    <ol className="steps" aria-label="Record progress">
      {steps.map((st, i) => <li key={st.label} className={`step ${st.state ? `step--${st.state}` : ''}`} aria-current={st.state === 'current' ? 'step' : undefined}>{st.state === 'done' ? '✓' : i + 1} {st.label}</li>)}
    </ol>
  )
}

// One sentence on what happens next, for this person, and the button that does it.
function nextStep(r: ActivityRecord | null, ctx: { me?: string; role?: string | null; can: (p: string) => boolean; reviewable: boolean; ownRecord: boolean }):
  { title: string; detail?: string; problem?: boolean; action?: 'review' | 'calculate' | 'query' } | null {
  if (!r) return null
  const mine = r.createdBy.id === ctx.me || ctx.role === 'TENANT_ADMIN'
  switch (r.status) {
    case 'DRAFT':
      return mine ? { title: 'Check the details, attach the bill, then submit for review.' } : { title: 'Draft, not yet submitted.' }
    case 'RETURNED':
      return { title: `Returned by ${r.reviewedBy?.name ?? 'a reviewer'}: “${r.returnReason}”`, detail: mine ? 'Correct the record below and resubmit it.' : 'Waiting for the person who entered it to correct it.', problem: true }
    case 'SUBMITTED':
      if (ctx.reviewable) return ctx.ownRecord
        ? { title: 'Waiting for review.', detail: 'You entered this record; sign in as the Reviewer to approve it.' }
        : { title: 'Review this record.', detail: 'Check the figures against the evidence and the calculation preview, then approve or return it.', action: 'review' }
      return { title: 'Submitted, waiting for a reviewer.', detail: 'You will see it here if it is returned for correction.' }
    case 'APPROVED':
      if (r.reportingPeriod.status === 'LOCKED') return ctx.can('query.create') ? { title: 'Final figures. Raise a query if something needs explaining.', action: 'query' } : { title: 'This reporting period is locked.' }
      if (!r.calculations?.length) return ctx.can('calc.run') ? { title: 'Approved. Run the calculation for the period to get its emissions.', action: 'calculate' } : { title: 'Approved; waiting for the calculation run.' }
      return ctx.can('calc.run')
        ? { title: 'Approved and calculated.', detail: 'Confirm any warnings on the Calculations page, then lock the period on Period Close.', action: ctx.reviewable ? 'review' : 'calculate' }
        : ctx.can('query.create') ? { title: 'Approved and calculated.', action: 'query' } : { title: 'Approved and calculated.' }
  }
}

function Outcomes({ items }: { items: Array<{ key: string; title: string; status: string; tCO2e: string | null; biogenic: string | null; issues: Array<{ code: string; severity: string; message: string }> }> }) {
  return (
    <ul className="plain">
      {items.map((p) => (
        <li key={p.key} className="todo todo--block">
          <strong>{p.status === 'BLOCKED' ? 'Would be blocked' : `${recordT(p.tCO2e)} tCO2e`}</strong> · {p.title}{p.biogenic && ` · + ${recordT(p.biogenic)} t biogenic CO₂ (reported separately)`}
          {p.issues.map((i) => <div key={i.code} className={i.severity === 'BLOCK' ? 'field__error' : 'field__hint'}>{humanize(i.message)}</div>)}
        </li>
      ))}
    </ul>
  )
}

function EvidenceList({ record, files, editable, onRemove, onDrop }: { record: ActivityRecord | null; files: File[]; editable: boolean; onRemove: (id: string) => void; onDrop: (f: File) => void }) {
  const count = (record?.evidence?.length ?? 0) + files.length
  return (
    <ul className="list">
      {record?.evidence?.map((ev) => (
        <li key={ev.id} className="list__item list__item--static">
          <span>
            <a className="link" href={evidenceUrl(ev.id, true)} target="_blank" rel="noreferrer">{ev.fileName}</a>
            <span className="list__meta"> · {formatSize(ev.sizeBytes)} · {ev.uploadedBy.name}, {new Date(ev.createdAt).toLocaleDateString()}</span>
          </span>
          <span className="actions">
            <a className="button button--ghost button--small" href={evidenceUrl(ev.id)}>Download</a>
            {editable && <button type="button" className="button button--ghost button--small button--danger" onClick={() => onRemove(ev.id)}>Remove</button>}
          </span>
        </li>
      ))}
      {files.map((f) => (
        <li key={f.name + f.size} className="list__item list__item--static">
          <span>{f.name}<span className="list__meta"> · {formatSize(f.size)} · uploads when you save</span></span>
          <button type="button" className="button button--ghost button--small button--danger" onClick={() => onDrop(f)}>Remove</button>
        </li>
      ))}
      {!count && <li className="field__hint">No files attached.</li>}
    </ul>
  )
}

const CATEGORY_SCOPE: Record<SourceCategory, string> = {
  FUEL_COMBUSTION: 'Scope 1', FUGITIVE_GAS: 'Scope 1', PROCESS: 'Scope 1', PURCHASED_ELECTRICITY: 'Scope 2', PURCHASED_ENERGY: 'Scope 2', REMOVAL: 'Removal (not netted)',
}
const CATEGORY_HINT: Record<SourceCategory, string> = {
  FUEL_COMBUSTION: 'Scope 1: diesel, gas, coal, biomass burned on site or in your vehicles. Enter litres, m³, kg/t, kWh or km.',
  FUGITIVE_GAS: 'Refrigerant or SF6 topped up or leaked, in kg (Scope 1).',
  PROCESS: 'Scope 1: cement clinker, lime, steel, ammonia, wastewater… Enter production in tonnes (or kg BOD).',
  PURCHASED_ELECTRICITY: 'Grid electricity bought, in kWh or MWh. Add any certificates (Scope 2).',
  PURCHASED_ENERGY: 'Steam, heat or cooling bought, with the supplier’s factor (Scope 2).',
  REMOVAL: 'CO₂ captured and stored or sold. Enter metered tonnes. Removals are reported separately from emission totals.',
}
