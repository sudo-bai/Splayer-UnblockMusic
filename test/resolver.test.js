import assert from "node:assert/strict";
import { test } from "node:test";
import { createResolver, mapQuality } from "../src/resolver.js";

test("按音源顺序选择达到目标音质的结果", async () => {
  const calls = [];
  const match = async (_id, [source]) => {
    calls.push(source);
    if (source === "kugou") return { url: "https://cdn.test/low.mp3", br: 128_000, source };
    if (source === "bodian") return { url: "https://cdn.test/flac.flac", br: 999_000, source };
    return { url: "https://cdn.test/kuwo.mp3", br: 320_000, source };
  };
  const resolver = createResolver({
    match,
    sources: ["kugou", "bodian", "kuwo"],
    enableFlac: true,
    logger: { warn() {} },
  });

  const result = await resolver.resolve({ id: "186016", quality: "lossless" });
  assert.deepEqual(calls, ["kugou", "bodian"]);
  assert.equal(result.provider, "bodian");
  assert.equal(result.quality, "lossless");
  assert.equal(result.degraded, false);
});

test("没有达到目标音质时返回最佳可用结果", async () => {
  const resolver = createResolver({
    match: async (_id, [source]) => ({ url: "https://cdn.test/low.mp3", br: 64_000, source }),
    sources: ["kuwo"],
    enableFlac: true,
    logger: { warn() {} },
  });

  const result = await resolver.resolve({ id: "186016", quality: "lossless" });
  assert.equal(result.quality, "lq");
  assert.equal(result.degraded, true);
});

test("缓存相同歌曲与音质的解析结果", async () => {
  let calls = 0;
  const resolver = createResolver({
    match: async (_id, [source]) => {
      calls += 1;
      return { url: "https://cdn.test/song.mp3", br: 320_000, source };
    },
    sources: ["kugou"],
    enableFlac: true,
    logger: { warn() {} },
  });

  const first = await resolver.resolve({ id: "186016", quality: "hq" });
  const second = await resolver.resolve({ id: "186016", quality: "hq" });
  assert.equal(calls, 1);
  assert.equal(second.cached, true);
  assert.equal(first.url, second.url);
});

test("拒绝非数字歌曲 ID", async () => {
  const resolver = createResolver({
    match: async () => {
      throw new Error("不应调用");
    },
    sources: ["kugou"],
    enableFlac: true,
    logger: { warn() {} },
  });

  await assert.rejects(() => resolver.resolve({ id: "../demo", quality: "hq" }), {
    code: "UNM_INVALID_ID",
  });
});

test("码率映射到 SPlayer 音质", () => {
  assert.equal(mapQuality(2_000_000), "hi-res");
  assert.equal(mapQuality(999_000), "lossless");
  assert.equal(mapQuality(320_000), "hq");
  assert.equal(mapQuality(192_000), "sq");
  assert.equal(mapQuality(128_000), "lq");
  assert.equal(mapQuality(0), undefined);
});
