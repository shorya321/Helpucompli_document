"use client";

import { Settings2 } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";

const FONT_OPTIONS: readonly { value: string; cssVar: string; label: string }[] = [
  { value: "inter", cssVar: "var(--font-inter)", label: "Inter" },
  { value: "manrope", cssVar: "var(--font-manrope)", label: "Manrope" },
  { value: "mono", cssVar: "var(--font-mono)", label: "JetBrains Mono" },
];

const LS_KEY = "helpucompli:config-drawer";

function readPref<T extends string>(field: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(LS_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Record<string, string>;
    return (parsed[field] as T | undefined) ?? fallback;
  } catch {
    return fallback;
  }
}

// TODO(E4): replace the localStorage shim below with the real
// useLocalSettings hook once it lands in Phase E4.
function useConfigPref<T extends string>(
  field: string,
  fallback: T,
): [T, (next: T) => void] {
  // Lazy initializer reads localStorage synchronously on first render —
  // keeps setState out of useEffect (per react-hooks/set-state-in-effect)
  // and avoids a post-mount re-render flash.
  const [value, setValue] = useState<T>(() => readPref(field, fallback));

  const write = (next: T) => {
    setValue(next);
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(LS_KEY);
      const parsed = raw ? (JSON.parse(raw) as Record<string, string>) : {};
      parsed[field] = next;
      window.localStorage.setItem(LS_KEY, JSON.stringify(parsed));
    } catch {
      // localStorage quota / disabled — swallow; UI still reflects state.
    }
  };

  return [value, write];
}

function applyFontSans(cssVar: string) {
  if (typeof document === "undefined") return;
  document.documentElement.style.setProperty("--font-sans", cssVar);
}

export function ConfigDrawer() {
  const [font, setFont] = useConfigPref<string>("fontSans", "inter");

  useEffect(() => {
    const option = FONT_OPTIONS.find((f) => f.value === font);
    if (option) applyFontSans(option.cssVar);
  }, [font]);

  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Open layout config">
          <Settings2 aria-hidden="true" />
        </Button>
      </SheetTrigger>
      <SheetContent side="right" className="w-80 sm:w-96">
        <SheetHeader>
          <SheetTitle>Layout</SheetTitle>
          <SheetDescription>
            Tweak the shell. Preferences are stored locally on this device.
          </SheetDescription>
        </SheetHeader>
        <div className="mt-6 flex flex-col gap-5 px-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="config-font">Body font</Label>
            <div role="radiogroup" id="config-font" className="flex flex-col gap-1">
              {FONT_OPTIONS.map((opt) => (
                <label
                  key={opt.value}
                  className="hover:bg-accent text-foreground flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm"
                >
                  <input
                    type="radio"
                    name="config-font"
                    value={opt.value}
                    checked={font === opt.value}
                    onChange={() => setFont(opt.value)}
                    className="accent-primary"
                  />
                  <span>{opt.label}</span>
                </label>
              ))}
            </div>
            <p className="text-muted-foreground text-xs">
              The font picker in Settings → Appearance (Phase E4) replaces
              this shim.
            </p>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
