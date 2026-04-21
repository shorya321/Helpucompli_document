import { getConfig } from "@/lib/config";

// Thin wrapper over the Resend HTTP API (https://api.resend.com/emails)
// for transactional email delivery. No SDK dependency — we post JSON
// directly and treat any failure as non-fatal so the invite flow can
// still succeed with the activation-ticket URL returned in the API
// response as a manual fallback.

export interface SendInviteEmailArgs {
  readonly to: string;
  readonly activationUrl: string;
  readonly inviterName: string | null;
}

export interface SendInviteEmailResult {
  readonly sent: boolean;
  readonly reason?: string;
  readonly id?: string;
}

const RESEND_URL = "https://api.resend.com/emails";
const DEFAULT_APP_NAME = "Compass Doc";

// HTML escape to neutralise any injection via the activationUrl or
// inviterName when rendered as an anchor's href / text. Guards against
// stored-XSS in the invitee's email client if the client renders the
// HTML variant. Minimal escape — only the chars that matter inside
// attributes and text.
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export async function sendInviteEmail(
  args: SendInviteEmailArgs,
): Promise<SendInviteEmailResult> {
  const config = getConfig() as {
    RESEND_API_KEY?: string;
    RESEND_FROM_EMAIL?: string;
    APP_NAME?: string;
  };
  const apiKey = config.RESEND_API_KEY;
  const from = config.RESEND_FROM_EMAIL;
  const appName =
    config.APP_NAME && config.APP_NAME.length > 0
      ? config.APP_NAME
      : DEFAULT_APP_NAME;

  if (!apiKey || apiKey.length === 0) {
    return { sent: false, reason: "RESEND_API_KEY not configured" };
  }
  if (!from || from.length === 0) {
    return { sent: false, reason: "RESEND_FROM_EMAIL not configured" };
  }

  const subject = `You're invited to ${appName}`;
  const safeUrl = escapeHtml(args.activationUrl);
  const safeInviter = args.inviterName ? escapeHtml(args.inviterName) : null;
  const greeting = safeInviter
    ? `${safeInviter} invited you to ${escapeHtml(appName)}.`
    : `You've been invited to ${escapeHtml(appName)}.`;

  const html = `<!doctype html>
<html>
  <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background:#f8fafc; padding:24px;">
    <table role="presentation" style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:8px;padding:32px;">
      <tr><td>
        <h1 style="font-size:20px;margin:0 0 8px;color:#1E293B;">${greeting}</h1>
        <p style="color:#475569;margin:0 0 24px;">Click the button below to activate your account and set a password.</p>
        <p style="margin:0 0 24px;">
          <a href="${safeUrl}" style="display:inline-block;background:#E91E8C;color:#ffffff;padding:12px 20px;border-radius:6px;text-decoration:none;font-weight:600;">Activate account</a>
        </p>
        <p style="color:#64748B;font-size:13px;margin:0 0 8px;">Or paste this link into your browser:</p>
        <p style="color:#2563EB;font-size:13px;word-break:break-all;margin:0 0 24px;"><a href="${safeUrl}" style="color:#2563EB;">${safeUrl}</a></p>
        <p style="color:#94A3B8;font-size:12px;margin:0;">This link expires in 5 days. If you did not expect this invitation, you can safely ignore this email.</p>
      </td></tr>
    </table>
  </body>
</html>`;

  const text = `${args.inviterName ? args.inviterName + " invited you" : "You have been invited"} to ${appName}.

Activate your account and set a password:
${args.activationUrl}

This link expires in 5 days. If you did not expect this invitation, you can safely ignore this email.`;

  try {
    const response = await fetch(RESEND_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: `${appName} <${from}>`,
        to: [args.to],
        subject,
        html,
        text,
      }),
    });

    if (!response.ok) {
      let bodyExcerpt = "<body unreadable>";
      try {
        const raw = await response.text();
        bodyExcerpt = raw.length > 512 ? `${raw.slice(0, 512)}…` : raw;
      } catch {
        // ignore
      }
      console.error(
        `[email] Resend POST /emails failed status=${response.status} body=${bodyExcerpt}`,
      );
      return { sent: false, reason: `Resend API ${response.status}` };
    }

    const data = (await response.json()) as { id?: string };
    return { sent: true, id: data.id };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[email] Resend network error: ${message}`);
    return { sent: false, reason: "Network error" };
  }
}
