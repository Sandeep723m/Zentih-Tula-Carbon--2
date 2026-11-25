import { lazy, Suspense, useEffect, type ComponentType, type ReactElement } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { ErrorBoundary } from '../components/ErrorBoundary'
import { Skeleton } from '../components/Page'
import { revealIn } from '../components/motion'
import { scrollToTarget } from '../components/smoothScroll'
import { breadcrumbs, PLATFORM_NAV, TENANT_NAV } from '../components/nav'
import { nextStep, useAuth } from '../auth/AuthContext'
import AppLayout from '../components/AppLayout'
import LoginPage from '../pages/LoginPage'
import { PlatformLayout } from '../pages/PlatformPages'


// Pages load on first visit, so the first screen downloads only what it needs.
const page = <K extends string>(load: () => Promise<Record<K, ComponentType>>, name: K) => lazy(() => load().then((m) => ({ default: m[name] })))
const EmissionSourcesPage = page(() => import('../pages/AdminPages'), 'EmissionSourcesPage')
const FacilitiesPage = page(() => import('../pages/AdminPages'), 'FacilitiesPage')
const OrganizationProfilePage = page(() => import('../pages/AdminPages'), 'OrganizationProfilePage')
const ReportingPeriodsPage = page(() => import('../pages/AdminPages'), 'ReportingPeriodsPage')
const TenantSettingsPage = page(() => import('../pages/AdminPages'), 'TenantSettingsPage')
const ActivityEntryPage = lazy(() => import('../pages/ActivityEntryPage'))
const ActivitiesPage = page(() => import('../pages/ActivityPages'), 'ActivitiesPage')
const ActivityDashboardPage = page(() => import('../pages/ActivityPages'), 'ActivityDashboardPage')
const ReviewQueuePage = page(() => import('../pages/ActivityPages'), 'ReviewQueuePage')
const DocumentsPage = lazy(() => import('../pages/DocumentsPage'))
const DataQualityPage = lazy(() => import('../pages/DataQualityPage'))
const ReconciliationPage = lazy(() => import('../pages/ReconciliationPage'))
const CarbonIntelligencePage = lazy(() => import('../pages/CarbonIntelligencePage'))
const AuditWorkspacePage = lazy(() => import('../pages/AuditWorkspacePage'))
const RenewablesPage = lazy(() => import('../pages/RenewablesPage'))
const PlatformAiPage = lazy(() => import('../pages/PlatformAiPage'))
const PlatformActivityTypesPage = lazy(() => import('../pages/PlatformActivityTypesPage'))
const PeriodClosePage = lazy(() => import('../pages/PeriodClosePage'))
const QueriesPage = lazy(() => import('../pages/QueriesPage'))
const ReportsPage = lazy(() => import('../pages/ReportsPage'))
const AnalyticsPage = lazy(() => import('../pages/AnalyticsPage'))
const AccountSettingsPage = page(() => import('../pages/AccountPages'), 'AccountSettingsPage')
const ForcedPasswordChangePage = page(() => import('../pages/AccountPages'), 'ForcedPasswordChangePage')
const BoundarySetupPage = lazy(() => import('../pages/BoundarySetupPage'))
const CalculationsPage = lazy(() => import('../pages/CalculationsPage'))
const FactorsAndFuel = page(() => import('../pages/EmissionFactorsPage'), 'FactorsAndFuel')
const PlatformFactors = page(() => import('../pages/EmissionFactorsPage'), 'PlatformFactors')
const PlatformOrganizationPage = lazy(() => import('../pages/PlatformOrganizationPage'))
const PlatformUserPage = lazy(() => import('../pages/PlatformUserPage'))
const PlatformAuditPage = page(() => import('../pages/PlatformPages'), 'PlatformAuditPage')
const PlatformDashboardPage = page(() => import('../pages/PlatformPages'), 'PlatformDashboardPage')
const PlatformOrganizationsPage = page(() => import('../pages/PlatformPages'), 'PlatformOrganizationsPage')
const PlatformSubscriptionsPage = page(() => import('../pages/PlatformPages'), 'PlatformSubscriptionsPage')
const PlatformUsersPage = page(() => import('../pages/PlatformPages'), 'PlatformUsersPage')
const OrganizationsPage = lazy(() => import('../pages/OrganizationsPage'))
const UsersPage = lazy(() => import('../pages/UsersPage'))
const VerifyPage = lazy(() => import('../pages/VerifyPage'))

// Each page is reachable only at the matching sign-in stage; otherwise redirect.
// The organisation picker also stays open after an org is chosen, for switching.
function Stage({ path, children }: { path: ReturnType<typeof nextStep>; children: ReactElement }) {
  const { me, loading, error, refresh } = useAuth()
  if (loading) return <main className="page page--narrow"><Skeleton rows={4} /></main>
  if (error) return (
    <main className="page page--narrow">
      <p className="status status--error" role="alert"><span>{error}</span><button className="button button--small" onClick={() => void refresh()}>Try again</button></p>
    </main>
  )
  const step = nextStep(me)
  const allowed = step === path || (path === '/organizations' && step === '/')
  return allowed ? children : <Navigate to={step} replace />
}

