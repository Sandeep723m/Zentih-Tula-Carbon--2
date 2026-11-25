import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { PlugZap } from 'lucide-react'
import { Header, States } from '../components/Page'
import { Pager, type Page } from '../components/Pager'
import { Notify } from '../components/Toast'
import { useLoad } from '../hooks/useLoad'
import { apiPost } from '../services/apiClient'

interface Totals { calls: number; inputTokens: number; outputTokens: number; estimatedCostUsd: string | null }
type OrgRow = Totals & { organizationId: string; name: string }
type Status = Page<OrgRow> & { provider: string; model: string | null; keySet: boolean; pricesSet: boolean; allTime: Totals & { failed: number }; last30Days: Totals }

const num = (n: number) => n.toLocaleString()
const usd = (v: string | null, pricesSet: boolean) => (v != null ? `$${Number(v).toFixed(4)}` : pricesSet ? '$0.0000' : 'Prices not set')

// The AI service: which provider and model run, whether they work, and what they have used.
export default function PlatformAiPage() {
  const [params, setParams] = useSearchParams()
  const page = params.get('page') ?? '1'
  const { data, error, reload } = useLoad<Status>(`/api/platform/ai?page=${page}`)
  const [testing, setTesting] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null)

  const test = async () => {
    setTesting(true); setResult(null)
    try { setResult(await apiPost<{ ok: boolean; message: string }>('/api/platform/ai/test')) }
    catch (e) { setResult({ ok: false, message: (e as Error).message }) }
    finally { setTesting(false); reload() }
  }

  return (
    <>
      <Header title="AI Service" subtitle="The service that reads uploaded documents." action={
        <button type="button" className="button" disabled={testing} onClick={() => void test()}><PlugZap size={16} /> {testing ? 'Testing…' : 'Test connection'}</button>
      } />
      <Notify kind={result?.ok ? 'ok' : 'error'} message={result?.message} />
      <States error={error} loading={!data} />
      {data && (
        <>
          <section className="card">
            <h2 className="card__title">Configuration</h2>
            <dl className="summary">
              <div><dt>Provider</dt><dd>{data.provider}</dd></div>
              <div><dt>Model</dt><dd>{data.model ?? <span className="text-error">Not set</span>}</dd></div>
              <div><dt>API key</dt><dd>{data.keySet ? <span className="badge badge--success">Set on the server</span> : <span className="badge badge--error">Not set</span>}</dd></div>
              <div><dt>Prices for cost estimates</dt><dd>{data.pricesSet ? <span className="badge badge--success">Set</span> : <span className="badge">Not set</span>}</dd></div>
            </dl>
          </section>

          <div className="kpis">
            <div className="kpi"><span className="kpi__label">Calls, last 30 days</span><span className="kpi__value">{num(data.last30Days.calls)}</span><span className="kpi__delta">{num(data.allTime.calls)} all time, {num(data.allTime.failed)} failed</span></div>
            <div className="kpi"><span className="kpi__label">Input tokens, last 30 days</span><span className="kpi__value">{num(data.last30Days.inputTokens)}</span><span className="kpi__delta">{num(data.allTime.inputTokens)} all time</span></div>
            <div className="kpi"><span className="kpi__label">Output tokens, last 30 days</span><span className="kpi__value">{num(data.last30Days.outputTokens)}</span><span className="kpi__delta">{num(data.allTime.outputTokens)} all time</span></div>
            <div className="kpi"><span className="kpi__label">Estimated cost, last 30 days</span><span className="kpi__value">{usd(data.last30Days.estimatedCostUsd, data.pricesSet)}</span><span className="kpi__delta">{usd(data.allTime.estimatedCostUsd, data.pricesSet)} all time</span></div>
          </div>

          <section className="card">
            <h2 className="card__title">Usage by organisation</h2>
            {data.total === 0 ? <p className="status">No documents have been read yet.</p> : (
              <div className="table-wrap">
                <table className="table">
                  <thead><tr><th>Organisation</th><th className="num">Calls</th><th className="num">Input tokens</th><th className="num">Output tokens</th><th className="num">Estimated cost</th></tr></thead>
                  <tbody>{data.rows.map((o) => (
                    <tr key={o.organizationId}><td>{o.name}</td><td className="num">{num(o.calls)}</td><td className="num">{num(o.inputTokens)}</td><td className="num">{num(o.outputTokens)}</td><td className="num">{usd(o.estimatedCostUsd, data.pricesSet)}</td></tr>
                  ))}</tbody>
                </table>
              </div>
            )}
            <Pager data={data} onPage={(n) => setParams({ page: String(n) })} />
          </section>
        </>
      )}
    </>
  )
}
