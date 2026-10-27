import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const file = path.join(root, "plugin", "splayer-unblockmusic.js");
const source = await readFile(file, "utf8");
const forbidden = [
  [/\brequire\s*\(/, "require 调用"],
  [/^\s*import\s+/m, "ES import"],
  [/\bchild_process\b/, "child_process"],
  [/\bnode:/, "Node 内置模块"],
  [/\bWebAssembly\b/, "WebAssembly"],
  [/\bdocument\./, "DOM document"],
  [/\bwindow\./, "DOM window"],
  [/\belectron\b/i, "Electron API"],
];

if (Buffer.byteLength(source) >= 9_000_000) {
  throw new Error("插件文件超过 SPlayer 在线导入限制");
}
for (const [pattern, label] of forbidden) {
  if (pattern.test(source)) throw new Error(`插件产物包含不允许的 ${label}`);
}
if (!source.includes("@id          splayer.unblock-music")) {
  throw new Error("插件产物缺少稳定 ID");
}
if (!source.includes("@apiLevel    2")) throw new Error("插件产物缺少 apiLevel 2");
if (!source.includes("@grant       network")) throw new Error("插件产物缺少 network 权限");

console.log(`插件产物检查通过: ${Buffer.byteLength(source)} bytes`);
