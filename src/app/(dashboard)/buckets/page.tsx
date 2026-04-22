import { Database, Plus } from "lucide-react";

import { auth0 } from "@/lib/auth0";
import { resolveRole } from "@/lib/auth-guard";
import { prisma } from "@/lib/prisma";
import {
  asBucketListPrisma,
  getBucketList,
  parseBucketListQuery,
  type BucketListOptions,
  type BucketListScope,
  type BucketSummary,
} from "@/lib/bucket-list";
import { createRateLimiter } from "@/lib/rate-limit";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { BucketCard } from "@/components/buckets/bucket-card";

// Native <select> styled to match shadcn Input. The bucket filter form
// submits via GET, so we need the DOM element, not the Radix-based
// shadcn Select (which is a button + popover, not a form control).
const nativeSelectClass =
  "border-input bg-background text-foreground placeholder:text-muted-foreground focus-visible:ring-ring h-9 w-full rounded-md border px-3 py-1 text-sm shadow-xs transition-colors focus-visible:outline-hidden focus-visible:ring-1 disabled:cursor-not-allowed disabled:opacity-50";
import { CreateBucketDialog } from "@/components/buckets/create-bucket-dialog";

export const dynamic = "force-dynamic";

// SSR-render rate limiter. The API route also limits, but a direct
// page.tsx path bypasses that — without this an authed user can hammer
// Prisma with reload loops. Higher cap than the API (60/30s) because
// page loads carry the whole dashboard chrome + this fetch in one hit.
const pageLimiter = createRateLimiter({
  max: 60,
  windowMs: 30_000,
  prefix: "@helpucompli/buckets-page",
});

interface PageProps {
  readonly searchParams: Promise<
    Record<string, string | string[] | undefined>
  >;
}

export default async function BucketsPage({ searchParams }: PageProps) {
  const session = await auth0.getSession();
  const role = await resolveRole(session ?? null);
  if (!role) {
    return <EmptyState message="You do not have access to the bucket manager." />;
  }

  const sub = session?.user.sub as string | undefined;
  if (sub) {
    const quota = await pageLimiter.limit(`buckets-page:${sub}`);
    if (!quota.success) {
      return (
        <EmptyState message="You are refreshing too fast. Please wait a moment and try again." />
      );
    }
  }

  const params = await searchParams;
  const options: BucketListOptions = parseBucketListQuery(params) ?? {};

  let scope: BucketListScope;
  let list: readonly BucketSummary[] = [];
  let loadError = false;

  if (role === "viewer") {
    const sub = session?.user.sub as string | undefined;
    if (!sub) {
      return <BucketsView role={role} buckets={[]} options={options} />;
    }
    const dbUser = await prisma.user.findUnique({
      where: { auth0Id: sub },
      select: { id: true },
    });
    if (!dbUser) {
      return <BucketsView role={role} buckets={[]} options={options} />;
    }
    scope = { role: "viewer", userId: dbUser.id };
  } else {
    scope = { role };
  }

  try {
    list = await getBucketList(asBucketListPrisma(prisma), scope, options);
  } catch {
    loadError = true;
  }

  const dialogOpen = role === "superadmin" && params.new === "1";

  return (
    <>
      <BucketsView
        role={role}
        buckets={list}
        options={options}
        loadError={loadError}
      />
      {dialogOpen ? <CreateBucketDialog closeHref="/buckets" /> : null}
    </>
  );
}

interface BucketsViewProps {
  readonly role: "superadmin" | "admin" | "viewer";
  readonly buckets: readonly BucketSummary[];
  readonly options: BucketListOptions;
  readonly loadError?: boolean;
}

function BucketsView({ role, buckets, options, loadError }: BucketsViewProps) {
  const canCreate = role === "superadmin";
  const sortField = options.sort?.field ?? "name";
  const sortDir = options.sort?.dir ?? "asc";
  const region = options.filters?.region ?? "";
  const status = options.filters?.status ?? "active";

  return (
    <section className="flex flex-col gap-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1.5">
          <h1 className="text-foreground m-0 text-3xl font-semibold tracking-tight">
            Buckets
          </h1>
          <p className="text-muted-foreground text-sm">
            {role === "viewer"
              ? "Buckets you have access to."
              : "All managed document buckets."}
          </p>
        </div>
        {canCreate ? (
          <Button asChild size="sm">
            <a href="/buckets?new=1">
              <Plus aria-hidden="true" />
              Create bucket
            </a>
          </Button>
        ) : null}
      </header>

      <Card className="gap-0 p-5">
        <form
          method="GET"
          className="grid grid-cols-[repeat(auto-fit,minmax(10rem,1fr))] items-end gap-3"
        >
          <div className="flex flex-col gap-1.5">
            <Label
              htmlFor="sort"
              className="text-muted-foreground text-[11px] font-medium uppercase tracking-wider"
            >
              Sort
            </Label>
            <select
              id="sort"
              name="sort"
              defaultValue={sortField}
              className={nativeSelectClass}
            >
              <option value="name">Name</option>
              <option value="createdAt">Created date</option>
              <option value="documentCount">Document count</option>
            </select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label
              htmlFor="dir"
              className="text-muted-foreground text-[11px] font-medium uppercase tracking-wider"
            >
              Direction
            </Label>
            <select
              id="dir"
              name="dir"
              defaultValue={sortDir}
              className={nativeSelectClass}
            >
              <option value="asc">Ascending</option>
              <option value="desc">Descending</option>
            </select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label
              htmlFor="region"
              className="text-muted-foreground text-[11px] font-medium uppercase tracking-wider"
            >
              Region
            </Label>
            <Input
              id="region"
              name="region"
              defaultValue={region}
              placeholder="us-east-1"
              maxLength={32}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label
              htmlFor="status"
              className="text-muted-foreground text-[11px] font-medium uppercase tracking-wider"
            >
              Status
            </Label>
            <select
              id="status"
              name="status"
              defaultValue={status}
              className={nativeSelectClass}
            >
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
              <option value="all">All</option>
            </select>
          </div>
          <Button type="submit" variant="secondary" size="sm">
            Apply
          </Button>
        </form>
      </Card>

      {loadError ? (
        <p role="alert" className="text-destructive text-sm">
          Unable to load buckets. Please try again.
        </p>
      ) : buckets.length === 0 ? (
        <EmptyState
          message={
            role === "viewer"
              ? "You have not been granted access to any buckets yet."
              : "No buckets match the current filters."
          }
        />
      ) : (
        <ul
          role="list"
          className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(18rem,1fr))] gap-4 p-0 lg:gap-5"
        >
          {buckets.map((b) => (
            <li key={b.id}>
              <BucketCard bucket={b} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function EmptyState({ message }: { readonly message: string }) {
  return (
    <div className="border-border bg-card text-muted-foreground flex flex-col items-center gap-3 rounded-xl border border-dashed px-6 py-12 text-center">
      <div className="bg-muted text-muted-foreground flex size-12 items-center justify-center rounded-full">
        <Database aria-hidden="true" className="size-5" />
      </div>
      <p className="text-sm">{message}</p>
    </div>
  );
}
