"use client";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  "DOCUMENT_RESTORE",
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

// Native <select> styled to match shadcn Input. The audit filter form
// is a controlled form on a client component, but we keep the native
// element here for consistency with the rest of the dashboard (buckets,
// users) — shadcn Select is a Radix button+popover, not a form control.
const nativeSelectClass =
  "border-input bg-background text-foreground placeholder:text-muted-foreground focus-visible:ring-ring h-9 w-full rounded-md border px-3 py-1 text-sm shadow-xs transition-colors focus-visible:outline-hidden focus-visible:ring-1 disabled:cursor-not-allowed disabled:opacity-50";

interface AuditFiltersProps {
  readonly value: AuditFiltersValue;
  readonly onChange: (next: AuditFiltersValue) => void;
  readonly onApply: () => void;
  readonly onReset: () => void;
  readonly disabled?: boolean;
}

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
    <Card className="mb-4 p-5">
      <form
        role="search"
        aria-label="Audit log filters"
        onSubmit={(e) => {
          e.preventDefault();
          onApply();
        }}
        className="flex flex-col gap-5"
      >
        <div className="grid grid-cols-[repeat(auto-fit,minmax(10rem,1fr))] items-end gap-3">
          <div className="flex flex-col gap-1.5">
            <Label
              htmlFor="audit-user-id"
              className="text-muted-foreground text-[11px] font-medium uppercase tracking-wider"
            >
              User ID
            </Label>
            <Input
              id="audit-user-id"
              type="text"
              value={value.userId}
              maxLength={128}
              placeholder="auth0|..."
              onChange={(e) => onChange({ ...value, userId: e.target.value })}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label
              htmlFor="audit-target-type"
              className="text-muted-foreground text-[11px] font-medium uppercase tracking-wider"
            >
              Target type
            </Label>
            <select
              id="audit-target-type"
              value={value.targetType}
              onChange={(e) =>
                onChange({
                  ...value,
                  targetType: e.target.value as AuditTargetType | "",
                })
              }
              className={nativeSelectClass}
            >
              <option value="">All</option>
              {TARGET_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label
              htmlFor="audit-date-from"
              className="text-muted-foreground text-[11px] font-medium uppercase tracking-wider"
            >
              From
            </Label>
            <Input
              id="audit-date-from"
              type="date"
              value={value.dateFrom}
              onChange={(e) => onChange({ ...value, dateFrom: e.target.value })}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label
              htmlFor="audit-date-to"
              className="text-muted-foreground text-[11px] font-medium uppercase tracking-wider"
            >
              To
            </Label>
            <Input
              id="audit-date-to"
              type="date"
              value={value.dateTo}
              onChange={(e) => onChange({ ...value, dateTo: e.target.value })}
            />
          </div>
        </div>

        <fieldset className="border-border/70 rounded-lg border p-3">
          <legend className="text-muted-foreground px-2 text-[11px] font-semibold uppercase tracking-wider">
            Actions
          </legend>
          <div className="flex flex-wrap gap-1.5">
            {ALL_ACTIONS.map((action) => {
              const active = value.actions.includes(action);
              return (
                <button
                  key={action}
                  type="button"
                  onClick={() => toggleAction(action)}
                  aria-pressed={active}
                  className={
                    active
                      ? "bg-foreground text-background inline-flex h-7 items-center rounded-full px-2.5 font-mono text-[10px] font-semibold uppercase tracking-wide transition-all duration-150 hover:opacity-90 active:scale-[0.97]"
                      : "bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground border-border/70 inline-flex h-7 items-center rounded-full border px-2.5 font-mono text-[10px] font-semibold uppercase tracking-wide transition-all duration-150 active:scale-[0.97]"
                  }
                >
                  {action}
                </button>
              );
            })}
          </div>
        </fieldset>

        <div className="flex items-center gap-2">
          <Button type="submit" variant="default" size="sm" disabled={disabled}>
            Apply filters
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onReset}
            disabled={disabled}
          >
            Reset
          </Button>
        </div>
      </form>
    </Card>
  );
}
