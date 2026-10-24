import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createAuthDatabase } from "./helpers/auth-database.mjs";
const cafe = "00000000-0000-0000-0000-000000000003",
  product = "00000000-0000-0000-0000-000000000004",
  other = "00000000-0000-0000-0000-000000000005",
  asset = "00000000-0000-0000-0000-000000000006";
test("017 upgrades legacy rows without changing their data and closes table/column access", async () => {
  const db = await createAuthDatabase({ throughMigration: "016" });
  try {
    await db.exec(`INSERT INTO institutions(id,name,email_domain,brand_name) VALUES ('00000000-0000-0000-0000-000000000001','Test','test.invalid','Test');
      INSERT INTO sites(id,name,city,institution_id) VALUES ('00000000-0000-0000-0000-000000000002','Site','Test','00000000-0000-0000-0000-000000000001');
      INSERT INTO cafeterias(id,site_id,name,is_active,lunch_order_start,lunch_order_end) VALUES ('${cafe}','00000000-0000-0000-0000-000000000002','Cafe',false,'07:00','08:00');
      INSERT INTO lunches(id,cafeteria_id,name,category,price,image_url,stock,is_active) VALUES ('${product}','${cafe}','Legacy','CORRIENTE',18500.25,'/images/legacy.png',8,false),('${other}','${cafe}','Other','ESPECIAL',19000,NULL,0,false);`);
    const before = (await db.query(`SELECT * FROM lunches ORDER BY id`)).rows;
    const constraints = (
      await db.query(
        "SELECT conname,pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conrelid='public.order_items'::regclass ORDER BY conname",
      )
    ).rows;
    await db.exec(
      await readFile(
        new URL(
          "../../unifood-backend/supabase/migrations/017_catalog_images.sql",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    assert.deepEqual(
      (await db.query("SELECT * FROM lunches ORDER BY id")).rows.map(
        ({ image_asset_id, ...row }) => {
          assert.equal(image_asset_id, null);
          return row;
        },
      ),
      before,
    );
    assert.deepEqual(
      (
        await db.query(
          "SELECT conname,pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conrelid='public.order_items'::regclass ORDER BY conname",
        )
      ).rows,
      constraints,
    );
    for (const table of ["catalog_image_assets", "catalog_image_operations"]) {
      assert.equal(
        (
          await db.query(
            `SELECT relrowsecurity FROM pg_class WHERE oid='public.${table}'::regclass`,
          )
        ).rows[0].relrowsecurity,
        true,
      );
      for (const actor of ["anon", "authenticated"]) {
        for (const privilege of [
          "SELECT",
          "INSERT",
          "UPDATE",
          "DELETE",
          "TRUNCATE",
          "REFERENCES",
          "TRIGGER",
        ])
          assert.equal(
            (
              await db.query(
                `SELECT has_table_privilege('${actor}','public.${table}','${privilege}') AS allowed`,
              )
            ).rows[0].allowed,
            false,
          );
        for (const privilege of ["SELECT", "INSERT", "UPDATE", "REFERENCES"])
          assert.equal(
            (
              await db.query(
                `SELECT has_any_column_privilege('${actor}','public.${table}','${privilege}') AS allowed`,
              )
            ).rows[0].allowed,
            false,
          );
      }
    }
    await db.exec(
      `INSERT INTO catalog_image_assets(id,cafeteria_id,product_id,bucket,object_key,content_type,byte_size,width,height,sha256,state) VALUES ('${asset}','${cafe}','${product}','product-images','cafeterias/${cafe}/products/${product}/${asset}.png','image/png',100,300,300,'${"a".repeat(64)}','CURRENT')`,
    );
    await assert.rejects(
      db.exec(
        `UPDATE lunches SET image_asset_id='${asset}' WHERE id='${other}'`,
      ),
      /foreign key/i,
    );
    await db.exec(
      `UPDATE lunches SET image_asset_id='${asset}' WHERE id='${product}' AND version=0`,
    );
    assert.equal(
      String(
        (await db.query(`SELECT version FROM lunches WHERE id='${product}'`))
          .rows[0].version,
      ),
      "1",
    );
    await assert.rejects(
      db.exec(`DELETE FROM catalog_image_assets WHERE id='${asset}'`),
      /foreign key/i,
    );
  } finally {
    await db.close();
  }
});
