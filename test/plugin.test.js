import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { parseSourceOrder } from "../src/settings.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("插件产物满足 SPlayer 在线导入约束", async () => {
  const source = await readFile(path.join(root, "plugin", "splayer-unblockmusic.js"), "utf8");
  assert.ok(Buffer.byteLength(source) < 9_000_000);
  assert.match(source, /@apiLevel\s+2/);
  assert.match(source, /@grant\s+network/);
  assert.doesNotMatch(source, /\brequire\s*\(/);
  assert.doesNotMatch(source, /^\s*import\s+/m);
  assert.doesNotMatch(source, /\bchild_process\b|\bnode:|\bWebAssembly\b/);
});

test("内置音源顺序只保留已实现 provider", () => {
  assert.deepEqual(parseSourceOrder("kuwo,unknown,bodian,kuwo"), ["kuwo", "bodian"]);
  assert.deepEqual(parseSourceOrder(""), ["bodian", "kugou", "kuwo"]);
});
