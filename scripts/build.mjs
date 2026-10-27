import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
const output = path.join(root, "plugin", "splayer-unblockmusic.js");

/**
 * 生成插件元数据横幅
 * @returns 插件文件头
 */
const metadata = () =>
  `/**
 * @name        Splayer-UnblockMusic
 * @id          splayer.unblock-music
 * @version     ${packageJson.version}
 * @description 内置 HTTP 音源为网易云歌曲补充播放地址，可选 sidecar 提供 yt-dlp 增强
 * @author      ${packageJson.author}
 * @type        source
 * @grant       network
 * @apiLevel    2
 * @license     AGPL-3.0-only
 * @updateUrl   https://raw.githubusercontent.com/sudo-bai/Splayer-UnblockMusic/main/plugin/splayer-unblockmusic.js
 *
 * 内置 provider 兼容逻辑参考 UnblockNeteaseMusic/server（LGPL-3.0-only）
 * 详见仓库中的 THIRD_PARTY_NOTICES.md
 */`;

await build({
  entryPoints: [path.join(root, "src", "plugin.js")],
  outfile: output,
  bundle: true,
  platform: "neutral",
  format: "iife",
  target: "es2022",
  charset: "utf8",
  legalComments: "none",
  banner: { js: metadata() },
  logLevel: "info",
});

const bundle = await readFile(output, "utf8");
await writeFile(output, `${bundle.trimEnd()}\n`);
console.log(`插件已生成: ${path.relative(root, output)} (${Buffer.byteLength(bundle)} bytes)`);
