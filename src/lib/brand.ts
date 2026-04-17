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
    stylesheetUrl:
      "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap",
  },
  assets: {
    logoUrl: "https://docs.helpucompli.com/brand/logo.svg",
    faviconUrl: "https://docs.helpucompli.com/brand/favicon.ico",
  },
} as const;

export type Brand = typeof BRAND;
