import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FileMemoryStore } from "../src/memory/file.js";

describe("FileMemoryStore", () => {
  let root: string;
  let store: FileMemoryStore;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "kohala-mem-"));
    store = new FileMemoryStore(root, "tester");
  });
  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("puts and gets by logical key", async () => {
    const record = await store.put("a/one", Buffer.from("hello"));
    expect(record.category).toBe("agentoutput");
    const asset = await store.get("a/one");
    expect(asset?.body.toString()).toBe("hello");
    expect(asset?.record.size).toBe(5);
  });

  it("gets by record id as fallback", async () => {
    const record = await store.put("a/one", Buffer.from("x"));
    const asset = await store.get(record.id);
    expect(asset?.record.key).toBe("a/one");
  });

  it("updates in place when the active key already exists", async () => {
    const first = await store.put("k", Buffer.from("v1"));
    const second = await store.put("k", Buffer.from("v2"), "custom");
    expect(second.id).toBe(first.id);
    expect((await store.get("k"))?.body.toString()).toBe("v2");
    expect((await store.list()).length).toBe(1);
    expect((await store.get("k"))?.record.category).toBe("custom");
  });

  it("lists active assets by prefix, newest first", async () => {
    await store.put("a/1", Buffer.from("1"));
    await new Promise((resolve) => setTimeout(resolve, 5));
    await store.put("a/2", Buffer.from("2"));
    await store.put("b/1", Buffer.from("3"));
    const listed = await store.list("a/");
    expect(listed.map((record) => record.key)).toEqual(["a/2", "a/1"]);
  });

  it("respects the list limit", async () => {
    for (let i = 0; i < 5; i += 1) await store.put(`k/${i}`, Buffer.from("x"));
    expect((await store.list(undefined, 3)).length).toBe(3);
  });

  it("delete removes the body and deactivates the record", async () => {
    const record = await store.put("gone", Buffer.from("bye"));
    const deleted = await store.delete("gone");
    expect(deleted?.active).toBe(false);
    expect(await store.get("gone")).toBeNull();
    expect(fs.existsSync(path.join(root, ".kohala", "memory", "tester", "bodies", record.id))).toBe(
      false,
    );
    // Reusing the key after deletion creates a fresh record.
    const fresh = await store.put("gone", Buffer.from("again"));
    expect(fresh.id).not.toBe(record.id);
  });

  it("returns null when deleting something that does not exist", async () => {
    expect(await store.delete("nope")).toBeNull();
  });

  it("throws when the index references a missing body file", async () => {
    const record = await store.put("broken", Buffer.from("x"));
    fs.unlinkSync(path.join(root, ".kohala", "memory", "tester", "bodies", record.id));
    await expect(store.get("broken")).rejects.toThrow(/body file is missing/);
  });
});
