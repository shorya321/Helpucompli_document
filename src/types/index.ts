// HelpUcompli Document Repository — Type Definitions
// This file is populated as modules are implemented

export type Role = "superadmin" | "admin" | "viewer";

export type AuditAction =
  | "LOGIN"
  | "LOGOUT"
  | "BUCKET_CREATE"
  | "BUCKET_DELETE"
  | "DOCUMENT_UPLOAD"
  | "DOCUMENT_DOWNLOAD"
  | "DOCUMENT_SOFT_DELETE"
  | "DOCUMENT_HARD_DELETE"
  | "DOCUMENT_MOVE"
  | "DOCUMENT_COPY"
  | "POLICY_CREATE"
  | "POLICY_UPDATE"
  | "POLICY_DELETE"
  | "LINK_GENERATE"
  | "LINK_ACCESS"
  | "LINK_DENIED"
  | "LINK_REVOKE"
  | "USER_INVITE"
  | "USER_ROLE_CHANGE"
  | "USER_DISABLE"
  | "USER_ENABLE";

export type PolicyTargetType = "bucket" | "prefix" | "object";

export interface ApiResponse<T> {
  readonly data: T | null;
  readonly error: string | null;
}

export interface PaginatedResponse<T> extends ApiResponse<T[]> {
  readonly total: number;
  readonly page: number;
  readonly limit: number;
}
