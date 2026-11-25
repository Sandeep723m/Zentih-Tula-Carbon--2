import { useState, type ReactNode } from 'react'
import { useAuth } from '../auth/AuthContext'
import { useDialog } from '../components/Dialog'
import FieldsForm from '../components/FieldsForm'
import { Header, States } from '../components/Page'
import { Notify } from '../components/Toast'
import { useLoad } from '../hooks/useLoad'
import { API_URL, apiPost, apiUpload } from '../services/apiClient'
import { day, plain } from '../services/format'
import type { ActivityTypeRef, Facility, FuelProperty } from '../types/api'
import { FlaskConical, Plus } from 'lucide-react'

const STATUS_BADGE: Record<FuelProperty['status'], string> = { DRAFT: 'badge--draft', APPROVED: 'badge--approved', REJECTED: 'badge--returned', SUPERSEDED: 'badge--soft' }

// Site fuel properties register (workbook tab 05 rules 1 and 5): monthly laboratory values per fuel and facility.
// Calculations apply a month's APPROVED values to records inside that month, ahead of the IPCC defaults; values
// awaiting approval are never applied. A correction is a new version, and the one it replaces is kept.
export default function FuelPropertiesPage({ switcher }: { switcher?: ReactNode }) {
  const { me } = useAuth()
  const canWrite = me?.permissions.includes('fuel.write') ?? false
  const canApprove = me?.permissions.includes('fuel.approve') ?? false
  const dialog = useDialog()
  const list = useLoad<FuelProperty[]>('/api/fuel-properties')
  const facilities = useLoad<Facility[]>('/api/facilities')
  const activities = useLoad<ActivityTypeRef[]>('/api/reference/activity-types')
  const fuels = (activities.data ?? []).filter((a) => ['C-01', 'C-02', 'C-03'].includes(a.formulaCode ?? ''))
  const [adding, setAdding] = useState(false)
  const [msg, setMsg] = useState<{ ok?: string; err?: string }>({})
  const act = async (run: () => Promise<unknown>, ok: string) => {
    setMsg({})
    try { await run(); setMsg({ ok }); list.reload() } catch (e) { setMsg({ err: (e as Error).message }) }
  }
  const review = async (p: FuelProperty, approve: boolean) => {
    const note = await dialog.prompt({
      title: `${approve ? 'Approve' : 'Reject'} ${p.activityType.name}, ${p.month.slice(0, 7)} (version ${p.version})`,
      message: approve ? 'Calculations will use these values for records of this fuel at this facility in this month. Check them against the certificate.' : 'The values will not be used.',
      input: { label: approve ? 'Note (optional)' : 'Reason', required: !approve },
      confirmLabel: approve ? 'Approve' : 'Reject', danger: !approve,
    })
    if (note !== null) await act(() => apiPost(`/api/fuel-properties/${p.id}/${approve ? 'approve' : 'reject'}`, { note: note || null }), approve ? 'Approved.' : 'Rejected.')
  }
  const upload = (p: FuelProperty) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.pdf,.png,.jpg,.jpeg,.xlsx,.csv'
    input.onchange = () => { const f = input.files?.[0]; if (f) void act(() => apiUpload(`/api/fuel-properties/${p.id}/certificate`, f), `Certificate ${f.name} attached.`) }
    input.click()
  }

  return (
    <>
      <Header
        title="Factors & Fuel Data"
        subtitle="Monthly lab results for your fuels, used in place of standard values once approved."
        action={canWrite && !adding && <button className="button" onClick={() => setAdding(true)}><Plus size={16} /> Add monthly values</button>}
      />
      {switcher}
      <div className="callout">
        <FlaskConical size={18} />
        <span><strong>Order of use:</strong> <em>a value entered on the record itself, then this month's approved laboratory value, then the standard default (which needs a confirmation). Records covering more than one month do not take monthly values.</em></span>
      </div>
      <Notify message={msg.ok} /><Notify kind="error" message={msg.err} />
      {adding && facilities.data && (
        <section className="card card--spaced">
          <h2 className="card__title">New monthly laboratory values</h2>
          <p className="field__hint">Enter at least one value from the lab certificate. Calorific value is in TJ per tonne (43 GJ/t is 0.043).</p>
          <FieldsForm
            fields={[
              { name: 'facilityId', label: 'Facility', type: 'select', required: true, options: facilities.data.map((f) => ({ value: f.id, label: f.name })) },
              { name: 'activityCode', label: 'Fuel', type: 'searchable-select', required: true, options: fuels.map((a) => ({ value: a.code, label: `${a.code}: ${a.name}` })) },
              { name: 'month', label: 'Month (YYYY-MM)', required: true },
              { name: 'ncv', label: 'NCV, TJ per tonne' },
              { name: 'density', label: 'Density' },
              { name: 'densityUnit', label: 'Density unit', type: 'select', options: [{ value: '', label: '(no density)' }, { value: 'kg/l', label: 'kg per litre' }, { value: 'kg/m3', label: 'kg per m³' }] },
              { name: 'carbonContent', label: 'Carbon content, t C per t fuel' },
              { name: 'oxidationFactor', label: 'Oxidation factor (empty = 1)' },
              { name: 'biogenicSharePct', label: 'Biogenic share of carbon, % (blends)' },
              { name: 'certificateRef', label: 'Certificate number / reference', required: true },
              { name: 'laboratory', label: 'Laboratory' },
              { name: 'sampleDate', label: 'Sample date', type: 'date' },
              { name: 'notes', label: 'Notes' },
            ]}
            initial={{ facilityId: facilities.data[0]?.id ?? '', activityCode: '', month: '', ncv: '', density: '', densityUnit: '', carbonContent: '', oxidationFactor: '', biogenicSharePct: '', certificateRef: '', laboratory: '', sampleDate: '', notes: '' }}
            submitLabel="Save for review"
            onSubmit={async (b) => {
              const body = Object.fromEntries(Object.entries(b).filter(([, v]) => v !== ''))
              await apiPost('/api/fuel-properties', body)
              setAdding(false); setMsg({ ok: 'Saved. Attach the certificate, then ask a reviewer to approve it.' }); list.reload()
            }}
            onCancel={() => setAdding(false)}
          />
        </section>
      )}
      <section className="card">
        <States error={list.error} loading={!list.data} empty={list.data?.length === 0 && 'No laboratory values yet. Until there are, calculations use the IPCC defaults and ask for a confirmation.'} />
        {!!list.data?.length && (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Month</th><th>Facility / fuel</th><th className="num">NCV (TJ/t)</th><th className="num">Density</th><th className="num">Carbon (t/t)</th><th className="num">Biogenic</th><th>Certificate</th><th>Status</th><th aria-label="Actions" /></tr></thead>
              <tbody>
                {list.data.map((p) => (
                  <tr key={p.id}>
                    <td className="nowrap">{p.month.slice(0, 7)}<div className="field__hint">version {p.version}</div></td>
                    <td>{p.facility.name}<div className="field__hint">{p.activityType.name}</div></td>
                    <td className="num">{p.ncv ? plain(p.ncv) : '—'}</td>
                    <td className="num">{p.density ? `${plain(p.density)} ${p.densityUnit}` : '—'}</td>
                    <td className="num">{p.carbonContent ? plain(p.carbonContent) : '—'}{p.oxidationFactor && <div className="field__hint">ox. {plain(p.oxidationFactor)}</div>}</td>
                    <td className="num">{p.biogenicShare ? `${Number(p.biogenicShare) * 100}%` : '—'}</td>
                    <td>
                      {p.certificateRef}{p.laboratory && <div className="field__hint">{p.laboratory}</div>}
                      {p.evidenceName ? <a className="field__hint" href={`${API_URL}/api/fuel-properties/${p.id}/certificate`}>{p.evidenceName}</a> : <div className="field__hint">no file attached</div>}
                    </td>
                    <td>
                      <span className={`badge ${STATUS_BADGE[p.status]}`}>{p.status.toLowerCase()}</span>
                      <div className="field__hint">by {p.createdBy.name}{p.reviewedBy && `; reviewed by ${p.reviewedBy.name} ${p.reviewedAt ? day(p.reviewedAt) : ''}`}</div>
                      {p.reviewNote && <div className="field__hint">{p.reviewNote}</div>}
                    </td>
                    <td className="nowrap">
                      {p.status === 'DRAFT' && canWrite && <button type="button" className="button button--ghost button--small" onClick={() => upload(p)}>{p.evidenceName ? 'Replace file' : 'Attach certificate'}</button>}
                      {p.status === 'DRAFT' && canApprove && <button type="button" className="button button--ghost button--small" onClick={() => void review(p, true)}>Approve</button>}
                      {p.status === 'DRAFT' && canApprove && <button type="button" className="button button--ghost button--small" onClick={() => void review(p, false)}>Reject</button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  )
}
