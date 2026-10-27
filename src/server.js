import crypto from "node:crypto";
import http from "node:http";

export const MAX_BODY_SIZE = 16 * 1024;
export const MAX_CONCURRENT_RESOLVES = 2;

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
export const createSidecarServer = ({ resolver, token = "", version, sources, ytdlp }) => {
  if (!resolver || typeof resolver.resolve !== "function") {
    throw new TypeError("resolver.resolve 必须是函数");
  }

  let activeResolves = 0;
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");

    if (req.method === "GET" && url.pathname === "/health") {
      sendJson(res, 200, {
        ok: true,
        version,
        sources,
        ytdlp,
        activeResolves,
      });
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
      });
      sendJson(res, 200, result);
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
