"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { BRAND } from "@/lib/brand";
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

export function InviteUserDialog({ canInviteAdmin }: InviteUserDialogProps) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<FormState>({ kind: "idle" });
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const emailId = useId();
  const nameId = useId();
  const roleId = useId();
  const router = useRouter();

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
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
    <>
      <button
        type="button"
        onClick={() => {
          setState({ kind: "idle" });
          setOpen(true);
        }}
        style={{
          padding: "0.5rem 1rem",
          background: BRAND.colors.pink,
          color: "#FFFFFF",
          border: "none",
          borderRadius: "0.375rem",
          fontWeight: 600,
          fontSize: "0.85rem",
          cursor: "pointer",
        }}
      >
        + Invite user
      </button>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby={`${emailId}-title`}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(30,41,59,0.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 50,
          }}
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setOpen(false);
          }}
        >
          <div
            ref={dialogRef}
            style={{
              background: "#FFFFFF",
              borderRadius: "0.5rem",
              padding: "1.5rem",
              width: "min(30rem, 90vw)",
              boxShadow: "0 20px 40px rgba(0,0,0,0.15)",
            }}
          >
            <h2
              id={`${emailId}-title`}
              style={{ fontSize: "1.15rem", fontWeight: 700, margin: 0 }}
            >
              Invite user
            </h2>
            <p
              style={{
                margin: "0.25rem 0 1rem",
                color: "rgba(30,41,59,0.64)",
                fontSize: "0.85rem",
              }}
            >
              Sends an activation email via Auth0. The user sets their own
              password on first login.
            </p>

            <form onSubmit={onSubmit}>
              <Field label="Email" htmlFor={emailId}>
                <input
                  id={emailId}
                  name="email"
                  type="email"
                  required
                  autoComplete="email"
                  maxLength={254}
                  style={inputStyle}
                />
              </Field>

              <Field label="Name (optional)" htmlFor={nameId}>
                <input
                  id={nameId}
                  name="name"
                  type="text"
                  maxLength={150}
                  style={inputStyle}
                />
              </Field>

              <Field label="Role" htmlFor={roleId}>
                <select
                  id={roleId}
                  name="role"
                  defaultValue="viewer"
                  required
                  style={inputStyle}
                >
                  <option value="viewer">Viewer</option>
                  {canInviteAdmin && <option value="admin">Admin</option>}
                </select>
              </Field>

              {state.kind === "error" && (
                <p
                  role="alert"
                  style={{
                    color: BRAND.colors.pink,
                    fontSize: "0.8rem",
                    margin: "0.5rem 0 0",
                  }}
                >
                  {state.message}
                </p>
              )}

              {state.kind === "ok" && (
                <div
                  style={{
                    background: state.emailSent ? "#F0FDF4" : "#FFFBEB",
                    border: `1px solid ${state.emailSent ? "#16A34A" : "#D97706"}`,
                    borderRadius: "0.375rem",
                    padding: "0.75rem",
                    margin: "0.75rem 0 0",
                    fontSize: "0.8rem",
                  }}
                >
                  <p style={{ margin: 0, fontWeight: 600 }}>
                    {state.emailSent
                      ? `Invitation email sent to ${state.email}.`
                      : `Invitation created for ${state.email}, but email was not sent.`}
                  </p>
                  <p
                    style={{
                      margin: "0.25rem 0 0",
                      color: "rgba(30,41,59,0.72)",
                    }}
                  >
                    {state.emailSent
                      ? "If the user does not receive the email, share this activation link manually:"
                      : "Check RESEND_API_KEY / RESEND_FROM_EMAIL in .env.local, or forward this activation link manually:"}
                  </p>
                  <code
                    style={{
                      display: "block",
                      marginTop: "0.35rem",
                      wordBreak: "break-all",
                      fontSize: "0.75rem",
                    }}
                  >
                    {state.ticket}
                  </code>
                </div>
              )}

              <div
                style={{
                  display: "flex",
                  justifyContent: "flex-end",
                  gap: "0.5rem",
                  marginTop: "1rem",
                }}
              >
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  style={{
                    padding: "0.45rem 0.9rem",
                    background: "#FFFFFF",
                    color: BRAND.colors.dark,
                    border: `1px solid ${BRAND.colors.dark}33`,
                    borderRadius: "0.375rem",
                    fontSize: "0.85rem",
                    cursor: "pointer",
                  }}
                >
                  Close
                </button>
                <button
                  type="submit"
                  disabled={state.kind === "pending"}
                  style={{
                    padding: "0.45rem 1rem",
                    background: BRAND.colors.pink,
                    color: "#FFFFFF",
                    border: "none",
                    borderRadius: "0.375rem",
                    fontSize: "0.85rem",
                    fontWeight: 600,
                    cursor: state.kind === "pending" ? "wait" : "pointer",
                    opacity: state.kind === "pending" ? 0.6 : 1,
                  }}
                >
                  {state.kind === "pending" ? "Sending…" : "Send invite"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "0.45rem 0.65rem",
  border: "1px solid rgba(30,41,59,0.2)",
  borderRadius: "0.375rem",
  fontSize: "0.9rem",
  boxSizing: "border-box",
};

function Field({
  label,
  htmlFor,
  children,
}: {
  readonly label: string;
  readonly htmlFor: string;
  readonly children: React.ReactNode;
}) {
  return (
    <label
      htmlFor={htmlFor}
      style={{
        display: "block",
        marginBottom: "0.75rem",
        fontSize: "0.8rem",
        fontWeight: 600,
      }}
    >
      <span style={{ display: "block", marginBottom: "0.25rem" }}>{label}</span>
      {children}
    </label>
  );
}
