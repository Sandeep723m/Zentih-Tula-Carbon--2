import express, { Router } from 'express'
import { loadSession, requireAuth, requirePasswordStep, requirePermission, requireSignedIn, requireSuperAdmin } from '../auth/session.js'
import {
  changePassword, changePasswordSchema, devResetPassword, devResetPasswordSchema, listMyOrganizations, login, loginSchema, logout, me, mfaSetup, mfaVerify, mfaVerifySchema,
  selectOrganization, selectOrganizationSchema,
} from '../controllers/auth.controller.js'
import { testSwitchInfo, testSwitchLogin, testSwitchSchema } from '../controllers/test-switch.controller.js'
import { allocate, allocationSchema, createInstrument, instrumentSchema, listInstruments, removeAllocation, renewablesSummary, retireInstrument, retireSchema } from '../controllers/renewables.controller.js'
import { evidencePack, readiness, sample } from '../controllers/auditWorkspace.controller.js'
import { createTarget, deleteIntensity, deleteScenario, deleteTarget, intensitySchema, listScenarios, listTargets, overview, rebaseline, rebaselineSchema, saveIntensity, saveScenario, scenarioSchema, simulate, simulateSchema, simulationOptions, targetSchema } from '../controllers/insights.controller.js'
import { addItem, getReconciliation, itemSchema, listReconciliations, reconcileRecord, resolveReconciliation } from '../controllers/reconciliation.controller.js'
import { getDataQuality, reopenFinding, reviewFinding, reviewSchema } from '../controllers/dataQuality.controller.js'
import { aiStatus, aiTestConnection, categorySchema, deleteDocument, downloadDocument, getDocument, linkDocument, linkSchema, listDocuments, rejectDocument, rejectSchema, retryDocument, setCategory, uploadDocument } from '../controllers/documents.controller.js'
import { getHealth } from '../controllers/health.controller.js'
import {
  activitySummary, approveActivity, createActivity, createActivitySchema, deleteActivity, getActivity, listActivities, returnActivity, returnSchema,
  submitActivity, updateActivity, updateActivitySchema,
  checkActivity, checkActivitySchema,
} from '../controllers/activities.controller.js'
import { getAttention, getChecklist, lockPeriod, reopenPeriod, reopenSchema } from '../controllers/periodClose.controller.js'
import { getReport } from '../controllers/reports.controller.js'
import { getAnalytics } from '../controllers/analytics.controller.js'
import {
  addMessage, closeQuery, createGrant, createQuery, createQuerySchema, deleteGrant, getQuery, grantSchema, listGrants, listQueries, messageSchema,
} from '../controllers/verification.controller.js'
import { createSource, createSourceSchema, listSources, updateSource, updateSourceSchema } from '../controllers/emissionSources.controller.js'
import { deleteEvidence, downloadEvidence, MAX_EVIDENCE_BYTES, uploadEvidence } from '../controllers/evidence.controller.js'
import { createFacility, createFacilitySchema, listFacilities, updateFacility, updateFacilitySchema } from '../controllers/facilities.controller.js'
import { inviteMember, inviteMemberSchema, listMembers, removeMember, resetMemberPassword, updateMember, updateMemberSchema } from '../controllers/members.controller.js'
import {
  getCurrentOrganization, updateProfile, updateProfileSchema, updateSettings, updateSettingsSchema,
} from '../controllers/organizations.controller.js'
import {
  addOrgMember, addOrgMemberSchema, changeRoleSchema, createOrganization, createOrganizationSchema, createSuperAdmin,
  createSuperAdminSchema, getOrganization, listAudit, listOrganizations, listUsers,
  getUser, platformChangeRole, platformReadiness, platformSummary, platformUpdateProfileSchema, setOrganizationStatus, setStatusSchema,
  resetPasswordSchema, resetUserPassword, updateOrganization, updateSubscription, updateSubscriptionSchema, updateUser, updateUserSchema,
} from '../controllers/platform.controller.js'
import { createPeriod, createPeriodSchema, listPeriods, updatePeriod, updatePeriodSchema } from '../controllers/reportingPeriods.controller.js'
import {
  approveBoundary, createOrgFacility, getBoundary, getBoundaryHistory, newBoundaryVersion, newVersionSchema, saveBoundary, saveBoundarySchema,
} from '../controllers/boundary.controller.js'
import { compareRuns, confirmResult, confirmRun, previewPeriod, confirmRunSchema, confirmSchema, getRun, listRuns, runCalculation, runSchema } from '../controllers/calculations.controller.js'
import { approveFactor, approveFactorSchema, createFactor, createFactorSchema, createOrgFactor, createUnitRequest, downloadFactorEvidence, factorHistory, factorVersions, libraryUpdates, listActivityTypes, listFactors, listGridRegions, listUnitRequests, listUnits, resolveUnitRequest, resolveUnitRequestSchema, returnFactor, returnFactorSchema, submitFactor, supersedeFactor, supersedeFactorSchema, unitRequestSchema, updateFactor, updateFactorSchema, uploadFactorEvidence } from '../controllers/reference.controller.js'
import { approveFuelProperty, createFuelProperty, downloadCertificate, fuelPropertySchema, listFuelProperties, rejectFuelProperty, reviewFuelPropertySchema, uploadCertificate } from '../controllers/fuelProperties.controller.js'
import { getActivityTypeAdmin, listActivityTypesAdmin, updateActivityTypeAdmin, updateActivityTypeSchema } from '../controllers/activityTypes.controller.js'
import { authRateLimit } from '../middleware/security.js'
import { validateBody } from '../middleware/validate.js'

