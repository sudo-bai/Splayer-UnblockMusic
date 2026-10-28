import crypto from "node:crypto";
import http from "node:http";
import { Readable } from "node:stream";

export const MAX_BODY_SIZE = 16 * 1024;
export const MAX_CONCURRENT_RESOLVES = 2;
const AUDIO_SESSION_LIMIT = 128;
const AUDIO_SESSION_TTL = 30 * 60_000;

/**
 * 发送 JSON 响应
 * @param res - HTTP 响应
 * @param status - HTTP 状态码
 * @param body - 响应正文
 */
const sendJson = (res, status, body) => {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload),
    "Cache-Control": "no-store",
  });
  res.end(payload);
};

/**
 * 读取并解析 JSON 请求体
 * @param req - HTTP 请求
 * @returns 解析后的 JSON 对象
 */
const readJsonBody = async (req) => {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_SIZE) {
      throw Object.assign(new Error("请求体过大"), { status: 413 });
    }
    chunks.push(chunk);
  }
  if (size === 0) return {};
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("请求体必须是 JSON 对象");
    }
    return value;
  } catch (error) {
    throw Object.assign(new Error("请求体不是有效 JSON"), {
      status: 400,
      cause: error,
    });
  }
};

/**
 * 使用恒定时间比较校验 Bearer Token
 * @param req - HTTP 请求
 * @param token - 服务端配置的 Token
 * @returns 是否通过校验
 */
export const authorize = (req, token) => {
  if (!token) return true;
  const value = req.headers.authorization ?? "";
  if (!value.startsWith("Bearer ")) return false;
  const provided = Buffer.from(value.slice(7));
  const expected = Buffer.from(token);
  return provided.length === expected.length && crypto.timingSafeEqual(provided, expected);
};

/**
 * 创建 Splayer-UnblockMusic sidecar HTTP 服务
 * @param options - 解析器、认证与运行信息
 * @returns Node HTTP 服务
 */
export const createSidecarServer = ({
  resolver,
  token = "",
  version,
  ytdlp,
  cookiesConfigured = false,
}) => {
  if (!resolver || typeof resolver.resolve !== "function") {
    throw new TypeError("resolver.resolve 必须是函数");
  }

  let activeResolves = 0;
  const audioSessions = new Map();

  /**
   * 清理过期的音频代理会话
   */
  const cleanAudioSessions = () => {
    const now = Date.now();
    for (const [id, session] of audioSessions) {
      if (session.expiresAt <= now) audioSessions.delete(id);
    }
  };

  /**
   * 注册一个本地音频代理会话
   * @param upstreamUrl - yt-dlp 返回的上游播放地址
   * @param expire - 上游地址过期时间
   * @returns 会话 ID
   */
  const createAudioSession = (upstreamUrl, expire) => {
    cleanAudioSessions();
    while (audioSessions.size >= AUDIO_SESSION_LIMIT) {
      audioSessions.delete(audioSessions.keys().next().value);
    }
    const id = crypto.randomBytes(16).toString("hex");
    audioSessions.set(id, {
      upstreamUrl,
      expiresAt: Math.min(
        Date.now() + AUDIO_SESSION_TTL,
        Number.isFinite(expire) && expire > Date.now() ? expire : Number.POSITIVE_INFINITY,
      ),
    });
    return id;
  };

  /**
   * 代理上游音频并透传 Range 请求
   * @param req - 客户端请求
   * @param res - 客户端响应
   * @param upstreamUrl - 上游播放地址
   */
  const proxyAudio = async (req, res, upstreamUrl) => {
    const range = typeof req.headers.range === "string" ? req.headers.range : "bytes=0-";
    const request = (userAgent) =>
      fetch(upstreamUrl, {
        headers: {
          Range: range,
          "User-Agent": userAgent,
          "Accept-Encoding": "identity",
        },
        redirect: "follow",
      });

    const userAgents = [
      "Lavf/62.12.101",
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/121.0.0.0 Safari/537.36",
      "Mozilla/5.0",
    ];
    let upstream;
    for (const [index, userAgent] of userAgents.entries()) {
      try {
        upstream = await request(userAgent);
      } catch {
        sendJson(res, 502, { error: "audio_proxy_failed" });
        return;
      }
      if (upstream.status !== 403 || index === userAgents.length - 1) break;
      await upstream.body?.cancel().catch(() => {});
      await new Promise((resolve) => setTimeout(resolve, 200));
    }

    if (upstream.status !== 206 && upstream.status !== 200) {
      sendJson(res, 502, { error: `audio_upstream_${upstream.status}` });
      return;
    }

    const headers = {};
    for (const name of [
      "content-type",
      "content-length",
      "content-range",
      "accept-ranges",
      "cache-control",
      "last-modified",
      "etag",
    ]) {
      const value = upstream.headers.get(name);
      if (value) headers[name] = value;
    }
    res.writeHead(upstream.status, headers);
    if (!upstream.body) {
      res.end();
      return;
    }
    Readable.fromWeb(upstream.body)
      .on("error", () => res.destroy())
      .pipe(res);
  };

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");

    if (req.method === "GET" && url.pathname === "/health") {
      sendJson(res, 200, {
        ok: true,
        version,
        sources: ["ytdlp"],
        ytdlp,
        cookiesConfigured,
        activeResolves,
      });
      return;
    }

    const audioMatch = /^\/v1\/audio\/([a-f0-9]{32})$/.exec(url.pathname);
    if (req.method === "GET" && audioMatch) {
      const session = audioSessions.get(audioMatch[1]);
      if (!session || session.expiresAt <= Date.now()) {
        if (session) audioSessions.delete(audioMatch[1]);
        sendJson(res, 404, { error: "audio_session_not_found" });
        return;
      }
      await proxyAudio(req, res, session.upstreamUrl);
      return;
    }

    if (req.method !== "POST" || url.pathname !== "/v1/resolve") {
      sendJson(res, 404, { error: "not_found" });
      return;
    }

    if (!authorize(req, token)) {
      sendJson(res, 401, { error: "unauthorized" });
      return;
    }

    if (activeResolves >= MAX_CONCURRENT_RESOLVES) {
      sendJson(res, 429, { error: "busy" });
      return;
    }

    activeResolves += 1;
    try {
      const body = await readJsonBody(req);
      const result = await resolver.resolve({
        id: body.id,
        quality: typeof body.quality === "string" ? body.quality : "hq",
        keyword: typeof body.keyword === "string" ? body.keyword : "",
      });
      const sessionId = createAudioSession(result.url, result.expire);
      const host = req.headers.host || "127.0.0.1";
      sendJson(res, 200, {
        ...result,
        upstreamUrl: undefined,
        url: `http://${host}/v1/audio/${sessionId}`,
      });
    } catch (error) {
      const status = Number(error?.status) || 502;
      sendJson(res, status, {
        error: error?.code ?? "resolve_failed",
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      activeResolves -= 1;
    }
  });

  server.requestTimeout = 25_000;
  server.headersTimeout = 10_000;
  server.on("clientError", (_error, socket) => {
    socket.end("HTTP/1.1 400 Bad Request\r\n\r\n");
  });
  return server;
};
