// Prisma seed — invoked by `prisma db seed` (configured in
// prisma.config.ts: migrations.seed = "tsx prisma/seed.ts").
// Currently a no-op. Real seed data (e.g., a superadmin bootstrap
// user for first-run dev) will land in Module 10 when the user
// upsert-from-Auth0 flow ships. Kept as a callable file so the
// configured command does not fail when a developer runs it.

async function main(): Promise<void> {
  // intentional no-op
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
