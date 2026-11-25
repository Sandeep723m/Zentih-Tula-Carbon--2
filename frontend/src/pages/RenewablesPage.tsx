import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { useDialog } from '../components/Dialog'
import { Header, States } from '../components/Page'
import { Notify } from '../components/Toast'
import { useLoad } from '../hooks/useLoad'
import { apiDelete, apiPost } from '../services/apiClient'
import type { ReportingPeriod } from '../types/api'

interface Check { code: string; ok: boolean; message: string }
interface Instrument { id: string; type: string; reference: string; issuer: string | null; supplier: string | null; quantityMWh: string; generationFrom: string; generationTo: string; country: string | null; retiredAt: string | null; retiredForOrg: boolean; allocated: number; remaining: number; checks: Check[] }
interface Summary {
  rulesVersion: string; consumptionMWh: number; coveredMWh: number; notCoveredMWh: number; ineligibleMWh: number; locationTCO2e: number | null; marketTCO2e: number | null
  rows: Array<{ id: string; record: string; status: string; consumedMWh: number; eligibleMWh: number; recordInstrumentMWh: number; matchesRecord: boolean; allocations: Array<{ id: string; instrument: string; mwh: number; eligible: boolean; checks: Check[] }> }>
}
const TYPES: Record<string, string> = { I_REC: 'I-REC', REC: 'REC', PPA: 'Power purchase agreement', GREEN_TARIFF: 'Green supply contract', OTHER_EAC: 'Other certificate' }
const n = (v: number | null) => (v === null ? '—' : v.toLocaleString(undefined, { maximumFractionDigits: 3 }))
const EMPTY = { type: 'I_REC', reference: '', issuer: '', supplier: '', quantityMWh: '', generationFrom: '', generationTo: '', country: '' }

