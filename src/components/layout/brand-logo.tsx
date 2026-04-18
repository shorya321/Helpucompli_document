import Link from "next/link";
import { BRAND } from "@/lib/brand";

interface BrandLogoProps {
  readonly href?: string;
}

export function BrandLogo({ href = "/" }: BrandLogoProps) {
  return (
    <Link
      href={href}
      aria-label={`${BRAND.name} — ${BRAND.productName}`}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "0.5rem",
        textDecoration: "none",
        color: BRAND.colors.dark,
        fontFamily: `'${BRAND.font.family}', system-ui, sans-serif`,
        fontWeight: 700,
      }}
    >
      <span
        aria-hidden="true"
        style={{
          display: "inline-block",
          width: "1.5rem",
          height: "1.5rem",
          borderRadius: "0.375rem",
          background: BRAND.colors.pink,
        }}
      />
      <span style={{ fontSize: "1.125rem", letterSpacing: "-0.01em" }}>
        {BRAND.name}
      </span>
    </Link>
  );
}
