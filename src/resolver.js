import { createError, errorMessage } from "./errors.js";
import { meetsQuality, normalizeQuality } from "./quality.js";

export const RESOLUTION_BUDGET = 16_000;
export const CACHE_TTL = 60_000;
export const CACHE_LIMIT = 128;

/**
 * 为 yt-dlp 调用设置总时间上限
 * @param promise - yt-dlp 调用
 * @param timeout - 超时时间
 * @returns 解析结果
 */
const withTimeout = (promise, timeout) =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(createError("yt-dlp 解析超时", "YTDLP_TIMEOUT"));
    }, timeout);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });

/**
 * 创建带缓存与并发复用的 yt-dlp 解析器
 * @param options - yt-dlp 调用、关键词回退与日志
 * @returns sidecar 解析器
 */
export const createResolver = ({
  run,
  resolveKeyword,
  logger = console,
  now = () => Date.now(),
  resolutionBudget = RESOLUTION_BUDGET,
}) => {
  if (typeof run !== "function") throw new TypeError("run 必须是函数");
  if (typeof resolveKeyword !== "function") throw new TypeError("resolveKeyword 必须是函数");

  const cache = new Map();
  const pending = new Map();

  /**
   * 读取未过期的播放结果
   * @param key - 缓存键
   * @returns 缓存结果或 undefined
   */
  const readCache = (key) => {
    const entry = cache.get(key);
    if (!entry) return undefined;
    if (entry.until <= now()) {
      cache.delete(key);
      return undefined;
    }
    cache.delete(key);
    cache.set(key, entry);
    return entry.value;
  };

  /**
   * 写入有界播放结果缓存
   * @param key - 缓存键
   * @param value - 播放结果
   */
  const writeCache = (key, value) => {
    cache.delete(key);
    while (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value);
    cache.set(key, { value, until: now() + CACHE_TTL });
  };

  return {
    /**
     * 解析网易云歌曲的 YouTube 播放地址
     * @param input - 歌曲 ID、音质与可选关键词
     * @returns 播放结果
     */
    async resolve({ id, quality = "hq", keyword = "" }) {
      const songId = String(id ?? "").trim();
      if (!/^\d+$/.test(songId)) {
        throw createError("歌曲 ID 必须是网易云数字 ID", "INVALID_ID");
      }
      const requestedQuality = normalizeQuality(quality);
      const query = String(keyword ?? "").trim() || (await resolveKeyword(songId));
      const key = JSON.stringify([songId, requestedQuality, query]);
      const cached = readCache(key);
      if (cached) return { ...cached, cached: true };
      const active = pending.get(key);
      if (active) return active;

      const operation = withTimeout(
        run(query, resolutionBudget, requestedQuality),
        resolutionBudget,
      )
        .then((result) => {
          const normalized = {
            ...result,
            requestedQuality,
            degraded: !meetsQuality(result, requestedQuality),
            cached: false,
          };
          writeCache(key, normalized);
          logger.info(`《${query}》由 yt-dlp 解析，音质 ${normalized.quality}`);
          if (normalized.degraded) logger.warn("yt-dlp 未达到请求音质，已返回实际可用音质");
          return normalized;
        })
        .catch((error) => {
          logger.warn(`[unblockmusic:ytdlp] ${errorMessage(error)}`);
          throw error;
        })
        .finally(() => {
          if (pending.get(key) === operation) pending.delete(key);
        });

      if (pending.size < CACHE_LIMIT) pending.set(key, operation);
      return operation;
    },
  };
};
