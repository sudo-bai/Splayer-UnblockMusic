export const DEFAULT_PORT = 18_321;

/**
 * 读取整数环境变量
 * @param value - 环境变量原值
 * @param fallback - 无效或未设置时的默认值
 * @returns 解析后的整数
 */
const readInteger = (value, fallback) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : fallback;
};

/**
 * 读取 sidecar 配置
 * @param env - 环境变量对象
 * @returns sidecar 运行配置
 */
export const loadConfig = (env = process.env) => {
  const port = readInteger(env.UNM_PORT, DEFAULT_PORT);
  if (port < 1 || port > 65_535) throw new Error(`UNM_PORT 无效: ${env.UNM_PORT}`);

  return {
    host: String(env.UNM_HOST ?? "127.0.0.1").trim() || "127.0.0.1",
    port,
    token: String(env.UNM_TOKEN ?? "").trim(),
    ytdlpPath: String(env.YTDLP_PATH ?? "yt-dlp").trim() || "yt-dlp",
    ytdlpCookies: String(env.YTDLP_COOKIES ?? "").trim(),
    ytdlpCookiesFromBrowser: String(env.YTDLP_COOKIES_FROM_BROWSER ?? "").trim(),
    logLevel: String(env.LOG_LEVEL ?? "warn").trim() || "warn",
  };
};
