-- Tula Carbon: WIPE TEST DATA (run whenever you want a clean slate for testing).
-- Deletes every organisation except WebAnatomy and its users/memberships.
-- Also wipes WebAnatomy's own working data so you can re-test from the start.
-- Reference data (EmissionFactor, ActivityType, Unit, GridRegion) is NEVER touched.
-- Sessions (all orgs) are cleared so existing browser tabs get a fresh login.
--
-- After running this, sign in as the WebAnatomy Tenant Admin and start fresh.
-- To also restore the 5 quick-login demo accounts, run new-demo-accounts.sql next.

/*!40014 SET @OLD_FOREIGN_KEY_CHECKS=@@FOREIGN_KEY_CHECKS, FOREIGN_KEY_CHECKS=0 */;
/*!40101 SET @OLD_SQL_MODE=@@SQL_MODE, SQL_MODE='NO_AUTO_VALUE_ON_ZERO' */;

-- ============================================================
-- 1. WIPE ALL NON-WEBANATOMY ORGS (working data + org row)
-- ============================================================

-- Child rows that don't cascade must go first.
DELETE FROM `VerificationQueryMessage`
WHERE queryId IN (SELECT id FROM `VerificationQuery` WHERE organizationId IN (SELECT id FROM `Organization` WHERE name <> 'WebAnatomy'));

DELETE FROM `VerificationQuery` WHERE organizationId IN (SELECT id FROM `Organization` WHERE name <> 'WebAnatomy');
DELETE FROM `VerifierGrant`     WHERE organizationId IN (SELECT id FROM `Organization` WHERE name <> 'WebAnatomy');
DELETE FROM `PeriodLockEvent`   WHERE organizationId IN (SELECT id FROM `Organization` WHERE name <> 'WebAnatomy');
DELETE FROM `CalculationResult` WHERE organizationId IN (SELECT id FROM `Organization` WHERE name <> 'WebAnatomy');
DELETE FROM `CalculationRun`    WHERE organizationId IN (SELECT id FROM `Organization` WHERE name <> 'WebAnatomy');
DELETE FROM `ActivityReview`    WHERE organizationId IN (SELECT id FROM `Organization` WHERE name <> 'WebAnatomy');
DELETE FROM `AiUsageEvent`      WHERE organizationId IN (SELECT id FROM `Organization` WHERE name <> 'WebAnatomy');
DELETE FROM `IntakeDocument`    WHERE organizationId IN (SELECT id FROM `Organization` WHERE name <> 'WebAnatomy');
DELETE FROM `Evidence`          WHERE organizationId IN (SELECT id FROM `Organization` WHERE name <> 'WebAnatomy');
DELETE FROM `ActivityRecord`    WHERE organizationId IN (SELECT id FROM `Organization` WHERE name <> 'WebAnatomy');
DELETE FROM `EmissionSource`    WHERE organizationId IN (SELECT id FROM `Organization` WHERE name <> 'WebAnatomy');
DELETE FROM `OrgBoundary`       WHERE organizationId IN (SELECT id FROM `Organization` WHERE name <> 'WebAnatomy');
DELETE FROM `ReportingPeriod`   WHERE organizationId IN (SELECT id FROM `Organization` WHERE name <> 'WebAnatomy');
DELETE FROM `Facility`          WHERE organizationId IN (SELECT id FROM `Organization` WHERE name <> 'WebAnatomy');
DELETE FROM `Membership`        WHERE organizationId IN (SELECT id FROM `Organization` WHERE name <> 'WebAnatomy');
DELETE FROM `Subscription`      WHERE organizationId IN (SELECT id FROM `Organization` WHERE name <> 'WebAnatomy');
DELETE FROM `SubscriptionEvent` WHERE organizationId IN (SELECT id FROM `Organization` WHERE name <> 'WebAnatomy');
-- AuditLog is append-only (and may be protected by 5-triggers.sql): audit history is always kept.
DELETE FROM `Organization`      WHERE name <> 'WebAnatomy';

-- ============================================================
-- 2. WIPE WEBANATOMY'S WORKING DATA (keep org, users, memberships)
-- ============================================================

SET @wa = (SELECT id FROM `Organization` WHERE name = 'WebAnatomy' LIMIT 1);

DELETE FROM `VerificationQueryMessage`
WHERE queryId IN (SELECT id FROM `VerificationQuery` WHERE organizationId = @wa);

DELETE FROM `VerificationQuery` WHERE organizationId = @wa;
DELETE FROM `VerifierGrant`     WHERE organizationId = @wa;
DELETE FROM `PeriodLockEvent`   WHERE organizationId = @wa;
DELETE FROM `CalculationResult` WHERE organizationId = @wa;
DELETE FROM `CalculationRun`    WHERE organizationId = @wa;
DELETE FROM `ActivityReview`    WHERE organizationId = @wa;
DELETE FROM `AiUsageEvent`      WHERE organizationId = @wa;
DELETE FROM `IntakeDocument`    WHERE organizationId = @wa;
DELETE FROM `Evidence`          WHERE organizationId = @wa;
DELETE FROM `ActivityRecord`    WHERE organizationId = @wa;
DELETE FROM `EmissionSource`    WHERE organizationId = @wa;
DELETE FROM `OrgBoundary`       WHERE organizationId = @wa;
-- Clear locked state on any periods before deleting them.
UPDATE `ReportingPeriod` SET finalRunId = NULL, lockedAt = NULL, lockedById = NULL WHERE organizationId = @wa;
DELETE FROM `ReportingPeriod`   WHERE organizationId = @wa;
DELETE FROM `Facility`          WHERE organizationId = @wa;

-- ============================================================
-- 3. CLEAR ALL SESSIONS (force a fresh login)
-- ============================================================
DELETE FROM `Session`;

-- ============================================================
-- 4. RESET WEBANATOMY ORG SETTINGS TO DEFAULTS
-- ============================================================
UPDATE `Organization` SET
  legalName        = NULL,
  industry         = NULL,
  address          = NULL,
  timezone         = 'Asia/Kolkata',
  fiscalYearStartMonth = 4,
  requireEvidenceOnSubmit = 0,
  status           = 'ACTIVE',
  statusReason     = NULL
WHERE name = 'WebAnatomy';

/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */;
/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;

-- Done. Reference data rows kept:
--   ActivityType, Unit, GridRegion, EmissionFactor — untouched.
-- WebAnatomy organisation, users and memberships — kept.
-- Everything else — deleted.
