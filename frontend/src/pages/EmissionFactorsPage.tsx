import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Pager, type Page } from '../components/Pager'
import { Tabs } from '../components/Tabs'
import FieldsForm, { type Values } from '../components/FieldsForm'
import { API_URL, apiPatch, apiPost, apiUpload } from '../services/apiClient'
import { day, factorNote, plain } from '../services/format'
import type { ActivityTypeRef, EmissionFactor, FactorStatus, GridRegion, LibraryUpdate, UnitRef, UnitRequest } from '../types/api'
import { Header, States } from '../components/Page'
import { useLoad } from '../hooks/useLoad'
import { useAuth } from '../auth/AuthContext'
import { useDialog } from '../components/Dialog'
import { Info, Plus, Search, ShieldCheck } from 'lucide-react'
import { Notify } from '../components/Toast'
import FuelPropertiesPage from './FuelPropertiesPage'

const KINDS: Array<[string, string]> = [
  ['electricity', 'Electricity'], ['stationary', 'Stationary fuels'], ['mobile', 'Mobile fuels'], ['fugitive', 'Refrigerants & gases'],
  ['process', 'Process'], ['gwp', 'GWP (CH4, N2O)'], ['other', 'Steam & removals'],
]
const TIERS = ['Tier 1 default', 'Tier 2 country', 'Tier 3 site-specific']
const STATUS_BADGE: Record<FactorStatus, string> = { DRAFT: 'badge--draft', IN_REVIEW: 'badge--warning', APPROVED: 'badge--approved', IN_USE: 'badge--success', SUPERSEDED: 'badge--soft' }
const statusText = (f: Pick<EmissionFactor, 'status' | 'shared'>) => ({ DRAFT: 'Draft', IN_REVIEW: 'In review', APPROVED: f.shared ? 'Published' : 'Approved', IN_USE: 'In use', SUPERSEDED: 'Superseded' })[f.status]
const CHECKS = { checks: { source: true, units: true, tier: true, validity: true } }
type Listing = Page<EmissionFactor> & { counts: Record<string, number>; explanations: Array<{ activity: string; requirement: string }> }

// Organisation view: emission factors, monthly fuel lab values, and platform library updates, as tabs of one page.
export function FactorsAndFuel() {
  const [params, setParams] = useSearchParams()
  const view = params.get('view') ?? ''
  const switcher = <Tabs label="Factor data" active={view} onChange={(k) => setParams(k ? { view: k } : {})} tabs={[
    { key: '', label: 'Emission factors' },
    { key: 'fuel', label: 'Fuel lab values (monthly)' },
    { key: 'updates', label: 'Library updates & unit requests' },
  ]} />
  if (view === 'fuel') return <FuelPropertiesPage switcher={switcher} />
  if (view === 'updates') return <LibraryUpdates switcher={switcher} />
  return <EmissionFactorsPage switcher={switcher} />
}

