#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadConfig } from "./config.js";
import { createResolver } from "./resolver.js";
import { createSidecarServer } from "./server.js";
import { createYtDlpRunner, fetchKeyword, inspectYtDlp } from "./ytdlp.js";

const packageJson = JSON.parse(
  fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"),
);

/**
 * 检查 yt-dlp 用户配置是否声明了 Cookie
 * @returns 是否检测到 Cookie 配置
 */
const hasYtDlpCookieConfig = () => {
  const configHome = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config");
  return ["config", "config.txt"].some((fileName) => {
    try {
      const content = fs.readFileSync(path.join(configHome, "yt-dlp", fileName), "utf8");
      return /(?:^|\s)--cookies(?:-from-browser)?(?:\s|$)/m.test(content);
    } catch {
      return false;
    }
  });
};

/**
 * 启动 Splayer-UnblockMusic sidecar
 */
const start = async () => {
  const config = loadConfig();
  const ytdlp = await inspectYtDlp(config.ytdlpPath);
  const cookiesConfigured = Boolean(
    config.ytdlpCookies || config.ytdlpCookiesFromBrowser || hasYtDlpCookieConfig(),
  );
  if (!ytdlp.available) {
    console.warn(`[unblockmusic] 无法执行 yt-dlp: ${config.ytdlpPath}`);
  } else if (!cookiesConfigured) {
    console.warn(
      "[unblockmusic] 未检测到 yt-dlp Cookie 配置；YouTube 可能要求登录并返回 bot check",
    );
  }

  const runner = createYtDlpRunner({
    executable: config.ytdlpPath,
    cookies: config.ytdlpCookies,
    cookiesFromBrowser: config.ytdlpCookiesFromBrowser,
  });
  const resolver = createResolver({
    run: runner.run,
    resolveKeyword: fetchKeyword,
    logger: console,
  });
  const server = createSidecarServer({
    resolver,
    token: config.token,
    version: packageJson.version,
    ytdlp,
    cookiesConfigured,
  });

  server.listen(config.port, config.host, () => {
    console.log(`[unblockmusic] sidecar 已启动: http://${config.host}:${config.port}`);
    console.log(`[unblockmusic] yt-dlp: ${ytdlp.available ? ytdlp.version : "不可用"}`);
    console.log(`[unblockmusic] Cookie: ${cookiesConfigured ? "已配置" : "未配置"}`);
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

start().catch((error) => {
  console.error(`[unblockmusic] sidecar 启动失败: ${error?.message ?? error}`);
  process.exit(1);
});
