import { useEffect, useState, type ChangeEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Ban, CircleCheck, CircleDashed, FileUp, Link2, Loader, RotateCw, Trash2, TriangleAlert, Undo2 } from 'lucide-react'
import { useDialog } from '../components/Dialog'
import { Header, Skeleton, States } from '../components/Page'
import { Pager, type Page } from '../components/Pager'
import { Tabs } from '../components/Tabs'
import { Notify } from '../components/Toast'
import { useLoad } from '../hooks/useLoad'
import { API_URL, apiDelete, apiPatch, apiPost, apiUpload } from '../services/apiClient'
import type { SourceCategory } from '../types/api'

type Status = 'PENDING' | 'PROCESSING' | 'EXTRACTED' | 'FAILED'
type Stage = 'RECEIVED' | 'PROCESSING' | 'FAILED' | 'NEEDS_CORRECTION' | 'AWAITING_REVIEW' | 'MATCHED' | 'SUBMITTED' | 'REJECTED'
interface Doc {
  id: string; fileName: string; mimeType: string; sizeBytes: number; status: Status; stage: Stage; invoiceCount: number; attempts: number; errorMessage: string | null
  documentType: string | null; category: string | null; duplicateOfId: string | null; rejectedAt: string | null; rejectReason: string | null
  activityRecordId: string | null; createdAt: string; updatedAt: string; uploadedBy: { name: string }
}
interface Extraction {
  documentType: string; confidence: number; supplier: string | null; documentNumber: string | null; documentDate: string | null
  periodStart: string | null; periodEnd: string | null; activityDate?: string | null; quantity: string | null; unit: string | null; material: string | null; site: string | null
  // Absent on documents read before these were added
  otherItems?: string | null; density?: string | null; supplierFactor?: string | null; customerName?: string | null; meterPrevious?: string | null; meterCurrent?: string | null
  ncv?: string | null; totalAmount?: string | null; taxAmount?: string | null; currency?: string | null
}
interface RecordRef { id: string; status: string; startDate: string; endDate: string; quantity: string; unit: string; facility: { id: string; code: string; name: string }; emissionSource: { id: string; name: string } }
interface Detail extends Doc {
  invoices: Extraction[]
  matches: Array<{ invoiceIndex: number; withEvidence: boolean; activityRecord: RecordRef }>
  corrections: Array<{ invoiceIndex: number; field: string; before: string | null; after: string | null; createdAt: string }>
  duplicateOf: { id: string; fileName: string } | null
  candidates: RecordRef[][]
  recurring: { count: number; facilityId: string; emissionSourceId: string } | null
}
export interface DocumentPrefill {
  documentId: string; documentName: string; invoiceIndex: number; fileUrl: string; mimeType: string
  category: SourceCategory | ''; site: string | null; suggestion: { facilityId: string; emissionSourceId: string } | null; checks: string[]
  values: Partial<Record<'startDate' | 'endDate' | 'quantity' | 'unit' | 'notes', string>>
}

// What the person must look at on the form. Printed density, NCV and supplier figures are shown, never applied.
function checksFor(r: Extraction): string[] {
  const missing = [!(r.periodStart || r.activityDate) && 'start date', !(r.periodEnd || r.activityDate) && 'end date', !r.quantity && 'quantity', !r.unit && 'unit'].filter(Boolean)
  const metered = r.meterPrevious && r.meterCurrent ? Number(r.meterCurrent) - Number(r.meterPrevious) : null
  return [
    r.confidence < 0.6 && 'This document was hard to read. Check every value with extra care.',
    missing.length > 0 && `We could not find ${missing.join(', ')} on the document. Please enter them yourself.`,
    r.otherItems && r.documentType !== 'OTHER' && `The document also lists ${r.otherItems}. Only the first item is filled in. Enter any other fuels or materials as separate records.`,
    metered !== null && r.quantity && metered !== Number(r.quantity) && `The meter readings differ by ${metered.toLocaleString()}, but the billed quantity is ${Number(r.quantity).toLocaleString()}. Check which one applies.`,
    r.density && `The document states a density of ${r.density}. Enter it below if needed.`,
    r.ncv && `The document states a calorific value of ${r.ncv}. Enter it below if needed.`,
    r.supplierFactor && `The document states a supplier emission figure of ${r.supplierFactor}. Enter it below if needed.`,
    r.site && `The document names the site ${r.site}. Check the facility matches.`,
  ].filter((c): c is string => !!c)
}

