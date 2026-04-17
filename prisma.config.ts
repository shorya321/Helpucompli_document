import { config as loadEnv } from "dotenv";
import path from "node:path";
import { defineConfig } from "prisma/config";

// Prisma CLI reads `.env` by default. This repo uses `.env.local`
// (Next.js convention). Load it explicitly so `prisma migrate`,
// `prisma studio`, `prisma generate`, and `tsx prisma/seed.ts`
// all resolve DATABASE_URL without shell sourcing.
loadEnv({ path: path.resolve(__dirname, ".env.local") });

export default defineConfig({
  schema: path.resolve(__dirname, "prisma", "schema.prisma"),
  migrations: {
    path: path.resolve(__dirname, "prisma", "migrations"),
    seed: "tsx prisma/seed.ts",
  },
});
