import { BRAND } from "@/lib/brand";

export const AUTH0_BRANDING_PAYLOAD = {
  colors: {
    primary: BRAND.colors.pink,
    page_background: BRAND.colors.dark,
  },
  favicon_url: BRAND.assets.faviconUrl,
  logo_url: BRAND.assets.logoUrl,
  font: {
    url: BRAND.font.stylesheetUrl,
  },
} as const;

export const AUTH0_UNIVERSAL_LOGIN_TEMPLATE = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${BRAND.name} — Sign in</title>
    <link rel="icon" href="${BRAND.assets.faviconUrl}" />
    <link rel="stylesheet" href="${BRAND.font.stylesheetUrl}" />
    <style>
      body {
        font-family: '${BRAND.font.family}', system-ui, sans-serif;
        background: ${BRAND.colors.dark};
        color: ${BRAND.colors.light};
        margin: 0;
      }
      .brand-header {
        display: flex;
        justify-content: center;
        padding: 2rem 1rem 1rem;
      }
      .brand-header img { height: 48px; }
      .auth0-widget-host {
        display: flex;
        justify-content: center;
        padding: 1rem 1rem 3rem;
      }
    </style>
  </head>
  <body>
    <header class="brand-header">
      <img src="${BRAND.assets.logoUrl}" alt="${BRAND.name}" />
    </header>
    <main class="auth0-widget-host">
      {%- auth0:widget -%}
    </main>
  </body>
</html>`;

export type Auth0BrandingPayload = typeof AUTH0_BRANDING_PAYLOAD;
