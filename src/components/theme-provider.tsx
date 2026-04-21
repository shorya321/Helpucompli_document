"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

/*
 * Minimal React 19-safe theme provider.
 *
 * Why not next-themes? next-themes@0.4.6 renders a <script> tag via its
 * ThemeScript client component to prevent theme flash. React 19 now
 * warns "Encountered a script tag while rendering React component"
 * because client-rendered scripts never execute after hydration.
 *
 * This provider does the same job without rendering <script> in JSX:
 *   - Flash prevention runs via a server-rendered
 *     dangerouslySetInnerHTML script in src/app/layout.tsx <head>,
 *     before the React tree hydrates. That path is a server-component
 *     render and does not trigger the React 19 client warning.
 *   - React context handles theme state, localStorage persistence, and
 *     matchMedia listening at runtime.
 *
 * Public API mirrors next-themes useTheme():
 *   { theme, setTheme, resolvedTheme, systemTheme }
 */

export type Theme = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

export interface ThemeProviderProps {
  readonly children: React.ReactNode;
  readonly defaultTheme?: Theme;
  readonly storageKey?: string;
  readonly attribute?: "class" | "data-theme";
  readonly enableSystem?: boolean;
  readonly disableTransitionOnChange?: boolean;
}

interface ThemeContextValue {
  readonly theme: Theme;
  readonly resolvedTheme: ResolvedTheme;
  readonly systemTheme: ResolvedTheme;
  readonly setTheme: (theme: Theme) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

const DEFAULT_STORAGE_KEY = "theme";

function readSystemTheme(): ResolvedTheme {
  if (typeof window === "undefined") return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

function readStoredTheme(storageKey: string, fallback: Theme): Theme {
  if (typeof window === "undefined") return fallback;
  try {
    const stored = window.localStorage.getItem(storageKey);
    if (stored === "light" || stored === "dark" || stored === "system") {
      return stored;
    }
  } catch {
    // localStorage unavailable (e.g. private mode) — fall through.
  }
  return fallback;
}

function applyTheme(
  root: HTMLElement,
  attribute: "class" | "data-theme",
  resolved: ResolvedTheme,
) {
  if (attribute === "class") {
    root.classList.toggle("dark", resolved === "dark");
    root.classList.toggle("light", resolved === "light");
  } else {
    root.setAttribute(attribute, resolved);
  }
  root.style.colorScheme = resolved;
}

function disableTransitionsFor(ms: number): () => void {
  if (typeof document === "undefined") return () => {};
  const css = document.createElement("style");
  css.appendChild(
    document.createTextNode(
      "*,*::before,*::after{-webkit-transition:none!important;-moz-transition:none!important;-o-transition:none!important;-ms-transition:none!important;transition:none!important}",
    ),
  );
  document.head.appendChild(css);
  return () => {
    void window.getComputedStyle(document.body);
    window.setTimeout(() => {
      css.remove();
    }, ms);
  };
}

export function ThemeProvider({
  children,
  defaultTheme = "system",
  storageKey = DEFAULT_STORAGE_KEY,
  attribute = "class",
  enableSystem = true,
  disableTransitionOnChange = false,
}: ThemeProviderProps) {
  // Lazy initializer reads localStorage + matchMedia synchronously so
  // the first render already reflects the correct theme state. The
  // <script> in layout.tsx <head> has already applied the .dark class
  // to <html> before React hydrates, so there is no flash.
  const [theme, setThemeState] = useState<Theme>(() =>
    readStoredTheme(storageKey, defaultTheme),
  );
  const [systemTheme, setSystemTheme] = useState<ResolvedTheme>(() =>
    readSystemTheme(),
  );

  const resolvedTheme: ResolvedTheme =
    theme === "system" && enableSystem ? systemTheme : (theme as ResolvedTheme);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mql = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => setSystemTheme(mql.matches ? "dark" : "light");
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    if (typeof document === "undefined") return;
    const cleanup = disableTransitionOnChange
      ? disableTransitionsFor(1)
      : null;
    applyTheme(document.documentElement, attribute, resolvedTheme);
    cleanup?.();
  }, [attribute, disableTransitionOnChange, resolvedTheme]);

  const setTheme = useCallback(
    (next: Theme) => {
      setThemeState(next);
      try {
        window.localStorage.setItem(storageKey, next);
      } catch {
        // localStorage quota / unavailable — swallow; state still updates.
      }
    },
    [storageKey],
  );

  const value = useMemo<ThemeContextValue>(
    () => ({ theme, resolvedTheme, systemTheme, setTheme }),
    [theme, resolvedTheme, systemTheme, setTheme],
  );

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    // SSR / outside-provider fallback with no-op setter. Matches
    // next-themes behaviour so useTheme() never throws.
    return {
      theme: "system",
      resolvedTheme: "light",
      systemTheme: "light",
      setTheme: () => {},
    };
  }
  return ctx;
}
