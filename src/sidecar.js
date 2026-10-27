#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { loadConfig } from "./config.js";
import { createResolver } from "./resolver.js";
import { createSidecarServer } from "./server.js";

const require = createRequire(import.meta.url);
const packageJson = require("../package.json");

/**
 * 检测系统中的 yt-dlp
 * @returns yt-dlp 可用性与版本
 */
const inspectYtDlp = () => {
  const result = spawnSync("yt-dlp", ["--version"], {
    encoding: "utf8",
    timeout: 3_000,
  });
  if (result.error || result.status !== 0) return { available: false, version: null };
  return { available: true, version: result.stdout.trim() || null };
};

/**
 * 启动 Splayer-UnblockMusic sidecar
 */
const start = () => {
  const config = loadConfig();
  process.env.ENABLE_FLAC = config.enableFlac ? "true" : "false";
  process.env.FOLLOW_SOURCE_ORDER = "true";
  if (!process.env.LOG_LEVEL) process.env.LOG_LEVEL = "error";

  // 上游在模块加载时读取 ENABLE_FLAC，因此必须在设置环境变量后再加载
  const match = require("@unblockneteasemusic/server");
  const resolver = createResolver({
    match,
    sources: config.sources,
    enableFlac: config.enableFlac,
    minBitrate: config.minBitrate,
  });
  const ytdlp = inspectYtDlp();
  if (
    !ytdlp.available &&
    config.sources.some((source) => source === "ytdlp" || source === "youtubedl")
  ) {
    console.warn("[unblockmusic] 未检测到 yt-dlp，ytdlp 音源将不可用");
  }

  const server = createSidecarServer({
    resolver,
    token: config.token,
    version: packageJson.version,
    sources: config.sources,
    ytdlp,
  });

  server.listen(config.port, config.host, () => {
    console.log(`[unblockmusic] sidecar 已启动: http://${config.host}:${config.port}`);
    console.log(`[unblockmusic] 音源: ${config.sources.join(", ")}`);
    console.log(`[unblockmusic] yt-dlp: ${ytdlp.available ? ytdlp.version : "不可用"}`);
    console.log(`[unblockmusic] 认证: ${config.token ? "Bearer Token" : "关闭（仅限本机）"}`);
  });

  const shutdown = (signal) => {
    console.log(`[unblockmusic] 收到 ${signal}，正在关闭`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 5_000).unref();
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
};

start();
