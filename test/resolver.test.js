import assert from "node:assert/strict";
import { test } from "node:test";
import { createResolver } from "../src/resolver.js";

const log = { info() {}, warn() {}, debug() {} };

/**
 * 创建测试用 yt-dlp 解析器
 * @param run - yt-dlp 调用
 * @param options - 覆盖配置
 * @returns 解析器
 */
const createTestResolver = (run, options = {}) =>
  createResolver({
    run,
    resolveKeyword: async (id) => `歌曲 ${id} - 歌手`,
    logger: log,
    ...options,
  });

test("返回 yt-dlp 结果并标记音质降级", async () => {
  const resolver = createTestResolver(async () => ({
    url: "https://cdn.test/song.webm",
    provider: "ytdlp",
    bitrate: 128_000,
    quality: "lq",
  }));
  const result = await resolver.resolve({
    id: "186016",
    quality: "lossless",
    keyword: "晴天 - 周杰伦",
  });
  assert.equal(result.provider, "ytdlp");
  assert.equal(result.requestedQuality, "lossless");
  assert.equal(result.degraded, true);
});

test("缺少关键词时回退到网易云详情", async () => {
  let received;
  const resolver = createTestResolver(async (keyword) => {
    received = keyword;
    return { url: "https://cdn.test/song.m4a", provider: "ytdlp", bitrate: 128_000, quality: "lq" };
  });
  await resolver.resolve({ id: "186016", quality: "hq" });
  assert.equal(received, "歌曲 186016 - 歌手");
});

test("缓存相同歌曲、音质和关键词", async () => {
  let calls = 0;
  const resolver = createTestResolver(async () => {
    calls += 1;
    return {
      url: "https://cdn.test/cache.m4a",
      provider: "ytdlp",
      bitrate: 128_000,
      quality: "lq",
    };
  });
  const input = { id: "186016", quality: "hq", keyword: "晴天 - 周杰伦" };
  await resolver.resolve(input);
  const second = await resolver.resolve(input);
  assert.equal(calls, 1);
  assert.equal(second.cached, true);
});

test("拒绝非数字歌曲 ID", async () => {
  const resolver = createTestResolver(async () => ({ url: "https://cdn.test/song.m4a" }));
  await assert.rejects(() => resolver.resolve({ id: "../demo", quality: "hq" }), {
    code: "INVALID_ID",
  });
});
