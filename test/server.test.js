import assert from "node:assert/strict";
import http from "node:http";
import { once } from "node:events";
import { test } from "node:test";
import { createSidecarServer } from "../src/server.js";

/**
 * 在随机本机端口启动测试服务
 * @param options - 服务配置
 * @returns 服务地址与关闭方法
 */
const listen = async (options) => {
  const server = createSidecarServer(options);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
};

test("健康检查不需要认证", async () => {
  const service = await listen({
    resolver: { resolve: async () => ({ url: "https://cdn.test/song.m4a" }) },
    token: "secret",
    version: "0.3.0",
    ytdlp: { available: true, version: "2026.10.26" },
    cookiesConfigured: true,
  });
  try {
    const response = await fetch(`${service.baseUrl}/health`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      ok: true,
      version: "0.3.0",
      sources: ["ytdlp"],
      ytdlp: { available: true, version: "2026.10.26" },
      cookiesConfigured: true,
      activeResolves: 0,
    });
  } finally {
    await service.close();
  }
});

test("解析接口校验 Token 并传递关键词", async () => {
  const requests = [];
  const service = await listen({
    resolver: {
      resolve: async (input) => {
        requests.push(input);
        return { url: "https://cdn.test/song.m4a", quality: "lq", provider: "ytdlp" };
      },
    },
    token: "secret",
    version: "0.3.0",
    ytdlp: { available: true, version: "2026.10.26" },
    cookiesConfigured: true,
  });
  try {
    const unauthorized = await fetch(`${service.baseUrl}/v1/resolve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: "186016", quality: "lossless" }),
    });
    assert.equal(unauthorized.status, 401);

    const response = await fetch(`${service.baseUrl}/v1/resolve`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer secret",
      },
      body: JSON.stringify({
        id: "186016",
        quality: "lossless",
        keyword: "晴天 - 周杰伦",
      }),
    });
    assert.equal(response.status, 200);
    assert.deepEqual(requests, [{ id: "186016", quality: "lossless", keyword: "晴天 - 周杰伦" }]);
    assert.equal((await response.json()).provider, "ytdlp");
  } finally {
    await service.close();
  }
});

test("解析错误返回稳定错误码", async () => {
  const service = await listen({
    resolver: {
      resolve: async () => {
        throw Object.assign(new Error("需要 Cookie"), { code: "YTDLP_COOKIE_REQUIRED" });
      },
    },
    version: "0.3.0",
    ytdlp: { available: true, version: "2026.10.26" },
    cookiesConfigured: false,
  });
  try {
    const response = await fetch(`${service.baseUrl}/v1/resolve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: "186016", quality: "hq" }),
    });
    assert.equal(response.status, 502);
    assert.deepEqual(await response.json(), {
      error: "YTDLP_COOKIE_REQUIRED",
      message: "需要 Cookie",
    });
  } finally {
    await service.close();
  }
});

test("返回本地代理地址并透传 Range 请求", async () => {
  let seenRange = "";
  const upstream = http.createServer((req, res) => {
    seenRange = String(req.headers.range ?? "");
    res.writeHead(206, {
      "Content-Type": "audio/webm",
      "Content-Range": "bytes 0-3/100",
      "Content-Length": "4",
      "Accept-Ranges": "bytes",
    });
    res.end(Buffer.from([1, 2, 3, 4]));
  });
  upstream.listen(0, "127.0.0.1");
  await once(upstream, "listening");
  const upstreamAddress = upstream.address();
  const upstreamUrl = `http://127.0.0.1:${upstreamAddress.port}/audio`;

  const service = await listen({
    resolver: {
      resolve: async () => ({
        url: upstreamUrl,
        quality: "lq",
        provider: "ytdlp",
        expire: Date.now() + 60_000,
      }),
    },
    version: "0.3.0",
    ytdlp: { available: true, version: "2026.10.26" },
    cookiesConfigured: true,
  });

  try {
    const resolved = await fetch(`${service.baseUrl}/v1/resolve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: "186016", quality: "hq", keyword: "晴天 - 周杰伦" }),
    });
    const body = await resolved.json();
    assert.match(body.url, /^http:\/\/127\.0\.0\.1:\d+\/v1\/audio\/[a-f0-9]{32}$/);

    const audio = await fetch(body.url, { headers: { Range: "bytes=0-3" } });
    assert.equal(audio.status, 206);
    assert.equal(seenRange, "bytes=0-3");
    assert.deepEqual([...new Uint8Array(await audio.arrayBuffer())], [1, 2, 3, 4]);
  } finally {
    await service.close();
    await new Promise((resolve) => upstream.close(resolve));
  }
});

test("音频代理遇到 403 时切换请求头重试", async () => {
  let attempts = 0;
  const upstream = http.createServer((req, res) => {
    attempts += 1;
    if (req.headers["user-agent"] === "Lavf/62.12.101") {
      res.writeHead(403);
      res.end("forbidden");
      return;
    }
    res.writeHead(206, {
      "Content-Type": "audio/webm",
      "Content-Range": "bytes 0-3/100",
      "Content-Length": "4",
    });
    res.end(Buffer.from([9, 8, 7, 6]));
  });
  upstream.listen(0, "127.0.0.1");
  await once(upstream, "listening");
  const address = upstream.address();
  const service = await listen({
    resolver: {
      resolve: async () => ({
        url: `http://127.0.0.1:${address.port}/audio`,
        quality: "lq",
        provider: "ytdlp",
      }),
    },
    version: "0.3.1",
    ytdlp: { available: true, version: "2026.10.26" },
    cookiesConfigured: true,
  });
  try {
    const resolved = await fetch(`${service.baseUrl}/v1/resolve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: "186016", quality: "hq", keyword: "晴天 - 周杰伦" }),
    });
    const { url } = await resolved.json();
    const response = await fetch(url, { headers: { Range: "bytes=0-3" } });
    assert.equal(response.status, 206);
    assert.equal(attempts, 2);
    assert.deepEqual([...new Uint8Array(await response.arrayBuffer())], [9, 8, 7, 6]);
  } finally {
    await service.close();
    await new Promise((resolve) => upstream.close(resolve));
  }
});
