import type { Metadata } from "next";
import Link from "next/link";
import { BRAND } from "@/lib/brand";

export const metadata: Metadata = {
  title: `Access Denied — ${BRAND.name}`,
  description:
    "You do not have permission to view this page. Contact an administrator.",
  robots: { index: false, follow: false },
};

export default function AccessDeniedPage() {
  return (
    <main
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        background: BRAND.colors.dark,
        color: BRAND.colors.light,
        fontFamily: `'${BRAND.font.family}', system-ui, sans-serif`,
        padding: "2rem 1rem",
      }}
    >
      <div
        role="alert"
        aria-labelledby="access-denied-heading"
        style={{
          maxWidth: "32rem",
          width: "100%",
          background: "rgba(255,255,255,0.04)",
          border: `1px solid ${BRAND.colors.pink}`,
          borderRadius: "0.75rem",
          padding: "2rem",
          textAlign: "center",
        }}
      >
        <p
          style={{
            textTransform: "uppercase",
            letterSpacing: "0.1em",
            color: BRAND.colors.pink,
            margin: 0,
            fontSize: "0.875rem",
            fontWeight: 600,
          }}
        >
          {BRAND.name}
        </p>
        <h1
          id="access-denied-heading"
          style={{
            margin: "0.5rem 0 0.75rem",
            fontSize: "1.75rem",
            fontWeight: 700,
          }}
        >
          Access Denied
        </h1>
        <p style={{ margin: "0 0 1.5rem", color: "rgba(248,250,252,0.8)" }}>
          You do not have permission to view this resource. Please contact an
          administrator to request access.
        </p>
        <div
          style={{
            display: "flex",
            gap: "0.75rem",
            justifyContent: "center",
            flexWrap: "wrap",
          }}
        >
          <Link
            href="/auth/login"
            style={{
              background: BRAND.colors.pink,
              color: BRAND.colors.light,
              padding: "0.625rem 1.25rem",
              borderRadius: "0.5rem",
              textDecoration: "none",
              fontWeight: 600,
            }}
          >
            Return to sign-in
          </Link>
          <a
            href={`mailto:admin@${BRAND.domain}?subject=Access%20request`}
            style={{
              background: "transparent",
              color: BRAND.colors.light,
              padding: "0.625rem 1.25rem",
              borderRadius: "0.5rem",
              textDecoration: "none",
              fontWeight: 600,
              border: `1px solid ${BRAND.colors.blue}`,
            }}
          >
            Contact administrator
          </a>
        </div>
      </div>
    </main>
  );
}
