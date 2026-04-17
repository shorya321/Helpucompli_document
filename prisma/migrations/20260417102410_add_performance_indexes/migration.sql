-- CreateIndex
CREATE INDEX "documents_is_deleted_idx" ON "documents"("is_deleted");

-- CreateIndex
CREATE INDEX "documents_uploaded_at_idx" ON "documents"("uploaded_at");

-- CreateIndex
CREATE INDEX "generated_links_expires_at_idx" ON "generated_links"("expires_at");

-- CreateIndex
CREATE INDEX "generated_links_is_revoked_idx" ON "generated_links"("is_revoked");
