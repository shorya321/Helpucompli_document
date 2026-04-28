import { NextResponse } from "next/server";

export function json<T>(
  body: T,
  status: number,
  extra?: Record<string, string>,
): NextResponse<T> {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store, private", ...extra },
  });
}
