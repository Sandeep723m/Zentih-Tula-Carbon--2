// Shared page navigation for server-paged lists ({ rows, total, page, pageSize }).
export interface Page<T> { rows: T[]; total: number; page: number; pageSize: number }

// "Showing 51–100 of 1,234" with previous/next; the page number lives in the URL (?page=).
export function Pager({ data, onPage }: { data: Page<unknown>; onPage: (page: number) => void }) {
  if (data.total <= data.pageSize) return data.total ? <p className="field__hint">{data.total} total</p> : null
  const last = Math.ceil(data.total / data.pageSize)
  const from = (data.page - 1) * data.pageSize + 1
  return (
    <div className="pager">
      <span className="field__hint">Showing {from.toLocaleString()}–{Math.min(from + data.rows.length - 1, data.total).toLocaleString()} of {data.total.toLocaleString()}</span>
      <button className="button button--ghost button--small" disabled={data.page <= 1} onClick={() => onPage(data.page - 1)}>Previous</button>
      <span className="field__hint">Page {data.page} of {last}</span>
      <button className="button button--ghost button--small" disabled={data.page >= last} onClick={() => onPage(data.page + 1)}>Next</button>
    </div>
  )
}
