import { createError, errorMessage } from "./errors.js";
import { mapQuality, meetsQuality, normalizeQuality, pickBetterResult } from "./quality.js";

export const RESOLUTION_BUDGET = 16_000;
export const RESULT_CACHE_TTL = 60_000;
export const RESULT_CACHE_LIMIT = 128;
export const DEFAULT_SOURCE_TIMEOUTS = {
  bodian: 5_000,
  kugou: 4_500,
  kuwo: 3_500,
  sidecar: 5_000,
};

/**
 * 为异步操作设置超时
 * @param promise - 待执行操作
 * @param timeout - 超时时间
 * @param source - 音源名称
 * @returns 操作结果
 */
const withTimeout = (promise, timeout, source) =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(createError(`${source} 解析超时`, "SOURCE_TIMEOUT"));
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
 * 规范化音源返回结果
 * @param result - 音源返回结果
 * @param source - 音源名称
 * @returns 带音质信息的统一结果
 */
const normalizeResult = (result, source) => {
  if (!result || typeof result.url !== "string" || !/^https?:\/\//i.test(result.url)) {
    throw createError(`${source} 返回了无效播放地址`, "INVALID_AUDIO_URL");
  }
  const bitrate = Number.isFinite(Number(result.bitrate)) ? Number(result.bitrate) : null;
  const quality = normalizeQuality(result.quality ?? mapQuality({ ...result, bitrate }));
  return {
    ...result,
    bitrate,
    quality,
    provider: typeof result.provider === "string" ? result.provider : source,
  };
};

/**
 * 创建带缓存、并发复用和可选 sidecar 兜底的网易云解析器
 * @param options - 音源实现、上下文与日志
 * @returns 网易云歌曲解析器
 */
export const createMusicResolver = ({
  providers,
  context,
  log,
  resolutionBudget = RESOLUTION_BUDGET,
  sourceTimeouts = DEFAULT_SOURCE_TIMEOUTS,
  now = () => Date.now(),
}) => {
  const cache = new Map();
  const pending = new Map();
  let generation = 0;

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
    while (cache.size >= RESULT_CACHE_LIMIT) cache.delete(cache.keys().next().value);
    cache.set(key, { value, until: now() + RESULT_CACHE_TTL });
  };

  /**
   * 执行内置音源与可选 sidecar 的完整解析
   * @param request - 解析参数
   * @returns 最终播放结果
   */
  const execute = async ({
    info,
    quality,
    sourceOrder,
    preferLossless,
    sidecar,
    signature,
    currentGeneration,
  }) => {
    const requestedQuality = normalizeQuality(quality);
    const deadline = now() + resolutionBudget;
    const failures = [];
    let best = null;

    for (const source of sourceOrder) {
      const provider = providers[source];
      if (!provider) continue;
      const remaining = deadline - now();
      if (remaining <= 0) break;
      const timeout = Math.max(
        1,
        Math.min(sourceTimeouts[source] ?? DEFAULT_SOURCE_TIMEOUTS[source] ?? 4_000, remaining),
      );
      try {
        const result = await withTimeout(
          Promise.resolve(provider(info, context, { preferLossless })),
          timeout,
          source,
        );
        const normalized = normalizeResult(result, source);
        best = pickBetterResult(best, normalized);
        if (meetsQuality(best, requestedQuality)) break;
      } catch (error) {
        failures.push(`${source}: ${errorMessage(error)}`);
        log.warn(`[${source}] ${errorMessage(error)}`);
      }
    }

    if ((!best || !meetsQuality(best, requestedQuality)) && sidecar) {
      const remaining = deadline - now();
      if (remaining >= 1_000) {
        try {
          const result = await withTimeout(
            Promise.resolve(sidecar.resolve(info, requestedQuality, Math.min(remaining, 5_000))),
            Math.min(remaining, 5_000),
            "sidecar",
          );
          if (result) best = pickBetterResult(best, normalizeResult(result, "sidecar"));
        } catch (error) {
          failures.push(`sidecar: ${errorMessage(error)}`);
          log.warn(`[sidecar] ${errorMessage(error)}`);
        }
      } else {
        failures.push("sidecar: 总时间预算不足");
      }
    }

    if (!best) {
      throw createError(
        `所有音源均未解析成功${failures.length ? `：${failures.join("；")}` : ""}`,
        "NO_AUDIO_SOURCE",
      );
    }

    const result = {
      ...best,
      requestedQuality,
      degraded: !meetsQuality(best, requestedQuality),
      cached: false,
    };
    log.info(`《${info.name}》由 ${result.provider} 解析，音质 ${result.quality}`);
    if (result.degraded) log.warn("未找到请求音质，已返回当前可用最佳音质");
    if (currentGeneration === generation) {
      writeCache(
        JSON.stringify([info.id, requestedQuality, sourceOrder, preferLossless, signature]),
        result,
      );
    }
    return result;
  };

  return {
    /**
     * 解析网易云歌曲播放地址
     * @param request - 歌曲信息、音质与当次配置
     * @returns 播放结果
     */
    async resolve(request) {
      const requestedQuality = normalizeQuality(request.quality);
      const key = JSON.stringify([
        request.info.id,
        requestedQuality,
        request.sourceOrder,
        request.preferLossless,
        request.signature,
      ]);
      const cached = readCache(key);
      if (cached) return { ...cached, cached: true };

      const active = pending.get(key);
      if (active) return active;

      const currentGeneration = generation;
      const operation = execute({
        ...request,
        quality: requestedQuality,
        currentGeneration,
      }).finally(() => {
        if (pending.get(key) === operation) pending.delete(key);
      });
      if (pending.size < RESULT_CACHE_LIMIT) pending.set(key, operation);
      return operation;
    },
    /**
     * 清空设置变更后的运行缓存
     */
    clear() {
      generation += 1;
      cache.clear();
      pending.clear();
    },
  };
};
