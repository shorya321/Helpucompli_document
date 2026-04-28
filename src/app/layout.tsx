import type { Metadata } from "next";
import { Inter, JetBrains_Mono, Manrope } from "next/font/google";
import { Auth0Provider } from "@auth0/nextjs-auth0";
import { auth0 } from "@/lib/auth0";
import { Providers } from "./providers";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";

// Matches the reference template's Google Fonts:
//   <link href="https://fonts.googleapis.com/css2?family=Inter:ital,opsz,wght@0,14..32,100..900;1,14..32,100..900&family=Manrope:wght@200..800&display=swap">
const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

const manrope = Manrope({
  subsets: ["latin"],
  variable: "--font-manrope",
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "HelpUcompli Document Repository",
  description: "HIPAA-compliant document management platform",
};

// Runs before React hydrates. Reads localStorage + matchMedia, sets
// the .dark class on <html>. Rendered as a raw inline <script> in <head>
// with suppressHydrationWarning so React 19 does not re-diff it on Fast
// Refresh and next/script does not inject a dev-only nonce mismatch.
const themeInitScript = `(function(){try{var t=localStorage.getItem('theme')||'system';var d=t==='dark'||(t==='system'&&window.matchMedia('(prefers-color-scheme: dark)').matches);var c=document.documentElement.classList;c.toggle('dark',d);c.toggle('light',!d);document.documentElement.style.colorScheme=d?'dark':'light';}catch(e){}})();`;

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const session = await auth0.getSession();

  return (
    <html
      lang="en"
      suppressHydrationWarning
      // --font-sans defaults to Inter (matches reference). ConfigDrawer /
      // Settings → Appearance can override this at runtime by writing
      // --font-sans on <html>.
      style={
        {
          "--font-sans": "var(--font-inter)",
        } as React.CSSProperties
      }
    >
      <head>
        {/*
          Inline anti-FOUC script. RootLayout is a Server Component, so
          this <script> is server-rendered into the HTML and executes on
          initial paint before React hydrates. React 19 / Turbopack may
          surface an informational "script tag in JSX" warning in dev —
          ignore it. next/script with beforeInteractive cannot be used
          here: it injects a nonce="" attribute that hydration-mismatches
          against the client's nonce={undefined}.
        */}
        <script
          suppressHydrationWarning
          // eslint-disable-next-line react/no-danger
          dangerouslySetInnerHTML={{ __html: themeInitScript }}
        />
      </head>
      <body
        className={`${inter.variable} ${manrope.variable} ${jetbrainsMono.variable} font-sans antialiased`}
      >
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          <Auth0Provider user={session?.user}>
            <Providers>{children}</Providers>
          </Auth0Provider>
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
