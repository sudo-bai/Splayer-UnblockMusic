import assert from "node:assert/strict";
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
