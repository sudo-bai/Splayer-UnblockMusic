export const QUALITIES = ["lq", "sq", "hq", "lossless", "hi-res"];

export const QUALITY_RANK = {
  lq: 0,
  sq: 1,
  hq: 2,
  lossless: 3,
  "hi-res": 4,
};

export const QUALITY_MIN_BITRATE = {
  lq: 0,
  sq: 192_000,
  hq: 320_000,
  lossless: 900_000,
  "hi-res": 1_411_200,
};

/**
 * 统一插件请求音质
 * @param quality - 宿主传入的音质
 * @returns 受支持音质或 hq
 */
export const normalizeQuality = (quality) =>
  typeof quality === "string" && QUALITIES.includes(quality) ? quality : "hq";

/**
 * 根据音频探测信息映射 SPlayer 音质
 * @param audio - 码率、格式与采样信息
 * @returns SPlayer 音质档位
 */
export const mapQuality = (audio) => {
  const bitrate = Number(audio.bitrate);
  const sampleRate = Number(audio.sampleRate);
  const bitsPerSample = Number(audio.bitsPerSample);
  const isLossless = audio.format === "flac" || bitrate >= 900_000;

  if (isLossless) {
    return sampleRate >= 96_000 && bitsPerSample >= 24 ? "hi-res" : "lossless";
  }
  if (bitrate >= 320_000) return "hq";
  if (bitrate >= 192_000) return "sq";
  return "lq";
};

/**
 * 判断解析结果是否达到目标音质
 * @param result - 已解析的音频结果
 * @param target - 请求的目标音质
 * @returns 是否达到目标
 */
export const meetsQuality = (result, target) =>
  QUALITY_RANK[result.quality] >= QUALITY_RANK[normalizeQuality(target)];

/**
 * 从两个结果中选择音质更高的一项
 * @param current - 当前最佳结果
 * @param candidate - 新的候选结果
 * @returns 较高音质的结果
 */
export const pickBetterResult = (current, candidate) => {
  if (!current) return candidate;
  if (!candidate) return current;
  return QUALITY_RANK[candidate.quality] > QUALITY_RANK[current.quality] ? candidate : current;
};
