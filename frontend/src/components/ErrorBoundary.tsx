import { Component, type ReactNode } from 'react'

// A page that fails to render shows a way out instead of a blank screen. `resetKey` (the route) clears it on navigation.
export class ErrorBoundary extends Component<{ children: ReactNode; resetKey?: string }, { failed: boolean; key?: string }> {
  state = { failed: false, key: this.props.resetKey }

  static getDerivedStateFromError() { return { failed: true } }

  static getDerivedStateFromProps(props: { resetKey?: string }, state: { failed: boolean; key?: string }) {
    return props.resetKey !== state.key ? { failed: false, key: props.resetKey } : null
  }

  componentDidCatch(error: unknown) { console.error(error) }

  render() {
    if (!this.state.failed) return this.props.children
    return (
      <section className="card empty-state" role="alert">
        <h1 className="card__title">Something went wrong on this page</h1>
        <p>Your data is safe. Reload the page, or go back to the dashboard. If it keeps happening, contact support.</p>
        <div className="actions">
          <button className="button" onClick={() => window.location.reload()}>Reload page</button>
          <a className="button button--ghost" href="/">Go to dashboard</a>
        </div>
      </section>
    )
  }
}
