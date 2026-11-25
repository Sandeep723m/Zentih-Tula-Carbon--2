-- Tula Carbon: 3 of 3, TRIGGERS (optional). Makes the audit log append-only in the database.
-- If phpMyAdmin says you lack the TRIGGER privilege, skip this file: the app never edits audit rows.
DROP TRIGGER IF EXISTS audit_log_no_update;
CREATE TRIGGER audit_log_no_update BEFORE UPDATE ON `AuditLog` FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'AuditLog is append-only';
DROP TRIGGER IF EXISTS audit_log_no_delete;
CREATE TRIGGER audit_log_no_delete BEFORE DELETE ON `AuditLog` FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'AuditLog is append-only';
