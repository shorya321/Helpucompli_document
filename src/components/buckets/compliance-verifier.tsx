"use client";

import { useState } from "react";
import { AlertTriangle, CheckCircle2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

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
      <CardHeader className="flex flex-row items-start justify-between gap-2 space-y-0">
        <div>
          <CardTitle className="text-sm">Live drift check</CardTitle>
          <CardDescription className="text-xs">
            Queries the real S3 configuration and reports any drift from the
            HIPAA baseline.
          </CardDescription>
        </div>
        <Button type="button" size="sm" onClick={run} disabled={pending}>
          {pending ? "Checking…" : "Verify now"}
        </Button>
      </CardHeader>
      {error || report ? (
        <CardContent>
          {error ? (
            <p role="alert" className="text-destructive text-sm">
              {error}
            </p>
          ) : null}
          {report ? (
            <ul className="m-0 flex flex-col gap-1.5 p-0" role="list">
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
              <li className="text-muted-foreground mt-1 text-[10px] tabular-nums">
                Checked at {new Date(report.checkedAt).toISOString()} •{" "}
                {report.compliant ? "COMPLIANT" : "DRIFT DETECTED"}
              </li>
            </ul>
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
      className={
        ok
          ? "border-border bg-muted flex items-center justify-between gap-2 rounded-md border px-2.5 py-2"
          : "border-destructive/40 bg-destructive/10 flex items-center justify-between gap-2 rounded-md border px-2.5 py-2"
      }
    >
      <span className="flex items-center gap-2 text-sm">
        <Icon
          aria-hidden="true"
          className={ok ? "text-foreground h-4 w-4" : "text-destructive h-4 w-4"}
        />
        {label}
      </span>
      <span
        className={
          ok
            ? "text-muted-foreground text-[10px] font-semibold uppercase tracking-wider"
            : "text-destructive text-[10px] font-semibold uppercase tracking-wider"
        }
        title={detail}
      >
        {ok ? "OK" : "DRIFT"}
      </span>
    </li>
  );
}
