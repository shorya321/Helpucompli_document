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
import { ChevronLeftIcon, ChevronRightIcon, MoreHorizontalIcon } from "lucide-react";

import {
  Pagination,
  PaginationContent,
  PaginationItem,
} from "@/components/ui/pagination";
import { buttonVariants } from "@/components/ui/button";
import { buildPageWindow } from "@/components/ui/data-pagination";
import { cn } from "@/lib/utils";
import { formatDateTime } from "@/lib/format-datetime";
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
      className="gap-1 font-mono text-[10px] uppercase tracking-wide"
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
        className="font-mono text-[10px] uppercase tracking-wide"
      >
        active
      </Badge>
    );
  }
  return (
    <Badge
      variant="outline"
      className="text-muted-foreground font-mono text-[10px] uppercase tracking-wide"
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
      <Card className="p-5">
        <form
          method="get"
          className="grid grid-cols-[repeat(auto-fit,minmax(10rem,1fr))] items-end gap-3"
        >
          <div className="flex flex-col gap-1.5">
            <Label
              htmlFor="user-q"
              className="text-muted-foreground text-[11px] font-medium uppercase tracking-wider"
            >
              Search
            </Label>
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
            <Label
              htmlFor="user-role"
              className="text-muted-foreground text-[11px] font-medium uppercase tracking-wider"
            >
              Role
            </Label>
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
            <Label
              htmlFor="user-status"
              className="text-muted-foreground text-[11px] font-medium uppercase tracking-wider"
            >
              Status
            </Label>
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
        <div className="border-border bg-card text-muted-foreground flex flex-col items-center gap-3 rounded-xl border border-dashed px-6 py-10 text-center">
          <p className="text-sm">No users match those filters.</p>
        </div>
      ) : (
        <Card className="overflow-hidden p-0">
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
                  <TableCell className="text-muted-foreground font-mono text-xs tabular-nums">
                    {row.lastLoginAt ? formatDateTime(row.lastLoginAt) : "Never"}
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
        <div className="flex flex-col items-center justify-between gap-3 sm:flex-row">
          <span className="text-muted-foreground text-xs">
            Page {page} of {totalPages} · {total} users
          </span>
          <UserTablePagination
            query={query}
            page={page}
            totalPages={totalPages}
          />
        </div>
      )}
    </section>
  );
}

function buildHref(query: UserTableProps["query"], page: number): string {
  const params = new URLSearchParams();
  if (query.q) params.set("q", query.q);
  if (query.role) params.set("role", query.role);
  if (query.status) params.set("status", query.status);
  params.set("page", String(page));
  return `/users?${params.toString()}`;
}

const DISABLED_LINK = "pointer-events-none cursor-not-allowed opacity-50";

function UserTablePagination({
  query,
  page,
  totalPages,
}: {
  readonly query: UserTableProps["query"];
  readonly page: number;
  readonly totalPages: number;
}) {
  const isFirst = page <= 1;
  const isLast = page >= totalPages;
  const window = buildPageWindow(page, totalPages, 1);

  return (
    <Pagination className="sm:mx-0 sm:w-auto sm:justify-end">
      <PaginationContent>
        <PaginationItem>
          <PageNavLink
            href={buildHref(query, page - 1)}
            disabled={isFirst}
            ariaLabel="Go to previous page"
          >
            <ChevronLeftIcon />
            <span className="hidden sm:block">Previous</span>
          </PageNavLink>
        </PaginationItem>
        {window.map((item) => {
          if (item === "ellipsis-left" || item === "ellipsis-right") {
            return (
              <PaginationItem key={item}>
                <span
                  aria-hidden="true"
                  className="flex size-9 items-center justify-center"
                >
                  <MoreHorizontalIcon className="size-4" />
                  <span className="sr-only">More pages</span>
                </span>
              </PaginationItem>
            );
          }
          const active = item === page;
          return (
            <PaginationItem key={item}>
              <PageNumberLink
                href={buildHref(query, item)}
                page={item}
                isActive={active}
              />
            </PaginationItem>
          );
        })}
        <PaginationItem>
          <PageNavLink
            href={buildHref(query, page + 1)}
            disabled={isLast}
            ariaLabel="Go to next page"
          >
            <span className="hidden sm:block">Next</span>
            <ChevronRightIcon />
          </PageNavLink>
        </PaginationItem>
      </PaginationContent>
    </Pagination>
  );
}

function PageNavLink({
  href,
  disabled,
  ariaLabel,
  children,
}: {
  readonly href: string;
  readonly disabled: boolean;
  readonly ariaLabel: string;
  readonly children: React.ReactNode;
}) {
  const className = cn(
    buttonVariants({ variant: "ghost", size: "default" }),
    "gap-1 px-2.5",
    disabled && DISABLED_LINK,
  );
  if (disabled) {
    return (
      <span
        aria-label={ariaLabel}
        aria-disabled="true"
        className={className}
        data-slot="pagination-link"
      >
        {children}
      </span>
    );
  }
  return (
    <Link
      href={href}
      aria-label={ariaLabel}
      className={className}
      data-slot="pagination-link"
    >
      {children}
    </Link>
  );
}

function PageNumberLink({
  href,
  page,
  isActive,
}: {
  readonly href: string;
  readonly page: number;
  readonly isActive: boolean;
}) {
  const className = cn(
    buttonVariants({
      variant: isActive ? "outline" : "ghost",
      size: "icon",
    }),
  );
  if (isActive) {
    return (
      <span
        aria-current="page"
        aria-label={`Go to page ${page}`}
        data-slot="pagination-link"
        data-active="true"
        className={className}
      >
        {page}
      </span>
    );
  }
  return (
    <Link
      href={href}
      aria-label={`Go to page ${page}`}
      data-slot="pagination-link"
      className={className}
    >
      {page}
    </Link>
  );
}
