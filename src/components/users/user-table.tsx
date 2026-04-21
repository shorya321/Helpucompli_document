import Link from "next/link";
import { Eye, Shield, ShieldCheck } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { UserListRow } from "@/lib/user-list";
import type { Role } from "@/types";
import { RoleSelect } from "@/components/users/role-select";
import { StatusToggle } from "@/components/users/status-toggle";

interface UserTableProps {
  readonly rows: ReadonlyArray<UserListRow>;
  readonly total: number;
  readonly page: number;
  readonly pageSize: number;
  readonly query: {
    readonly q?: string;
    readonly role?: Role;
    readonly status?: "active" | "disabled";
  };
  readonly actorRole: Role;
  readonly actorId: string | null;
}

// Native <select> styled to match shadcn Input. The user filter form
// submits via GET, so we need the DOM element, not the Radix-based
// shadcn Select (which is a button + popover, not a form control).
const nativeSelectClass =
  "border-input bg-background text-foreground placeholder:text-muted-foreground focus-visible:ring-ring h-9 w-full rounded-md border px-3 py-1 text-sm shadow-xs transition-colors focus-visible:outline-hidden focus-visible:ring-1 disabled:cursor-not-allowed disabled:opacity-50";

type RoleBadgeVariant = "default" | "secondary" | "outline";

const ROLE_VARIANT: Record<Role, RoleBadgeVariant> = {
  superadmin: "default",
  admin: "secondary",
  viewer: "outline",
};

function roleIcon(role: Role) {
  if (role === "superadmin") return <ShieldCheck aria-hidden="true" />;
  if (role === "admin") return <Shield aria-hidden="true" />;
  return <Eye aria-hidden="true" />;
}

export function RoleBadge({ role }: { readonly role: Role }) {
  return (
    <Badge
      variant={ROLE_VARIANT[role]}
      className="gap-1 font-mono text-[0.65rem] uppercase tracking-wide"
    >
      {roleIcon(role)}
      {role}
    </Badge>
  );
}

export function StatusBadge({
  status,
}: {
  readonly status: "active" | "disabled";
}) {
  if (status === "active") {
    return (
      <Badge
        variant="secondary"
        className="font-mono text-[0.65rem] uppercase tracking-wide"
      >
        active
      </Badge>
    );
  }
  return (
    <Badge
      variant="outline"
      className="text-muted-foreground font-mono text-[0.65rem] uppercase tracking-wide"
    >
      disabled
    </Badge>
  );
}

export function UserTable({
  rows,
  total,
  page,
  pageSize,
  query,
  actorRole,
  actorId,
}: UserTableProps) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const hasFilters = Boolean(query.q || query.role || query.status);

  return (
    <section className="flex flex-col gap-4">
      <Card className="p-4">
        <form
          method="get"
          className="grid grid-cols-[repeat(auto-fit,minmax(10rem,1fr))] items-end gap-3"
        >
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="user-q">Search</Label>
            <Input
              id="user-q"
              type="text"
              name="q"
              defaultValue={query.q ?? ""}
              placeholder="Search name or email"
              maxLength={128}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="user-role">Role</Label>
            <select
              id="user-role"
              name="role"
              defaultValue={query.role ?? ""}
              className={nativeSelectClass}
            >
              <option value="">All roles</option>
              <option value="superadmin">Superadmin</option>
              <option value="admin">Admin</option>
              <option value="viewer">Viewer</option>
            </select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="user-status">Status</Label>
            <select
              id="user-status"
              name="status"
              defaultValue={query.status ?? ""}
              className={nativeSelectClass}
            >
              <option value="">All statuses</option>
              <option value="active">Active</option>
              <option value="disabled">Disabled</option>
            </select>
          </div>
          <div className="flex items-center gap-2">
            <Button type="submit" variant="secondary" size="sm">
              Apply
            </Button>
            {hasFilters && (
              <Button asChild variant="ghost" size="sm">
                <Link href="/users">Reset</Link>
              </Button>
            )}
          </div>
        </form>
      </Card>

      {rows.length === 0 ? (
        <div className="border-border bg-card text-muted-foreground rounded-lg border border-dashed p-6 text-center">
          No users match those filters.
        </div>
      ) : (
        <Card className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Last login</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right" aria-label="Actions" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="font-medium">
                    {row.name ?? "—"}
                  </TableCell>
                  <TableCell className="text-muted-foreground font-mono text-xs">
                    {row.email}
                  </TableCell>
                  <TableCell>
                    <span className="inline-flex items-center gap-2">
                      <RoleBadge role={row.role} />
                      <RoleSelect
                        userId={row.id}
                        currentRole={row.role}
                        actorRole={actorRole}
                        isSelf={actorId === row.id}
                      />
                    </span>
                  </TableCell>
                  <TableCell className="text-muted-foreground font-mono tabular-nums">
                    {row.lastLoginAt ? row.lastLoginAt.toLocaleString() : "Never"}
                  </TableCell>
                  <TableCell>
                    <span className="inline-flex items-center gap-2">
                      <StatusBadge status={row.status} />
                      <StatusToggle
                        userId={row.id}
                        currentStatus={row.status}
                        targetRole={row.role}
                        actorRole={actorRole}
                        isSelf={actorId === row.id}
                      />
                    </span>
                  </TableCell>
                  <TableCell className="text-right">
                    <Button asChild variant="ghost" size="sm">
                      <Link href={`/users/${row.id}`}>Details</Link>
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}

      {total > pageSize && (
        <div className="text-muted-foreground flex items-center justify-between text-xs">
          <span>
            Page {page} of {totalPages} · {total} users
          </span>
          <div className="flex gap-2">
            {page > 1 && (
              <PageLink query={query} page={page - 1} label="Prev" />
            )}
            {page < totalPages && (
              <PageLink query={query} page={page + 1} label="Next" />
            )}
          </div>
        </div>
      )}
    </section>
  );
}

function PageLink({
  query,
  page,
  label,
}: {
  readonly query: UserTableProps["query"];
  readonly page: number;
  readonly label: string;
}) {
  const params = new URLSearchParams();
  if (query.q) params.set("q", query.q);
  if (query.role) params.set("role", query.role);
  if (query.status) params.set("status", query.status);
  params.set("page", String(page));
  return (
    <Button asChild variant="outline" size="sm">
      <Link href={`/users?${params.toString()}`}>{label}</Link>
    </Button>
  );
}
