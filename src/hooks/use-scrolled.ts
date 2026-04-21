"use client";

import { useEffect, useState } from "react";

/**
 * Returns true when `window.scrollY` exceeds the given threshold.
 * Used by the dashboard topbar to flip on frosted-glass + shadow once
 * the user scrolls past the header.
 */
export function useScrolled(threshold = 10): boolean {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const read = () => {
      setScrolled(window.scrollY > threshold);
    };
    read();
    window.addEventListener("scroll", read, { passive: true });
    return () => window.removeEventListener("scroll", read);
  }, [threshold]);

  return scrolled;
}
