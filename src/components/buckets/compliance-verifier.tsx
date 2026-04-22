"use client";

import { useState } from "react";
import { AlertTriangle, CheckCircle2, ShieldCheck } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

interface ComplianceVerifierProps {
  readonly bucketId: string;
}

interface ComplianceField {
  readonly ok: boolean;
  readonly errorReason?: string;
}

interface ComplianceReport {
  readonly bucketName: string;
  readonly compliant: boolean;
  readonly sseKms: ComplianceField & {
    algorithm: string | null;
    bucketKeyEnabled: boolean;
  };
  readonly versioning: ComplianceField & { status: string | null };
  readonly publicAccessBlock: ComplianceField & {
    blockPublicAcls: boolean;
    ignorePublicAcls: boolean;
    blockPublicPolicy: boolean;
    restrictPublicBuckets: boolean;
  };
  readonly httpsOnlyPolicy: ComplianceField & {
    denyNonHttpsPresent: boolean;
    denyTlsBelow12Present: boolean;
  };
  readonly checkedAt: string;
}

export function ComplianceVerifier({ bucketId }: ComplianceVerifierProps) {
  const [pending, setPending] = useState(false);
  const [report, setReport] = useState<ComplianceReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/s3/buckets/${bucketId}/compliance`, {
        method: "GET",
        headers: { "cache-control": "no-cache" },
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        setError(body?.error ?? `Request failed (${res.status})`);
        setReport(null);
        return;
      }
      const body = (await res.json()) as { data: ComplianceReport };
      setReport(body.data);
    } catch {
      setError("Network error. Try again.");
    } finally {
      setPending(false);
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
        <div className="flex min-w-0 items-start gap-3">
          <span className="bg-muted text-muted-foreground flex size-8 shrink-0 items-center justify-center rounded-md">
            <ShieldCheck aria-hidden="true" className="size-4" />
          </span>
          <div className="min-w-0">
            <CardTitle className="text-foreground text-sm font-semibold">
              Live drift check
            </CardTitle>
            <CardDescription className="text-xs">
              Queries the real S3 configuration and reports any drift from the
              HIPAA baseline.
            </CardDescription>
          </div>
        </div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={run}
          disabled={pending}
        >
          {pending ? "Checking…" : "Verify now"}
        </Button>
      </CardHeader>
      {pending || error || report ? (
        <CardContent>
          {pending ? (
            <div
              aria-busy="true"
              aria-live="polite"
              aria-label="Checking S3 compliance"
              className="flex flex-col gap-2"
            >
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-9 w-full rounded-md" />
              ))}
            </div>
          ) : null}
          {!pending && error ? (
            <p role="alert" className="text-destructive text-sm">
              {error}
            </p>
          ) : null}
          {!pending && report ? (
            <div className="flex flex-col gap-3">
              <ul
                role="list"
                className="border-border bg-card divide-y divide-border/60 m-0 flex list-none flex-col overflow-hidden rounded-md border p-0"
              >
                <Row
                  label="SSE-KMS encryption"
                  ok={report.sseKms.ok}
                  detail={
                    report.sseKms.errorReason ??
                    `algorithm: ${report.sseKms.algorithm ?? "none"}`
                  }
                />
                <Row
                  label="Versioning"
                  ok={report.versioning.ok}
                  detail={
                    report.versioning.errorReason ??
                    `status: ${report.versioning.status ?? "unset"}`
                  }
                />
                <Row
                  label="Public access block (all 4 flags)"
                  ok={report.publicAccessBlock.ok}
                  detail={
                    report.publicAccessBlock.errorReason ??
                    [
                      `acls=${report.publicAccessBlock.blockPublicAcls}`,
                      `ignore=${report.publicAccessBlock.ignorePublicAcls}`,
                      `policy=${report.publicAccessBlock.blockPublicPolicy}`,
                      `restrict=${report.publicAccessBlock.restrictPublicBuckets}`,
                    ].join(" / ")
                  }
                />
                <Row
                  label="HTTPS-only + TLS 1.2 policy"
                  ok={report.httpsOnlyPolicy.ok}
                  detail={
                    report.httpsOnlyPolicy.errorReason ??
                    [
                      `DenyNonHttps=${report.httpsOnlyPolicy.denyNonHttpsPresent}`,
                      `DenyTls<1.2=${report.httpsOnlyPolicy.denyTlsBelow12Present}`,
                    ].join(" / ")
                  }
                />
              </ul>
              <p className="text-muted-foreground m-0 flex items-center justify-between font-mono text-[10px] tabular-nums">
                <span>
                  Checked at {new Date(report.checkedAt).toISOString()}
                </span>
                <Badge
                  variant={report.compliant ? "secondary" : "destructive"}
                  className="text-[10px] uppercase tracking-wide"
                >
                  {report.compliant ? "Compliant" : "Drift detected"}
                </Badge>
              </p>
            </div>
          ) : null}
        </CardContent>
      ) : null}
    </Card>
  );
}

function Row({
  label,
  ok,
  detail,
}: {
  readonly label: string;
  readonly ok: boolean;
  readonly detail: string;
}) {
  const Icon = ok ? CheckCircle2 : AlertTriangle;
  return (
    <li
      className="flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-muted/40"
      title={detail}
    >
      <Icon
        aria-hidden="true"
        className={`size-4 ${ok ? "text-foreground" : "text-destructive"}`}
      />
      <span className="text-foreground text-sm font-medium">{label}</span>
      <Badge
        variant={ok ? "secondary" : "destructive"}
        className="ml-auto whitespace-nowrap text-[10px] uppercase tracking-wide"
      >
        {ok ? "OK" : "Drift"}
      </Badge>
    </li>
  );
}