export const apiRouter = Router()

apiRouter.get('/health', getHealth)

apiRouter.use(loadSession)

apiRouter.post('/auth/login', authRateLimit, validateBody(loginSchema), login)
apiRouter.get('/auth/test-switch', testSwitchInfo)
apiRouter.post('/auth/test-switch/login', authRateLimit, validateBody(testSwitchSchema), testSwitchLogin) // TEST_SWITCH only; Zenith sandbox accounts only
apiRouter.post('/auth/dev/reset-password', authRateLimit, validateBody(devResetPasswordSchema), devResetPassword) // dev only, blocked in production
apiRouter.post('/auth/mfa/setup', requirePasswordStep, mfaSetup)
apiRouter.post('/auth/mfa/verify', authRateLimit, requirePasswordStep, validateBody(mfaVerifySchema), mfaVerify)
apiRouter.post('/auth/logout', logout)
apiRouter.get('/auth/me', requirePasswordStep, me)
apiRouter.post('/auth/password', authRateLimit, requireSignedIn, validateBody(changePasswordSchema), changePassword)
apiRouter.get('/auth/organizations', requireAuth, listMyOrganizations)
apiRouter.post('/auth/organization', requireAuth, validateBody(selectOrganizationSchema), selectOrganization)

apiRouter.get('/organizations/current', ...requirePermission('org.read'), getCurrentOrganization)
apiRouter.patch('/organizations/current', ...requirePermission('org.manage'), validateBody(updateProfileSchema), updateProfile)
apiRouter.patch('/organizations/current/settings', ...requirePermission('org.manage'), validateBody(updateSettingsSchema), updateSettings)

apiRouter.get('/facilities', ...requirePermission('org.read'), listFacilities)
apiRouter.post('/facilities', ...requirePermission('facility.manage'), validateBody(createFacilitySchema), createFacility)
apiRouter.patch('/facilities/:id', ...requirePermission('facility.manage'), validateBody(updateFacilitySchema), updateFacility)

apiRouter.get('/reporting-periods', ...requirePermission('org.read'), listPeriods)
apiRouter.post('/reporting-periods', ...requirePermission('period.manage'), validateBody(createPeriodSchema), createPeriod)
apiRouter.patch('/reporting-periods/:id', ...requirePermission('period.manage'), validateBody(updatePeriodSchema), updatePeriod)
apiRouter.get('/attention', ...requirePermission('period.lock'), getAttention)
apiRouter.get('/reporting-periods/:id/checklist', ...requirePermission('period.lock'), getChecklist)
apiRouter.post('/reporting-periods/:id/lock', ...requirePermission('period.lock'), lockPeriod)
apiRouter.post('/reporting-periods/:id/reopen', ...requirePermission('period.manage'), validateBody(reopenSchema), reopenPeriod)

apiRouter.get('/emission-sources', ...requirePermission('org.read'), listSources)
apiRouter.post('/emission-sources', ...requirePermission('source.manage'), validateBody(createSourceSchema), createSource)
apiRouter.patch('/emission-sources/:id', ...requirePermission('source.manage'), validateBody(updateSourceSchema), updateSource)

apiRouter.get('/members', ...requirePermission('users.manage'), listMembers)
apiRouter.post('/members', ...requirePermission('users.manage'), validateBody(inviteMemberSchema), inviteMember)
apiRouter.patch('/members/:id', ...requirePermission('users.manage'), validateBody(updateMemberSchema), updateMember)
apiRouter.delete('/members/:id', ...requirePermission('users.manage'), removeMember)
apiRouter.post('/members/:id/reset-password', ...requirePermission('users.manage'), resetMemberPassword)

