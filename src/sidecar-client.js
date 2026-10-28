import { createError } from "./errors.js";
import { normalizeQuality } from "./quality.js";

/**
 * 创建可选 sidecar 兜底客户端
 * @param requestClient - 网络请求客户端
 * @returns sidecar 解析与签名方法
 */
export const createSidecarClient = (requestClient) => ({
  /**
   * 生成 sidecar 配置签名
   * @param endpoint - 服务地址
   * @param token - 访问 Token
   * @returns 配置签名
   */
  signature(endpoint, token) {
    return `${endpoint}\n${token}`;
  },
  /**
   * 调用 sidecar 解析播放地址
   * @param info - 网易云歌曲信息
   * @param quality - 请求音质
   * @param timeout - 本次调用超时
   * @param endpoint - 服务地址
   * @param token - 访问 Token
   * @returns 规范化播放结果
   */
  async resolve(info, quality, timeout, endpoint, token) {
    let parsed;
    try {
      parsed = new URL(endpoint);
    } catch (error) {
      throw createError("sidecar 地址无效", "SIDECAR_ENDPOINT_INVALID", error);
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw createError("sidecar 地址只支持 http/https", "SIDECAR_ENDPOINT_INVALID");
    }

    const headers = { "Content-Type": "application/json" };
    if (token) headers.Authorization = `Bearer ${token}`;
    const response = await requestClient.json(
      `${endpoint.replace(/\/+$/, "")}/v1/resolve`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({ id: info.id, quality, keyword: info.keyword }),
        timeout,
      },
      true,
    );
    if (response.status === 401)
      throw createError("sidecar 认证失败，请检查 Token", "SIDECAR_UNAUTHORIZED");
    if (response.status === 429) throw createError("sidecar 正忙，请稍后重试", "SIDECAR_BUSY");
    const body = response.body;
    if (!body || typeof body !== "object" || typeof body.url !== "string" || !body.url) {
      const message = typeof body?.message === "string" ? body.message : `HTTP ${response.status}`;
      throw createError(`sidecar 解析失败：${message}`, "SIDECAR_RESOLVE_FAILED");
    }
    return {
      url: body.url,
      quality: normalizeQuality(body.quality ?? quality),
      provider: typeof body.provider === "string" ? body.provider : "sidecar",
      bitrate: Number.isFinite(Number(body.bitrate)) ? Number(body.bitrate) : null,
      size: Number.isFinite(Number(body.size)) ? Number(body.size) : null,
      expire: Number.isFinite(Number(body.expire)) ? Number(body.expire) : undefined,
    };
  },
});
