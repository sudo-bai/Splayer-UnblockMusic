import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_PORT, loadConfig } from "../src/config.js";

test("读取 sidecar 默认配置", () => {
  const config = loadConfig({});
  assert.equal(config.host, "127.0.0.1");
  assert.equal(config.port, DEFAULT_PORT);
  assert.equal(config.token, "");
  assert.equal(config.ytdlpPath, "yt-dlp");
  assert.equal(config.ytdlpCookies, "");
  assert.equal(config.ytdlpCookiesFromBrowser, "");
  assert.equal(config.logLevel, "warn");
});

test("读取 yt-dlp 路径与 Cookie 配置", () => {
  const config = loadConfig({
    UNM_HOST: "127.0.0.1",
    UNM_PORT: "19000",
    UNM_TOKEN: "secret",
    YTDLP_PATH: "/usr/bin/yt-dlp",
    YTDLP_COOKIES: "/tmp/cookies.txt",
    YTDLP_COOKIES_FROM_BROWSER: "brave:/tmp/profile",
    LOG_LEVEL: "info",
  });
  assert.deepEqual(config, {
    host: "127.0.0.1",
    port: 19000,
    token: "secret",
    ytdlpPath: "/usr/bin/yt-dlp",
    ytdlpCookies: "/tmp/cookies.txt",
    ytdlpCookiesFromBrowser: "brave:/tmp/profile",
    logLevel: "info",
  });
});

test("拒绝非法端口", () => {
  assert.throws(() => loadConfig({ UNM_PORT: "70000" }), /UNM_PORT/);
});
