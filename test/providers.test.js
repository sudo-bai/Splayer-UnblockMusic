import assert from "node:assert/strict";
import crypto from "node:crypto";
import { test } from "node:test";
import { createPromiseCache } from "../src/promise-cache.js";
import { resolveBodian } from "../src/providers/bodian.js";
import { resolveKugou } from "../src/providers/kugou.js";
import { resolveKuwo } from "../src/providers/kuwo.js";
import { flacResponse, KUGOU_SEARCH_BODY, KUWO_SEARCH_BODY, mp3Response } from "./plugin-host.js";

const info = {
  id: "186016",
  name: "晴天",
  artists: ["周杰伦"],
  durationMs: 269_000,
  keyword: "晴天 - 周杰伦",
};

/**
 * 创建 provider 测试上下文
 * @param request - 按 URL 返回响应的实现
 * @returns provider 上下文
 */
const createContext = (request) => {
  const call = (url, options, expected) => request(url, options, expected);
  return {
    request: {
      json: (url, options) => call(url, options, "json"),
      text: (url, options) => call(url, options, "text"),
      bytes: (url, options) => call(url, options, "bytes"),
    },
    md5: (value) => crypto.createHash("md5").update(value).digest("hex"),
    searchCache: createPromiseCache(8),
    log: { debug() {}, warn() {}, info() {} },
  };
};

test("kugou provider 解析搜索、取流并探测音质", async () => {
  const context = createContext(async (url) => {
    if (url.includes("mobilecdn.kugou.com")) {
      return { status: 200, headers: {}, body: KUGOU_SEARCH_BODY };
    }
    if (url.includes("trackercdn.kugou.com")) {
      return {
        status: 200,
        headers: {},
        body: { url: ["https://cdn.test/kugou.flac"] },
      };
    }
    if (url.includes("cdn.test/kugou.flac")) return flacResponse(url);
    throw new Error(`未预期请求: ${url}`);
  });

  const result = await resolveKugou(info, context, { preferLossless: true });
  assert.equal(result.url, "https://cdn.test/kugou.flac");
  assert.equal(result.format, "flac");
  assert.equal(result.size, 55_397_039);
});

test("bodian provider 解锁后返回 FLAC 地址", async () => {
  const context = createContext(async (url) => {
    if (url.includes("search.kuwo.cn")) {
      return { status: 200, headers: {}, body: KUWO_SEARCH_BODY };
    }
    if (url.includes("/advert/watch")) return { status: 200, headers: {}, body: { code: 200 } };
    if (url.includes("/audioUrl")) {
      return {
        status: 200,
        headers: {},
        body: { code: 200, data: { audioUrl: "https://cdn.test/bodian.flac" } },
      };
    }
    if (url.includes("cdn.test/bodian.flac")) return flacResponse(url);
    throw new Error(`未预期请求: ${url}`);
  });

  const result = await resolveBodian(info, context, { preferLossless: true });
  assert.equal(result.url, "https://cdn.test/bodian.flac");
  assert.equal(result.sampleRate, 44_100);
  assert.equal(result.bitsPerSample, 24);
});

test("kuwo provider 返回可播放 MP3", async () => {
  const context = createContext(async (url) => {
    if (url.includes("search.kuwo.cn")) {
      return { status: 200, headers: {}, body: KUWO_SEARCH_BODY };
    }
    if (url.includes("antiserver.kuwo.cn")) {
      return { status: 200, headers: {}, body: "https://cdn.test/kuwo.mp3" };
    }
    if (url.includes("cdn.test/kuwo.mp3")) return mp3Response(url);
    throw new Error(`未预期请求: ${url}`);
  });

  const result = await resolveKuwo(info, context, { preferLossless: true });
  assert.equal(result.url, "https://cdn.test/kuwo.mp3");
  assert.equal(result.format, "mp3");
  assert.equal(result.bitrate, 128_000);
});
