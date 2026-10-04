import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { access, mkdtemp, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createServer } from "node:net";
import { authSchemaSql } from "./auth-database.mjs";

const run = promisify(execFile);
const suffix = process.platform === "win32" ? ".exe" : "";
const nativeEnv = Object.fromEntries(
  Object.entries(process.env).filter(([name]) => !/^PG/i.test(name)),
);

// A daemon may inherit execFile pipes on Windows. Avoid those pipes entirely.
function control(executable, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      windowsHide: true,
      stdio: "ignore",
      env: nativeEnv,
    });
    child.once("error", reject);
    child.once("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`pg_ctl exited with ${code}`)),
    );
  });
}

export async function postgresBinaries() {
  const directories = [];
  if (process.platform === "win32") {
    const root = join(
      process.env.ProgramFiles || "C:\\Program Files",
      "PostgreSQL",
    );
    try {
      for (const version of (await readdir(root)).sort().reverse())
        directories.push(join(root, version, "bin"));
    } catch {
      /* Optional native PostgreSQL; PGlite tests always run. */
    }
  }
  try {
    directories.push(
      (
        await run("pg_config" + suffix, ["--bindir"], {
          env: nativeEnv,
          windowsHide: true,
        })
      ).stdout.trim(),
    );
  } catch {
    /* Not installed on PATH. */
  }
  for (const directory of directories) {
    try {
      await Promise.all(
        ["initdb", "pg_ctl", "psql"].map((name) =>
          access(join(directory, name + suffix)),
        ),
      );
      return directory;
    } catch {
      /* Try the next installation. */
    }
  }
  return null;
}

export async function createNativeAuthDatabase(directory) {
  const root = await mkdtemp(join(tmpdir(), "unifood-role-cardinality-"));
  const data = join(root, "data");
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  const executable = (name) => join(directory, name + suffix);
  const args = [
    "-X",
    "-qAt",
    "-h",
    "127.0.0.1",
    "-p",
    String(port),
    "-U",
    "postgres",
    "-d",
    "postgres",
    "-v",
    "ON_ERROR_STOP=1",
    "-v",
    "VERBOSITY=verbose",
  ];
  await run(
    executable("initdb"),
    [
      "-D",
      data,
      "-U",
      "postgres",
      "--auth-local=trust",
      "--auth-host=trust",
      "--encoding=UTF8",
      "--no-locale",
    ],
    { windowsHide: true, env: nativeEnv },
  );
  // Entirely separate temporary cluster, loopback only; never use developer DB variables.
  await control(executable("pg_ctl"), [
    "-D",
    data,
    "-l",
    join(root, "postgres.log"),
    "-o",
    `-h 127.0.0.1 -p ${port} -F`,
    "-w",
    "start",
  ]);
  const close = () =>
    control(executable("pg_ctl"), [
      "-D",
      data,
      "-m",
      "immediate",
      "-w",
      "stop",
    ]);
  function session() {
    const child = spawn(executable("psql"), args, {
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
      env: nativeEnv,
    });
    let output = "",
      errors = "";
    child.stdout.on("data", (chunk) => {
      output += chunk;
    });
    child.stderr.on("data", (chunk) => {
      errors += chunk;
    });
    const done = new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("close", (code) => resolve({ code, output, errors }));
    });
    return {
      write: (sql) => child.stdin.write(sql + "\n"),
      end: () => child.stdin.end(),
      done,
      output: () => output,
    };
  }
  async function query(sql) {
    const connection = session();
    connection.write(sql);
    connection.end();
    const result = await connection.done;
    if (result.code !== 0) throw new Error(result.errors);
    return result.output.trim();
  }
  try {
    await query(authSchemaSql);
    const migrations = new URL(
      "../../../unifood-backend/supabase/migrations/",
      import.meta.url,
    );
    for (const file of (await readdir(migrations))
      .filter((name) => name.endsWith(".sql"))
      .sort()) {
      await query(await readFile(new URL(file, migrations), "utf8"));
    }
  } catch (error) {
    await close();
    throw error;
  }
  // Leave the isolated temporary directory/log for diagnosis; do not delete paths.
  return { query, session, close, root };
}
