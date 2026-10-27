export const CACHE_LIMIT = 128;
export const CACHE_TTL = 60_000;
export const RESOLUTION_BUDGET = 16_500;
export const SOURCE_TIMEOUT = 5_000;
export const YTDLP_TIMEOUT = 9_000;

export const QUALITY_MIN_BITRATE = {
  lq: 0,
  sq: 192_000,
  hq: 320_000,
  lossless: 900_000,
  "hi-res": 1_411_200,
};

/**
 * 把音频码率映射为 SPlayer 音质档位
 * @param bitrate - UNM 探测到的码率
 * @returns SPlayer 音质档位，未知时返回 undefined
 */
export const mapQuality = (bitrate) => {
  if (!Number.isFinite(bitrate) || bitrate <= 0) return undefined;
  if (bitrate >= 1_411_200) return "hi-res";
  if (bitrate >= 900_000) return "lossless";
  if (bitrate >= 320_000) return "hq";
  if (bitrate >= 192_000) return "sq";
  return "lq";
};

/**
 * 为单个音源调用设置时间上限
 * @param promise - UNM 音源调用
 * @param timeoutMs - 超时时间
 * @param source - 音源名称
 * @returns 音源解析结果
 */
const withTimeout = (promise, timeoutMs, source) =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(Object.assign(new Error(`${source} 解析超时`), { code: "UNM_SOURCE_TIMEOUT" }));
    }, timeoutMs);
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
 * 创建带缓存、并发复用和音源降级的 UNM 解析器
 * @param options - 解析器依赖与默认配置
 * @returns UNM 解析器
 */
export const createResolver = ({
  match,
  sources,
  enableFlac,
  minBitrate = 0,
  now = () => Date.now(),
  logger = console,
}) => {
  if (typeof match !== "function") throw new TypeError("match 必须是函数");
  if (!Array.isArray(sources) || sources.length === 0) throw new Error("至少需要一个 UNM 音源");

  const cache = new Map();
  const pending = new Map();

  /**
   * 读取未过期的解析缓存
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
   * 写入有界解析缓存
   * @param key - 缓存键
   * @param value - 解析结果
   */
  const writeCache = (key, value) => {
    cache.delete(key);
    while (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value);
    cache.set(key, { value, until: now() + CACHE_TTL });
  };

  return {
    /**
     * 解析网易云歌曲的可用播放地址
     * @param input - 歌曲 ID 与期望音质
     * @returns 解析结果
     */
    async resolve({ id, quality = "hq" }) {
      const songId = String(id ?? "").trim();
      if (!/^\d+$/.test(songId)) {
        throw Object.assign(new Error("歌曲 ID 必须是网易云数字 ID"), { code: "UNM_INVALID_ID" });
      }

      const requestedQuality = Object.hasOwn(QUALITY_MIN_BITRATE, quality) ? quality : "hq";
      const requiredBitrate = Math.max(minBitrate, QUALITY_MIN_BITRATE[requestedQuality]);
      const key = JSON.stringify([songId, requestedQuality, requiredBitrate]);
      const cached = readCache(key);
      if (cached) return { ...cached, cached: true };
      const active = pending.get(key);
      if (active) return active;

      const operation = (async () => {
        const deadline = now() + RESOLUTION_BUDGET;
        const failures = [];
        let best = null;

        for (const source of sources) {
          const remaining = deadline - now();
          if (remaining <= 0) break;
          const timeout = Math.max(
            1,
            Math.min(
              source === "ytdlp" || source === "youtubedl" ? YTDLP_TIMEOUT : SOURCE_TIMEOUT,
              remaining,
            ),
          );

          try {
            const result = await withTimeout(match(songId, [source]), timeout, source);
            if (!result?.url || typeof result.url !== "string") {
              throw new Error("未返回播放地址");
            }
            if (!best || Number(result.br) > Number(best.br)) best = result;
            if (!requiredBitrate || Number(result.br) >= requiredBitrate) break;
          } catch (error) {
            failures.push(`${source}: ${error instanceof Error ? error.message : String(error)}`);
            logger.warn(
              `[unblockmusic:${source}] ${error instanceof Error ? error.message : String(error)}`,
            );
          }
        }

        if (!best) {
          throw Object.assign(
            new Error(
              `所有 UNM 音源均未解析成功${failures.length ? `：${failures.join("；")}` : ""}`,
            ),
            { code: "UNM_NO_SOURCE" },
          );
        }

        const bitrate = Number.isFinite(Number(best.br)) ? Number(best.br) : null;
        const result = {
          url: best.url,
          provider: best.source,
          bitrate,
          size: Number.isFinite(Number(best.size)) ? Number(best.size) : null,
          quality: mapQuality(bitrate) ?? requestedQuality,
          requestedQuality,
          flac: Boolean(enableFlac),
          degraded: Boolean(requiredBitrate && bitrate && bitrate < requiredBitrate),
          cached: false,
        };
        writeCache(key, result);
        return result;
      })();

      if (pending.size >= CACHE_LIMIT) return operation;
      pending.set(key, operation);
      try {
        return await operation;
      } finally {
        if (pending.get(key) === operation) pending.delete(key);
      }
    },
  };
};
