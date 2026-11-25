import type { CalcResult } from '../types/api'
import { humanize } from '../services/format'

// A calculation result's status, its issues, and its confirmation.
export function ResultStatus({ r, canRun, onConfirm }: { r: CalcResult; canRun: boolean; onConfirm?: () => void }) {
  return (
    <div className="calc-result">
      <span className={`badge ${r.status === 'BLOCKED' ? 'badge--error' : 'badge--success'}`}>{r.status === 'BLOCKED' ? 'Blocked' : 'Calculated'}</span>
      {r.issues.map((i) => (
        <span key={i.code} className={i.severity === 'BLOCK' ? 'field__error' : 'field__hint'}>{humanize(i.message)}</span>
      ))}
      {r.confirmedAt
        ? <span className="field__hint">Confirmed by {r.confirmedBy?.name ?? 'unknown user'} on {new Date(r.confirmedAt).toLocaleString()} (“{r.confirmationReason}”)</span>
        : r.needsConfirmation && (canRun && onConfirm
          ? <button className="button button--small" onClick={onConfirm}>Confirm…</button>
          : <span className="field__hint">Awaiting confirmation</span>)}
    </div>
  )
}