// Two tiers (TC-ARC-006): the platform library, published from cited sources and read-only in every organisation;
// and the organisation's own factors, which only it can see, used only after a reviewer approves them.
export default function EmissionFactorsPage({ canAdd = false, switcher }: { canAdd?: boolean; switcher?: ReactNode }) {
  const { me } = useAuth()
  const platform = canAdd
  const perms = me?.permissions ?? []
  const canWrite = !platform && perms.includes('factor.write')
  const canApprove = !platform && perms.includes('factor.approve')
  const canSupersede = !platform && perms.includes('factor.supersede')
  const myId = me?.user.id
  const [params, setParams] = useSearchParams()
  const q = params.get('q') ?? ''
  const page = params.get('page') ?? '1'
  const kind = params.get('kind') ?? ''
  const scope = params.get('scope') ?? ''
  const status = params.get('status') ?? ''
  const [search, setSearch] = useState(q)
  const query = new URLSearchParams(Object.entries({ page, q, kind, scope, status }).filter(([, v]) => v)).toString()
  const { data, error, reload } = useLoad<Listing>(`/api/reference/emission-factors?${query}`)
  const go = (next: Record<string, string>) => setParams(Object.fromEntries(Object.entries({ q, kind, scope, status, ...next }).filter(([, v]) => v)))
  const [form, setForm] = useState<{ editing?: EmissionFactor; replacing?: EmissionFactor } | null>(null)
  const [open, setOpen] = useState<{ id: string; panel: 'history' | 'review' } | null>(null)
  const [requesting, setRequesting] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const dialog = useDialog()

  const act = async (run: () => Promise<unknown>, done: string) => {
    setNotice(null); setFailure(null)
    try { await run(); setNotice(done); setOpen(null); reload() } catch (e) { setFailure((e as Error).message) }
  }
  const mine = (f: EmissionFactor) => !f.shared && (f.createdById === myId || f.submittedById === myId)
  const manageable = (f: EmissionFactor) => (f.shared ? platform : !platform)
  const upload = (f: EmissionFactor) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.pdf,.png,.jpg,.jpeg,.xlsx,.csv'
    input.onchange = () => { const file = input.files?.[0]; if (file) void act(() => apiUpload(`/api/emission-factors/${f.id}/evidence`, file), `Evidence ${file.name} attached to ${f.code}.`) }
    input.click()
  }
  const submit = (f: EmissionFactor) => act(() => apiPost(`/api/emission-factors/${f.id}/submit`), `${f.code} is submitted. A reviewer will check it.`)
  const supersede = async (f: EmissionFactor) => {
    const reason = await dialog.prompt({
      title: `End-date ${f.code}?`, danger: true, confirmLabel: 'End-date',
      message: 'From today it is superseded: new calculations stop using it. It stays in the library, and results already calculated keep this factor, its value and units.',
      input: { label: 'Reason', required: true, placeholder: 'e.g. Supplier contract ended on 31 March' },
    })
    if (reason) await act(() => apiPost(`/api/emission-factors/${f.id}/supersede`, { reason }), `${f.code} is superseded.`)
  }

  return (
    <>
      <Header
        title={platform ? 'Emission Factors' : 'Factors & Fuel Data'}
        subtitle={platform
          ? 'The shared factor library used by every organisation.'
          : 'Standard factors, plus your organisation\'s own factors.'}
        action={(platform || canWrite) && !form && <button className="button" onClick={() => { setForm({}); setNotice(null) }}><Plus size={16} /> {platform ? 'Propose platform factor' : 'Add organisation factor'}</button>}
      />
      {switcher}
      <div className="callout">
        <ShieldCheck size={18} />
        {platform
          ? <span>New factors are checked before they are published. Past results always keep the factor they used.</span>
          : <span>Standard factors come from published sources such as IPCC and CEA and cannot be changed. Factors you add are private to your organisation and are used once a reviewer approves them.</span>}
      </div>
      <Notify message={notice} />
      <Notify kind="error" message={failure} />
      {requesting && <UnitRequestForm onDone={() => { setRequesting(false); setNotice('Unit requested. The platform team will answer it under Library updates & unit requests.') }} onCancel={() => setRequesting(false)} />}
      {form && (
        <AddFactor key={form.editing?.id ?? form.replacing?.id ?? 'new'} platform={platform} editing={form.editing} replacing={form.replacing}
          onRequestUnit={platform ? undefined : () => setRequesting(true)}
          onDone={(code) => { setForm(null); setNotice(form.editing ? `${code} saved.` : platform ? `${code} saved as a draft. Publish it once the source is verified.` : `${code} saved as a draft. Attach the evidence, then submit it for review.`); reload() }}
          onCancel={() => setForm(null)} />
      )}
      <section className="card factor-filters">
        <form className="filters" onSubmit={(e) => { e.preventDefault(); go({ q: search.trim(), page: '' }) }}>
          <div className="search-input">
            <Search size={15} />
            <input className="input" placeholder="Search by code, fuel, gas or source (e.g. diesel, R-410A, CEA)…" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search factors" />
          </div>
          <button className="button button--ghost" type="submit">Search</button>
          {!platform && (
            <select className="input" aria-label="Library" value={scope} onChange={(e) => go({ scope: e.target.value, page: '' })}>
              <option value="">Platform and organisation</option>
              <option value="shared">Platform library only</option>
              <option value="organization">Your organisation's factors only</option>
            </select>
          )}
          <select className="input" aria-label="Status" value={status} onChange={(e) => go({ status: e.target.value, page: '' })}>
            <option value="">Any status</option>
            <option value="DRAFT">Draft</option>
            {!platform && <option value="IN_REVIEW">In review</option>}
            <option value="APPROVED">{platform ? 'Published' : 'Approved'}</option>
            <option value="IN_USE">In use</option>
            <option value="SUPERSEDED">Superseded</option>
          </select>
          {data && <span className="field__hint filters__end">Showing {data.total.toLocaleString()} factors</span>}
        </form>
        <Tabs label="Factor kinds" active={kind} onChange={(k) => go({ kind: k, page: '' })} tabs={[
          { key: '', label: 'All', count: data ? Object.values(data.counts).reduce((a, b) => a + b, 0) : undefined },
          ...KINDS.map(([k, label]) => ({ key: k, label, count: data?.counts[k] })),
        ]} />
      </section>
      {!!data?.explanations.length && (
        <section className="card">
          <h2 className="card__title"><Info size={16} /> What these activities need</h2>
          <p className="field__hint">These activities have no generic emission factor, so this tab holds only organisation-specific supplier factors, if any.</p>
          <ul className="stack stack--sm">
            {data.explanations.map((x) => <li key={x.activity}><strong>{x.activity}:</strong> {x.requirement}</li>)}
          </ul>
        </section>
      )}
      <section className="card">
        <States error={error} loading={!data} />
        {data?.total === 0 && <p className="status">{q || scope || status ? 'No factors match.' : kind === 'other' ? 'No supplier-specific factors yet. See what each activity needs above.' : 'No emission factors are available yet. Please contact support.'}</p>}
        {!!data?.rows.length && (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Factor / activity</th><th>Library</th><th>Region</th><th className="num">Value</th><th>Unit</th><th>Valid</th><th>Source</th><th>Status</th><th aria-label="Actions" /></tr></thead>
              <tbody>
                {data.rows.map((f) => (
                  <Fragment key={f.id}>
                  <tr>
                    <td className="cell--wide">
                      <strong title={f.notes ? factorNote(f.notes) : undefined}>{f.activityType?.name ?? 'Global warming potential'}</strong>
                      <div className="field__hint">{f.code} · {f.gas}{f.gwpSet && ` (${f.gwpSet})`}{f.createdBy && !f.shared && ` · added by ${f.createdBy.name}`}</div>
                      {!f.usable && (f.status === 'APPROVED' || f.status === 'IN_USE') && <div className="field__error" role="note">Not used in calculations because {f.problem ?? 'it does not fit its activity'}.</div>}
                    </td>
                    <td className="nowrap"><span className={`badge ${f.shared ? 'badge--soft' : 'badge--warning'}`}>{f.shared ? 'Standard' : 'Your organisation'}</span>{f.tier && f.tier !== 'n/a' && <div className="field__hint">{f.tier.replace(/ - default$/, '')}</div>}</td>
                    <td className="nowrap">{f.region?.name ?? (f.geography.replace(/^Default \/ /i, '').replace(/^./, (c) => c.toUpperCase()) || 'Global')}</td>
                    <td className="num"><strong>{plain(f.value)}</strong></td>
                    <td className="field__hint nowrap">{f.numeratorUnit} / {f.denominatorUnit}</td>
                    <td className="nowrap">{f.validTo ? `${day(f.validFrom)} – ${day(f.validTo)}` : `From ${day(f.validFrom)}`}</td>
                    <td className="field__hint" title={`${f.source}, ${f.sourceVersion}`}>{f.source}</td>
                    <td>
                      <span className={`badge ${STATUS_BADGE[f.status]}`}>{statusText(f)}</span>
                      {f.status === 'DRAFT' && !f.shared && <div className="field__hint">{f.evidenceName ? 'evidence attached' : 'no evidence yet'}{f.basis ? '' : ' · no basis yet'}</div>}
                      {f.status === 'SUPERSEDED' && f.withdrawnReason && <div className="field__hint">{f.withdrawnReason}</div>}
                    </td>
                    <td className="nowrap">
                      <button type="button" className="button button--ghost button--small" onClick={() => setOpen(open?.id === f.id && open.panel === 'history' ? null : { id: f.id, panel: 'history' })}>{open?.id === f.id && open.panel === 'history' ? 'Hide' : 'History'}</button>
                      {manageable(f) && f.status === 'DRAFT' && (platform || canWrite) && <>
                        <button type="button" className="button button--ghost button--small" onClick={() => setForm({ editing: f })}>Edit</button>
                        <button type="button" className="button button--ghost button--small" onClick={() => upload(f)}>{f.evidenceName ? 'Replace evidence' : 'Attach evidence'}</button>
                        {platform
                          ? <button type="button" className="button button--small" onClick={() => setOpen({ id: f.id, panel: 'review' })}>Publish</button>
                          : <button type="button" className="button button--small" onClick={() => void submit(f)}>Submit for review</button>}
                      </>}
                      {!f.shared && f.status === 'IN_REVIEW' && canApprove && (mine(f)
                        ? <span className="field__hint">Another reviewer approves it</span>
                        : <button type="button" className="button button--small" onClick={() => setOpen({ id: f.id, panel: 'review' })}>Review</button>)}
                      {!f.shared && f.status === 'APPROVED' && canApprove && <button type="button" className="button button--ghost button--small" onClick={() => setForm({ editing: f })}>Edit</button>}
                      {manageable(f) && (f.status === 'APPROVED' || f.status === 'IN_USE') && (platform || canWrite) && <button type="button" className="button button--ghost button--small" onClick={() => setForm({ replacing: f })}>New version</button>}
                      {manageable(f) && (f.status === 'APPROVED' || f.status === 'IN_USE') && (platform || canSupersede) && <button type="button" className="button button--ghost button--small" onClick={() => void supersede(f)}>End-date</button>}
                    </td>
                  </tr>
                  {open?.id === f.id && open.panel === 'history' && <tr><td colSpan={9}><FactorHistory id={f.id} /></td></tr>}
                  {open?.id === f.id && open.panel === 'review' && <tr><td colSpan={9}>
                    <ReviewPanel factor={f} platform={platform} onCancel={() => setOpen(null)}
                      onApprove={(note) => act(() => apiPost(`/api/emission-factors/${f.id}/approve`, { ...CHECKS, note: note || null }), platform ? `${f.code} is published.` : `${f.code} is approved. Calculations use it from now on.`)}
                      onReturn={(comment) => act(() => apiPost(`/api/emission-factors/${f.id}/return`, { comment }), `${f.code} is returned to draft with your comments.`)} />
                  </td></tr>}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {data && <Pager data={data} onPage={(n) => go({ page: String(n) })} />}
      </section>
    </>
  )
}

// Section 3.2: the reviewer confirms four checks before approving, or returns the factor with comments.
// For the platform library the same panel records that the value was checked against the cited source.
function ReviewPanel({ factor: f, platform, onApprove, onReturn, onCancel }: { factor: EmissionFactor; platform: boolean; onApprove: (note: string) => void; onReturn: (comment: string) => void; onCancel: () => void }) {
  const items: Array<[string, string]> = [
    ['source', platform ? 'The value matches the cited table or dataset itself, not a secondary source.' : 'The source document is attached and says what the factor claims.'],
    ['units', 'The units are right for the activity, and the energy basis (NCV or GCV) is stated where it matters.'],
    ['tier', 'The tier matches the evidence (a site lab report is Tier 3; a trade publication is not).'],
    ['validity', 'The validity period is right and does not overlap another factor for the same activity and gas.'],
  ]
  const [ticked, setTicked] = useState<Record<string, boolean>>({})
  const [note, setNote] = useState('')
  const all = items.every(([k]) => ticked[k])
  return (
    <div className="stack stack--sm">
      <strong>{platform ? `Publish ${f.code}` : `Review ${f.code}`}</strong>
      {f.basis && <p className="field__hint"><strong>Basis:</strong> {f.basis}</p>}
      {f.evidenceName && <a className="field__hint" href={`${API_URL}/api/reference/emission-factors/${f.id}/evidence`}>Open the evidence: {f.evidenceName}</a>}
      {items.map(([k, text]) => (
        <label key={k} className="check-row"><input type="checkbox" checked={!!ticked[k]} onChange={(e) => setTicked({ ...ticked, [k]: e.target.checked })} /> {text}</label>
      ))}
      <input className="input" placeholder={platform ? 'Note (optional), e.g. checked against CEA v22 table 3' : 'Comment (required to return; optional to approve)'} value={note} onChange={(e) => setNote(e.target.value)} aria-label="Comment" />
      <div className="actions">
        <button type="button" className="button" disabled={!all} onClick={() => onApprove(note.trim())}>{platform ? 'Publish' : 'Approve'}</button>
        {!platform && <button type="button" className="button button--ghost" disabled={note.trim().length < 5} onClick={() => onReturn(note.trim())}>Return with comments</button>}
        <button type="button" className="button button--ghost" onClick={onCancel}>Cancel</button>
      </div>
      {!all && <p className="field__hint">Tick all four checks to {platform ? 'publish' : 'approve'}.</p>}
    </div>
  )
}

// The form offers only the gas and units accepted for the chosen activity; the server checks the same rules.
// A unit that is not offered is requested, never substituted.
function AddFactor({ platform, editing, replacing, onDone, onCancel, onRequestUnit }: { platform: boolean; editing?: EmissionFactor; replacing?: EmissionFactor; onDone: (code: string) => void; onCancel: () => void; onRequestUnit?: () => void }) {
  const activities = useLoad<ActivityTypeRef[]>('/api/reference/activity-types')
  const regions = useLoad<GridRegion[]>('/api/reference/grid-regions')
  const units = useLoad<UnitRef[]>('/api/reference/units')
  if (!activities.data || !regions.data || !units.data) return <States error={activities.error ?? regions.error ?? units.error} loading />
  const withFactors = activities.data.filter((a) => a.factorShapes?.length && (platform ? a.formulaCode !== 'C-21' : true))
  const shapes = (v: Values) => withFactors.find((a) => a.code === v.activityCode)?.factorShapes ?? []
  const uniq = (xs: string[]) => [...new Set(xs)].map((x) => ({ value: x, label: x }))
  // Grid and supplier heat factors convert between units of the same dimension, so those are offered too.
  const convertible = (v: Values) => ['C-06', 'C-21'].includes(withFactors.find((a) => a.code === v.activityCode)?.formulaCode ?? '') || v.activityCode === 'A-PPA'
  const denominators = (v: Values) => {
    const base = shapes(v).map((s) => s.denominatorUnit)
    if (!convertible(v)) return uniq(base)
    const dims = new Set(units.data!.filter((u) => base.includes(u.code)).map((u) => u.dimension))
    return uniq([...base, ...units.data!.filter((u) => dims.has(u.dimension)).map((u) => u.code)])
  }
  const numerators = (v: Values) => uniq([...shapes(v).filter((s) => s.gas === v.gas).map((s) => s.numeratorUnit), ...(convertible(v) ? ['tCO2e', 'kgCO2e'] : [])])
  const fugitive = (v: Values) => withFactors.find((a) => a.code === v.activityCode)?.formulaCode === 'C-05'
  const from = editing ?? replacing
  const title = editing ? `Edit ${editing.code}` : replacing ? `New version of ${replacing.code}` : platform ? 'Propose a platform factor' : 'New organisation factor'

  return (
    <section className="card card--spaced">
      <h2 className="card__title">{title}</h2>
      <p className="field__hint">
        {platform ? 'Platform factors come from a published document with an edition and date. It is saved as a draft and published after the value is checked against the source.'
          : 'Only your organisation sees and uses this factor, e.g. your steam supplier\'s disclosed factor or a site lab result. It is saved as a draft: attach the evidence, then submit it for a reviewer to approve.'}
        {replacing && ` When this version is approved, ${replacing.code} is end-dated the day before it starts.`}
        {' '}Only the units accepted for the activity are offered.
        {onRequestUnit && <> <button type="button" className="link link--button" onClick={onRequestUnit}>Can't find your unit? Request it.</button></>}
      </p>
      <FieldsForm
        fields={[
          ...(editing ? [] : [{ name: 'code', label: 'Factor ID (e.g. EF-0342)', required: true }]),
          { name: 'activityCode', label: 'Activity', type: 'searchable-select', required: true, options: withFactors.map((a) => ({ value: a.code, label: `${a.code}: ${a.name}` })) },
          { name: 'gas', label: 'Gas', type: 'select', required: true, optionsFor: (v) => uniq(shapes(v).map((s) => s.gas)) },
          { name: 'numeratorUnit', label: 'Factor unit', type: 'select', required: true, optionsFor: numerators },
          { name: 'denominatorUnit', label: 'Per unit', type: 'select', required: true, optionsFor: denominators },
          { name: 'gwpSet', label: 'GWP set (refrigerants and gases)', type: 'select', optionsFor: (v) => (fugitive(v) ? [{ value: 'AR6', label: 'AR6 (default)' }, { value: 'AR5', label: 'AR5' }] : [{ value: '', label: '(not a GWP)' }]) },
          { name: 'regionCode', label: 'Grid region (electricity only)', type: 'select', options: [{ value: '', label: '(not region-specific)' }, ...regions.data.map((r) => ({ value: r.code, label: r.name }))] },
          { name: 'value', label: 'Value (a number only, no units)', required: true },
          ...(platform ? [] : [{ name: 'carbonOrigin', label: 'Carbon origin', type: 'select' as const, required: true, options: [{ value: 'Fossil', label: 'Fossil' }, { value: 'Biogenic', label: 'Biogenic' }] }]),
          { name: 'validFrom', label: 'Valid from', type: 'date', required: true },
          { name: 'validTo', label: 'Valid to (empty = open-ended)', type: 'date' },
          { name: 'source', label: platform ? 'Source / publication' : 'Source document (e.g. supplier disclosure, lab report)', required: true },
          { name: 'sourceVersion', label: 'Version, edition or date of the source', required: true },
          { name: 'geography', label: 'Geography / site', required: true },
          platform ? { name: 'tier', label: 'Tier', required: true } : { name: 'tier', label: 'Tier', type: 'select' as const, required: true, options: TIERS.map((t) => ({ value: t, label: t })) },
          { name: 'basis', label: 'How the value was derived, and where it should not be used', required: !platform },
          { name: 'notes', label: 'Notes' },
        ]}
        initial={from
          ? { code: replacing ? '' : from.code, activityCode: from.activityCode ?? '', gas: from.gas, numeratorUnit: from.numeratorUnit, denominatorUnit: from.denominatorUnit, gwpSet: from.gwpSet ?? '', regionCode: from.regionCode ?? '', value: from.value, carbonOrigin: from.carbonOrigin === 'Biogenic' ? 'Biogenic' : 'Fossil', validFrom: replacing ? '' : from.validFrom.slice(0, 10), validTo: replacing ? '' : from.validTo?.slice(0, 10) ?? '', source: from.source, sourceVersion: replacing ? '' : from.sourceVersion, geography: from.geography, tier: from.tier, basis: from.basis ?? '', notes: from.notes ?? '' }
          : { code: '', activityCode: platform ? 'A-GRID' : '', gas: 'CO2e', numeratorUnit: 'tCO2e', denominatorUnit: 'MWh', gwpSet: '', regionCode: platform ? 'IN-ALL' : '', value: '', carbonOrigin: 'Fossil', validFrom: '', validTo: '', source: '', sourceVersion: '', geography: '', tier: platform ? 'Tier 2 country' : 'Tier 3 site-specific', basis: '', notes: '' }}
        submitLabel={editing ? 'Save' : 'Save as draft'}
        onSubmit={async (b) => {
          const body = { ...b, regionCode: b.regionCode || null, gwpSet: b.gwpSet || null, validTo: b.validTo || null, notes: b.notes || null, basis: b.basis || null, ...(replacing ? { supersedesId: replacing.id } : {}) }
          if (editing) delete (body as Record<string, unknown>).code
          const saved = editing
            ? await apiPatch<EmissionFactor>(`/api/emission-factors/${editing.id}`, body)
            : await apiPost<EmissionFactor>(platform ? '/api/platform/emission-factors' : '/api/emission-factors', body)
          onDone(saved.code)
        }}
        onCancel={onCancel}
      />
    </section>
  )
}

function UnitRequestForm({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const activities = useLoad<ActivityTypeRef[]>('/api/reference/activity-types')
  const ref = useRef<HTMLElement>(null)
  useEffect(() => { ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }) }, [activities.data])
  if (!activities.data) return <States error={activities.error} loading />
  return (
    <section ref={ref} className="card card--spaced" style={{ scrollMarginTop: 96 }}>
      <h2 className="card__title">Request a unit</h2>
      <p className="field__hint">Tell us which unit you need and we will add it.</p>
      <FieldsForm
        fields={[
          { name: 'activityCode', label: 'Activity', type: 'searchable-select', options: activities.data.map((a) => ({ value: a.code, label: `${a.code}: ${a.name}` })) },
          { name: 'unit', label: 'Unit you need (e.g. kg CO2 per tonne as received)', required: true },
          { name: 'reason', label: 'What the factor is and why this unit', required: true },
        ]}
        initial={{ activityCode: '', unit: '', reason: '' }}
        submitLabel="Send request"
        onSubmit={async (b) => { await apiPost('/api/unit-requests', { ...b, activityCode: b.activityCode || null }); onDone() }}
        onCancel={onCancel}
      />
    </section>
  )
}

// Platform library change log (what was published or end-dated) and this organisation's unit requests.
function LibraryUpdates({ switcher }: { switcher: ReactNode }) {
  const { me } = useAuth()
  const canRequest = me?.permissions.includes('factor.write') ?? false
  const updates = useLoad<LibraryUpdate[]>('/api/reference/library-updates')
  const requests = useLoad<UnitRequest[]>('/api/unit-requests')
  const [requesting, setRequesting] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  return (
    <>
      <Header title="Factors & Fuel Data" subtitle="Recent library changes and your unit requests." />
      {switcher}
      <div className="callout">
        <Info size={18} />
        <span><em>A new edition never changes a result already calculated. Calculations take the factor in force at the start of the reporting period, so an open period keeps the version it started with.</em></span>
      </div>
      <section className="card">
        <h2 className="card__title">Platform library updates</h2>
        <States error={updates.error} loading={!updates.data} empty={updates.data?.length === 0 && 'No platform library changes yet.'} />
        {!!updates.data?.length && (
          <div className="table-wrap"><table className="table">
            <thead><tr><th>When</th><th>Change</th><th>Factor</th><th className="num">Value</th><th>Valid</th><th>Source</th></tr></thead>
            <tbody>{updates.data.map((u, i) => (
              <tr key={i}>
                <td className="nowrap">{day(u.at)}</td>
                <td><span className={`badge ${u.action === 'published' ? 'badge--approved' : 'badge--soft'}`}>{u.action}</span>{u.reason && <div className="field__hint">{u.reason}</div>}</td>
                <td>{u.factor.activityType?.name ?? 'All activities'}<div className="field__hint">{u.factor.code} · {u.factor.gas}</div></td>
                <td className="num">{plain(u.factor.value)} <span className="field__hint">{u.factor.numeratorUnit}/{u.factor.denominatorUnit}</span></td>
                <td className="nowrap">{day(u.factor.validFrom)} to {u.factor.validTo ? day(u.factor.validTo) : 'open-ended'}</td>
                <td>{u.factor.source}<div className="field__hint">{u.factor.sourceVersion}</div></td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </section>
      <Notify message={notice} />
      {requesting && <UnitRequestForm onDone={() => { setRequesting(false); setNotice('Unit requested. The answer will appear below.'); requests.reload() }} onCancel={() => setRequesting(false)} />}
      <section className="card">
        <div className="actions" style={{ justifyContent: 'space-between' }}>
          <h2 className="card__title">Your unit requests</h2>
          {canRequest && !requesting && <button type="button" className="button button--small" onClick={() => { setNotice(null); setRequesting(true) }}><Plus size={14} /> Request a unit</button>}
        </div>
        <p className="field__hint">Can't find the unit you need? Ask us to add it.</p>
        <UnitRequestTable data={requests.data ?? undefined} error={requests.error} />
      </section>
    </>
  )
}

export function UnitRequestTable({ data, error, onResolve }: { data?: UnitRequest[]; error?: string | null; onResolve?: (r: UnitRequest, status: 'ADDED' | 'DECLINED') => void }) {
  return (
    <>
      <States error={error ?? null} loading={!data} empty={data?.length === 0 && 'No unit requests.'} />
      {!!data?.length && (
        <div className="table-wrap"><table className="table">
          <thead><tr><th>Requested</th>{onResolve && <th>Organisation</th>}<th>Unit</th><th>Why</th><th>Answer</th>{onResolve && <th aria-label="Actions" />}</tr></thead>
          <tbody>{data.map((r) => (
            <tr key={r.id}>
              <td className="nowrap">{day(r.createdAt)}<div className="field__hint">{r.requestedBy.name}</div></td>
              {onResolve && <td>{r.organization?.name ?? '—'}</td>}
              <td><strong>{r.unit}</strong>{r.activityCode && <div className="field__hint">{r.activityCode}</div>}</td>
              <td className="cell--medium">{r.reason}</td>
              <td><span className={`badge ${r.status === 'OPEN' ? 'badge--warning' : r.status === 'ADDED' ? 'badge--approved' : 'badge--soft'}`}>{r.status.toLowerCase()}</span>{r.resolution && <div className="field__hint">{r.resolution}</div>}</td>
              {onResolve && <td className="nowrap">{r.status === 'OPEN' && <>
                <button type="button" className="button button--ghost button--small" onClick={() => onResolve(r, 'ADDED')}>Mark added</button>
                <button type="button" className="button button--ghost button--small" onClick={() => onResolve(r, 'DECLINED')}>Decline</button>
              </>}</td>}
            </tr>
          ))}</tbody>
        </table></div>
      )}
    </>
  )
}

interface Version { id: string; code: string; value: string; numeratorUnit: string; denominatorUnit: string; source: string; sourceVersion: string; validFrom: string; validTo: string | null; status: string; changePercent: number | null; results: number; inLockedPeriods: number; organizations: number | null }
interface History { status: string; label: string; results: number; basis: string | null; approvalNote: string | null; evidenceName: string | null; supersedes: string | null; events: Array<{ action: string; actor: string | null; reason: string | null; at: string }> }
const EVENT: Record<string, string> = {
  'emission_factor.seeded': 'Loaded from the reference library', 'emission_factor.created': 'Created as a draft', 'emission_factor.updated': 'Edited',
  'emission_factor.evidence_attached': 'Evidence attached', 'emission_factor.submitted': 'Submitted for review', 'emission_factor.returned': 'Returned with comments',
  'emission_factor.approved': 'Approved', 'emission_factor.published': 'Published', 'emission_factor.in_use': 'In use (first used by a calculation)',
  'emission_factor.superseded': 'Superseded / end-dated', 'emission_factor.activated': 'Activated', 'emission_factor.withdrawn': 'Withdrawn',
}

// Who created, submitted, approved or end-dated it, its basis and evidence; every version and where each was used.
function FactorHistory({ id }: { id: string }) {
  const versions = useLoad<{ platform: boolean; versions: Version[] }>(`/api/reference/emission-factors/${id}/versions`)
  const history = useLoad<History>(`/api/reference/emission-factors/${id}/history`)
  if (!versions.data || !history.data) return <States error={versions.error ?? history.error} loading />
  const data = versions.data
  const h = history.data
  return (
    <div className="stack stack--sm">
      <p className="field__hint"><strong>{h.label}</strong>{h.supersedes && ` · replaces ${h.supersedes}`}</p>
      {h.basis && <p className="field__hint"><strong>Basis:</strong> {h.basis}</p>}
      {h.evidenceName && <a className="field__hint" href={`${API_URL}/api/reference/emission-factors/${id}/evidence`}>Evidence: {h.evidenceName}</a>}
      {h.approvalNote && <p className="field__hint"><strong>Approval note:</strong> {h.approvalNote}</p>}
      <ul className="stack stack--sm">
        {h.events.map((e, i) => (
          <li key={i}><strong>{EVENT[e.action] ?? e.action}</strong> · {day(e.at)}{e.actor && ` · ${e.actor}`}{e.reason && <span className="field__hint"> · {e.reason}</span>}</li>
        ))}
      </ul>
      <div className="table-wrap">
        <table className="table">
          <thead><tr><th>Version</th><th className="num">Value</th><th className="num">Change</th><th>Valid</th><th>Status</th><th className="num">Results using it{data.platform ? ' (organisations)' : ''}</th><th className="num">In locked periods</th></tr></thead>
          <tbody>{data.versions.map((v) => (
            <tr key={v.id} className={v.id === id ? 'is-selected' : undefined}>
              <td>{v.code}<div className="field__hint">{v.source} {v.sourceVersion}</div></td>
              <td className="num">{plain(v.value)} <span className="field__hint">{v.numeratorUnit}/{v.denominatorUnit}</span></td>
              <td className="num">{v.changePercent === null ? '—' : `${v.changePercent > 0 ? '+' : ''}${v.changePercent.toFixed(2)}%`}</td>
              <td className="nowrap">{day(v.validFrom)} to {v.validTo ? day(v.validTo) : 'open-ended'}</td>
              <td>{v.status.replace('_', ' ').toLowerCase()}</td>
              <td className="num">{v.results}{v.organizations !== null && ` (${v.organizations})`}</td>
              <td className="num">{v.inLockedPeriods}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>
      <p className="field__hint">Past results keep the factor they were calculated with. A new version applies the next time you calculate.</p>
    </div>
  )
}

// Platform team view: the platform library, and the units organisations have asked for.
export function PlatformFactors() {
  const [params, setParams] = useSearchParams()
  const view = params.get('view') ?? ''
  const requests = useLoad<UnitRequest[]>(view === 'requests' ? '/api/unit-requests' : '')
  const dialog = useDialog()
  const [msg, setMsg] = useState<{ ok?: string; err?: string }>({})
  const switcher = <Tabs label="Platform library" active={view} onChange={(k) => setParams(k ? { view: k } : {})} tabs={[
    { key: '', label: 'Platform library' },
    { key: 'requests', label: 'Unit requests', count: requests.data?.filter((r) => r.status === 'OPEN').length },
  ]} />
  if (view !== 'requests') return <EmissionFactorsPage canAdd switcher={switcher} />
  const resolve = async (r: UnitRequest, status: 'ADDED' | 'DECLINED') => {
    const resolution = await dialog.prompt({
      title: status === 'ADDED' ? `Mark "${r.unit}" as added` : `Decline "${r.unit}"`,
      message: status === 'ADDED' ? 'Confirm the unit is now in the controlled list, and tell the requester how to choose it.' : 'Explain how to express the factor with the units that are offered.',
      input: { label: 'Answer for the requester', required: true }, confirmLabel: status === 'ADDED' ? 'Mark added' : 'Decline',
    })
    if (!resolution) return
    try { await apiPost(`/api/platform/unit-requests/${r.id}/resolve`, { status, resolution }); setMsg({ ok: 'Answered.' }); requests.reload() } catch (e) { setMsg({ err: (e as Error).message }) }
  }
  return (
    <>
      <Header title="Emission Factors" subtitle="Units that organisations have asked to be added." />
      {switcher}
      <Notify message={msg.ok} /><Notify kind="error" message={msg.err} />
      <section className="card"><UnitRequestTable data={requests.data ?? undefined} error={requests.error} onResolve={(r, s) => void resolve(r, s)} /></section>
    </>
  )
}
