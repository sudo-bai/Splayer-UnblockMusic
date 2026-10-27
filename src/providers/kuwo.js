/*
 * 接口兼容逻辑参考 UnblockNeteaseMusic/server 的 LGPL-3.0-only provider 实现
 */
import { createError } from "../errors.js";
import { probeAudio } from "../probe.js";
import { searchKuwo } from "./kuwo-search.js";

/**
 * 通过酷我解析播放地址
 * @param info - 网易云歌曲信息
 * @param context - 插件运行上下文
 * @returns 音频探测结果
 */
export const resolveKuwo = async (info, context) => {
  const candidate = await searchKuwo(info, context);
  const url =
    "https://antiserver.kuwo.cn/anti.s?" +
    `type=convert_url&format=mp3&response=url&rid=MUSIC_${candidate.id}`;
  const response = await context.request.text(url, {
    headers: { "User-Agent": "okhttp/3.10.0" },
  });
  const playUrl = String(response.body).match(/https?:\/\/[^\s$"]+/)?.[0];
  if (!playUrl) throw createError("酷我未返回播放地址", "KUWO_URL_EMPTY");
  return probeAudio(playUrl, context.request);
};