apiRouter.get('/activities', ...requirePermission('activity.read'), listActivities)
apiRouter.get('/activities/summary', ...requirePermission('activity.read'), activitySummary)
apiRouter.post('/activities/check', ...requirePermission('activity.write'), validateBody(checkActivitySchema), checkActivity)
apiRouter.get('/activities/:id', ...requirePermission('activity.read'), getActivity)
apiRouter.post('/activities', ...requirePermission('activity.write'), validateBody(createActivitySchema), createActivity)
apiRouter.patch('/activities/:id', ...requirePermission('activity.write'), validateBody(updateActivitySchema), updateActivity)
apiRouter.delete('/activities/:id', ...requirePermission('activity.write'), deleteActivity)
apiRouter.post('/activities/:id/submit', ...requirePermission('activity.submit'), submitActivity)
apiRouter.post('/activities/:id/approve', ...requirePermission('activity.review'), approveActivity)
apiRouter.post('/activities/:id/return', ...requirePermission('activity.review'), validateBody(returnSchema), returnActivity)

// Raw file body; permission is checked before the body is read.
apiRouter.post('/activities/:id/evidence', ...requirePermission('evidence.write'), express.raw({ type: () => true, limit: MAX_EVIDENCE_BYTES }), uploadEvidence)
apiRouter.get('/evidence/:id/download', ...requirePermission('evidence.read'), downloadEvidence)
apiRouter.delete('/evidence/:id', ...requirePermission('evidence.write'), deleteEvidence)

// ---- AI document intake (people who enter data; verifiers and reviewers do not) ----
apiRouter.get('/documents', ...requirePermission('activity.write'), listDocuments)
apiRouter.post('/documents', ...requirePermission('activity.write'), express.raw({ type: () => true, limit: MAX_EVIDENCE_BYTES }), uploadDocument)
apiRouter.get('/documents/:id', ...requirePermission('activity.write'), getDocument)
apiRouter.get('/documents/:id/file', ...requirePermission('activity.write'), downloadDocument)
apiRouter.post('/documents/:id/retry', ...requirePermission('activity.write'), retryDocument)
apiRouter.post('/documents/:id/link', ...requirePermission('activity.write'), validateBody(linkSchema), linkDocument)
apiRouter.delete('/documents/:id', ...requirePermission('activity.write'), deleteDocument)
apiRouter.get('/data-quality', ...requirePermission('quality.read'), getDataQuality)
apiRouter.post('/data-quality/reviews', ...requirePermission('quality.manage'), validateBody(reviewSchema), reviewFinding)
apiRouter.delete('/data-quality/reviews', ...requirePermission('quality.manage'), reopenFinding)
apiRouter.get('/reconciliations', ...requirePermission('reconcile.read'), listReconciliations)
apiRouter.get('/reconciliations/:id', ...requirePermission('reconcile.read'), getReconciliation)
apiRouter.post('/reconciliations/from-record/:recordId', ...requirePermission('reconcile.read'), reconcileRecord)
apiRouter.post('/reconciliations/:id/items', ...requirePermission('reconcile.read'), validateBody(itemSchema), addItem)
apiRouter.post('/reconciliations/:id/resolve', ...requirePermission('reconcile.resolve'), resolveReconciliation)
const insight = requirePermission('insight.use')
apiRouter.get('/insights/overview', ...insight, overview)
apiRouter.get('/insights/simulation-options', ...insight, simulationOptions)
apiRouter.post('/insights/simulate', ...insight, validateBody(simulateSchema), simulate)
apiRouter.get('/insights/scenarios', ...insight, listScenarios)
apiRouter.post('/insights/scenarios', ...insight, validateBody(scenarioSchema), saveScenario)
apiRouter.delete('/insights/scenarios/:id', ...insight, deleteScenario)
apiRouter.put('/insights/intensity', ...insight, validateBody(intensitySchema), saveIntensity)
apiRouter.delete('/insights/intensity/:id', ...insight, deleteIntensity)
apiRouter.get('/insights/targets', ...insight, listTargets)
apiRouter.post('/insights/targets', ...insight, validateBody(targetSchema), createTarget)
apiRouter.post('/insights/targets/:id/rebaseline', ...insight, validateBody(rebaselineSchema), rebaseline)
apiRouter.delete('/insights/targets/:id', ...insight, deleteTarget)
apiRouter.get('/audit-workspace/readiness', ...requirePermission('report.read'), readiness)
apiRouter.get('/audit-workspace/sample', ...requirePermission('report.read'), sample)
apiRouter.get('/audit-workspace/evidence-pack', ...requirePermission('report.read'), evidencePack)
apiRouter.get('/renewables', ...requirePermission('renewables.read'), listInstruments)
apiRouter.get('/renewables/summary', ...requirePermission('renewables.read'), renewablesSummary)
apiRouter.post('/renewables', ...requirePermission('renewables.manage'), validateBody(instrumentSchema), createInstrument)
apiRouter.post('/renewables/:id/retire', ...requirePermission('renewables.manage'), validateBody(retireSchema), retireInstrument)
apiRouter.post('/renewables/:id/allocations', ...requirePermission('renewables.manage'), validateBody(allocationSchema), allocate)
apiRouter.delete('/renewables/allocations/:allocationId', ...requirePermission('renewables.manage'), removeAllocation)
apiRouter.patch('/documents/:id/category', ...requirePermission('activity.write'), validateBody(categorySchema), setCategory)
apiRouter.post('/documents/:id/reject', ...requirePermission('activity.write'), validateBody(rejectSchema), rejectDocument)

