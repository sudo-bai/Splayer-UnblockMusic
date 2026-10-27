import assert from "node:assert/strict";
import { test } from "node:test";
import { createMusicResolver } from "../src/music-resolver.js";

const info = { id: "186016", name: "晴天", artists: ["周杰伦"], durationMs: 269_000 };
const log = { info() {}, warn() {}, debug() {} };

/**
 * 创建最小解析器
 * @param providers - 测试音源实现
 * @param options - 覆盖解析器限制
 * @returns 解析器
 */
const createResolver = (providers, options = {}) =>
  createMusicResolver({
    providers,
    context: {},
    log,
    resolutionBudget: 2_000,
    sourceTimeouts: { bodian: 500, kugou: 500, kuwo: 500, sidecar: 500 },
    ...options,
  });

/**
 * 创建播放结果
 * @param provider - 音源名称
 * @param quality - 音质
 * @returns provider 返回结果
 */
const result = (provider, quality = "lq") => ({
  url: `https://cdn.test/${provider}.mp3`,
  quality,
  bitrate: quality === "hq" ? 320_000 : 128_000,
});

test("按音源顺序在达到目标音质后停止", async () => {
  const calls = [];
  const resolver = createResolver({
    bodian: async () => {
      calls.push("bodian");
      return result("bodian");
    },
    kugou: async () => {
      calls.push("kugou");
      return result("kugou", "hq");
    },
    kuwo: async () => {
      calls.push("kuwo");
      return result("kuwo", "lossless");
    },
  });

  const resolved = await resolver.resolve({
    info,
    quality: "hq",
    sourceOrder: ["bodian", "kugou", "kuwo"],
    preferLossless: true,
    signature: "test",
  });
  assert.deepEqual(calls, ["bodian", "kugou"]);
  assert.equal(resolved.provider, "kugou");
  assert.equal(resolved.quality, "hq");
});

test("音源超时后在总预算内返回可读错误", async () => {
  const started = Date.now();
  const resolver = createResolver({
    bodian: () => new Promise(() => {}),
  });

  await assert.rejects(
    () =>
      resolver.resolve({
        info,
        quality: "hq",
        sourceOrder: ["bodian"],
        preferLossless: true,
        signature: "timeout",
      }),
    /bodian 解析超时/,
  );
  assert.ok(Date.now() - started < 1_000);
});

test("sidecar 作为可选 fallback 参与最终择优", async () => {
  const resolver = createResolver({
    bodian: async () => result("bodian", "lq"),
  });
  const resolved = await resolver.resolve({
    info,
    quality: "hq",
    sourceOrder: ["bodian"],
    preferLossless: true,
    signature: "sidecar",
    sidecar: {
      resolve: async () => ({
        url: "https://cdn.test/ytdlp.webm",
        quality: "hq",
        provider: "ytdlp",
        bitrate: 320_000,
      }),
    },
  });
  assert.equal(resolved.provider, "ytdlp");
  assert.equal(resolved.degraded, false);
});
