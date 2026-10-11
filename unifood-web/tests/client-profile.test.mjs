import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";

function profileReader(client) {
  const mod = { exports: {} };
  const source = ts.transpileModule(
    fs.readFileSync("features/client/server/profile.ts", "utf8"),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    },
  ).outputText;
  new Function("require", "module", "exports", source)(
    (name) => {
      if (name === "server-only") return {};
      if (name === "@/features/auth/server/client")
        return { authClient: async () => client };
      throw new Error(`Unexpected module: ${name}`);
    },
    mod,
    mod.exports,
  );
  return mod.exports.getClientDetails;
}
function fixture(responses, calls) {
  return {
    from(table) {
      const call = { table };
      calls.push(call);
      return {
        select(columns) {
          call.columns = columns;
          return {
            eq(column, value) {
              call.filter = [column, value];
              return {
                async maybeSingle() {
                  const response = responses[table];
                  if (response instanceof Error) throw response;
                  return response;
                },
              };
            },
          };
        },
      };
    },
  };
}
test("student details use the verified user filter and its actual institution", async () => {
  const calls = [];
  const read = profileReader(
    fixture(
      {
        clients: {
          data: {
            document: "12345",
            phone: null,
            institution_id: "own-institution",
          },
          error: null,
        },
        institutions: { data: { name: "Own university" }, error: null },
      },
      calls,
    ),
  );
  assert.deepEqual(await read("verified-user"), {
    document: "12345",
    phone: null,
    institution: "Own university",
    unavailable: false,
  });
  assert.deepEqual(calls, [
    {
      table: "clients",
      columns: "document, phone, institution_id",
      filter: ["user_id", "verified-user"],
    },
    {
      table: "institutions",
      columns: "name",
      filter: ["id", "own-institution"],
    },
  ]);
});
test("student details handle absent or denied rows and provider failures without leaking errors", async () => {
  for (const response of [
    { data: null, error: null },
    { data: null, error: { message: "private provider detail" } },
    new Error("private provider detail"),
  ]) {
    const calls = [];
    const read = profileReader(fixture({ clients: response }, calls));
    assert.deepEqual(await read("verified-user"), {
      document: null,
      phone: null,
      institution: null,
      unavailable: true,
    });
    assert.equal(calls.length, 1);
  }
});
test("unavailable institution preserves the student's other fields", async () => {
  const read = profileReader(
    fixture(
      {
        clients: {
          data: {
            document: "12345",
            phone: "3001234567",
            institution_id: "inactive-institution",
          },
          error: null,
        },
        institutions: { data: null, error: null },
      },
      [],
    ),
  );
  assert.deepEqual(await read("verified-user"), {
    document: "12345",
    phone: "3001234567",
    institution: null,
    unavailable: true,
  });
});
