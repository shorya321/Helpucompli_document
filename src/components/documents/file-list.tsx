import Link from "next/link";
import { BRAND } from "@/lib/brand";
import { formatStorage } from "@/components/buckets/bucket-card";
import { buildBreadcrumb } from "@/lib/documents-browse";
import { DownloadButton } from "@/components/documents/download-button";

export type FileListEntry =
  | {
      readonly kind: "folder";
      readonly name: string;
      readonly prefix: string; // full prefix including trailing slash
    }
  | {
      readonly kind: "file";
      readonly key: string;
      readonly size: bigint;
      readonly lastModified?: Date;
    };

interface FileListProps {
  readonly bucket: string;
  readonly bucketId?: string;
  readonly prefix: string;
  readonly entries: ReadonlyArray<FileListEntry>;
  readonly view: "grid" | "list";
}

function hrefForFolder(bucket: string, prefix: string): string {
  const b = encodeURIComponent(bucket);
  const p = encodeURIComponent(prefix);
  return `/documents?bucket=${b}&prefix=${p}`;
}

function filenameFromKey(key: string): string {
  const parts = key.split("/");
  return parts[parts.length - 1] ?? key;
}

export function FileList({
  bucket,
  bucketId,
  prefix,
  entries,
  view,
}: FileListProps) {
  const crumbs = buildBreadcrumb(bucket, prefix);

  return (
    <section
      style={{
        fontFamily: `'${BRAND.font.family}', system-ui, sans-serif`,
        color: BRAND.colors.dark,
        display: "flex",
        flexDirection: "column",
        gap: "1rem",
      }}
    >
      <nav aria-label="Breadcrumb">
        <ol
          style={{
            listStyle: "none",
            padding: 0,
            margin: 0,
            display: "flex",
            flexWrap: "wrap",
            gap: "0.25rem",
            fontSize: "0.8125rem",
          }}
        >
          {crumbs.map((c, i) => {
            const isLast = i === crumbs.length - 1;
            const href = hrefForFolder(bucket, c.prefix);
            return (
              <li key={`${c.prefix}-${c.label}`} style={{ display: "flex", gap: "0.25rem" }}>
                {i > 0 ? (
                  <span aria-hidden="true" style={{ color: "rgba(30,41,59,0.45)" }}>
                    /
                  </span>
                ) : null}
                {isLast ? (
                  <span
                    aria-current="page"
                    style={{ color: BRAND.colors.dark, fontWeight: 600 }}
                  >
                    {c.label}
                  </span>
                ) : (
                  <Link
                    href={href}
                    style={{ color: BRAND.colors.blue, textDecoration: "none" }}
                  >
                    {c.label}
                  </Link>
                )}
              </li>
            );
          })}
        </ol>
      </nav>

      {entries.length === 0 ? (
        <p
          style={{
            margin: 0,
            padding: "1.5rem",
            background: "#FFFFFF",
            border: `1px dashed ${BRAND.colors.dark}33`,
            borderRadius: "0.75rem",
            textAlign: "center",
            color: "rgba(30,41,59,0.72)",
          }}
          data-view={view}
        >
          This folder is empty.
        </p>
      ) : (
        <ul
          role="list"
          data-view={view}
          style={
            view === "grid"
              ? {
                  listStyle: "none",
                  padding: 0,
                  margin: 0,
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fill, minmax(12rem, 1fr))",
                  gap: "0.75rem",
                }
              : {
                  listStyle: "none",
                  padding: 0,
                  margin: 0,
                  display: "flex",
                  flexDirection: "column",
                  gap: "0.25rem",
                  background: "#FFFFFF",
                  border: `1px solid ${BRAND.colors.dark}1A`,
                  borderRadius: "0.75rem",
                  overflow: "hidden",
                }
          }
        >
          {entries.map((e) =>
            e.kind === "folder" ? (
              <li
                key={`folder:${e.prefix}`}
                style={{
                  padding: "0.625rem 0.875rem",
                  borderBottom:
                    view === "list" ? `1px solid ${BRAND.colors.dark}0D` : "none",
                  background: view === "grid" ? "#FFFFFF" : "transparent",
                  border:
                    view === "grid"
                      ? `1px solid ${BRAND.colors.dark}1A`
                      : undefined,
                  borderRadius: view === "grid" ? "0.5rem" : undefined,
                }}
              >
                <Link
                  href={hrefForFolder(bucket, e.prefix)}
                  style={{
                    color: BRAND.colors.blue,
                    textDecoration: "none",
                    fontWeight: 600,
                    fontSize: "0.875rem",
                    wordBreak: "break-all",
                  }}
                >
                  {e.name}/
                </Link>
              </li>
            ) : (
              <li
                key={`file:${e.key}`}
                style={{
                  padding: "0.625rem 0.875rem",
                  borderBottom:
                    view === "list" ? `1px solid ${BRAND.colors.dark}0D` : "none",
                  background: view === "grid" ? "#FFFFFF" : "transparent",
                  border:
                    view === "grid"
                      ? `1px solid ${BRAND.colors.dark}1A`
                      : undefined,
                  borderRadius: view === "grid" ? "0.5rem" : undefined,
                  display: "flex",
                  gap: "0.75rem",
                  justifyContent: "space-between",
                  alignItems: "baseline",
                  flexWrap: "wrap",
                  fontSize: "0.875rem",
                }}
              >
                <span style={{ wordBreak: "break-all", fontWeight: 500 }}>
                  {filenameFromKey(e.key)}
                </span>
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "baseline",
                    gap: "0.75rem",
                  }}
                >
                  <span
                    style={{
                      color: "rgba(30,41,59,0.72)",
                      fontSize: "0.75rem",
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    {formatStorage(e.size)}
                  </span>
                  {bucketId ? (
                    <DownloadButton bucketId={bucketId} s3Key={e.key} />
                  ) : null}
                </span>
              </li>
            ),
          )}
        </ul>
      )}
    </section>
  );
}