// ---- Calculation engine ----
apiRouter.post('/calculations/runs', ...requirePermission('calc.run'), validateBody(runSchema), runCalculation)
apiRouter.get('/calculations/runs', ...requirePermission('calc.read'), listRuns)
apiRouter.get('/calculations/compare', ...requirePermission('calc.read'), compareRuns)
apiRouter.get('/calculations/preview', ...requirePermission('calc.run'), previewPeriod)
apiRouter.get('/calculations/runs/:id', ...requirePermission('calc.read'), getRun)
apiRouter.post('/calculations/runs/:id/confirm', ...requirePermission('calc.run'), validateBody(confirmRunSchema), confirmRun)
apiRouter.post('/calculations/results/:id/confirm', ...requirePermission('calc.run'), validateBody(confirmSchema), confirmResult)

// ---- Reporting and verification ----
apiRouter.get('/analytics', ...requirePermission('report.read'), getAnalytics)
apiRouter.get('/reports/emissions', ...requirePermission('report.read'), getReport) // ?format=csv to export
apiRouter.get('/verifier-grants', ...requirePermission('verifier.manage'), listGrants)
apiRouter.post('/verifier-grants', ...requirePermission('verifier.manage'), validateBody(grantSchema), createGrant)
apiRouter.delete('/verifier-grants/:id', ...requirePermission('verifier.manage'), deleteGrant)
apiRouter.get('/queries', ...requirePermission('query.read'), listQueries)
apiRouter.get('/queries/:id', ...requirePermission('query.read'), getQuery)
apiRouter.post('/queries', ...requirePermission('query.create'), validateBody(createQuerySchema), createQuery)
apiRouter.post('/queries/:id/messages', ...requirePermission('query.read'), validateBody(messageSchema), addMessage) // verifier follow-up or organisation answer
apiRouter.post('/queries/:id/close', ...requirePermission('query.create'), closeQuery)

// Shared reference data (same for every organisation; readable by anyone signed in)
apiRouter.get('/reference/grid-regions', requireAuth, listGridRegions)
apiRouter.get('/reference/activity-types', requireAuth, listActivityTypes)
apiRouter.get('/reference/units', requireAuth, listUnits)
apiRouter.get('/reference/emission-factors', requireAuth, listFactors)
apiRouter.get('/reference/emission-factors/:id/versions', requireAuth, factorVersions)
apiRouter.get('/reference/emission-factors/:id/history', requireAuth, factorHistory)
apiRouter.get('/reference/library-updates', requireAuth, libraryUpdates)
apiRouter.get('/reference/emission-factors/:id/evidence', requireAuth, downloadFactorEvidence)
// Factor lifecycle (TC-ARC-006). Each action checks the factor's tier and the role per factor: platform factors
// are Super Admin only; an organisation's factors are its members' only (Super Admin cannot reach them).
apiRouter.post('/emission-factors', ...requirePermission('factor.write'), validateBody(createFactorSchema), createOrgFactor)
apiRouter.patch('/emission-factors/:id', requireAuth, validateBody(updateFactorSchema), updateFactor)
apiRouter.post('/emission-factors/:id/evidence', requireAuth, express.raw({ type: () => true, limit: MAX_EVIDENCE_BYTES }), uploadFactorEvidence)
apiRouter.post('/emission-factors/:id/submit', requireAuth, submitFactor)
apiRouter.post('/emission-factors/:id/approve', requireAuth, validateBody(approveFactorSchema), approveFactor)
apiRouter.post('/emission-factors/:id/return', requireAuth, validateBody(returnFactorSchema), returnFactor)
apiRouter.post('/emission-factors/:id/supersede', requireAuth, validateBody(supersedeFactorSchema), supersedeFactor)
apiRouter.get('/unit-requests', requireAuth, listUnitRequests)
apiRouter.post('/unit-requests', ...requirePermission('factor.write'), validateBody(unitRequestSchema), createUnitRequest)

