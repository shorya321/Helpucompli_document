"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { Role } from "@/types";

interface InviteUserDialogProps {
  readonly canInviteAdmin: boolean;
}

type FormState =
  | { readonly kind: "idle" }
  | { readonly kind: "pending" }
  | {
      readonly kind: "ok";
      readonly email: string;
      readonly ticket: string;
      readonly emailSent: boolean;
    }
  | { readonly kind: "error"; readonly message: string };

// Native <select> styled to match shadcn Input. Using a DOM <select>
// here keeps the plain HTML form submission path + FormData parsing
// in onSubmit intact; the Radix Select would break that.
const nativeSelectClass =
  "border-input bg-background text-foreground focus-visible:ring-ring h-9 w-full rounded-md border px-3 py-1 text-sm shadow-xs transition-colors focus-visible:outline-hidden focus-visible:ring-1 disabled:cursor-not-allowed disabled:opacity-50";

export function InviteUserDialog({ canInviteAdmin }: InviteUserDialogProps) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<FormState>({ kind: "idle" });
  const emailId = useId();
  const nameId = useId();
  const roleId = useId();
  const router = useRouter();

  async function onSubmit(e: React.SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const data = new FormData(form);
    const email = String(data.get("email") ?? "").trim();
    const name = String(data.get("name") ?? "").trim();
    const role = String(data.get("role") ?? "") as Role;

    setState({ kind: "pending" });
    try {
      const res = await fetch("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          name: name.length > 0 ? name : null,
          role,
        }),
      });
      const body = (await res.json()) as {
        data?: {
          email: string;
          ticket: string;
          emailSent?: boolean;
        } | null;
        error?: string | null;
      };
      if (!res.ok || !body.data) {
        setState({
          kind: "error",
          message: body.error ?? "Failed to invite user",
        });
        return;
      }
      setState({
        kind: "ok",
        email: body.data.email,
        ticket: body.data.ticket,
        emailSent: body.data.emailSent ?? false,
      });
      form.reset();
      router.refresh();
    } catch {
      setState({ kind: "error", message: "Network error" });
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setState({ kind: "idle" });
      }}
    >
      <DialogTrigger asChild>
        <Button type="button">+ Invite user</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Invite user</DialogTitle>
          <DialogDescription>
            Sends an activation email via Auth0. The user sets their own
            password on first login.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor={emailId}>Email</Label>
            <Input
              id={emailId}
              name="email"
              type="email"
              required
              autoComplete="email"
              maxLength={254}
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor={nameId}>
              Name{" "}
              <span className="text-muted-foreground font-normal">(optional)</span>
            </Label>
            <Input id={nameId} name="name" type="text" maxLength={150} />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor={roleId}>Role</Label>
            <select
              id={roleId}
              name="role"
              defaultValue="viewer"
              required
              className={nativeSelectClass}
            >
              <option value="viewer">Viewer</option>
              {canInviteAdmin && <option value="admin">Admin</option>}
            </select>
          </div>

          {state.kind === "error" && (
            <p role="alert" className="text-destructive text-sm">
              {state.message}
            </p>
          )}

          {state.kind === "ok" && (
            <div className="border-border bg-muted text-muted-foreground rounded-md border px-3 py-2 text-xs">
              <p className="text-foreground m-0 font-semibold">
                {state.emailSent
                  ? `Invitation email sent to ${state.email}.`
                  : `Invitation created for ${state.email}, but email was not sent.`}
              </p>
              <p className="mt-1">
                {state.emailSent
                  ? "If the user does not receive the email, share this activation link manually:"
                  : "Check RESEND_API_KEY / RESEND_FROM_EMAIL in .env.local, or forward this activation link manually:"}
              </p>
              <code className="mt-1.5 block break-all text-xs">
                {state.ticket}
              </code>
            </div>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
            >
              Close
            </Button>
            <Button type="submit" disabled={state.kind === "pending"}>
              {state.kind === "pending" ? "Sending…" : "Send invite"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
