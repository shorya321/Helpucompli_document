-- CreateEnum
CREATE TYPE "Role" AS ENUM ('superadmin', 'admin', 'viewer');

-- CreateEnum
CREATE TYPE "AuditAction" AS ENUM ('LOGIN', 'LOGOUT', 'BUCKET_CREATE', 'BUCKET_DELETE', 'DOCUMENT_UPLOAD', 'DOCUMENT_DOWNLOAD', 'DOCUMENT_SOFT_DELETE', 'DOCUMENT_HARD_DELETE', 'DOCUMENT_MOVE', 'DOCUMENT_COPY', 'POLICY_CREATE', 'POLICY_UPDATE', 'POLICY_DELETE', 'LINK_GENERATE', 'LINK_ACCESS', 'LINK_DENIED', 'LINK_REVOKE', 'USER_INVITE', 'USER_ROLE_CHANGE', 'USER_DISABLE', 'USER_ENABLE');

-- CreateEnum
CREATE TYPE "PolicyTargetType" AS ENUM ('bucket', 'prefix', 'object');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('active', 'disabled');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "auth0_id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "role" "Role" NOT NULL DEFAULT 'viewer',
    "status" "UserStatus" NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_login_at" TIMESTAMP(3),

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "buckets" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "aws_region" TEXT NOT NULL,
    "description" TEXT,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "buckets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "documents" (
    "id" TEXT NOT NULL,
    "bucket_id" TEXT NOT NULL,
    "s3_key" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "content_type" TEXT,
    "size_bytes" BIGINT,
    "uploaded_by" TEXT NOT NULL,
    "uploaded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "deleted_at" TIMESTAMP(3),
    "deleted_by" TEXT,

    CONSTRAINT "documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "access_policies" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "target_type" "PolicyTargetType" NOT NULL,
    "target_value" TEXT NOT NULL,
    "allowed_domains" JSONB,
    "allowed_ip_ranges" JSONB,
    "link_ttl_seconds" INTEGER NOT NULL DEFAULT 900,
    "max_downloads" INTEGER,
    "require_auth" BOOLEAN NOT NULL DEFAULT false,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "access_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "generated_links" (
    "id" TEXT NOT NULL,
    "document_id" TEXT NOT NULL,
    "policy_id" TEXT,
    "generated_by" TEXT NOT NULL,
    "presigned_url_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "download_count" INTEGER NOT NULL DEFAULT 0,
    "max_downloads" INTEGER,
    "is_revoked" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "generated_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "user_id" TEXT,
    "action" "AuditAction" NOT NULL,
    "target_type" TEXT NOT NULL,
    "target_id" TEXT NOT NULL,
    "metadata" JSONB DEFAULT '{}',
    "ip_address" TEXT NOT NULL,
    "user_agent" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_bucket_access" (
    "user_id" TEXT NOT NULL,
    "bucket_id" TEXT NOT NULL,
    "granted_by" TEXT NOT NULL,
    "granted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_bucket_access_pkey" PRIMARY KEY ("user_id","bucket_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_auth0_id_key" ON "users"("auth0_id");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "buckets_name_key" ON "buckets"("name");

-- CreateIndex
CREATE INDEX "documents_bucket_id_idx" ON "documents"("bucket_id");

-- CreateIndex
CREATE INDEX "documents_s3_key_idx" ON "documents"("s3_key");

-- CreateIndex
CREATE UNIQUE INDEX "generated_links_presigned_url_hash_key" ON "generated_links"("presigned_url_hash");

-- CreateIndex
CREATE INDEX "generated_links_document_id_idx" ON "generated_links"("document_id");

-- CreateIndex
CREATE INDEX "audit_logs_created_at_idx" ON "audit_logs"("created_at");

-- CreateIndex
CREATE INDEX "audit_logs_user_id_idx" ON "audit_logs"("user_id");

-- CreateIndex
CREATE INDEX "audit_logs_action_idx" ON "audit_logs"("action");

-- AddForeignKey
ALTER TABLE "buckets" ADD CONSTRAINT "buckets_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_bucket_id_fkey" FOREIGN KEY ("bucket_id") REFERENCES "buckets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_uploaded_by_fkey" FOREIGN KEY ("uploaded_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_deleted_by_fkey" FOREIGN KEY ("deleted_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "access_policies" ADD CONSTRAINT "access_policies_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "generated_links" ADD CONSTRAINT "generated_links_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "generated_links" ADD CONSTRAINT "generated_links_policy_id_fkey" FOREIGN KEY ("policy_id") REFERENCES "access_policies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "generated_links" ADD CONSTRAINT "generated_links_generated_by_fkey" FOREIGN KEY ("generated_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_bucket_access" ADD CONSTRAINT "user_bucket_access_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_bucket_access" ADD CONSTRAINT "user_bucket_access_bucket_id_fkey" FOREIGN KEY ("bucket_id") REFERENCES "buckets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_bucket_access" ADD CONSTRAINT "user_bucket_access_granted_by_fkey" FOREIGN KEY ("granted_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ============================================================================
-- F2.1 — audit_logs append-only database enforcement
-- HIPAA 6-year retention requires that audit entries cannot be modified or
-- removed by application code, $executeRaw, or any bypass of a source-layer
-- convention. Triggers raise an exception on every UPDATE or DELETE,
-- regardless of the caller.
-- ============================================================================
CREATE OR REPLACE FUNCTION audit_logs_reject_mutation()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs is append-only; % is not permitted', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_logs_no_update
  BEFORE UPDATE ON "audit_logs"
  FOR EACH ROW EXECUTE FUNCTION audit_logs_reject_mutation();

CREATE TRIGGER audit_logs_no_delete
  BEFORE DELETE ON "audit_logs"
  FOR EACH ROW EXECUTE FUNCTION audit_logs_reject_mutation();

CREATE TRIGGER audit_logs_no_truncate
  BEFORE TRUNCATE ON "audit_logs"
  FOR EACH STATEMENT EXECUTE FUNCTION audit_logs_reject_mutation();
