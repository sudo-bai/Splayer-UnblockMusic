/**
 * 创建有界 TTL Promise 缓存
 * @param limit - 最大缓存项
 * @param now - 当前时间函数
 * @returns 支持并发复用的缓存
 */
export const createPromiseCache = (limit = 128, now = () => Date.now()) => {
  const cache = new Map();

  /**
   * 读取未过期的缓存
   * @param key - 缓存键
   * @returns 缓存条目或 undefined
   */
  const read = (key) => {
    const entry = cache.get(key);
    if (!entry) return undefined;
    if (entry.until <= now()) {
      cache.delete(key);
      return undefined;
    }
    cache.delete(key);
    cache.set(key, entry);
    return entry;
  };

  return {
    /**
     * 获取缓存值，未命中时执行加载函数
     * @param key - 缓存键
     * @param loader - 异步加载函数
     * @param ttl - 缓存时长
     * @returns 加载结果
     */
    async get(key, loader, ttl = 60_000) {
      const cached = read(key);
      if (cached) return cached.value;

      const value = Promise.resolve().then(loader);
      while (cache.size >= limit) cache.delete(cache.keys().next().value);
      cache.set(key, { value, until: now() + ttl });
      try {
        return await value;
      } catch (error) {
        cache.delete(key);
        throw error;
      }
    },
    /**
     * 清空全部缓存
     */
    clear() {
      cache.clear();
    },
  };
};
