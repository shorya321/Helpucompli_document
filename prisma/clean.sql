-- Wipe operational row data, keep schema/migrations.
-- Run via: npm run db:clean
-- Local dev only.
--
-- PRESERVED tables (intentional):
--   users      - Auth0 mapping; deleting would cascade-update audit_logs
--                (UPDATE blocked by HIPAA append-only trigger).
--   audit_logs - HIPAA 6-year append-only retention enforced by DB trigger
--                (BEFORE TRUNCATE/DELETE/UPDATE, firing always).
--
-- WIPED tables: buckets, documents, access_policies, generated_links,
-- user_bucket_access. These form a closed FK group; no CASCADE needed.
TRUNCATE TABLE
  user_bucket_access,
  generated_links,
  access_policies,
  documents,
  buckets
RESTART IDENTITY;
