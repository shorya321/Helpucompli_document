-- Additive enum value for restore audit trail (F6.7).
-- ALTER TYPE ... ADD VALUE is non-blocking on Postgres >= 12.
ALTER TYPE "AuditAction" ADD VALUE 'DOCUMENT_RESTORE';
