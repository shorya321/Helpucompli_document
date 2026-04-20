"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { BRAND } from "@/lib/brand";

interface QrCodeProps {
  readonly url: string;
  readonly size?: number;
}

export function QrCode({ url, size = 192 }: QrCodeProps) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setDataUrl(null);
    setError(null);
    QRCode.toDataURL(url, {
      errorCorrectionLevel: "M",
      margin: 1,
      width: size,
      color: { dark: BRAND.colors.dark, light: "#FFFFFF" },
    })
      .then((d) => {
        if (!cancelled) setDataUrl(d);
      })
      .catch(() => {
        if (!cancelled) setError("Failed to render QR code.");
      });
    return () => {
      cancelled = true;
    };
  }, [url, size]);

  return (
    <div
      style={{
        display: "inline-flex",
        flexDirection: "column",
        alignItems: "center",
        gap: "0.5rem",
        padding: "0.75rem",
        background: "#FFFFFF",
        border: `1px solid ${BRAND.colors.dark}1A`,
        borderRadius: "0.5rem",
      }}
    >
      {error && (
        <span
          role="alert"
          style={{ color: BRAND.colors.pink, fontSize: "0.75rem" }}
        >
          {error}
        </span>
      )}
      {dataUrl && (
        <>
          <img
            src={dataUrl}
            alt="QR code for share link"
            width={size}
            height={size}
            style={{ display: "block" }}
          />
          <a
            href={dataUrl}
            download="share-link-qr.png"
            style={{
              fontSize: "0.75rem",
              color: BRAND.colors.blue,
              textDecoration: "none",
              fontWeight: 600,
            }}
          >
            Download PNG
          </a>
        </>
      )}
    </div>
  );
}
