/*
 * 接口兼容逻辑参考 UnblockNeteaseMusic/server 的 LGPL-3.0-only provider 实现
 */
import { createError } from "../errors.js";
import { probeAudio } from "../probe.js";
import { searchKuwo } from "./kuwo-search.js";

const DEVICE_ID = String(Math.floor(Math.random() * 100_000_000_000));
const AD_URL =
  "https://bd-api.kuwo.cn/api/service/advert/watch" +
  "?uid=-1&token=&timestamp=1724306124436&sign=15a676d66285117ad714e8c8371691da";

const REQUEST_HEADERS = {
  "User-Agent": "Dart/2.19 (dart:io)",
  plat: "ar",
  channel: "aliopen",
  devid: DEVICE_ID,
  ver: "3.9.0",
  host: "bd-api.kuwo.cn",
};

/**
 * 为波点取流地址生成签名
 * @param value - 未签名的请求地址
 * @param md5 - MD5 工具
 * @returns 带时间戳和签名的地址
 */
const signUrl = (value, md5) => {
  const url = new URL(value);
  const withTimestamp = `${value}&timestamp=${Date.now()}`;
  const filtered = withTimestamp
    .substring(withTimestamp.indexOf("?") + 1)
    .replace(/[^a-zA-Z0-9]/g, "")
    .split("")
    .sort()
    .join("");
  const signature = md5(`kuwotest${filtered}${url.pathname}`);
  return `${withTimestamp}&sign=${signature}`;
};

/**
 * 发送波点广告解锁请求
 * @param context - 插件运行上下文
 */
const unlockBodian = async (context) => {
  try {
    await context.request.json(AD_URL, {
      method: "POST",
      headers: {
        ...REQUEST_HEADERS,
        qimei36: "1e9970cbcdc20a031dee9f37100017e1840e",
        "Content-Type": "application/json; charset=utf-8",
      },
      body: JSON.stringify({ type: 5, subType: 5, musicId: 0, adToken: "" }),
    });
  } catch (error) {
    context.log.debug(`波点解锁请求失败：${error.message}`);
  }
};

/**
 * 请求波点音频地址
 * @param musicId - 酷我歌曲 ID
 * @param lossless - 是否请求 FLAC
 * @param context - 插件运行上下文
 * @returns 播放地址
 */
const requestBodianUrl = async (musicId, lossless, context) => {
  const quality = lossless ? "2000kflac" : "320kmp3";
  const url = signUrl(
    `https://bd-api.kuwo.cn/api/play/music/v2/audioUrl?&br=${quality}&musicId=${musicId}`,
    context.md5,
  );
  const response = await context.request.json(url, {
    headers: {
      ...REQUEST_HEADERS,
      "X-Forwarded-For": "1.0.1.114",
    },
  });
  const playUrl = response.body?.data?.audioUrl;
  if (response.body?.code !== 200 || typeof playUrl !== "string" || !playUrl) {
    throw createError(response.body?.msg || "波点未返回播放地址", "BODIAN_URL_EMPTY");
  }
  return playUrl;
};

/**
 * 通过波点解析播放地址
 * @param info - 网易云歌曲信息
 * @param context - 插件运行上下文
 * @param options - 解析选项
 * @returns 音频探测结果
 */
export const resolveBodian = async (info, context, options) => {
  const candidate = await searchKuwo(info, context);
  await unlockBodian(context);

  const qualities = options.preferLossless ? [true, false] : [false];
  let lastError;
  for (const lossless of qualities) {
    try {
      const url = await requestBodianUrl(candidate.id, lossless, context);
      return await probeAudio(url, context.request);
    } catch (error) {
      lastError = error;
    }
  }
  throw createError("波点取流失败", "BODIAN_TRACK_FAILED", lastError);
};
