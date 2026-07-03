import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { sql } from "drizzle-orm";
import { createDb } from "./index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsFolder = join(__dirname, "..", "migrations");
const policiesFolder = join(__dirname, "..", "policies");

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required");
  const { db, close } = createDb(url);
  try {
    await db.execute(sql`CREATE EXTENSION IF NOT EXISTS vector`);
    await migrate(db, { migrationsFolder });
    // RLS policies live outside drizzle-kit's diffing; applied idempotently after schema migrations.
    for (const file of readdirSync(policiesFolder).sort()) {
      if (!file.endsWith(".sql")) continue;
      const ddl = readFileSync(join(policiesFolder, file), "utf8");
      await db.execute(sql.raw(ddl));
      console.log(`applied policy file: ${file}`);
    }
    console.log("migrations complete");
  } finally {
    await close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
