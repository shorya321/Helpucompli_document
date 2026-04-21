"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { Card, CardContent } from "@/components/ui/card";

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
    // QR module colors fall through to defaults (black on white) so the
    // PNG stays a plain two-tone code — renders correctly in every UI
    // theme without touching design tokens.
    QRCode.toDataURL(url, {
      errorCorrectionLevel: "M",
      margin: 1,
      width: size,
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
    <Card className="inline-block">
      <CardContent className="flex flex-col items-center gap-2 p-3">
        {error && (
          <span role="alert" className="text-destructive text-xs">
            {error}
          </span>
        )}
        {dataUrl && (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={dataUrl}
              alt="QR code for share link"
              width={size}
              height={size}
              className="block"
            />
            <a
              href={dataUrl}
              download="share-link-qr.png"
              className="text-foreground text-xs font-semibold no-underline hover:underline"
            >
              Download PNG
            </a>
          </>
        )}
      </CardContent>
    </Card>
  );
}