const TYPE_LABEL: Record<string, string> = {
  ELECTRICITY_BILL: 'Electricity bill', FUEL_INVOICE: 'Fuel or LPG invoice', REFRIGERANT_SERVICE: 'Refrigerant service report', STEAM_HEAT_INVOICE: 'Steam or heat invoice',
  PRODUCTION_LOG: 'Production log', CO2_RECOVERY_LOG: 'CO₂ recovery log', METER_READING: 'Meter reading', WATER_BILL: 'Water bill', WASTE_INVOICE: 'Waste invoice', OTHER: 'Other document',
}
const TYPE_CATEGORY: Record<string, SourceCategory> = {
  ELECTRICITY_BILL: 'PURCHASED_ELECTRICITY', FUEL_INVOICE: 'FUEL_COMBUSTION', REFRIGERANT_SERVICE: 'FUGITIVE_GAS', STEAM_HEAT_INVOICE: 'PURCHASED_ENERGY', PRODUCTION_LOG: 'PROCESS', CO2_RECOVERY_LOG: 'REMOVAL',
}
const STAGE: Record<Stage, { label: string; badge: string; icon: typeof CircleCheck }> = {
  RECEIVED: { label: 'Received', badge: '', icon: CircleDashed },
  PROCESSING: { label: 'Reading', badge: 'badge--soft', icon: Loader },
  FAILED: { label: 'Failed, retry available', badge: 'badge--error', icon: TriangleAlert },
  NEEDS_CORRECTION: { label: 'Needs correction', badge: 'badge--warning', icon: TriangleAlert },
  AWAITING_REVIEW: { label: 'Awaiting your review', badge: 'badge--soft', icon: CircleCheck },
  MATCHED: { label: 'Matched with a record', badge: 'badge--success', icon: Link2 },
  SUBMITTED: { label: 'Submitted for approval', badge: 'badge--success', icon: CircleCheck },
  REJECTED: { label: 'Rejected', badge: 'badge--error', icon: Ban },
}
const FIELD_LABEL: Record<string, string> = { quantity: 'Quantity', unit: 'Unit', startDate: 'From', endDate: 'To', documentType: 'Document type' }
// Bills write units many ways; the entry form uses these codes. Anything else is left for the person to choose.
const UNIT_CODES: Record<string, string> = {
  l: 'l', ltr: 'l', ltrs: 'l', litre: 'l', litres: 'l', liter: 'l', liters: 'l', kl: 'kl', kwh: 'kWh', units: 'kWh', mwh: 'MWh', gj: 'GJ', kg: 'kg', kgs: 'kg', t: 't', mt: 't', tonne: 't', tonnes: 't', ton: 't', tons: 't', km: 'km', scm: 'SCM',
}
const unitCode = (u: string | null) => (u ? UNIT_CODES[u.trim().toLowerCase()] ?? u : undefined)
const inProgress = (s: Status) => s === 'PENDING' || s === 'PROCESSING'
const confidence = (c: number) => (c >= 0.85 ? { label: 'High confidence', badge: 'badge--success' } : c >= 0.6 ? { label: 'Medium confidence', badge: 'badge--warning' } : { label: 'Low confidence', badge: 'badge--error' })
const fileUrl = (id: string) => `${API_URL}/api/documents/${id}/file`
const day = (s: string) => s.slice(0, 10)