// Site fuel properties register (Tier 3): monthly laboratory values per fuel and facility
apiRouter.get('/fuel-properties', ...requirePermission('activity.read'), listFuelProperties)
apiRouter.post('/fuel-properties', ...requirePermission('fuel.write'), validateBody(fuelPropertySchema), createFuelProperty)
apiRouter.post('/fuel-properties/:id/certificate', ...requirePermission('fuel.write'), express.raw({ type: () => true, limit: MAX_EVIDENCE_BYTES }), uploadCertificate)
apiRouter.get('/fuel-properties/:id/certificate', ...requirePermission('activity.read'), downloadCertificate)
apiRouter.post('/fuel-properties/:id/approve', ...requirePermission('fuel.approve'), validateBody(reviewFuelPropertySchema), approveFuelProperty)
apiRouter.post('/fuel-properties/:id/reject', ...requirePermission('fuel.approve'), validateBody(reviewFuelPropertySchema), rejectFuelProperty)

// ---- Platform administration (Super Admin only) ----
const sa = requireSuperAdmin
apiRouter.get('/platform/summary', ...sa, platformSummary)
apiRouter.get('/platform/readiness', ...sa, platformReadiness)
apiRouter.get('/platform/organizations', ...sa, listOrganizations)
apiRouter.post('/platform/organizations', ...sa, validateBody(createOrganizationSchema), createOrganization)
apiRouter.get('/platform/organizations/:id', ...sa, getOrganization)
apiRouter.patch('/platform/organizations/:id', ...sa, validateBody(platformUpdateProfileSchema), updateOrganization)
apiRouter.post('/platform/organizations/:id/status', ...sa, validateBody(setStatusSchema), setOrganizationStatus)
apiRouter.put('/platform/organizations/:id/subscription', ...sa, validateBody(updateSubscriptionSchema), updateSubscription)
apiRouter.post('/platform/organizations/:id/members', ...sa, validateBody(addOrgMemberSchema), addOrgMember)
apiRouter.patch('/platform/organizations/:id/members/:memberId', ...sa, validateBody(changeRoleSchema), platformChangeRole)
apiRouter.get('/platform/organizations/:id/boundary', ...sa, getBoundary)
apiRouter.get('/platform/organizations/:id/boundary/history', ...sa, getBoundaryHistory)
apiRouter.put('/platform/organizations/:id/boundary', ...sa, validateBody(saveBoundarySchema), saveBoundary)
apiRouter.post('/platform/organizations/:id/boundary/approve', ...sa, approveBoundary)
apiRouter.post('/platform/organizations/:id/facilities', ...sa, validateBody(createFacilitySchema), createOrgFacility)
apiRouter.post('/platform/organizations/:id/boundary/new-version', ...sa, validateBody(newVersionSchema), newBoundaryVersion)
apiRouter.get('/platform/users', ...sa, listUsers)
apiRouter.get('/platform/users/:id', ...sa, getUser)
apiRouter.post('/platform/users', ...sa, validateBody(createSuperAdminSchema), createSuperAdmin)
apiRouter.patch('/platform/users/:id', ...sa, validateBody(updateUserSchema), updateUser)
apiRouter.post('/platform/users/:id/reset-password', ...sa, validateBody(resetPasswordSchema), resetUserPassword)
apiRouter.get('/platform/audit', ...sa, listAudit)
apiRouter.get('/platform/ai', ...sa, aiStatus)
apiRouter.post('/platform/ai/test', ...sa, aiTestConnection)
apiRouter.post('/platform/emission-factors', ...sa, validateBody(createFactorSchema), createFactor)
apiRouter.post('/platform/unit-requests/:id/resolve', ...sa, validateBody(resolveUnitRequestSchema), resolveUnitRequest)
apiRouter.get('/platform/activity-types', ...sa, listActivityTypesAdmin)
apiRouter.get('/platform/activity-types/:code', ...sa, getActivityTypeAdmin)
apiRouter.patch('/platform/activity-types/:code', ...sa, validateBody(updateActivityTypeSchema), updateActivityTypeAdmin)
