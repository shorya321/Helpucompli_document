export const BRAND = {
  name: "HelpUcompli",
  productName: "HelpUcompli Document Repository",
  domain: "docs.helpucompli.com",
  colors: {
    pink: "#E91E8C",
    blue: "#2563EB",
    dark: "#1E293B",
    light: "#F8FAFC",
  },
  font: {
    family: "Inter",
    // Google Fonts CSS stylesheet (for the self-hosted <link rel="stylesheet">
    // in the Universal Login HTML template preview). Auth0 Universal Login
    // Management API does NOT accept a CSS stylesheet here — it requires a
    // direct WOFF/WOFF2 URL with CORS. `woff2Url` below is what we ship to
    // Auth0 via AUTH0_BRANDING_PAYLOAD.
    stylesheetUrl:
      "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap",
    // Canonical Inter variable-font WOFF2 hosted by the Inter project
    // maintainer (rsms) with CORS enabled. Auth0 Management API /api/v2/
    // branding/font.url accepts this form.
    // Ref: https://auth0.com/docs/customize/login-pages/universal-login/customize-themes#fonts
    woff2Url: "https://rsms.me/inter/font-files/Inter.var.woff2",
  },
  // Carry-forward: ship actual logo + favicon under public/brand/ before
  // Auth0 tenant branding is pushed — Auth0 renders these URLs directly
  // and a 404 shows default Auth0 chrome.
  assets: {
    logoUrl: "https://docs.helpucompli.com/brand/logo.svg",
    faviconUrl: "https://docs.helpucompli.com/brand/favicon.ico",
  },
} as const;

export type Brand = typeof BRAND;
