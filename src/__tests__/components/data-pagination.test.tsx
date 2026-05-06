// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import {
  DataPagination,
  buildPageWindow,
} from "@/components/ui/data-pagination";

describe("buildPageWindow", () => {
  it("returns all pages when total fits without ellipsis", () => {
    expect(buildPageWindow(1, 5)).toEqual([1, 2, 3, 4, 5]);
  });

  it("inserts right ellipsis near start", () => {
    expect(buildPageWindow(2, 20)).toEqual([1, 2, 3, "ellipsis-right", 20]);
  });

  it("inserts left ellipsis near end", () => {
    expect(buildPageWindow(19, 20)).toEqual([
      1,
      "ellipsis-left",
      18,
      19,
      20,
    ]);
  });

  it("inserts both ellipses for middle pages", () => {
    expect(buildPageWindow(10, 20)).toEqual([
      1,
      "ellipsis-left",
      9,
      10,
      11,
      "ellipsis-right",
      20,
    ]);
  });
});

describe("DataPagination — offset mode", () => {
  it("renders nothing when total <= pageSize", () => {
    const { container } = render(
      <DataPagination
        mode="offset"
        page={1}
        pageSize={10}
        total={5}
        onPageChange={vi.fn()}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders Previous, numbered pages, and Next", () => {
    render(
      <DataPagination
        mode="offset"
        page={1}
        pageSize={10}
        total={50}
        onPageChange={vi.fn()}
      />,
    );
    expect(screen.getByLabelText("Go to previous page")).toBeTruthy();
    expect(screen.getByLabelText("Go to next page")).toBeTruthy();
    expect(screen.getByLabelText("Go to page 1")).toBeTruthy();
    expect(screen.getByLabelText("Go to page 5")).toBeTruthy();
  });

  it("disables Previous on first page", () => {
    render(
      <DataPagination
        mode="offset"
        page={1}
        pageSize={10}
        total={50}
        onPageChange={vi.fn()}
      />,
    );
    expect(
      screen
        .getByLabelText("Go to previous page")
        .getAttribute("aria-disabled"),
    ).toBe("true");
    expect(
      screen.getByLabelText("Go to next page").getAttribute("aria-disabled"),
    ).toBe("false");
  });

  it("disables Next on last page", () => {
    render(
      <DataPagination
        mode="offset"
        page={5}
        pageSize={10}
        total={50}
        onPageChange={vi.fn()}
      />,
    );
    expect(
      screen.getByLabelText("Go to next page").getAttribute("aria-disabled"),
    ).toBe("true");
  });

  it("calls onPageChange with the clicked page number", async () => {
    const onPageChange = vi.fn();
    const user = userEvent.setup();
    render(
      <DataPagination
        mode="offset"
        page={1}
        pageSize={10}
        total={50}
        onPageChange={onPageChange}
      />,
    );
    await user.click(screen.getByLabelText("Go to page 3"));
    expect(onPageChange).toHaveBeenCalledWith(3);
  });

  it("does not call onPageChange when Previous is clicked on first page", async () => {
    const onPageChange = vi.fn();
    const user = userEvent.setup();
    render(
      <DataPagination
        mode="offset"
        page={1}
        pageSize={10}
        total={50}
        onPageChange={onPageChange}
      />,
    );
    await user.click(screen.getByLabelText("Go to previous page"));
    expect(onPageChange).not.toHaveBeenCalled();
  });

  it("renders ellipsis for many pages", () => {
    render(
      <DataPagination
        mode="offset"
        page={10}
        pageSize={10}
        total={500}
        onPageChange={vi.fn()}
      />,
    );
    const ellipses = screen.getAllByText("More pages");
    expect(ellipses.length).toBeGreaterThanOrEqual(2);
  });
});

describe("DataPagination — cursor mode", () => {
  it("renders Previous, page indicator, and Next", () => {
    render(
      <DataPagination
        mode="cursor"
        page={2}
        hasPrev
        hasNext
        onPrev={vi.fn()}
        onNext={vi.fn()}
      />,
    );
    expect(screen.getByLabelText("Go to previous page")).toBeTruthy();
    expect(screen.getByLabelText("Go to next page")).toBeTruthy();
    expect(screen.getByText("Page 2")).toBeTruthy();
  });

  it("disables Previous when hasPrev is false", () => {
    render(
      <DataPagination
        mode="cursor"
        page={1}
        hasPrev={false}
        hasNext
        onPrev={vi.fn()}
        onNext={vi.fn()}
      />,
    );
    expect(
      screen
        .getByLabelText("Go to previous page")
        .getAttribute("aria-disabled"),
    ).toBe("true");
  });

  it("disables Next when hasNext is false", () => {
    render(
      <DataPagination
        mode="cursor"
        page={3}
        hasPrev
        hasNext={false}
        onPrev={vi.fn()}
        onNext={vi.fn()}
      />,
    );
    expect(
      screen.getByLabelText("Go to next page").getAttribute("aria-disabled"),
    ).toBe("true");
  });

  it("invokes onPrev / onNext on click", async () => {
    const onPrev = vi.fn();
    const onNext = vi.fn();
    const user = userEvent.setup();
    render(
      <DataPagination
        mode="cursor"
        page={2}
        hasPrev
        hasNext
        onPrev={onPrev}
        onNext={onNext}
      />,
    );
    await user.click(screen.getByLabelText("Go to next page"));
    await user.click(screen.getByLabelText("Go to previous page"));
    expect(onNext).toHaveBeenCalledTimes(1);
    expect(onPrev).toHaveBeenCalledTimes(1);
  });

  it("does not invoke handlers when disabled", async () => {
    const onPrev = vi.fn();
    const onNext = vi.fn();
    const user = userEvent.setup();
    render(
      <DataPagination
        mode="cursor"
        page={1}
        hasPrev={false}
        hasNext={false}
        onPrev={onPrev}
        onNext={onNext}
      />,
    );
    await user.click(screen.getByLabelText("Go to previous page"));
    await user.click(screen.getByLabelText("Go to next page"));
    expect(onPrev).not.toHaveBeenCalled();
    expect(onNext).not.toHaveBeenCalled();
  });
});
