"use client";

import * as React from "react";

import { cn } from "@/lib/utils";
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";

type OffsetMode = {
  mode: "offset";
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  siblingCount?: number;
  className?: string;
};

type CursorMode = {
  mode: "cursor";
  page: number;
  hasPrev: boolean;
  hasNext: boolean;
  onPrev: () => void;
  onNext: () => void;
  className?: string;
};

export type DataPaginationProps = OffsetMode | CursorMode;

const DISABLED_CLASSES =
  "pointer-events-none cursor-not-allowed opacity-50";

export function buildPageWindow(
  currentPage: number,
  totalPages: number,
  siblingCount: number = 1
): Array<number | "ellipsis-left" | "ellipsis-right"> {
  if (totalPages <= 0) return [];
  if (totalPages <= 5 + siblingCount * 2) {
    return Array.from({ length: totalPages }, (_, i) => i + 1);
  }

  const left = Math.max(currentPage - siblingCount, 1);
  const right = Math.min(currentPage + siblingCount, totalPages);
  const showLeftEllipsis = left > 2;
  const showRightEllipsis = right < totalPages - 1;

  const items: Array<number | "ellipsis-left" | "ellipsis-right"> = [];
  items.push(1);
  if (showLeftEllipsis) items.push("ellipsis-left");

  const startMid = showLeftEllipsis ? left : 2;
  const endMid = showRightEllipsis ? right : totalPages - 1;
  for (let p = startMid; p <= endMid; p += 1) {
    if (p > 1 && p < totalPages) items.push(p);
  }

  if (showRightEllipsis) items.push("ellipsis-right");
  items.push(totalPages);
  return items;
}

export function DataPagination(props: DataPaginationProps) {
  if (props.mode === "offset") {
    return <OffsetPagination {...props} />;
  }
  return <CursorPagination {...props} />;
}

function OffsetPagination({
  page,
  pageSize,
  total,
  onPageChange,
  siblingCount = 1,
  className,
}: OffsetMode) {
  const totalPages = Math.max(1, Math.ceil(total / Math.max(1, pageSize)));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const isFirst = safePage <= 1;
  const isLast = safePage >= totalPages;
  const window = buildPageWindow(safePage, totalPages, siblingCount);

  if (totalPages <= 1) return null;

  const handle = (target: number) => (event: React.MouseEvent) => {
    event.preventDefault();
    if (target < 1 || target > totalPages || target === safePage) return;
    onPageChange(target);
  };

  return (
    <Pagination className={className}>
      <PaginationContent>
        <PaginationItem>
          <PaginationPrevious
            href="#"
            aria-disabled={isFirst}
            tabIndex={isFirst ? -1 : undefined}
            className={cn(isFirst && DISABLED_CLASSES)}
            onClick={handle(safePage - 1)}
          />
        </PaginationItem>
        {window.map((item) => {
          if (item === "ellipsis-left" || item === "ellipsis-right") {
            return (
              <PaginationItem key={item}>
                <PaginationEllipsis />
              </PaginationItem>
            );
          }
          const isActive = item === safePage;
          return (
            <PaginationItem key={item}>
              <PaginationLink
                href="#"
                isActive={isActive}
                aria-label={`Go to page ${item}`}
                onClick={handle(item)}
              >
                {item}
              </PaginationLink>
            </PaginationItem>
          );
        })}
        <PaginationItem>
          <PaginationNext
            href="#"
            aria-disabled={isLast}
            tabIndex={isLast ? -1 : undefined}
            className={cn(isLast && DISABLED_CLASSES)}
            onClick={handle(safePage + 1)}
          />
        </PaginationItem>
      </PaginationContent>
    </Pagination>
  );
}

function CursorPagination({
  page,
  hasPrev,
  hasNext,
  onPrev,
  onNext,
  className,
}: CursorMode) {
  const handlePrev = (event: React.MouseEvent) => {
    event.preventDefault();
    if (!hasPrev) return;
    onPrev();
  };
  const handleNext = (event: React.MouseEvent) => {
    event.preventDefault();
    if (!hasNext) return;
    onNext();
  };

  return (
    <Pagination className={className}>
      <PaginationContent>
        <PaginationItem>
          <PaginationPrevious
            href="#"
            aria-disabled={!hasPrev}
            tabIndex={!hasPrev ? -1 : undefined}
            className={cn(!hasPrev && DISABLED_CLASSES)}
            onClick={handlePrev}
          />
        </PaginationItem>
        <PaginationItem>
          <span
            aria-current="page"
            className="flex h-9 min-w-9 items-center justify-center px-3 text-sm font-medium text-foreground tabular-nums"
          >
            Page {page}
          </span>
        </PaginationItem>
        <PaginationItem>
          <PaginationNext
            href="#"
            aria-disabled={!hasNext}
            tabIndex={!hasNext ? -1 : undefined}
            className={cn(!hasNext && DISABLED_CLASSES)}
            onClick={handleNext}
          />
        </PaginationItem>
      </PaginationContent>
    </Pagination>
  );
}
