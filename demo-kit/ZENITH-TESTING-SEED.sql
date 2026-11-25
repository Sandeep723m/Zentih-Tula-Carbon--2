-- Zenith Testing sandbox: one organisation and five logins (Super Admin + four roles).
-- NON-DESTRUCTIVE. Adds or updates only the "Zenith Testing" organisation and these five accounts,
-- matched by name and email. No other organisation, user or record is read, changed or deleted.
-- Safe to run more than once. Import with phpMyAdmin → kaphimosol9_tulacarbon → Import → Go.
-- Two-step sign-in is OFF for all five accounts (testing only).

SET NAMES utf8mb4;

INSERT INTO Organization (id, name, legalName, country, status)
SELECT 'a0e10000-0000-4000-8000-000000000001', 'Zenith Testing', 'Zenith Testing', 'India', 'ACTIVE'
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM Organization WHERE name = 'Zenith Testing');

INSERT IGNORE INTO Subscription (id, organizationId, planName, status, startDate, updatedAt)
SELECT 'a0e10000-0000-4000-8000-000000000002', o.id, 'Testing', 'ACTIVE', CURDATE(), NOW(3)
FROM Organization o
WHERE o.name = 'Zenith Testing'
LIMIT 1;

INSERT INTO User (id, email, name, passwordHash, mustChangePassword, platformRole, isActive, mfaSecret, mfaEnabled, mfaLastStep, failedLoginCount, lockedUntil)
VALUES
  ('a0e10000-0000-4000-8000-000000000011', 'superadmin@zenithtesting.in', 'Zenith Super Admin', 'scrypt$xE73uvQlJLIeZBl2BN7qfw==$QD1JQ8Dxsc+Mao3tgCmFc4rteoOdmrtGgP7tzazasfv/eH+47tv2DoKogaK50LNLdPVMX8UphMjcsCJVflCCwQ==', 0, 'SUPER_ADMIN', 1, NULL, 0, NULL, 0, NULL),
  ('a0e10000-0000-4000-8000-000000000012', 'tenant@zenithtesting.in', 'Zenith Tenant Admin', 'scrypt$hvYOhiw92vHZ91P0GwcVUg==$zgkid0HMvVJ+clEyFCUmwcedjpqIENpLC0tYlaN0Hf8PV/JbGDOCL/f8intIhZW0rRy1pFHJnFQRj7VPk5ZLhQ==', 0, NULL, 1, NULL, 0, NULL, 0, NULL),
  ('a0e10000-0000-4000-8000-000000000013', 'dataentry@zenithtesting.in', 'Zenith Data Entry', 'scrypt$qQG9J/BAFckb4FA9j7D0Kg==$w648SKV/Q2GuQs8awNEZ3uwNl6vhPJOcJgK8zAN6trdhqAs6nSoXb71DO4uhPs1Ae7xZf2Y42toS7E82smX2LQ==', 0, NULL, 1, NULL, 0, NULL, 0, NULL),
  ('a0e10000-0000-4000-8000-000000000014', 'reviewer@zenithtesting.in', 'Zenith Reviewer', 'scrypt$T9E5RrVNaKvjXKs6N9+TQw==$9bOntF1yWbawrn+RgNUiG36DIRWJVK0DGpCyKAWGiGCkEOkfyjPtM7U7ribxQ5pQ1hbQMkQk+rSYT8IyS5+JAA==', 0, NULL, 1, NULL, 0, NULL, 0, NULL),
  ('a0e10000-0000-4000-8000-000000000015', 'verifier@zenithtesting.in', 'Zenith Verifier', 'scrypt$U0DhjqfACWSeF1xNPKavlg==$A5Qku9Qo2M/lr3/3TLQSMorvzR7YoxEBiZwf3Qx+9vEYA9M3iCZf6YjYZ2+wEoWi/01BVsO0JXSMAEIMHwT2jw==', 0, NULL, 1, NULL, 0, NULL, 0, NULL)
ON DUPLICATE KEY UPDATE
  name = VALUES(name),
  passwordHash = VALUES(passwordHash),
  mustChangePassword = 0,
  platformRole = VALUES(platformRole),
  isActive = 1,
  mfaSecret = NULL,
  mfaEnabled = 0,
  mfaLastStep = NULL,
  failedLoginCount = 0,
  lockedUntil = NULL;

INSERT INTO Membership (id, userId, organizationId, role)
SELECT 'a0e10000-0000-4000-8000-000000000021', u.id, o.id, 'TENANT_ADMIN'
FROM User u JOIN Organization o ON o.name = 'Zenith Testing'
WHERE u.email = 'tenant@zenithtesting.in'
ON DUPLICATE KEY UPDATE role = VALUES(role);

INSERT INTO Membership (id, userId, organizationId, role)
SELECT 'a0e10000-0000-4000-8000-000000000022', u.id, o.id, 'DATA_ENTRY'
FROM User u JOIN Organization o ON o.name = 'Zenith Testing'
WHERE u.email = 'dataentry@zenithtesting.in'
ON DUPLICATE KEY UPDATE role = VALUES(role);

INSERT INTO Membership (id, userId, organizationId, role)
SELECT 'a0e10000-0000-4000-8000-000000000023', u.id, o.id, 'REVIEWER'
FROM User u JOIN Organization o ON o.name = 'Zenith Testing'
WHERE u.email = 'reviewer@zenithtesting.in'
ON DUPLICATE KEY UPDATE role = VALUES(role);

INSERT INTO Membership (id, userId, organizationId, role)
SELECT 'a0e10000-0000-4000-8000-000000000024', u.id, o.id, 'VERIFIER'
FROM User u JOIN Organization o ON o.name = 'Zenith Testing'
WHERE u.email = 'verifier@zenithtesting.in'
ON DUPLICATE KEY UPDATE role = VALUES(role);
