import Link from "next/link";
import { BRAND } from "@/lib/brand";
import type { UserListRow } from "@/lib/user-list";
import type { Role } from "@/types";

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
}

const ROLE_STYLES: Record<Role, { bg: string; fg: string }> = {
  superadmin: { bg: "#E91E8C", fg: "#FFFFFF" },
  admin: { bg: "#2563EB", fg: "#FFFFFF" },
  viewer: { bg: "#E2E8F0", fg: "#1E293B" },
};

function RoleBadge({ role }: { readonly role: Role }) {
  const style = ROLE_STYLES[role];
  return (
    <span
      style={{
        background: style.bg,
        color: style.fg,
        padding: "0.15rem 0.55rem",
        borderRadius: "999px",
        fontSize: "0.7rem",
        fontWeight: 600,
        textTransform: "uppercase",
        letterSpacing: "0.04em",
      }}
    >
      {role}
    </span>
  );
}

function StatusBadge({ status }: { readonly status: "active" | "disabled" }) {
  const bg = status === "active" ? "#16A34A" : "#DC2626";
  return (
    <span
      style={{
        background: bg,
        color: "#FFFFFF",
        padding: "0.15rem 0.55rem",
        borderRadius: "999px",
        fontSize: "0.7rem",
        fontWeight: 600,
        textTransform: "uppercase",
        letterSpacing: "0.04em",
      }}
    >
      {status}
    </span>
  );
}

export function UserTable({ rows, total, page, pageSize, query }: UserTableProps) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const cell: React.CSSProperties = {
    padding: "0.625rem 1rem",
    borderBottom: `1px solid ${BRAND.colors.dark}0F`,
  };

  return (
    <section>
      <form
        method="get"
        style={{
          display: "flex",
          gap: "0.75rem",
          flexWrap: "wrap",
          marginBottom: "1rem",
        }}
      >
        <input
          type="text"
          name="q"
          defaultValue={query.q ?? ""}
          placeholder="Search name or email"
          maxLength={128}
          style={{
            padding: "0.4rem 0.65rem",
            border: `1px solid ${BRAND.colors.dark}33`,
            borderRadius: "0.375rem",
            fontSize: "0.85rem",
            minWidth: "14rem",
          }}
        />
        <select
          name="role"
          defaultValue={query.role ?? ""}
          style={{
            padding: "0.4rem 0.65rem",
            border: `1px solid ${BRAND.colors.dark}33`,
            borderRadius: "0.375rem",
            fontSize: "0.85rem",
          }}
        >
          <option value="">All roles</option>
          <option value="superadmin">Superadmin</option>
          <option value="admin">Admin</option>
          <option value="viewer">Viewer</option>
        </select>
        <select
          name="status"
          defaultValue={query.status ?? ""}
          style={{
            padding: "0.4rem 0.65rem",
            border: `1px solid ${BRAND.colors.dark}33`,
            borderRadius: "0.375rem",
            fontSize: "0.85rem",
          }}
        >
          <option value="">All statuses</option>
          <option value="active">Active</option>
          <option value="disabled">Disabled</option>
        </select>
        <button
          type="submit"
          style={{
            padding: "0.4rem 0.9rem",
            background: BRAND.colors.blue,
            color: "#FFFFFF",
            border: "none",
            borderRadius: "0.375rem",
            fontSize: "0.85rem",
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          Apply
        </button>
        {(query.q || query.role || query.status) && (
          <Link
            href="/users"
            style={{
              alignSelf: "center",
              fontSize: "0.8rem",
              color: BRAND.colors.blue,
            }}
          >
            Reset
          </Link>
        )}
      </form>

      <div
        style={{
          background: "#FFFFFF",
          border: `1px solid ${BRAND.colors.dark}1A`,
          borderRadius: "0.5rem",
          overflowX: "auto",
        }}
      >
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem" }}>
          <thead>
            <tr>
              {["Name", "Email", "Role", "Last login", "Status", ""].map((h) => (
                <th
                  key={h}
                  style={{
                    textAlign: "left",
                    padding: "0.75rem 1rem",
                    borderBottom: `1px solid ${BRAND.colors.dark}1A`,
                    fontSize: "0.75rem",
                    textTransform: "uppercase",
                    letterSpacing: "0.05em",
                    color: "rgba(30,41,59,0.64)",
                  }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td style={{ ...cell, fontWeight: 600 }}>{row.name ?? "—"}</td>
                <td
                  style={{
                    ...cell,
                    fontFamily: "ui-monospace, monospace",
                    fontSize: "0.8rem",
                  }}
                >
                  {row.email}
                </td>
                <td style={cell}>
                  <RoleBadge role={row.role} />
                </td>
                <td
                  style={{
                    ...cell,
                    color: "rgba(30,41,59,0.64)",
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {row.lastLoginAt ? row.lastLoginAt.toLocaleString() : "Never"}
                </td>
                <td style={cell}>
                  <StatusBadge status={row.status} />
                </td>
                <td style={{ ...cell, textAlign: "right" }}>
                  <Link
                    href={`/users/${row.id}`}
                    style={{
                      color: BRAND.colors.blue,
                      textDecoration: "none",
                      fontWeight: 600,
                    }}
                  >
                    Details
                  </Link>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td
                  colSpan={6}
                  style={{
                    padding: "2rem",
                    textAlign: "center",
                    color: "rgba(30,41,59,0.56)",
                  }}
                >
                  No users match those filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {total > pageSize && (
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginTop: "0.75rem",
            fontSize: "0.8rem",
            color: "rgba(30,41,59,0.64)",
          }}
        >
          <span>
            Page {page} of {totalPages} · {total} users
          </span>
          <div style={{ display: "flex", gap: "0.5rem" }}>
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
    <Link
      href={`/users?${params.toString()}`}
      style={{
        padding: "0.3rem 0.7rem",
        border: `1px solid ${BRAND.colors.dark}33`,
        borderRadius: "0.375rem",
        color: BRAND.colors.dark,
        textDecoration: "none",
      }}
    >
      {label}
    </Link>
  );
}
