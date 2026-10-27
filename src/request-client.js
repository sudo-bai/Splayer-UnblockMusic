import { createError } from "./errors.js";

/**
 * 创建基于 SPlayer 公开网络 API 的请求客户端
 * @param request - 宿主 splayer.request
 * @param timeout - 单次请求超时
 * @returns JSON、文本与二进制请求方法
 */
export const createRequestClient = (request, timeout = 3_000) => {
  const send = async (url, options, expected, allowHttpErrors = false) => {
    let response;
    try {
      response = await request(url, { ...options, timeout: options.timeout ?? timeout });
    } catch (error) {
      throw createError(`网络请求失败：${new URL(url).hostname}`, "REQUEST_FAILED", error);
    }
    if (!allowHttpErrors && (response.status < 200 || response.status > 299)) {
      throw createError(`HTTP ${response.status}：${new URL(url).hostname}`, "HTTP_ERROR");
    }
    if (expected === "json" && typeof response.body === "string") {
      try {
        return { ...response, body: JSON.parse(response.body) };
      } catch (error) {
        throw createError(`响应不是有效 JSON：${new URL(url).hostname}`, "INVALID_JSON", error);
      }
    }
    return response;
  };

  return {
    /**
     * 请求并解析 JSON 响应
     * @param url - 请求地址
     * @param options - SPlayer 请求选项
     * @param allowHttpErrors - 是否返回非 2xx 响应
     * @returns 宿主响应
     */
    json: (url, options = {}, allowHttpErrors = false) =>
      send(url, { ...options, responseType: "json" }, "json", allowHttpErrors),
    /**
     * 请求文本响应
     * @param url - 请求地址
     * @param options - SPlayer 请求选项
     * @returns 宿主响应
     */
    text: (url, options = {}) => send(url, { ...options, responseType: "text" }, "text"),
    /**
     * 请求二进制响应
     * @param url - 请求地址
     * @param options - SPlayer 请求选项
     * @returns 宿主响应
     */
    bytes: (url, options = {}) => send(url, { ...options, responseType: "arraybuffer" }, "bytes"),
  };
};
