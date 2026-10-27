import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_SOURCES, loadConfig, parseSources } from "../src/config.js";

test("过滤未知音源并保持声明顺序", () => {
  assert.deepEqual(parseSources("bodian, unknown, kugou, bodian"), ["bodian", "kugou"]);
});

test("空音源配置回退到默认值", () => {
  assert.deepEqual(parseSources(""), DEFAULT_SOURCES);
});

test("读取 sidecar 配置", () => {
  const config = loadConfig({
    UNM_HOST: "127.0.0.1",
    UNM_PORT: "19000",
    UNM_TOKEN: "secret",
    UNM_SOURCES: "kugou,ytdlp",
    ENABLE_FLAC: "false",
    UNM_MIN_BITRATE: "320000",
    PATH: "",
  });
  assert.deepEqual(config, {
    host: "127.0.0.1",
    port: 19000,
    token: "secret",
    sources: ["kugou", "ytdlp"],
    enableFlac: false,
    minBitrate: 320_000,
  });
});

test("拒绝非法端口", () => {
  assert.throws(() => loadConfig({ UNM_PORT: "70000", PATH: "" }), /UNM_PORT/);
});
