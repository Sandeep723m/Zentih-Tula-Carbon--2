import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { apiGet, apiPatch, apiPost } from '../services/apiClient'
import FieldsForm, { toValues, type Field } from './FieldsForm'
import { Tabs } from './Tabs'
import { Skeleton } from './Page'

export interface Column<T> {
  label: string
  render: (row: T) => ReactNode
}

interface Props<T> {
  title: string
  singular: string // e.g. 'facility', for the 'New …' form heading
  subtitle: string
  endpoint: string // e.g. /api/facilities; rows are PATCHed at `${endpoint}/${id}`
  fields: Field[]
  columns: Column<T>[]
  canWrite: boolean
  emptyText: string
  groups?: Array<{ key: string; label: string; match: (row: T) => boolean }> // shown as tabs with counts
}

// List + create/edit screen shared by facilities, reporting periods and emission sources.
export default function ResourcePage<T extends { id: string }>({ title, singular, subtitle, endpoint, fields, columns, canWrite, emptyText, groups }: Props<T>) {
  const [group, setGroup] = useState('')
  const [rows, setRows] = useState<T[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState<T | 'new' | null>(null)

  const load = useCallback(() => {
    apiGet<T[]>(endpoint).then(setRows).catch((e: Error) => setError(e.message))
  }, [endpoint])
  useEffect(load, [load])

  const save = async (body: Record<string, unknown>) => {
    if (editing === 'new') await apiPost(endpoint, body)
    else await apiPatch(`${endpoint}/${editing!.id}`, body)
    setEditing(null)
    load()
  }

  const formFields = editing === 'new' ? fields : fields.filter((f) => !f.createOnly)

  return (
    <>
      <header className="page__header page__header--row">
        <div>
          <h1 className="page__title">{title}</h1>
          <p className="page__subtitle">{subtitle}</p>
        </div>
        {canWrite && !editing && <button className="button" onClick={() => setEditing('new')}>Add</button>}
      </header>

      {editing && (
        <section className="card card--spaced">
          <h2 className="card__title">{editing === 'new' ? `New ${singular}` : 'Edit'}</h2>
          <FieldsForm
            key={editing === 'new' ? 'new' : editing.id}
            fields={formFields}
            initial={toValues(formFields, editing === 'new' ? null : (editing as Record<string, unknown>))}
            submitLabel={editing === 'new' ? 'Create' : 'Save'}
            onSubmit={save}
            onCancel={() => setEditing(null)}
          />
        </section>
      )}

      {!canWrite && <p className="status">You can view this page. Ask a Tenant Admin if you need to make changes.</p>}
      <section className="card">
        {error &&<p className="status status--error" role="alert">{error}</p>}
        {!rows && !error && <Skeleton />}
        {rows?.length === 0 && <p className="status">{emptyText}</p>}
        {groups && !!rows?.length && (
          <Tabs label={`${title} groups`} active={group} onChange={setGroup} tabs={[
            { key: '', label: 'All', count: rows.length },
            ...groups.map((g) => ({ key: g.key, label: g.label, count: rows.filter(g.match).length })).filter((t) => t.count > 0 || t.key === group),
          ]} />
        )}
        {!!rows?.length && (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  {columns.map((c) => <th key={c.label}>{c.label}</th>)}
                  {canWrite && <th aria-label="Actions" />}
                </tr>
              </thead>
              <tbody>
                {rows.filter((r) => !group || groups?.find((g) => g.key === group)?.match(r)).map((r) => (
                  <tr key={r.id}>
                    {columns.map((c) => <td key={c.label}>{c.render(r)}</td>)}
                    {canWrite && (
                      <td className="table__actions">
                        <button className="button button--ghost button--small" onClick={() => setEditing(r)}>Edit</button>
                      </td>
                    )}
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
