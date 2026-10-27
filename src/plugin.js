import { getTrackInfo } from "./metadata.js";
import { createMusicResolver } from "./music-resolver.js";
import { createPromiseCache } from "./promise-cache.js";
import { PROVIDERS } from "./providers/index.js";
import { createRequestClient } from "./request-client.js";
import { createSidecarClient } from "./sidecar-client.js";
import {
  DEFAULT_ENDPOINT,
  DEFAULT_SOURCE_ORDER,
  parseSourceOrder,
  PLUGIN_SETTINGS,
} from "./settings.js";
import { QUALITIES } from "./quality.js";

const BUILTIN_PROVIDER_TIMEOUT = 3_000;

/**
 * 读取非空字符串设置
 * @param key - 设置键
 * @param fallback - 默认值
 * @returns 去除首尾空白的设置值
 */
const readStringSetting = (key, fallback) => {
  const value = splayer.getSetting(key);
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
};

/**
 * 读取布尔设置
 * @param key - 设置键
 * @param fallback - 默认值
 * @returns 布尔设置值
 */
const readBooleanSetting = (key, fallback) => {
  const value = splayer.getSetting(key);
  return typeof value === "boolean" ? value : fallback;
};

/**
 * 读取网易云歌曲 ID
 * @param musicInfo - 宿主歌曲信息
 * @returns 数字歌曲 ID
 */
const getSongId = (musicInfo) => {
  for (const field of ["id", "songmid", "songId"]) {
    const value = musicInfo?.[field];
    if (typeof value === "string" && /^\d+$/.test(value.trim())) return value.trim();
    if (typeof value === "number" && Number.isSafeInteger(value)) return String(value);
  }
  throw new Error("宿主未提供有效的网易云数字歌曲 ID");
};

const requestClient = createRequestClient(
  (url, options) => splayer.request(url, options),
  BUILTIN_PROVIDER_TIMEOUT,
);
const searchCache = createPromiseCache(128);
const runtimeContext = {
  request: requestClient,
  md5: (value) => splayer.utils.crypto.md5(value),
  searchCache,
  log: splayer.log,
};
const resolver = createMusicResolver({
  providers: PROVIDERS,
  context: runtimeContext,
  log: splayer.log,
});
const sidecarClient = createSidecarClient(requestClient);

/**
 * 读取当前插件配置
 * @returns 音源顺序、无损偏好与 sidecar 配置
 */
const getConfig = () => {
  const endpoint = readStringSetting("endpoint", DEFAULT_ENDPOINT).replace(/\/+$/, "");
  const token = readStringSetting("token", "");
  const sidecarEnabled = readBooleanSetting("sidecarEnabled", false);
  return {
    sourceOrder: parseSourceOrder(readStringSetting("sourceOrder", DEFAULT_SOURCE_ORDER)),
    preferLossless: readBooleanSetting("preferLossless", true),
    sidecarEnabled,
    endpoint,
    token,
    signature: JSON.stringify([
      readStringSetting("sourceOrder", DEFAULT_SOURCE_ORDER),
      readBooleanSetting("preferLossless", true),
      sidecarEnabled,
      endpoint,
      token,
    ]),
  };
};

/**
 * 解析 SPlayer 的网易云播放地址请求
 * @param request - 宿主请求
 * @returns 播放地址与音质
 */
const handleMusicUrl = async ({ source, quality = "hq", musicInfo }) => {
  if (source !== "wy") throw new Error(`Splayer-UnblockMusic 不支持来源：${source}`);
  const songId = getSongId(musicInfo);
  const config = getConfig();
  const info = await getTrackInfo(musicInfo, songId, requestClient);
  const sidecar = config.sidecarEnabled
    ? {
        resolve: (trackInfo, requestedQuality, timeout) =>
          sidecarClient.resolve(
            trackInfo,
            requestedQuality,
            timeout,
            config.endpoint,
            config.token,
          ),
      }
    : null;
  const result = await resolver.resolve({
    info,
    quality,
    sourceOrder: config.sourceOrder,
    preferLossless: config.preferLossless,
    sidecar,
    signature: `${config.signature}\n${sidecarClient.signature(config.endpoint, config.token)}`,
  });
  return {
    url: result.url,
    quality: result.quality,
    ...(Number.isFinite(result.expire) ? { expire: result.expire } : {}),
  };
};

splayer.register({
  sources: {
    wy: {
      name: "Splayer-UnblockMusic",
      actions: ["musicUrl"],
      qualities: [...QUALITIES],
    },
  },
  settings: PLUGIN_SETTINGS,
});

for (const setting of PLUGIN_SETTINGS) {
  splayer.onSettingChange(setting.key, () => {
    resolver.clear();
    searchCache.clear();
  });
}

splayer.on("musicUrl", handleMusicUrl);
