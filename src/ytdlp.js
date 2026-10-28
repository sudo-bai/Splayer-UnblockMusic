import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createError } from "./errors.js";
import { mapQuality, normalizeQuality } from "./quality.js";

const execFileAsync = promisify(execFile);
const STDIO_MAX_BUFFER = 8 * 1024 * 1024;

/**
 * 解析播放地址中的过期时间
 * @param value - 播放地址
 * @returns 毫秒时间戳或 undefined
 */
const parseExpire = (value) => {
  try {
    const expire = Number(new URL(value).searchParams.get("expire"));
    return Number.isFinite(expire) && expire > 0 ? expire * 1_000 : undefined;
  } catch {
    return undefined;
  }
};

/**
 * 从 yt-dlp JSON 结果提取播放信息
 * @param data - yt-dlp 输出对象
 * @param requestedQuality - 请求音质
 * @returns 统一播放结果
 */
export const normalizeYtDlpResult = (data, requestedQuality) => {
  if (!data || typeof data.url !== "string" || !/^https?:\/\//i.test(data.url)) {
    throw createError("yt-dlp 未返回有效播放地址", "YTDLP_URL_EMPTY");
  }
  const bitrate =
    Number.isFinite(Number(data.abr)) && Number(data.abr) > 0
      ? Number(data.abr) * 1_000
      : Number.isFinite(Number(data.tbr)) && Number(data.tbr) > 0
        ? Number(data.tbr) * 1_000
        : null;
  const format = String(data.ext ?? "").toLowerCase();
  const acodec = String(data.acodec ?? "").toLowerCase();
  const quality =
    format === "flac" || acodec.includes("flac") ? "lossless" : mapQuality({ format, bitrate });
  const size = Number(data.filesize ?? data.filesize_approx);
  return {
    url: data.url,
    provider: "ytdlp",
    bitrate,
    size: Number.isFinite(size) && size > 0 ? size : null,
    quality,
    requestedQuality: normalizeQuality(requestedQuality),
    degraded: quality !== normalizeQuality(requestedQuality),
    expire: parseExpire(data.url),
  };
};

/**
 * 通过网易云公开接口获取搜索关键词
 * @param id - 网易云歌曲 ID
 * @returns 歌曲名与歌手的搜索关键词
 */
export const fetchKeyword = async (id) => {
  const response = await fetch(
    `https://music.163.com/api/song/detail?ids=[${encodeURIComponent(id)}]`,
    {
      headers: {
        Referer: "https://music.163.com/",
        "User-Agent": "Mozilla/5.0",
      },
    },
  );
  if (!response.ok)
    throw createError(`网易云详情请求失败：HTTP ${response.status}`, "NETEASE_HTTP");
  const body = await response.json();
  const song = body?.songs?.[0];
  if (!song?.name) throw createError("网易云未返回歌曲详情", "NETEASE_NOT_FOUND");
  const artists = Array.isArray(song.artists)
    ? song.artists.map((artist) => artist?.name).filter(Boolean)
    : [];
  return `${song.name} - ${artists.slice(0, 2).join(" / ") || song.name}`;
};

/**
 * 检测 yt-dlp 可用性与版本
 * @param executable - yt-dlp 可执行文件
 * @returns 可用性与版本
 */
export const inspectYtDlp = async (executable) => {
  try {
    const { stdout } = await execFileAsync(executable, ["--version"], {
      encoding: "utf8",
      timeout: 3_000,
      maxBuffer: STDIO_MAX_BUFFER,
    });
    return { available: true, version: stdout.trim() || null };
  } catch {
    return { available: false, version: null };
  }
};

/**
 * 创建直接调用 yt-dlp 的解析器
 * @param options - 可执行文件与 Cookie 配置
 * @returns yt-dlp 运行方法
 */
export const createYtDlpRunner = ({
  executable = "yt-dlp",
  cookies = "",
  cookiesFromBrowser = "",
  execFileImpl = execFileAsync,
}) => ({
  /**
   * 搜索并提取 YouTube 音频地址
   * @param keyword - 搜索关键词
   * @param timeout - 超时时间
   * @param requestedQuality - 请求音质
   * @returns 统一播放结果
   */
  async run(keyword, timeout, requestedQuality = "hq") {
    const args = ["--no-playlist", "--dump-json", "--no-warnings", "-f", "bestaudio/best"];
    if (cookies) args.push("--cookies", cookies);
    else if (cookiesFromBrowser) args.push("--cookies-from-browser", cookiesFromBrowser);
    args.push(`ytsearch1:${keyword}`);

    let stdout;
    try {
      ({ stdout } = await execFileImpl(executable, args, {
        encoding: "utf8",
        timeout,
        maxBuffer: STDIO_MAX_BUFFER,
      }));
    } catch (error) {
      const stderr = String(error?.stderr ?? "");
      if (/Sign in to confirm you.?re not a bot/i.test(stderr)) {
        throw createError(
          "YouTube 要求登录验证，请为 yt-dlp 配置有效 Cookie",
          "YTDLP_COOKIE_REQUIRED",
          error,
        );
      }
      if (error?.killed || error?.signal === "SIGTERM") {
        throw createError("yt-dlp 解析超时", "YTDLP_TIMEOUT", error);
      }
      const detail = stderr.trim().split("\n").filter(Boolean).at(-1);
      throw createError(`yt-dlp 执行失败${detail ? `：${detail}` : ""}`, "YTDLP_FAILED", error);
    }

    let data;
    try {
      data = JSON.parse(stdout);
    } catch (error) {
      throw createError("yt-dlp 返回了无效 JSON", "YTDLP_INVALID_JSON", error);
    }
    return normalizeYtDlpResult(data, requestedQuality);
  },
});
