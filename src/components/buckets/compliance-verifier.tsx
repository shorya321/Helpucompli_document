"use client";

import { useState } from "react";
import { BRAND } from "@/lib/brand";

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
    <div
      style={{
        padding: "1rem",
        background: "#FFFFFF",
        border: `1px solid ${BRAND.colors.dark}1A`,
        borderRadius: "0.75rem",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: "0.5rem",
          flexWrap: "wrap",
          marginBottom: report ? "0.75rem" : 0,
        }}
      >
        <div>
          <strong style={{ fontSize: "0.875rem" }}>Live drift check</strong>
          <p
            style={{
              margin: "0.125rem 0 0",
              fontSize: "0.75rem",
              color: "rgba(30,41,59,0.64)",
            }}
          >
            Queries the real S3 configuration and reports any drift from the
            HIPAA baseline.
          </p>
        </div>
        <button
          type="button"
          onClick={run}
          disabled={pending}
          style={{
            background: pending ? `${BRAND.colors.blue}80` : BRAND.colors.blue,
            color: "#FFFFFF",
            padding: "0.4375rem 0.75rem",
            fontSize: "0.8125rem",
            fontWeight: 600,
            borderRadius: "0.375rem",
            border: "none",
            cursor: pending ? "wait" : "pointer",
          }}
        >
          {pending ? "Checking…" : "Verify now"}
        </button>
      </div>
      {error ? (
        <p
          role="alert"
          style={{ margin: 0, color: BRAND.colors.pink, fontSize: "0.8125rem" }}
        >
          {error}
        </p>
      ) : null}
      {report ? (
        <ul
          style={{
            listStyle: "none",
            padding: 0,
            margin: 0,
            display: "flex",
            flexDirection: "column",
            gap: "0.375rem",
          }}
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
          <li
            style={{
              fontSize: "0.6875rem",
              color: "rgba(30,41,59,0.56)",
              marginTop: "0.25rem",
            }}
          >
            Checked at {new Date(report.checkedAt).toISOString()} •{" "}
            {report.compliant ? "COMPLIANT" : "DRIFT DETECTED"}
          </li>
        </ul>
      ) : null}
    </div>
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
  return (
    <li
      style={{
        display: "flex",
        justifyContent: "space-between",
        gap: "0.5rem",
        padding: "0.5rem 0.625rem",
        background: ok ? `${BRAND.colors.blue}0A` : `${BRAND.colors.pink}12`,
        borderRadius: "0.375rem",
      }}
    >
      <span style={{ fontSize: "0.8125rem" }}>{label}</span>
      <span
        style={{
          fontSize: "0.6875rem",
          fontWeight: 600,
          color: ok ? BRAND.colors.blue : BRAND.colors.pink,
          textTransform: "uppercase",
          letterSpacing: "0.06em",
        }}
        title={detail}
      >
        {ok ? "OK" : "DRIFT"}
      </span>
    </li>
  );
}
