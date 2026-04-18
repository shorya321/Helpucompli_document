import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { QuickActions } from "@/components/dashboard/quick-actions";

describe("QuickActions", () => {
  it("renders every quick action for superadmin including Create Bucket", () => {
    const html = renderToString(<QuickActions role="superadmin" />);
    expect(html).toMatch(/upload document/i);
    expect(html).toMatch(/create bucket/i);
    expect(html).toMatch(/generate link/i);
    expect(html).toMatch(/view audit log/i);
  });

  it("hides Create Bucket from admin", () => {
    const html = renderToString(<QuickActions role="admin" />);
    expect(html).toMatch(/upload document/i);
    expect(html).toMatch(/generate link/i);
    expect(html).toMatch(/view audit log/i);
    expect(html).not.toMatch(/create bucket/i);
  });

  it("viewer sees only the Upload Document action", () => {
    const html = renderToString(<QuickActions role="viewer" />);
    expect(html).toMatch(/upload document/i);
    expect(html).not.toMatch(/create bucket/i);
    expect(html).not.toMatch(/generate link/i);
    expect(html).not.toMatch(/view audit log/i);
  });

  it("each action is an anchor with a href attribute", () => {
    const html = renderToString(<QuickActions role="superadmin" />);
    const anchors = html.match(/<a\b[^>]*href=/g) ?? [];
    expect(anchors.length).toBeGreaterThanOrEqual(4);
  });

  it("is wrapped in a semantic list", () => {
    const html = renderToString(<QuickActions role="superadmin" />);
    expect(html).toMatch(/<ul[^>]*role="list"|<ul\b/);
  });
});