// Upload bills in bulk, let them be read automatically, check the values, then continue in the normal entry form.
export default function DocumentsPage() {
  const [params, setParams] = useSearchParams()
  const status = params.get('status') ?? ''
  const page = params.get('page') ?? '1'
  const selectedId = params.get('id') ?? ''
  const list = useLoad<Page<Doc> & { counts: Partial<Record<Status, number>> }>(`/api/documents?page=${page}${status ? `&status=${status}` : ''}`)
  const [progress, setProgress] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const rows = list.data?.rows ?? []
  const waiting = rows.some((d) => inProgress(d.status))
  const { reload } = list

  // Reading happens in the background: refresh until nothing on screen is still in progress.
  useEffect(() => {
    if (!waiting) return
    const t = window.setInterval(reload, 3000)
    return () => window.clearInterval(t)
  }, [waiting, reload])

  const set = (patch: Record<string, string>) => {
    const next = new URLSearchParams(params)
    for (const [k, v] of Object.entries(patch)) if (v) next.set(k, v); else next.delete(k)
    setParams(next)
  }

  // One file at a time keeps each failure separate: a refused file never stops the rest of the batch.
  const pick = async (e: ChangeEvent<HTMLInputElement>) => {
    const files = [...(e.target.files ?? [])]
    e.target.value = ''
    if (!files.length) return
    setError(null); setNotice(null)
    const failed: string[] = []
    let done = 0, last: Doc | null = null
    for (const [i, f] of files.entries()) {
      setProgress(`Uploading ${i + 1} of ${files.length}…`)
      try { last = await apiUpload<Doc>('/api/documents', f); done += 1 } catch (err) { failed.push((err as Error).message) }
    }
    setProgress(null)
    if (done) setNotice(`${done} document${done > 1 ? 's' : ''} uploaded. Reading has started.`)
    if (failed.length) setError(failed.join(' '))
    if (last) set({ id: last.id, status: '', page: '' })
    reload()
  }

  const selected = rows.find((d) => d.id === selectedId)

  return (
    <>
      <Header title="Document Intelligence Centre" subtitle="Upload bills and invoices and check the values before saving." />
      <Notify message={notice} />
      <Notify kind="error" message={error} />

      <label className={`dropzone ${progress ? 'is-loading' : ''}`}>
        <input className="dropzone__input" type="file" multiple accept=".pdf,.png,.jpg,.jpeg,.csv" disabled={!!progress} onChange={(e) => void pick(e)} aria-label="Upload documents" />
        <span className="dropzone__icon"><FileUp size={20} /></span>
        <span className="dropzone__title">{progress ?? 'Drop files here, or click to choose'}</span>
        <span className="field__hint">PDF, PNG, JPG or CSV, up to 10 MB each. A PDF holding several invoices is read as separate invoices. Files are always kept, even if reading fails.</span>
      </label>

      <div className="documents">
        <section className="card">
          <Tabs small label="Document status" active={status} onChange={(k) => set({ status: k, page: '', id: '' })} tabs={[
            { key: '', label: 'All' },
            { key: 'EXTRACTED', label: 'Read', count: list.data?.counts.EXTRACTED ?? 0 },
            { key: 'FAILED', label: 'Failed', count: list.data?.counts.FAILED ?? 0, alert: true },
          ]} />
          <States error={list.error} loading={!list.data} empty={list.data?.total === 0 && 'No documents here yet.'} />
          {!!rows.length && (
            <ul className="list">
              {rows.map((d) => {
                const s = STAGE[d.stage], Icon = s.icon
                const type = d.category ?? d.documentType
                return (
                  <li key={d.id}>
                    <button type="button" className={`list__item doc-row ${d.id === selectedId ? 'is-selected' : ''}`} onClick={() => set({ id: d.id })}>
                      <span className="doc-row__main">
                        <span className="list__title doc-row__name">{d.fileName}</span>
                        <span className="list__meta">{type ? TYPE_LABEL[type] : 'Not read yet'}{d.invoiceCount > 1 && ` · ${d.invoiceCount} invoices`} · {d.uploadedBy.name}, {new Date(d.createdAt).toLocaleDateString()}</span>
                      </span>
                      <span className={`badge ${s.badge}`}><Icon size={12} className={inProgress(d.status) ? 'doc-spin' : undefined} /> {s.label}</span>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
          {list.data && <Pager data={list.data} onPage={(n) => set({ page: String(n) })} />}
        </section>

        {selected
          ? <DocumentDetail key={selected.id} doc={selected} onChanged={reload} onGone={() => { set({ id: '' }); reload() }} onNotice={setNotice} onError={setError} />
          : <section className="card empty-state"><p>Select a document to check what was read.</p></section>}
      </div>
    </>
  )
}

function DocumentDetail({ doc, onChanged, onGone, onNotice, onError }: { doc: Doc; onChanged: () => void; onGone: () => void; onNotice: (m: string | null) => void; onError: (m: string | null) => void }) {
  const navigate = useNavigate()
  const dialog = useDialog()
  // The version in the path reloads the values when the list sees the document change.
  const detail = useLoad<Detail>(`/api/documents/${doc.id}?v=${encodeURIComponent(doc.updatedAt)}`)
  const d = detail.data
  const [index, setIndex] = useState(0)
  const [busy, setBusy] = useState(false)
  const r = d?.invoices[index] ?? null
  const match = d?.matches.find((m) => m.invoiceIndex === index)
  const type = d?.category ?? r?.documentType ?? ''

  const act = async (run: () => Promise<unknown>, done: string) => {
    setBusy(true); onError(null); onNotice(null)
    try { await run(); onNotice(done); detail.reload(); onChanged() } catch (e) { onError((e as Error).message) } finally { setBusy(false) }
  }
  const retry = () => act(() => apiPost(`/api/documents/${doc.id}/retry`), 'Reading again.')
  const recategorise = (category: string) => act(() => apiPatch(`/api/documents/${doc.id}/category`, { category }), 'Document type updated.')
  const linkTo = (rec: RecordRef) => act(() => apiPost(`/api/documents/${doc.id}/link`, { activityRecordId: rec.id, invoiceIndex: index }), 'Matched with the existing record.')
  const reject = async () => {
    const reason = await dialog.prompt({ title: 'Reject this document?', message: 'It is kept and can be restored later. No record is created from it.', input: { label: 'Why is it rejected', required: true }, confirmLabel: 'Reject', danger: true })
    if (reason !== null) await act(() => apiPost(`/api/documents/${doc.id}/reject`, { reason }), 'Document rejected.')
  }
  const restore = () => act(() => apiPost(`/api/documents/${doc.id}/reject?undo=1`, {}), 'Document restored.')
  const remove = async () => {
    const ok = await dialog.confirm({ title: 'Delete this document?', message: doc.activityRecordId ? 'Copies attached to records are kept as their evidence.' : 'The uploaded file is deleted. This cannot be undone.', confirmLabel: 'Delete', danger: true })
    if (!ok) return
    onError(null); onNotice(null)
    try { await apiDelete(`/api/documents/${doc.id}`); onNotice('Document deleted.'); onGone() } catch (e) { onError((e as Error).message) }
  }
  const openForm = () => {
    const prefill: DocumentPrefill = {
      documentId: doc.id, documentName: doc.fileName, invoiceIndex: index, fileUrl: fileUrl(doc.id), mimeType: doc.mimeType,
      category: TYPE_CATEGORY[type] ?? '', site: r?.site ?? null, checks: r ? checksFor(r) : [],
      suggestion: d?.recurring ? { facilityId: d.recurring.facilityId, emissionSourceId: d.recurring.emissionSourceId } : null,
      values: r ? {
        // The issue date is not when the activity happened, so it never fills these.
        startDate: r.periodStart ?? r.activityDate ?? undefined, endDate: r.periodEnd ?? r.activityDate ?? undefined,
        quantity: r.quantity ?? undefined, unit: unitCode(r.unit),
        notes: [r.supplier, r.documentNumber && `Ref ${r.documentNumber}`, r.material].filter(Boolean).join(' · ') || undefined,
      } : {},
    }
    navigate('/activities/new', { state: { prefill } })
  }

  const rowsOf = (x: Extraction): Array<[string, string | null]> => [
    ['Supplier', x.supplier], ['Reference', x.documentNumber], ['Document date', x.documentDate], ['Period from', x.periodStart], ['Period to', x.periodEnd],
    ['Quantity', x.quantity], ['Unit', x.unit], ['Fuel or material', x.material], ['Site', x.site],
    ...([['Customer', x.customerName], ['Delivery or visit date', x.activityDate], ['Previous meter reading', x.meterPrevious], ['Current meter reading', x.meterCurrent],
      ['Net calorific value', x.ncv], ['Density', x.density], ['Supplier emission figure', x.supplierFactor], ['Other items', x.otherItems],
      ['Total amount', x.totalAmount && `${x.totalAmount}${x.currency ? ` ${x.currency}` : ''}`], ['Tax', x.taxAmount]] as Array<[string, string | null | undefined]>)
      .filter((p): p is [string, string] => !!p[1]),
  ]
  const recordLine = (rec: RecordRef) => `${rec.facility.code} · ${rec.emissionSource.name} · ${day(rec.startDate)} to ${day(rec.endDate)} · ${Number(rec.quantity).toLocaleString()} ${rec.unit}`

  return (
    <section className="card">
      <div className="card__headline card__headline--top">
        <div className="stack stack--xs doc-detail__title">
          <h2 className="card__title">{doc.fileName}</h2>
          <p className="field__hint">{(doc.sizeBytes / 1024).toFixed(0)} KB · <a className="link" href={fileUrl(doc.id)} target="_blank" rel="noreferrer">View file</a></p>
        </div>
        <div className="actions">
          {doc.rejectedAt
            ? <button type="button" className="button button--ghost button--small" disabled={busy} onClick={() => void restore()}><Undo2 size={14} /> Restore</button>
            : doc.status === 'EXTRACTED' && <button type="button" className="button button--ghost button--small" disabled={busy} onClick={() => void reject()}><Ban size={14} /> Reject</button>}
          <button type="button" className="button button--ghost button--small button--danger" onClick={() => void remove()}><Trash2 size={14} /> Delete</button>
        </div>
      </div>

      {doc.rejectedAt && <p className="status status--warn"><span>Rejected: {doc.rejectReason}</span></p>}
      {inProgress(doc.status) && <div className="stack stack--sm"><p className="field__hint">Reading this document…</p><Skeleton rows={4} /></div>}

      {doc.status === 'FAILED' && (
        <>
          <p className="status status--warn"><span>{doc.errorMessage}</span></p>
          <div className="actions">
            <button type="button" className="button" disabled={busy} onClick={() => void retry()}><RotateCw size={15} /> Try again</button>
            <button type="button" className="button button--ghost" onClick={openForm}>Enter by hand</button>
          </div>
        </>
      )}

      {doc.status === 'EXTRACTED' && !r && <Skeleton rows={4} />}
      {doc.status === 'EXTRACTED' && d && r && (
        <>
          {d.duplicateOf && <p className="status status--warn"><span>Possible duplicate. The same supplier and invoice number were read from <strong>{d.duplicateOf.fileName}</strong>. Check before creating a record.</span></p>}
          {d.recurring && <p className="field__hint">Recurring bill: {d.recurring.count} earlier document{d.recurring.count > 1 ? 's' : ''} from this supplier. The facility and source used last time are suggested on the form.</p>}
          {d.invoices.length > 1 && (
            <Tabs small label="Invoices in this document" active={String(index)} onChange={(k) => setIndex(Number(k))}
              tabs={d.invoices.map((inv, i) => ({ key: String(i), label: `Invoice ${i + 1}${inv.documentNumber ? ` · ${inv.documentNumber}` : ''}${d.matches.some((m) => m.invoiceIndex === i) ? ' ✓' : ''}` }))} />
          )}
          <div className="badges">
            <span className={`badge ${confidence(r.confidence).badge}`}>{confidence(r.confidence).label}</span>
            {d.category && <span className="badge badge--soft">Type corrected</span>}
          </div>
          <label className="field doc-type">
            <span className="field__label">Document type</span>
            <select className="input" value={type} disabled={busy || !!doc.rejectedAt} onChange={(e) => void recategorise(e.target.value)}>
              {Object.entries(TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
            <span className="field__hint">Suggested automatically. Change it if it is wrong.</span>
          </label>
          <dl className="summary">
            {rowsOf(r).map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v ?? <span className="muted">Not found</span>}</dd></div>)}
          </dl>

          {match
            ? <p className="field__hint">Matched with <Link className="link" to={`/activities/${match.activityRecord.id}`}>{recordLine(match.activityRecord)}</Link>{match.withEvidence ? ', attached as its evidence.' : '. That record could no longer take new evidence, so it was matched without changes.'}</p>
            : !doc.rejectedAt && (
              <>
                {!!d.candidates[index]?.length && (
                  <div className="stack stack--sm">
                    <p className="field__label">This invoice may already be a record</p>
                    <ul className="list">
                      {d.candidates[index].map((rec) => (
                        <li key={rec.id} className="list__item">
                          <span className="list__meta">{recordLine(rec)}</span>
                          <button type="button" className="button button--ghost button--small" disabled={busy} onClick={() => void linkTo(rec)}><Link2 size={14} /> Match</button>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                <div className="card__footer">
                  <span className="field__hint">Automatic reading can make mistakes. Check each value against the document in the next step.</span>
                  <button type="button" className="button" onClick={openForm}>Check and create record</button>
                </div>
              </>
            )}

          {!!d.corrections.length && (
            <details className="doc-history">
              <summary className="field__label">Correction history ({d.corrections.length})</summary>
              <div className="table-wrap">
                <table className="table">
                  <thead><tr><th>Invoice</th><th>Field</th><th>Read as</th><th>Corrected to</th><th>When</th></tr></thead>
                  <tbody>{d.corrections.map((c, i) => (
                    <tr key={i}><td>{c.invoiceIndex + 1}</td><td>{FIELD_LABEL[c.field] ?? c.field}</td><td>{c.field === 'documentType' ? TYPE_LABEL[c.before ?? ''] ?? '—' : c.before ?? '—'}</td><td>{c.field === 'documentType' ? TYPE_LABEL[c.after ?? ''] : c.after}</td><td>{new Date(c.createdAt).toLocaleString()}</td></tr>
                  ))}</tbody>
                </table>
              </div>
            </details>
          )}
        </>
      )}
    </section>
  )
}
