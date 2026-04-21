"use client";

import { useRouter } from "next/navigation";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { DocumentPreview } from "@/components/documents/document-preview";

interface DocumentPreviewDialogProps {
  readonly bucketId: string;
  readonly s3Key: string;
  readonly filename: string;
  readonly contentType: string | null;
  readonly sizeBytes: bigint;
  readonly uploadedAt: Date;
  readonly uploadedByName: string | null;
  readonly closeHref: string;
}

// Guards against caller-supplied off-site redirect when the dialog closes.
function safeHref(href: string): string {
  if (!href.startsWith("/") || href.startsWith("//")) return "/documents";
  return href;
}

export function DocumentPreviewDialog({
  bucketId,
  s3Key,
  filename,
  contentType,
  sizeBytes,
  uploadedAt,
  uploadedByName,
  closeHref,
}: DocumentPreviewDialogProps) {
  const router = useRouter();
  const href = safeHref(closeHref);

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) router.push(href);
      }}
    >
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="sr-only">Preview {filename}</DialogTitle>
        </DialogHeader>
        <DocumentPreview
          bucketId={bucketId}
          s3Key={s3Key}
          filename={filename}
          contentType={contentType}
          sizeBytes={sizeBytes}
          uploadedAt={uploadedAt}
          uploadedByName={uploadedByName}
        />
      </DialogContent>
    </Dialog>
  );
}
