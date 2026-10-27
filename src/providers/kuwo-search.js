/*
 * 接口兼容逻辑参考 UnblockNeteaseMusic/server 的 LGPL-3.0-only provider 实现
 */
import { createError } from "../errors.js";
import { pickBestCandidate, splitArtists } from "../matching.js";

const SEARCH_TTL = 300_000;

/**
 * 把酷我搜索项转换为统一候选
 * @param song - 酷我搜索项
 * @returns 统一候选歌曲
 */
const formatCandidate = (song) => ({
  id: String(song.MUSICRID ?? "")
    .split("_")
    .pop(),
  name: String(song.SONGNAME ?? "").trim(),
  artists: splitArtists(song.ARTIST),
  durationMs: Number(song.DURATION) * 1_000 || 0,
  albumId: String(song.ALBUMID ?? ""),
  albumName: String(song.ALBUM ?? ""),
});

/**
 * 搜索并匹配酷我候选歌曲
 * @param info - 网易云歌曲信息
 * @param context - 插件运行上下文
 * @returns 匹配到的酷我候选
 */
export const searchKuwo = (info, context) =>
  context.searchCache.get(
    `kuwo:${info.keyword}`,
    async () => {
      const keyword = encodeURIComponent(info.keyword.replace(" - ", " "));
      const url =
        "https://search.kuwo.cn/r.s?correct=1&vipver=1&stype=comprehensive&encoding=utf8" +
        `&rformat=json&mobi=1&show_copyright_off=1&searchapi=6&all=${keyword}`;
      const response = await context.request.json(url);
      const list = response.body?.content?.[1]?.musicpage?.abslist;
      if (!Array.isArray(list) || list.length === 0) {
        throw createError("酷我未搜索到歌曲", "KUWO_SEARCH_EMPTY");
      }
      const candidate = pickBestCandidate(list.map(formatCandidate), info);
      if (!candidate) throw createError("酷我未找到可信匹配", "KUWO_NOT_MATCHED");
      return candidate;
    },
    SEARCH_TTL,
  );
