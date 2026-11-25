import type { OrganizationStatus, SubscriptionStatus } from '../../generated/prisma/client.js'

// What members of an organisation may do, given its platform status and subscription.
//   full : normal use, within their role's permissions
//   read : view and download only (expired / cancelled / not started) — nothing is deleted
//   none : cannot open the organisation (organisation or subscription suspended)
export type OrgAccess = 'full' | 'read' | 'none'

interface Sub { status: SubscriptionStatus; startDate: Date; endDate: Date | null }

const today = (now: Date) => now.toISOString().slice(0, 10)
const day = (d: Date) => d.toISOString().slice(0, 10)

// Stored status, except that a Trial/Active subscription past its end date counts as Expired.
// Nothing rewrites the stored row; the date decides at request time.
export function effectiveStatus(sub: Sub, now = new Date()): SubscriptionStatus {
  if ((sub.status === 'TRIAL' || sub.status === 'ACTIVE') && sub.endDate && day(sub.endDate) < today(now)) return 'EXPIRED'
  return sub.status
}

export function orgAccess(org: { status: OrganizationStatus }, sub: Sub | null, now = new Date()): { access: OrgAccess; reason: string | null } {
  if (org.status === 'SUSPENDED') return { access: 'none', reason: 'This organisation has been suspended. Contact Tula Carbon support.' }
  if (!sub) return { access: 'read', reason: 'This organisation has no subscription. Data is read-only.' }
  switch (effectiveStatus(sub, now)) {
    case 'SUSPENDED': return { access: 'none', reason: 'This organisation\'s subscription is suspended. Contact Tula Carbon support.' }
    case 'EXPIRED': return { access: 'read', reason: 'The subscription has expired. Data is read-only until it is renewed.' }
    case 'CANCELLED': return { access: 'read', reason: 'The subscription has been cancelled. Data is read-only.' }
    default:
      if (day(sub.startDate) > today(now)) return { access: 'read', reason: `The subscription starts on ${day(sub.startDate)}. Data is read-only until then.` }
      return { access: 'full', reason: null }
  }
}