const SIGN_IN_TITLES: Record<string, string> = { '/login': 'Sign in', '/verify': 'Two-step verification', '/change-password': 'Choose a new password', '/organizations': 'Select an organisation' }

// Each page names the browser tab, and a new page opens at the top (tabs and filters, which change only the query, keep the scroll).
function RouteEffects() {
  const { pathname } = useLocation()
  useEffect(() => {
    const crumbs = breadcrumbs(pathname, pathname.startsWith('/platform') ? PLATFORM_NAV : TENANT_NAV)
    const page = SIGN_IN_TITLES[pathname] ?? crumbs[crumbs.length - 1]?.label
    document.title = page ? `${page} · Tula Carbon` : 'Tula Carbon'
    scrollToTarget(0)
    // Sign-in steps (outside the app shell) get the same entrance.
    let stop = () => {}
    const id = requestAnimationFrame(() => { stop = revealIn(document.querySelector<HTMLElement>('main.page--narrow')) })
    return () => { cancelAnimationFrame(id); stop() }
  }, [pathname])
  return null
}

export default function AppRoutes() {
  const { pathname } = useLocation()
  return (
    <ErrorBoundary resetKey={pathname}>
    <RouteEffects />
    <Suspense fallback={null}>
    <Routes>
      <Route path="/login" element={<Stage path="/login"><LoginPage /></Stage>} />
      <Route path="/verify" element={<Stage path="/verify"><VerifyPage /></Stage>} />
      <Route path="/change-password" element={<Stage path="/change-password"><ForcedPasswordChangePage /></Stage>} />
      <Route element={<Stage path="/platform"><PlatformLayout /></Stage>}>
        <Route path="/platform" element={<PlatformDashboardPage />} />
        <Route path="/platform/organizations" element={<PlatformOrganizationsPage />} />
        <Route path="/platform/organizations/:id" element={<PlatformOrganizationPage />} />
        <Route path="/platform/organizations/:id/boundary" element={<BoundarySetupPage />} />
        <Route path="/platform/subscriptions" element={<PlatformSubscriptionsPage />} />
        <Route path="/platform/users" element={<PlatformUsersPage />} />
        <Route path="/platform/users/:id" element={<PlatformUserPage />} />
        <Route path="/platform/audit" element={<PlatformAuditPage />} />
        <Route path="/platform/ai" element={<PlatformAiPage />} />
        <Route path="/platform/emission-factors" element={<PlatformFactors />} />
        <Route path="/platform/activity-types" element={<PlatformActivityTypesPage />} />
        <Route path="/platform/account" element={<AccountSettingsPage />} />
      </Route>
      <Route path="/organizations" element={<Stage path="/organizations"><OrganizationsPage /></Stage>} />
      <Route element={<Stage path="/"><AppLayout /></Stage>}>
        <Route path="/" element={<ActivityDashboardPage />} />
        <Route path="/activities" element={<ActivitiesPage />} />
        <Route path="/documents" element={<DocumentsPage />} />
        <Route path="/data-quality" element={<DataQualityPage />} />
        <Route path="/reconciliation" element={<ReconciliationPage />} />
        <Route path="/carbon-intelligence" element={<CarbonIntelligencePage />} />
        <Route path="/audit-workspace" element={<AuditWorkspacePage />} />
        <Route path="/renewables" element={<RenewablesPage />} />
        <Route path="/activities/new" element={<ActivityEntryPage />} />
        <Route path="/activities/:id" element={<ActivityEntryPage />} />
        <Route path="/organization" element={<OrganizationProfilePage />} />
        <Route path="/facilities" element={<FacilitiesPage />} />
        <Route path="/reporting-periods" element={<ReportingPeriodsPage />} />
        <Route path="/emission-sources" element={<EmissionSourcesPage />} />
        <Route path="/review" element={<ReviewQueuePage />} />
        <Route path="/calculations" element={<CalculationsPage />} />
        <Route path="/period-close" element={<PeriodClosePage />} />
        <Route path="/reports" element={<ReportsPage />} />
        <Route path="/analytics" element={<AnalyticsPage />} />
        <Route path="/queries" element={<QueriesPage />} />
        <Route path="/emission-factors" element={<FactorsAndFuel />} />
        <Route path="/fuel-properties" element={<Navigate to="/emission-factors?view=fuel" replace />} />
        <Route path="/users" element={<UsersPage />} />
        <Route path="/settings" element={<TenantSettingsPage />} />
        <Route path="/account" element={<AccountSettingsPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
    </Suspense>
    </ErrorBoundary>
  )
}
