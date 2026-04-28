"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  AWS_REGIONS,
  HIPAA_BUCKET_NAME_PREFIX,
} from "@/lib/bucket-constants";

interface CreateBucketDialogProps {
  readonly closeHref: string;
}

// Guard against open-redirect if `closeHref` is ever wired to a
// user-supplied search param. Only same-origin relative paths allowed.
function safeHref(href: string): string {
  if (href.startsWith("/") && !href.startsWith("//")) return href;
  return "/buckets";
}

export function CreateBucketDialog({
  closeHref: rawCloseHref,
}: CreateBucketDialogProps) {
  const closeHref = safeHref(rawCloseHref);
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [submitting, setSubmitting] = useState(false);
  const [name, setName] = useState(HIPAA_BUCKET_NAME_PREFIX);
  const [awsRegion, setAwsRegion] = useState<string>("us-west-2");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (e: React.SyntheticEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/s3/buckets", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          awsRegion,
          ...(description.trim() ? { description: description.trim() } : {}),
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        setError(body?.error ?? `Request failed (${res.status})`);
        setSubmitting(false);
        return;
      }
      startTransition(() => {
        router.push(closeHref);
        router.refresh();
      });
    } catch {
      setError("Network error. Try again.");
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) router.push(closeHref);
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>Create bucket</DialogTitle>
            <DialogDescription>
              HIPAA settings (SSE-KMS, versioning, public-access block,
              HTTPS policy, CloudTrail data events) are applied automatically.
            </DialogDescription>
          </DialogHeader>

          <p className="border-border bg-muted text-muted-foreground rounded-md border px-3 py-2 text-xs">
            Do not enter patient names, MRNs, birthdates, or any PHI in the
            bucket name or description. Both fields are stored in cleartext
            and surfaced in audit logs.
          </p>

          <div className="flex flex-col gap-2">
            <Label htmlFor="bucket-name">Bucket name</Label>
            <Input
              id="bucket-name"
              required
              name="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              pattern="^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])?$"
              minLength={3}
              maxLength={63}
              placeholder={`${HIPAA_BUCKET_NAME_PREFIX}tenant-name`}
            />
            <p className="text-muted-foreground text-xs">
              Must start with <code>{HIPAA_BUCKET_NAME_PREFIX}</code>.
              Lowercase, digits, hyphens only. 3–63 chars.
            </p>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="aws-region">AWS region</Label>
            <Select value={awsRegion} onValueChange={setAwsRegion}>
              <SelectTrigger id="aws-region">
                <SelectValue placeholder="Choose a region" />
              </SelectTrigger>
              <SelectContent>
                {AWS_REGIONS.map((r) => (
                  <SelectItem key={r} value={r}>
                    {r}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="bucket-description">
              Description{" "}
              <span className="text-muted-foreground font-normal">(optional)</span>
            </Label>
            <Textarea
              id="bucket-description"
              name="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={2048}
              rows={3}
            />
          </div>

          {error ? (
            <p role="alert" className="text-destructive text-sm">
              {error}
            </p>
          ) : null}

          <DialogFooter>
            <Button type="button" variant="outline" asChild>
              <a href={closeHref}>Cancel</a>
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? "Creating…" : "Create bucket"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
