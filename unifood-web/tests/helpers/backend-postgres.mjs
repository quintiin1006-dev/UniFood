// Owned by the backend integration-test process; never accepts an external DB URL.
import {
  createNativeAuthDatabase,
  postgresBinaries,
} from "./native-auth-database.mjs";
const binaries = await postgresBinaries();
if (!binaries)
  throw new Error(
    "Native PostgreSQL is required for backend concurrency tests",
  );
const db = await createNativeAuthDatabase(binaries);
try {
  const port = await db.query("SHOW port");
  console.log(
    JSON.stringify({ url: `jdbc:postgresql://127.0.0.1:${port}/postgres` }),
  );
  await new Promise((resolve) => {
    process.stdin.once("data", resolve);
    process.stdin.once("end", resolve);
    process.stdin.resume();
  });
  process.stdin.destroy();
} finally {
  await db.close();
}
