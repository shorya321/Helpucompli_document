"use client";

import { BRAND } from "@/lib/brand";
import type { AuditAction } from "@/types";
import type { AuditTargetType } from "@/lib/audit-query";

export interface AuditFiltersValue {
  readonly userId: string;
  readonly actions: readonly AuditAction[];
  readonly targetType: AuditTargetType | "";
  readonly dateFrom: string;
  readonly dateTo: string;
}

export const EMPTY_FILTERS: AuditFiltersValue = {
  userId: "",
  actions: [],
  targetType: "",
  dateFrom: "",
  dateTo: "",
};

const ALL_ACTIONS: readonly AuditAction[] = [
  "LOGIN",
  "LOGOUT",
  "BUCKET_CREATE",
  "BUCKET_DELETE",
  "DOCUMENT_UPLOAD",
  "DOCUMENT_DOWNLOAD",
  "DOCUMENT_SOFT_DELETE",
  "DOCUMENT_HARD_DELETE",
  "DOCUMENT_MOVE",
  "DOCUMENT_COPY",
  "POLICY_CREATE",
  "POLICY_UPDATE",
  "POLICY_DELETE",
  "LINK_GENERATE",
  "LINK_ACCESS",
  "LINK_DENIED",
  "LINK_REVOKE",
  "USER_INVITE",
  "USER_ROLE_CHANGE",
  "USER_DISABLE",
  "USER_ENABLE",
];

const TARGET_TYPES: readonly AuditTargetType[] = [
  "bucket",
  "document",
  "policy",
  "user",
  "link",
];

interface AuditFiltersProps {
  readonly value: AuditFiltersValue;
  readonly onChange: (next: AuditFiltersValue) => void;
  readonly onApply: () => void;
  readonly onReset: () => void;
  readonly disabled?: boolean;
}

const inputStyle: React.CSSProperties = {
  padding: "0.5rem 0.75rem",
  border: `1px solid ${BRAND.colors.dark}33`,
  borderRadius: "0.375rem",
  fontFamily: `'${BRAND.font.family}', system-ui, sans-serif`,
  fontSize: "0.85rem",
  background: "#FFFFFF",
  color: BRAND.colors.dark,
};

const labelStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "0.25rem",
  fontFamily: `'${BRAND.font.family}', system-ui, sans-serif`,
  fontSize: "0.75rem",
  fontWeight: 600,
  color: "rgba(30,41,59,0.72)",
};

const buttonStyle: React.CSSProperties = {
  padding: "0.5rem 1rem",
  borderRadius: "0.375rem",
  border: "none",
  cursor: "pointer",
  fontWeight: 600,
  fontSize: "0.85rem",
  fontFamily: `'${BRAND.font.family}', system-ui, sans-serif`,
};

export function AuditFilters({
  value,
  onChange,
  onApply,
  onReset,
  disabled,
}: AuditFiltersProps) {
  const toggleAction = (action: AuditAction) => {
    const set = new Set(value.actions);
    if (set.has(action)) set.delete(action);
    else set.add(action);
    onChange({ ...value, actions: Array.from(set) });
  };

  return (
    <form
      role="search"
      aria-label="Audit log filters"
      onSubmit={(e) => {
        e.preventDefault();
        onApply();
      }}
      style={{
        display: "flex",
        flexWrap: "wrap",
        gap: "1rem",
        padding: "1rem",
        background: "#FFFFFF",
        border: `1px solid ${BRAND.colors.dark}1A`,
        borderRadius: "0.5rem",
        marginBottom: "1rem",
      }}
    >
      <label style={labelStyle}>
        User ID
        <input
          type="text"
          value={value.userId}
          maxLength={128}
          placeholder="auth0|..."
          onChange={(e) => onChange({ ...value, userId: e.target.value })}
          style={{ ...inputStyle, minWidth: "12rem" }}
        />
      </label>

      <label style={labelStyle}>
        Target type
        <select
          value={value.targetType}
          onChange={(e) =>
            onChange({
              ...value,
              targetType: e.target.value as AuditTargetType | "",
            })
          }
          style={inputStyle}
        >
          <option value="">All</option>
          {TARGET_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </label>

      <label style={labelStyle}>
        From
        <input
          type="date"
          value={value.dateFrom}
          onChange={(e) => onChange({ ...value, dateFrom: e.target.value })}
          style={inputStyle}
        />
      </label>

      <label style={labelStyle}>
        To
        <input
          type="date"
          value={value.dateTo}
          onChange={(e) => onChange({ ...value, dateTo: e.target.value })}
          style={inputStyle}
        />
      </label>

      <fieldset
        style={{
          flexBasis: "100%",
          border: `1px solid ${BRAND.colors.dark}1A`,
          borderRadius: "0.375rem",
          padding: "0.5rem",
          margin: 0,
        }}
      >
        <legend
          style={{
            ...labelStyle,
            padding: "0 0.5rem",
            display: "inline",
          }}
        >
          Actions
        </legend>
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: "0.375rem",
          }}
        >
          {ALL_ACTIONS.map((action) => {
            const active = value.actions.includes(action);
            return (
              <button
                key={action}
                type="button"
                onClick={() => toggleAction(action)}
                style={{
                  ...buttonStyle,
                  fontSize: "0.7rem",
                  padding: "0.25rem 0.5rem",
                  background: active ? BRAND.colors.blue : "transparent",
                  color: active ? "#FFFFFF" : BRAND.colors.dark,
                  border: `1px solid ${
                    active ? BRAND.colors.blue : BRAND.colors.dark + "33"
                  }`,
                }}
                aria-pressed={active}
              >
                {action}
              </button>
            );
          })}
        </div>
      </fieldset>

      <div style={{ display: "flex", gap: "0.5rem", alignItems: "flex-end" }}>
        <button
          type="submit"
          disabled={disabled}
          style={{
            ...buttonStyle,
            background: BRAND.colors.pink,
            color: "#FFFFFF",
            opacity: disabled ? 0.6 : 1,
          }}
        >
          Apply filters
        </button>
        <button
          type="button"
          onClick={onReset}
          disabled={disabled}
          style={{
            ...buttonStyle,
            background: "transparent",
            color: BRAND.colors.dark,
            border: `1px solid ${BRAND.colors.dark}33`,
          }}
        >
          Reset
        </button>
      </div>
    </form>
  );
}
