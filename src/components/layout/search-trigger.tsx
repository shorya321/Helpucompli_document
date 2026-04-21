"use client";

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
      className="text-muted-foreground relative h-9 w-full max-w-sm justify-start pr-10"
    >
      <span>Search...</span>
      <kbd className="bg-muted text-muted-foreground pointer-events-none absolute right-2 top-1/2 hidden -translate-y-1/2 items-center gap-1 rounded border px-1.5 py-0.5 text-[0.65rem] font-medium sm:inline-flex">
        <span className="text-[0.85rem]">⌘</span>K
      </kbd>
    </Button>
  );
}
