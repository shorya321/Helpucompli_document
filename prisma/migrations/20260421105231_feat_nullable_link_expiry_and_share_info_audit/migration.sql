-- Feature: "Never expires" for links + policies, plus LINK_SHARE_INFO_VIEW audit action
--
-- 1. Add LINK_SHARE_INFO_VIEW to AuditAction enum (per-row audit when an
--    admin re-reveals a token via /api/links/[id]/share-info).
-- 2. Make access_policies.link_ttl_seconds nullable (policy that issues
--    non-expiring links).
-- 3. Make generated_links.expires_at nullable (perpetual share link;
--    still bounded by max_downloads + is_revoked).
--
-- Both nullable columns are superadmin-gated at the API layer — see
-- src/app/api/links/route.ts and src/app/api/policies/route.ts. Filters
-- that previously compared against NOW() must now allow IS NULL.

ALTER TYPE "AuditAction" ADD VALUE 'LINK_SHARE_INFO_VIEW';

ALTER TABLE "access_policies"
  ALTER COLUMN "link_ttl_seconds" DROP NOT NULL;

ALTER TABLE "generated_links"
  ALTER COLUMN "expires_at" DROP NOT NULL;
