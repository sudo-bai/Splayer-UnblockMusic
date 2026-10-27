import assert from "node:assert/strict";
import { test } from "node:test";
import { flacResponse, KUWO_SEARCH_BODY, loadPlugin, mp3Response } from "./plugin-host.js";

const track = {
  source: "wy",
  quality: "lossless",
  musicInfo: { songmid: "186016", name: "晴天", singer: "周杰伦", interval: "04:29" },
};

/**
 * 创建默认的纯 HTTP 音源请求路由
 * @returns 请求实现与调用计数
 */
const createBuiltinRouter = () => {
  const calls = { ad: 0, audio: 0, probe: 0, sidecar: 0 };
  const request = async (url) => {
    if (url.includes("search.kuwo.cn")) return { status: 200, headers: {}, body: KUWO_SEARCH_BODY };
    if (url.includes("/advert/watch")) {
      calls.ad += 1;
      return { status: 200, headers: {}, body: { code: 200 } };
    }
    if (url.includes("/audioUrl")) {
      calls.audio += 1;
      return {
        status: 200,
        headers: {},
        body: {
          code: 200,
          data: { audioUrl: "https://cdn.test/song.flac" },
        },
      };
    }
    if (url.includes("cdn.test/song.flac")) {
      calls.probe += 1;
      return flacResponse(url);
    }
    if (url.includes("/v1/resolve")) {
      calls.sidecar += 1;
      throw new Error("默认配置不应调用 sidecar");
    }
    throw new Error(`未预期的请求: ${url}`);
  };
  return { request, calls };
};

test("注册稳定插件 ID、设置项且 sidecar 默认关闭", async () => {
  const plugin = await loadPlugin({ request: async () => assert.fail("不应发送请求") });
  assert.deepEqual(Object.keys(plugin.registration.sources), ["wy"]);
  assert.equal(plugin.registration.sources.wy.name, "Splayer-UnblockMusic");
  assert.deepEqual([...plugin.registration.sources.wy.actions], ["musicUrl"]);
  assert.deepEqual(
    Array.from(plugin.registration.settings, (item) => item.key),
    ["sourceOrder", "preferLossless", "sidecarEnabled", "endpoint", "token"],
  );
  assert.equal(
    plugin.registration.settings.find((item) => item.key === "sidecarEnabled").default,
    false,
  );
  assert.deepEqual(Object.keys(plugin.settingHandlers), [
    "sourceOrder",
    "preferLossless",
    "sidecarEnabled",
    "endpoint",
    "token",
  ]);
});

test("内部音源达到目标音质时不调用已启用的 sidecar", async () => {
  const { request, calls } = createBuiltinRouter();
  const plugin = await loadPlugin({
    settings: { sidecarEnabled: true, token: "secret" },
    request,
  });

  await plugin.handlers.musicUrl(track);
  assert.equal(calls.sidecar, 0);
});

test("sidecar 未运行时仍可通过内置波点音源解析", async () => {
  const { request, calls } = createBuiltinRouter();
  const plugin = await loadPlugin({ request });
  const result = await plugin.handlers.musicUrl(track);

  assert.equal(result.url, "https://cdn.test/song.flac");
  assert.equal(result.quality, "lossless");
  assert.equal(calls.sidecar, 0);
  assert.equal(calls.audio, 1);
  assert.equal(calls.probe, 1);
  assert.ok(plugin.logs.some(([level]) => level === "info"));
});

test("相同歌曲命中播放结果缓存并复用并发请求", async () => {
  const { request, calls } = createBuiltinRouter();
  const plugin = await loadPlugin({ request });
  const [first, second] = await Promise.all([
    plugin.handlers.musicUrl(track),
    plugin.handlers.musicUrl(track),
  ]);
  const third = await plugin.handlers.musicUrl(track);

  assert.equal(first.url, second.url);
  assert.equal(third.url, first.url);
  assert.equal(calls.ad, 1);
  assert.equal(calls.audio, 1);
  assert.equal(calls.probe, 1);
});

test("启用设置后 sidecar 仅在内置音源失败时兜底", async () => {
  const calls = [];
  const plugin = await loadPlugin({
    settings: {
      sidecarEnabled: false,
      endpoint: "http://sidecar.test",
      token: "secret",
    },
    request: async (url, options) => {
      calls.push({ url, options });
      if (url.includes("search.kuwo.cn") || url.includes("mobilecdn.kugou.com")) {
        return { status: 200, headers: {}, body: {} };
      }
      if (url === "http://sidecar.test/v1/resolve") {
        return {
          status: 200,
          headers: {},
          body: {
            url: "https://cdn.test/ytdlp.webm",
            quality: "hq",
            provider: "ytdlp",
            bitrate: 320_000,
          },
        };
      }
      throw new Error(`未预期的请求: ${url}`);
    },
  });
  plugin.changeSetting("sidecarEnabled", true);

  const result = await plugin.handlers.musicUrl({ ...track, quality: "hq" });
  const sidecarRequest = calls.find((item) => item.url === "http://sidecar.test/v1/resolve");
  assert.equal(result.url, "https://cdn.test/ytdlp.webm");
  assert.equal(result.quality, "hq");
  assert.equal(sidecarRequest.options.headers.Authorization, "Bearer secret");
  assert.equal(JSON.parse(sidecarRequest.options.body).id, "186016");
});

test("纯 JS provider 可识别 MP3 实际音质", async () => {
  const plugin = await loadPlugin({
    settings: { sourceOrder: "kuwo" },
    request: async (url) => {
      if (url.includes("search.kuwo.cn")) {
        return { status: 200, headers: {}, body: KUWO_SEARCH_BODY };
      }
      if (url.includes("antiserver.kuwo.cn")) {
        return { status: 200, headers: {}, body: "https://cdn.test/song.mp3" };
      }
      if (url.includes("cdn.test/song.mp3")) return mp3Response(url);
      throw new Error(`未预期的请求: ${url}`);
    },
  });

  const result = await plugin.handlers.musicUrl({ ...track, quality: "hq" });
  assert.equal(result.quality, "lq");
});
