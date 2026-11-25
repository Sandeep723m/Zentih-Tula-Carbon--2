-- Tula Carbon: quick-login demo accounts for all 5 roles (DEMO_MODE=true). Import after new-changes.sql.
-- Works on any existing database: accounts are matched by email, linked to every organisation that
-- exists, and the demo verifier is granted every reporting period. Safe to re-import.
-- The password is random and unknown: these accounts are reached only through quick login.

INSERT INTO `User` (id, email, name, passwordHash, mustChangePassword, platformRole, isActive, mfaEnabled)
SELECT UUID(), x.email, x.name, 'scrypt$bGVva6vgDsgJ296JglTvhQ==$cNbeOJiwM59Aqrz/qQtQYkhCY4h1Mg6G5u69xgKJr08+LpNPwG0G/Tf0qQ7JT7cIbFd9sCJT5bKzzqcpX6BCTQ==', 0, x.pr, 1, 0 FROM (
  SELECT 'demo.superadmin@tulacarbon.app' email, 'Demo Super Admin' name, 'SUPER_ADMIN' pr UNION ALL
  SELECT 'demo.tenantadmin@tulacarbon.app', 'Demo Tenant Admin', NULL UNION ALL
  SELECT 'demo.dataentry@tulacarbon.app', 'Demo Data Entry', NULL UNION ALL
  SELECT 'demo.reviewer@tulacarbon.app', 'Demo Reviewer', NULL UNION ALL
  SELECT 'demo.verifier@tulacarbon.app', 'Demo Verifier', NULL
) x WHERE NOT EXISTS (SELECT 1 FROM `User` u WHERE u.email = x.email);

-- Restore them if someone changed or deactivated them.
UPDATE `User` SET isActive = 1, mustChangePassword = 0, failedLoginCount = 0, lockedUntil = NULL,
  platformRole = IF(email = 'demo.superadmin@tulacarbon.app', 'SUPER_ADMIN', NULL)
WHERE email IN ('demo.superadmin@tulacarbon.app','demo.tenantadmin@tulacarbon.app','demo.dataentry@tulacarbon.app','demo.reviewer@tulacarbon.app','demo.verifier@tulacarbon.app');

-- Each role in every organisation.
INSERT INTO `Membership` (id, userId, organizationId, role)
SELECT UUID(), u.id, o.id, r.role FROM `Organization` o
JOIN (
  SELECT 'demo.tenantadmin@tulacarbon.app' email, 'TENANT_ADMIN' role UNION ALL
  SELECT 'demo.dataentry@tulacarbon.app', 'DATA_ENTRY' UNION ALL
  SELECT 'demo.reviewer@tulacarbon.app', 'REVIEWER' UNION ALL
  SELECT 'demo.verifier@tulacarbon.app', 'VERIFIER'
) r JOIN `User` u ON u.email = r.email
WHERE NOT EXISTS (SELECT 1 FROM `Membership` m WHERE m.userId = u.id AND m.organizationId = o.id);

UPDATE `Membership` m JOIN `User` u ON u.id = m.userId SET m.role = CASE u.email
  WHEN 'demo.tenantadmin@tulacarbon.app' THEN 'TENANT_ADMIN' WHEN 'demo.dataentry@tulacarbon.app' THEN 'DATA_ENTRY'
  WHEN 'demo.reviewer@tulacarbon.app' THEN 'REVIEWER' ELSE 'VERIFIER' END
WHERE u.email IN ('demo.tenantadmin@tulacarbon.app','demo.dataentry@tulacarbon.app','demo.reviewer@tulacarbon.app','demo.verifier@tulacarbon.app');

-- The demo verifier sees every reporting period.
INSERT INTO `VerifierGrant` (id, organizationId, userId, reportingPeriodId, grantedById)
SELECT UUID(), p.organizationId, v.id, p.id, t.id FROM `ReportingPeriod` p
JOIN `User` v ON v.email = 'demo.verifier@tulacarbon.app'
JOIN `User` t ON t.email = 'demo.tenantadmin@tulacarbon.app'
WHERE NOT EXISTS (SELECT 1 FROM `VerifierGrant` g WHERE g.userId = v.id AND g.reportingPeriodId = p.id);
