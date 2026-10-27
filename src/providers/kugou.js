/*
 * 接口兼容逻辑参考 UnblockNeteaseMusic/server 的 LGPL-3.0-only provider 实现
 */
import { createError } from "../errors.js";
import { pickBestCandidate, splitArtists } from "../matching.js";
import { probeAudio } from "../probe.js";

const SEARCH_TTL = 300_000;

/**
 * 把酷狗搜索项转换为统一候选
 * @param song - 酷狗搜索项
 * @returns 统一候选歌曲
 */
const formatCandidate = (song) => ({
  id: String(song.hash ?? ""),
  hqId: String(song["320hash"] ?? ""),
  sqId: String(song.sqhash ?? ""),
  name: String(song.songname ?? "").trim(),
  artists: splitArtists(song.singername),
  durationMs: Number(song.duration) * 1_000 || 0,
  albumId: String(song.album_id ?? ""),
  albumName: String(song.album_name ?? ""),
});

/**
 * 获取酷狗候选的取流地址
 * @param candidate - 酷狗候选
 * @param hash - 音频哈希
 * @param context - 插件运行上下文
 * @returns 播放地址
 */
const fetchTrackUrl = async (candidate, hash, context) => {
  if (!hash) throw createError("酷狗缺少音频哈希", "KUGOU_HASH_MISSING");
  const key = context.md5(`${hash}kgcloudv2`);
  const url =
    "http://trackercdn.kugou.com/i/v2/?" +
    `key=${key}&hash=${hash}&appid=1005&pid=2&cmd=25&behavior=play&album_id=${candidate.albumId}`;
  const response = await context.request.json(url);
  const playUrl = Array.isArray(response.body?.url) ? response.body.url[0] : null;
  if (typeof playUrl !== "string" || !playUrl) {
    throw createError("酷狗未返回播放地址", "KUGOU_URL_EMPTY");
  }
  return playUrl;
};

/**
 * 通过酷狗搜索并解析播放地址
 * @param info - 网易云歌曲信息
 * @param context - 插件运行上下文
 * @param options - 解析选项
 * @returns 音频探测结果
 */
export const resolveKugou = async (info, context, options) => {
  const candidate = await context.searchCache.get(
    `kugou:${info.keyword}`,
    async () => {
      const url =
        "http://mobilecdn.kugou.com/api/v3/search/song?" +
        `keyword=${encodeURIComponent(info.keyword)}&page=1&pagesize=10`;
      const response = await context.request.json(url);
      const list = response.body?.data?.info;
      if (!Array.isArray(list) || list.length === 0) {
        throw createError("酷狗未搜索到歌曲", "KUGOU_SEARCH_EMPTY");
      }
      const matched = pickBestCandidate(list.map(formatCandidate), info);
      if (!matched) throw createError("酷狗未找到可信匹配", "KUGOU_NOT_MATCHED");
      return matched;
    },
    SEARCH_TTL,
  );

  const hashes = [];
  if (options.preferLossless && candidate.sqId) hashes.push(candidate.sqId);
  if (candidate.hqId) hashes.push(candidate.hqId);
  if (candidate.id) hashes.push(candidate.id);

  let lastError;
  for (const hash of [...new Set(hashes)]) {
    try {
      const url = await fetchTrackUrl(candidate, hash, context);
      return await probeAudio(url, context.request);
    } catch (error) {
      lastError = error;
    }
  }
  throw createError("酷狗取流失败", "KUGOU_TRACK_FAILED", lastError);
};
