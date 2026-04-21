// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useScrolled } from "@/hooks/use-scrolled";

afterEach(() => {
  window.scrollY = 0;
});

describe("useScrolled", () => {
  it("returns false at scrollY = 0", () => {
    const { result } = renderHook(() => useScrolled());
    expect(result.current).toBe(false);
  });

  it("returns true once scrollY exceeds the threshold", () => {
    const { result } = renderHook(() => useScrolled(10));
    act(() => {
      window.scrollY = 50;
      window.dispatchEvent(new Event("scroll"));
    });
    expect(result.current).toBe(true);
  });

  it("returns false again when scrolling back above the threshold", () => {
    const { result } = renderHook(() => useScrolled(10));
    act(() => {
      window.scrollY = 50;
      window.dispatchEvent(new Event("scroll"));
    });
    expect(result.current).toBe(true);
    act(() => {
      window.scrollY = 2;
      window.dispatchEvent(new Event("scroll"));
    });
    expect(result.current).toBe(false);
  });
});
