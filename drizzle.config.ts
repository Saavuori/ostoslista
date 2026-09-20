import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/lib/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgres://ostoslista:ostoslista@localhost:5432/ostoslista",
  },
  strict: true,
  verbose: true,
});
