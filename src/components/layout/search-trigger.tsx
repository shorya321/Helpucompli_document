"use client";

import { Search as SearchIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useSearch } from "@/components/layout/search-provider";

export function SearchTrigger() {
  // search-provider is added in Phase E3. Until then useSearch returns
  // a no-op fallback so E1 can ship without the command palette wired.
  const { setOpen } = useSearch();
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={() => setOpen(true)}
      aria-label="Open command menu"
      className="text-muted-foreground relative h-9 w-full justify-start gap-2 rounded-full border-border/70 bg-muted/30 pr-10 pl-3.5 font-normal shadow-none hover:bg-muted/50 hover:text-foreground"
    >
      <SearchIcon aria-hidden="true" className="size-4 opacity-70" />
      <span className="text-sm">Search…</span>
      <kbd className="pointer-events-none absolute right-2 top-1/2 hidden -translate-y-1/2 items-center gap-0.5 rounded-md border border-border/60 bg-background px-1.5 py-0.5 font-mono text-[10px] font-medium text-muted-foreground sm:inline-flex">
        <span className="text-[11px] leading-none">⌘</span>K
      </kbd>
    </Button>
  );
}
