import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

const eslintConfig = [
  ...nextCoreWebVitals,
  ...nextTypescript,
  {
    ignores: [
      ".next/**",
      "node_modules/**",
      "coverage/**",
      "dist/**",
      "build/**",
      "src/components/ui/**",
      "src/hooks/use-mobile.ts",
      "scripts/**",
    ],
  },
  {
    files: ["src/components/**/*.{ts,tsx}", "src/app/(dashboard)/**/*.{ts,tsx}"],
    ignores: [
      "src/components/ui/**",
      "src/components/layout/brand-logo.tsx",
      "src/lib/email.ts",
      "src/lib/auth0-branding.ts",
    ],
    rules: {
      // Phase D cleanup: migration complete, guard is now strict. New
      // BRAND.colors access or inline color styles in dashboard scope
      // fail the build.
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "MemberExpression[object.name='BRAND'][property.name='colors']",
          message:
            "BRAND.colors is banned in dashboard/components scope. Use semantic Tailwind tokens (bg-background, text-foreground, etc.) from src/app/globals.css instead. See docs: single-source-of-truth CSS rule.",
        },
        {
          selector:
            "JSXAttribute[name.name='style'] > JSXExpressionContainer > ObjectExpression > Property[key.name=/^(background|backgroundColor|color|borderColor|border|fill|stroke)$/]",
          message:
            "Inline color/border styles are banned in dashboard components. Use semantic Tailwind utility classes (className='bg-background text-foreground border border-border') — all tokens defined in src/app/globals.css.",
        },
      ],
    },
  },
];

export default eslintConfig;
