import { createError } from "./errors.js";
import { splitArtists } from "./matching.js";

/**
 * 解析宿主传入的时长
 * @param musicInfo - 宿主歌曲信息
 * @returns 毫秒时长，未知时为 0
 */
export const parseDuration = (musicInfo) => {
  const direct = Number(musicInfo?.durationMs ?? musicInfo?.duration);
  if (Number.isFinite(direct) && direct > 0) return direct;

  const interval = String(musicInfo?.interval ?? "").trim();
  const match = interval.match(/^(\d+):(\d{2})$/);
  if (!match) return 0;
  return (Number(match[1]) * 60 + Number(match[2])) * 1_000;
};

/**
 * 从网易云详情响应提取统一歌曲信息
 * @param song - 网易云歌曲详情
 * @returns 搜索所需歌曲信息
 */
const formatNeteaseSong = (song) => ({
  id: String(song.id),
  name: String(song.name ?? "").trim(),
  artists: splitArtists(song.artists ?? []),
  durationMs: Number(song.duration) || 0,
});

/**
 * 获取用于跨平台搜索的歌曲信息
 * @param musicInfo - SPlayer 宿主歌曲信息
 * @param songId - 网易云数字歌曲 ID
 * @param requestClient - 网络请求客户端
 * @returns 完整歌曲信息
 */
export const getTrackInfo = async (musicInfo, songId, requestClient) => {
  let name = String(musicInfo?.name ?? "").trim();
  let artists = splitArtists(musicInfo?.singer ?? musicInfo?.artists);
  let durationMs = parseDuration(musicInfo);

  if (!name || artists.length === 0) {
    const response = await requestClient.json(
      `https://music.163.com/api/song/detail?ids=[${encodeURIComponent(songId)}]`,
      {
        headers: {
          Referer: "https://music.163.com/",
          "User-Agent": "Mozilla/5.0",
        },
      },
    );
    const song = response.body?.songs?.[0];
    if (!song) throw createError("网易云未返回歌曲详情", "NETEASE_NOT_FOUND");
    const detail = formatNeteaseSong(song);
    name ||= detail.name;
    artists = artists.length ? artists : detail.artists;
    durationMs ||= detail.durationMs;
  }

  if (!name) throw createError("宿主未提供歌曲标题，且网易云详情为空", "TRACK_METADATA_MISSING");

  return {
    id: songId,
    name,
    artists,
    durationMs,
    keyword: `${name} - ${artists.slice(0, 2).join(" / ") || name}`,
  };
};
