import { PGlite } from "@electric-sql/pglite";
import { readdir, readFile } from "node:fs/promises";

// Real PostgreSQL in memory. Only Supabase's managed auth schema is a fixture;
// all public tables, policies, functions and triggers come from our migrations.
export async function createAuthDatabase() {
  const db = new PGlite();
  try {
    await db.exec(`
      CREATE ROLE anon;
      CREATE ROLE authenticated;
      CREATE SCHEMA auth;
      CREATE TABLE auth.users (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        email text NOT NULL,
        raw_user_meta_data jsonb NOT NULL DEFAULT '{}'::jsonb
      );
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
        SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
      $$;
    `);
    const directory = new URL("../../../unifood-backend/supabase/migrations/", import.meta.url);
    // The helper lives at unifood-web/tests/helpers: move up to the monorepo.
    const migrations = (await readdir(directory)).filter((name) => name.endsWith(".sql")).sort();
    for (const migration of migrations) await db.exec(await readFile(new URL(migration, directory), "utf8"));
    return db;
  } catch (error) {
    await db.close();
    throw error;
  }
}
