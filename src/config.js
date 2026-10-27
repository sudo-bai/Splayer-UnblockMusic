import path from "node:path";

export const DEFAULT_PORT = 18_321;
export const DEFAULT_SOURCES = ["ytdlp"];
export const ALLOWED_SOURCES = new Set([
  "qq",
  "kugou",
  "kuwo",
  "bodian",
  "migu",
  "joox",
  "youtube",
  "youtubedl",
  "ytdlp",
  "bilibili",
  "bilivideo",
  "pyncmd",
]);

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
 * 解析并校验 UNM 音源列表
 * @param value - 逗号分隔的音源名称
 * @returns 去重后的有效音源列表
 */
export const parseSources = (value) => {
  const parsed = String(value ?? "")
    .split(",")
    .map((source) => source.trim().toLowerCase())
    .filter(Boolean);
  const sources = [...new Set(parsed.filter((source) => ALLOWED_SOURCES.has(source)))];
  return sources.length > 0 ? sources : [...DEFAULT_SOURCES];
};

/**
 * 读取 sidecar 配置
 * @param env - 环境变量对象
 * @returns sidecar 运行配置
 */
export const loadConfig = (env = process.env) => {
  const port = readInteger(env.UNM_PORT, DEFAULT_PORT);
  if (port < 1 || port > 65_535) throw new Error(`UNM_PORT 无效: ${env.UNM_PORT}`);

  const minBitrate = readInteger(env.UNM_MIN_BITRATE, 0);
  const ytdlpPath = String(env.YTDLP_PATH ?? "").trim();
  if (ytdlpPath) {
    process.env.PATH = `${path.dirname(ytdlpPath)}${path.delimiter}${process.env.PATH ?? ""}`;
  }

  return {
    host: String(env.UNM_HOST ?? "127.0.0.1").trim() || "127.0.0.1",
    port,
    token: String(env.UNM_TOKEN ?? "").trim(),
    sources: parseSources(env.UNM_SOURCES),
    enableFlac: String(env.ENABLE_FLAC ?? "true").toLowerCase() !== "false",
    minBitrate: Math.max(0, minBitrate),
  };
};
