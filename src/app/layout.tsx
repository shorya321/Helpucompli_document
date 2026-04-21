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
