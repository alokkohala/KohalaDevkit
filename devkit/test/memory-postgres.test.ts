import { afterAll, describe, expect, it } from "vitest";
import { PostgresMemoryStore } from "../src/memory/postgres.js";

/**
 * Postgres backend tests run only when TEST_DATABASE_URL (or DATABASE_URL)
 * is set — CI without a database skips them rather than faking one.
 */
const url = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;

describe.skipIf(!url)("PostgresMemoryStore", () => {
  const agent = `test-${Date.now().toString(36)}`;
  let store: PostgresMemoryStore;

  afterAll(async () => {
    await store?.close();
  });

  it("connects and migrates", async () => {
    store = await PostgresMemoryStore.connect(url as string, agent);
    expect(store).toBeDefined();
  });

  it("puts, gets, updates in place", async () => {
    const first = await store.put("pg/key", Buffer.from("v1"));
    const second = await store.put("pg/key", Buffer.from("v2"));
    expect(second.id).toBe(first.id);
    const asset = await store.get("pg/key");
    expect(asset?.body.toString()).toBe("v2");
  });

  it("lists by prefix and deletes (soft)", async () => {
    await store.put("pg/two", Buffer.from("x"));
    const listed = await store.list("pg/");
    expect(listed.length).toBeGreaterThanOrEqual(2);
    const deleted = await store.delete("pg/two");
    expect(deleted?.active).toBe(false);
    expect(await store.get("pg/two")).toBeNull();
  });
});