// Renewable electricity instruments and what they cover. Each claim is checked against the eligibility criteria; only
// claims that pass every one count, and only market-based Scope 2 changes.
export default function RenewablesPage() {
  const [params, setParams] = useSearchParams()
  const { me } = useAuth()
  const canManage = me?.permissions.includes('renewables.manage') ?? false
  const dialog = useDialog()
  const periods = useLoad<ReportingPeriod[]>('/api/reporting-periods').data ?? []
  const periodId = params.get('period') ?? periods.at(-1)?.id ?? ''
  const list = useLoad<{ rulesVersion: string; rows: Instrument[] }>('/api/renewables')
  const summary = useLoad<Summary>(periodId ? `/api/renewables/summary?reportingPeriodId=${periodId}` : '')
  const [form, setForm] = useState(EMPTY)
  const [alloc, setAlloc] = useState({ instrumentId: '', recordId: '', mwh: '' })
  const [msg, setMsg] = useState<{ ok?: string; err?: string }>({})
  const act = async (run: () => Promise<unknown>, ok: string) => { setMsg({}); try { await run(); setMsg({ ok }); list.reload(); summary.reload(); return true } catch (e) { setMsg({ err: (e as Error).message }); return false } }
  const register = async () => { if (await act(() => apiPost('/api/renewables', { ...form, issuer: form.issuer || null, supplier: form.supplier || null, country: form.country || null }), 'Instrument registered.')) setForm(EMPTY) }
  const retire = async (i: Instrument) => {
    const date = await dialog.prompt({ title: `Record retirement of ${i.reference}`, message: 'Confirm it was retired or cancelled on your organisation\'s behalf.', input: { label: 'Retirement date (YYYY-MM-DD)', required: true }, confirmLabel: 'Record retirement' })
    if (date) await act(() => apiPost(`/api/renewables/${i.id}/retire`, { retiredAt: date, retiredForOrg: true }), 'Retirement recorded.')
  }
  const allocate = async () => { if (await act(() => apiPost(`/api/renewables/${alloc.instrumentId}/allocations`, { activityRecordId: alloc.recordId, mwh: alloc.mwh }), 'Allocated.')) setAlloc({ instrumentId: '', recordId: '', mwh: '' }) }
  const s = summary.data
  return (
    <>
      <Header title="Renewable Energy" subtitle="Renewable energy certificates and contracts, and the electricity they cover." />
      <Notify message={msg.ok} /><Notify kind="error" message={msg.err} />
      <div className="filters">
        <select className="input" aria-label="Reporting period" value={periodId} onChange={(e) => setParams({ period: e.target.value })}>{periods.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
      </div>
      {s && (
        <>
          <div className="stats">
            <div className="stat"><span className="stat__value">{n(s.consumptionMWh)}</span><span className="stat__label">MWh electricity used</span></div>
            <div className="stat"><span className="stat__value">{n(s.coveredMWh)}</span><span className="stat__label">MWh covered by eligible claims</span></div>
            <div className="stat"><span className="stat__value">{n(s.notCoveredMWh)}</span><span className="stat__label">MWh not covered</span></div>
            <div className="stat"><span className="stat__value">{n(s.ineligibleMWh)}</span><span className="stat__label">MWh allocated but not eligible</span></div>
            <div className="stat"><span className="stat__value">{n(s.locationTCO2e)}</span><span className="stat__label">tCO2e location-based</span></div>
            <div className="stat"><span className="stat__value">{n(s.marketTCO2e)}</span><span className="stat__label">tCO2e market-based (from the last calculation)</span></div>
          </div>
          <section className="card">
            <h2 className="card__title">Electricity records and their claims</h2>
            <p className="field__hint">Checked against: {s.rulesVersion}. A record's market-based result uses the instrument MWh entered on the record; when it differs from the eligible claims, correct the record through the normal edit and review steps.</p>
            {!s.rows.length ? <p className="status">No electricity records in this period.</p> : (
              <div className="table-wrap">
                <table className="table">
                  <thead><tr><th>Record</th><th className="num">Used (MWh)</th><th>Claims</th><th className="num">Eligible (MWh)</th><th>On the record</th></tr></thead>
                  <tbody>{s.rows.map((r) => (
                    <tr key={r.id}>
                      <td>{r.record}</td><td className="num">{n(r.consumedMWh)}</td>
                      <td>{!r.allocations.length ? '—' : r.allocations.map((a) => (
                        <div key={a.id} className="stack stack--xs">
                          <span><span className={`badge ${a.eligible ? 'badge--success' : 'badge--error'}`}>{a.eligible ? 'Eligible' : 'Not eligible'}</span> {a.instrument}: {n(a.mwh)} MWh
                            {canManage && <> <button type="button" className="button button--ghost button--small" onClick={() => void act(() => apiDelete(`/api/renewables/allocations/${a.id}`), 'Allocation removed.')}>Remove</button></>}</span>
                          {!a.eligible && <span className="field__hint">{a.checks.filter((c) => !c.ok).map((c) => c.message).join(' ')}</span>}
                        </div>
                      ))}</td>
                      <td className="num">{n(r.eligibleMWh)}</td>
                      <td>{r.matchesRecord ? <span className="badge badge--success">Matches</span> : <span className="badge badge--warning">{n(r.recordInstrumentMWh)} MWh entered</span>}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
      <section className="card">
        <h2 className="card__title">Instruments</h2>
        <States error={list.error} loading={!list.data} empty={list.data?.rows.length === 0 && 'No instruments registered yet.'} />
        {!!list.data?.rows.length && (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Instrument</th><th>Generated</th><th className="num">MWh (left)</th><th>Checks</th><th /></tr></thead>
              <tbody>{list.data.rows.map((i) => (
                <tr key={i.id}>
                  <td>{TYPES[i.type]} {i.reference}<div className="field__hint">{[i.issuer, i.supplier, i.country].filter(Boolean).join(' · ')}</div></td>
                  <td className="nowrap">{i.generationFrom.slice(0, 10)} to {i.generationTo.slice(0, 10)}</td>
                  <td className="num">{n(Number(i.quantityMWh))} ({n(i.remaining)})</td>
                  <td>{i.checks.map((c) => <div key={c.code} className="field__hint">{c.ok ? '✓' : '✗'} {c.message}</div>)}</td>
                  <td>{canManage && !i.retiredAt && <button type="button" className="button button--ghost button--small" onClick={() => void retire(i)}>Record retirement</button>}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
        {canManage && !!list.data?.rows.length && !!s?.rows.length && (
          <div className="filters">
            <select className="input" aria-label="Instrument" value={alloc.instrumentId} onChange={(e) => setAlloc({ ...alloc, instrumentId: e.target.value })}><option value="">Instrument…</option>{list.data.rows.filter((i) => i.remaining > 0).map((i) => <option key={i.id} value={i.id}>{TYPES[i.type]} {i.reference} ({n(i.remaining)} MWh left)</option>)}</select>
            <select className="input" aria-label="Electricity record" value={alloc.recordId} onChange={(e) => setAlloc({ ...alloc, recordId: e.target.value })}><option value="">Electricity record…</option>{s.rows.map((r) => <option key={r.id} value={r.id}>{r.record}</option>)}</select>
            <input className="input" inputMode="decimal" placeholder="MWh" aria-label="MWh to allocate" value={alloc.mwh} onChange={(e) => setAlloc({ ...alloc, mwh: e.target.value })} />
            <button type="button" className="button" disabled={!alloc.instrumentId || !alloc.recordId || !alloc.mwh} onClick={() => void allocate()}>Allocate</button>
          </div>
        )}
      </section>
      {canManage && (
        <section className="card">
          <h2 className="card__title">Register an instrument</h2>
          <div className="grid-cols">
            <label className="field"><span className="field__label">Type</span><select className="input" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>{Object.entries(TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
            <label className="field"><span className="field__label">Certificate or contract reference</span><input className="input" value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} /></label>
            <label className="field"><span className="field__label">Issuer</span><input className="input" value={form.issuer} onChange={(e) => setForm({ ...form, issuer: e.target.value })} /></label>
            <label className="field"><span className="field__label">Supplier</span><input className="input" value={form.supplier} onChange={(e) => setForm({ ...form, supplier: e.target.value })} /></label>
            <label className="field"><span className="field__label">Electricity covered (MWh)</span><input className="input" inputMode="decimal" value={form.quantityMWh} onChange={(e) => setForm({ ...form, quantityMWh: e.target.value })} /></label>
            <label className="field"><span className="field__label">Generated from</span><input className="input" type="date" value={form.generationFrom} onChange={(e) => setForm({ ...form, generationFrom: e.target.value })} /></label>
            <label className="field"><span className="field__label">Generated to</span><input className="input" type="date" value={form.generationTo} onChange={(e) => setForm({ ...form, generationTo: e.target.value })} /></label>
            <label className="field"><span className="field__label">Market (country)</span><input className="input" placeholder="e.g. India" value={form.country} onChange={(e) => setForm({ ...form, country: e.target.value })} /></label>
          </div>
          <div className="actions"><button type="button" className="button" disabled={!form.reference || !form.quantityMWh || !form.generationFrom || !form.generationTo} onClick={() => void register()}>Register</button></div>
        </section>
      )}
    </>
  )
}
