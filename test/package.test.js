import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("package manifest excludes generated Python bytecode", async () => {
  const manifest = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8"),
  );

  assert.ok(manifest.files.includes("!**/__pycache__/**"));
  assert.ok(manifest.files.includes("!**/*.pyc"));
});
