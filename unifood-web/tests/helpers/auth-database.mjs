import { PGlite } from "@electric-sql/pglite";
import { readdir, readFile } from "node:fs/promises";

// The pg_cron objects that 018 uses. Scheduling only records the job; nothing runs.
export const cronSchemaSql = `
      CREATE SCHEMA cron;
      CREATE TABLE cron.job (
        jobid bigserial PRIMARY KEY,
        jobname text UNIQUE,
        schedule text NOT NULL,
        command text NOT NULL,
        active boolean NOT NULL DEFAULT true
      );
      CREATE FUNCTION cron.schedule(job_name text, schedule text, command text)
      RETURNS bigint LANGUAGE sql AS $$
        INSERT INTO cron.job (jobname, schedule, command) VALUES (job_name, schedule, command)
        RETURNING jobid;
      $$;
      CREATE FUNCTION cron.unschedule(job_id bigint) RETURNS boolean LANGUAGE sql AS $$
        DELETE FROM cron.job WHERE jobid = job_id RETURNING true;
      $$;
    `;

// Real PostgreSQL in memory. Only Supabase's managed auth schema is a fixture;
// all public tables, policies, functions and triggers come from our migrations.
// Fixtures insert identities directly, as the Admin API does, so raw_app_meta_data
// defaults to the provisioned mark. Public signups must pass '{}' explicitly.
export const authSchemaSql = `
      CREATE ROLE anon;
      CREATE ROLE authenticated;
      CREATE SCHEMA auth;
      CREATE TABLE auth.users (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        email text NOT NULL,
        raw_user_meta_data jsonb NOT NULL DEFAULT '{}'::jsonb,
        raw_app_meta_data jsonb NOT NULL DEFAULT '{"unifood_provisioned": true}'::jsonb,
        email_confirmed_at timestamptz,
        encrypted_password text NOT NULL DEFAULT ''
      );
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
        SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
      $$;
      ${cronSchemaSql}
    `;

// TEST DATABASE ONLY. It simulates the server step that preauthorizes an identity
// before creating it with the Admin API (migration 018). It lets fixtures that insert
// WORKER, ADMIN or SUPER_ADMIN identities directly keep doing so. The real 018 ignores
// the app_metadata mark; secure-registration.test.mjs runs without this trigger.
export const simulatedServerPreauthorizationSql = `
      CREATE FUNCTION auth.test_only_simulate_server_preauthorization()
      RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.raw_app_meta_data ->> 'unifood_provisioned' = 'true'
          AND to_regclass('public.identity_preauthorizations') IS NOT NULL THEN
          EXECUTE 'INSERT INTO public.identity_preauthorizations (email, role_name, expires_at)
            VALUES (lower($1), ''WORKER'', now() + interval ''5 minutes'')
            ON CONFLICT DO NOTHING' USING NEW.email;
        END IF;
        RETURN NEW;
      END;
      $$;
      CREATE TRIGGER test_only_simulate_server_preauthorization
        BEFORE INSERT ON auth.users
        FOR EACH ROW EXECUTE FUNCTION auth.test_only_simulate_server_preauthorization();
    `;

export async function createAuthDatabase({
  throughMigration = "999",
  simulateServerPreauthorization = true,
} = {}) {
  const db = new PGlite();
  try {
    await db.exec(authSchemaSql);
    if (simulateServerPreauthorization)
      await db.exec(simulatedServerPreauthorizationSql);
    const directory = new URL(
      "../../../unifood-backend/supabase/migrations/",
      import.meta.url,
    );
    // The helper lives at unifood-web/tests/helpers: move up to the monorepo.
    const migrations = (await readdir(directory))
      .filter(
        (name) => name.endsWith(".sql") && name.slice(0, 3) <= throughMigration,
      )
      .sort();
    for (const migration of migrations)
      await db.exec(await readFile(new URL(migration, directory), "utf8"));
    return db;
  } catch (error) {
    await db.close();
    throw error;
  }
}
