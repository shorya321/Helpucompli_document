import Link from "next/link";
import { redirect } from "next/navigation";
import { auth0 } from "@/lib/auth0";
import { resolveHasRole } from "@/lib/auth-guard";
import { BRAND } from "@/lib/brand";
import { prisma } from "@/lib/prisma";
import {
  asPolicyListPrisma,
  getPolicyList,
  summarizeRestrictions,
  type PolicyListRow,
} from "@/lib/policy-list";
import { DeletePolicyButton } from "@/components/policies/delete-policy-button";

export const dynamic = "force-dynamic";

export default async function PoliciesPage() {
  const session = await auth0.getSession();
  if (!session) redirect("/auth/login");
  if (!(await resolveHasRole(session, ["superadmin", "admin"]))) {
    redirect("/");
  }

  let rows: readonly PolicyListRow[] = [];
  let loadError = false;
  try {
    rows = await getPolicyList(asPolicyListPrisma(prisma));
  } catch {
    loadError = true;
  }

  return (
    <main
      style={{
        padding: "2rem",
        maxWidth: "80rem",
        margin: "0 auto",
        fontFamily: `'${BRAND.font.family}', system-ui, sans-serif`,
        color: BRAND.colors.dark,
      }}
    >
      <header
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: "1.5rem",
        }}
      >
        <div>
          <h1 style={{ fontSize: "1.5rem", fontWeight: 700, margin: 0 }}>
            Access policies
          </h1>
          <p style={{ color: "rgba(30,41,59,0.64)", margin: "0.25rem 0 0" }}>
            Restrict link sharing by IP, referrer, expiry, and download count.
          </p>
        </div>
        <Link
          href="/policies/new"
          style={{
            padding: "0.5rem 1rem",
            background: BRAND.colors.pink,
            color: "#FFFFFF",
            borderRadius: "0.375rem",
            textDecoration: "none",
            fontWeight: 600,
            fontSize: "0.85rem",
          }}
        >
          + New policy
        </Link>
      </header>

      {loadError && (
        <p role="alert" style={{ color: BRAND.colors.pink }}>
          Unable to load policies. Try again.
        </p>
      )}

      <div
        style={{
          background: "#FFFFFF",
          border: `1px solid ${BRAND.colors.dark}1A`,
          borderRadius: "0.5rem",
          overflowX: "auto",
        }}
      >
        <table
          style={{
            width: "100%",
            borderCollapse: "collapse",
            fontSize: "0.85rem",
          }}
        >
          <thead>
            <tr>
              {["Name", "Target", "Restrictions", "Updated", ""].map((h) => (
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
                <td
                  style={{
                    padding: "0.625rem 1rem",
                    borderBottom: `1px solid ${BRAND.colors.dark}0F`,
                    fontWeight: 600,
                  }}
                >
                  {row.name}
                </td>
                <td
                  style={{
                    padding: "0.625rem 1rem",
                    borderBottom: `1px solid ${BRAND.colors.dark}0F`,
                    fontFamily: "ui-monospace, monospace",
                    fontSize: "0.8rem",
                  }}
                >
                  {row.targetType}:{row.targetValue}
                </td>
                <td
                  style={{
                    padding: "0.625rem 1rem",
                    borderBottom: `1px solid ${BRAND.colors.dark}0F`,
                    color: "rgba(30,41,59,0.72)",
                  }}
                >
                  {summarizeRestrictions(row)}
                </td>
                <td
                  style={{
                    padding: "0.625rem 1rem",
                    borderBottom: `1px solid ${BRAND.colors.dark}0F`,
                    color: "rgba(30,41,59,0.56)",
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {row.updatedAt.toLocaleDateString()}
                </td>
                <td
                  style={{
                    padding: "0.625rem 1rem",
                    borderBottom: `1px solid ${BRAND.colors.dark}0F`,
                    textAlign: "right",
                  }}
                >
                  <Link
                    href={`/policies/${row.id}`}
                    style={{
                      marginRight: "0.5rem",
                      color: BRAND.colors.blue,
                      textDecoration: "none",
                      fontWeight: 600,
                    }}
                  >
                    Edit
                  </Link>
                  <DeletePolicyButton id={row.id} name={row.name} />
                </td>
              </tr>
            ))}
            {rows.length === 0 && !loadError && (
              <tr>
                <td
                  colSpan={5}
                  style={{
                    padding: "2rem",
                    textAlign: "center",
                    color: "rgba(30,41,59,0.56)",
                  }}
                >
                  No policies yet. Create one to start restricting link
                  sharing.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </main>
  );
}
