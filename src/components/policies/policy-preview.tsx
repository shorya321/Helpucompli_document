"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  describePolicy,
  type PolicyPreviewInput,
} from "@/lib/policy-preview";

interface PolicyPreviewProps {
  readonly policy: PolicyPreviewInput;
}

const ROWS: ReadonlyArray<{
  readonly label: string;
  readonly key: keyof ReturnType<typeof describePolicy>;
}> = [
  { label: "Applies to", key: "target" },
  { label: "Links expire after", key: "ttl" },
  { label: "Max downloads", key: "maxDownloads" },
  { label: "IP restriction", key: "ipRestriction" },
  { label: "Domain restriction", key: "domainRestriction" },
  { label: "Auth required", key: "requireAuth" },
];

export function PolicyPreview({ policy }: PolicyPreviewProps) {
  const desc = describePolicy(policy);
  return (
    <aside aria-label="Policy preview" className="contents">
      <Card>
        <CardHeader>
          <CardTitle className="text-muted-foreground text-xs font-bold uppercase tracking-wider">
            Policy preview
          </CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
            {ROWS.map((row) => (
              <div key={row.key} className="contents">
                <dt className="text-muted-foreground font-semibold">
                  {row.label}
                </dt>
                <dd
                  className={
                    row.key === "target"
                      ? "text-foreground m-0 tabular-nums"
                      : "text-foreground m-0"
                  }
                >
                  {desc[row.key]}
                </dd>
              </div>
            ))}
          </dl>
        </CardContent>
      </Card>
    </aside>
  );
}
