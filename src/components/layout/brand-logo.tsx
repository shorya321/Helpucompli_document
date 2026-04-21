import Link from "next/link";

const DISPLAY_NAME = "Compass Doc";

interface BrandLogoProps {
  readonly href?: string;
  readonly className?: string;
}

export function BrandLogo({ href = "/", className }: BrandLogoProps) {
  return (
    <Link
      href={href}
      aria-label={DISPLAY_NAME}
      className={`inline-flex items-center gap-2 font-semibold tracking-tight text-foreground no-underline ${className ?? ""}`.trim()}
    >
      <span
        aria-hidden="true"
        className="inline-block h-6 w-6 rounded-md bg-foreground"
      />
      <span className="text-base">{DISPLAY_NAME}</span>
    </Link>
  );
}
