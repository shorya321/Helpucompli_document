"use client";

import { createContext, useContext, useMemo, useState } from "react";

interface SearchContextValue {
  readonly open: boolean;
  readonly setOpen: (open: boolean) => void;
}

const noopContext: SearchContextValue = {
  open: false,
  setOpen: () => {
    // no-op when rendered outside a SearchProvider (E1 shell has no
    // provider until E3 adds one; SearchTrigger still renders and
    // becomes live the moment the provider wraps the tree).
  },
};

const SearchContext = createContext<SearchContextValue>(noopContext);

interface SearchProviderProps {
  readonly children: React.ReactNode;
}

export function SearchProvider({ children }: SearchProviderProps) {
  const [open, setOpen] = useState(false);
  const value = useMemo<SearchContextValue>(
    () => ({ open, setOpen }),
    [open],
  );
  return (
    <SearchContext.Provider value={value}>{children}</SearchContext.Provider>
  );
}

export function useSearch(): SearchContextValue {
  return useContext(SearchContext);
}
