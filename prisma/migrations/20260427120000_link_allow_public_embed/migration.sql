-- Feature: per-link `allow_public_embed` opt-in for cross-platform
-- iframe embedding (WordPress, Circle, Notion) + LINK_OEMBED_FETCHED
-- audit action.
--
-- 1. Add LINK_OEMBED_FETCHED to AuditAction enum (per-row audit when
--    a third-party platform calls /api/oembed against a token).
-- 2. Add generated_links.allow_public_embed boolean, default false.
--    Default false → every existing link continues to emit
--    `frame-ancestors 'none'` and stays non-embeddable (HIPAA-safe).
--    Toggling true on a per-link basis enables oEmbed discovery, the
--    /api/oembed endpoint, and an `https:` source in CSP frame-
--    ancestors. Gated at the API layer + audit-logged at create time.

ALTER TYPE "AuditAction" ADD VALUE 'LINK_OEMBED_FETCHED';

ALTER TABLE "generated_links"
  ADD COLUMN "allow_public_embed" BOOLEAN NOT NULL DEFAULT false;
