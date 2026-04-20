import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const configMock = vi.hoisted(() => ({
  RESEND_API_KEY: "re_test",
  RESEND_FROM_EMAIL: "invites@docs.helpucompli.com",
  APP_NAME: "HelpUcompli Docs",
}));

vi.mock("@/lib/config", () => ({ getConfig: () => configMock }));

import { sendInviteEmail } from "@/lib/email";

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  configMock.RESEND_API_KEY = "re_test";
  configMock.RESEND_FROM_EMAIL = "invites@docs.helpucompli.com";
  configMock.APP_NAME = "HelpUcompli Docs";
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("sendInviteEmail", () => {
  it("POSTs to api.resend.com/emails with bearer auth + html+text", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ id: "em-1" }),
      text: async () => "",
    });

    const result = await sendInviteEmail({
      to: "new@x.com",
      activationUrl: "https://auth.helpucompli.com/lo/reset?ticket=abc",
      inviterName: "Alice",
    });

    expect(result.sent).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe("https://api.resend.com/emails");
    const init_ = init as {
      method: string;
      headers: Record<string, string>;
      body: string;
    };
    expect(init_.method).toBe("POST");
    expect(init_.headers.Authorization).toBe("Bearer re_test");
    const body = JSON.parse(init_.body);
    expect(body.from).toContain("invites@docs.helpucompli.com");
    expect(body.to).toEqual(["new@x.com"]);
    expect(typeof body.subject).toBe("string");
    expect(body.html).toContain(
      "https://auth.helpucompli.com/lo/reset?ticket=abc",
    );
    expect(body.text).toContain(
      "https://auth.helpucompli.com/lo/reset?ticket=abc",
    );
  });

  it("returns {sent:false} without throwing when RESEND_API_KEY is unset", async () => {
    configMock.RESEND_API_KEY = "";
    const result = await sendInviteEmail({
      to: "new@x.com",
      activationUrl: "https://x",
      inviterName: null,
    });
    expect(result.sent).toBe(false);
    expect(result.reason).toMatch(/RESEND_API_KEY/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns {sent:false} when RESEND_FROM_EMAIL is unset", async () => {
    configMock.RESEND_FROM_EMAIL = "";
    const result = await sendInviteEmail({
      to: "new@x.com",
      activationUrl: "https://x",
      inviterName: null,
    });
    expect(result.sent).toBe(false);
    expect(result.reason).toMatch(/RESEND_FROM_EMAIL/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns {sent:false, reason:status} on Resend non-ok response, no throw", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 422,
      json: async () => ({ name: "validation_error" }),
      text: async () => '{"name":"validation_error"}',
    });
    const result = await sendInviteEmail({
      to: "new@x.com",
      activationUrl: "https://x",
      inviterName: null,
    });
    expect(result.sent).toBe(false);
    expect(result.reason).toMatch(/422/);
  });

  it("falls back to default APP_NAME when unset", async () => {
    configMock.APP_NAME = "";
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ id: "em-1" }),
      text: async () => "",
    });
    await sendInviteEmail({
      to: "new@x.com",
      activationUrl: "https://x",
      inviterName: null,
    });
    const body = JSON.parse(fetchMock.mock.calls[0]?.[1].body);
    expect(body.subject).toMatch(/HelpUcompli/);
  });

  it("escapes HTML in activationUrl to block XSS in the HTML body", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ id: "em-1" }),
      text: async () => "",
    });
    await sendInviteEmail({
      to: "new@x.com",
      activationUrl: 'https://x"><script>alert(1)</script>',
      inviterName: null,
    });
    const body = JSON.parse(fetchMock.mock.calls[0]?.[1].body);
    expect(body.html).not.toContain("<script>");
    expect(body.html).toContain("&lt;script&gt;");
  });
});
