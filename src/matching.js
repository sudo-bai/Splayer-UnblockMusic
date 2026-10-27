const VERSION_MARKERS =
  /(?:^|[\s(（[【_-])(live|remix|cover|instrumental|karaoke|demo|acoustic|现场|演唱会|翻唱|伴奏|混音)(?=$|[\s)）\]】_-])/i;

/**
 * 归一化用于比较的文本
 * @param value - 原始文本
 * @returns 小写且去除空白和标点的文本
 */
export const normalizeText = (value) =>
  String(value ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, "");

/**
 * 生成不包含版本说明的标题
 * @param value - 原始歌曲标题
 * @returns 去除括号说明后的标题
 */
export const normalizeTitle = (value) =>
  normalizeText(
    String(value ?? "")
      .replace(/[（(【\[].*?[）)】\]]/g, " ")
      .replace(/\s+/g, " "),
  );

/**
 * 拆分平台返回的歌手文本
 * @param value - 歌手文本或歌手数组
 * @returns 去重后的歌手列表
 */
export const splitArtists = (value) => {
  const values = Array.isArray(value)
    ? value.map((item) => (typeof item === "string" ? item : item?.name))
    : String(value ?? "").split(/[&/、,，]/);
  return [...new Set(values.map((item) => String(item ?? "").trim()).filter(Boolean))];
};

/**
 * 判断标题是否携带不同版本标记
 * @param sourceTitle - 网易云标题
 * @param candidateTitle - 候选标题
 * @returns 候选是否额外包含 Live、Remix 等标记
 */
const hasDifferentVersion = (sourceTitle, candidateTitle) =>
  !VERSION_MARKERS.test(String(sourceTitle ?? "")) &&
  VERSION_MARKERS.test(String(candidateTitle ?? ""));

/**
 * 计算搜索结果与目标歌曲的匹配分
 * @param candidate - 平台候选歌曲
 * @param info - 网易云歌曲信息
 * @returns 匹配分，明显不相关时返回负数
 */
const scoreCandidate = (candidate, info) => {
  const targetTitle = normalizeTitle(info.name);
  const candidateTitle = normalizeTitle(candidate.name);
  const targetArtists = info.artists.map(normalizeText);
  const candidateArtists = (candidate.artists ?? []).map(normalizeText);
  let score = 0;

  if (targetTitle && candidateTitle === targetTitle) score += 60;
  else if (targetTitle && candidateTitle.includes(targetTitle)) score += 35;
  else if (targetTitle && targetTitle.includes(candidateTitle)) score += 25;
  else score -= 30;

  if (targetArtists.length && candidateArtists.length) {
    if (targetArtists.some((artist) => candidateArtists.includes(artist))) score += 30;
    else return Number.NEGATIVE_INFINITY;
  }

  const targetDuration = Number(info.durationMs);
  const candidateDuration = Number(candidate.durationMs);
  if (targetDuration > 0 && candidateDuration > 0) {
    const difference = Math.abs(targetDuration - candidateDuration);
    if (difference <= 2_000) score += 35;
    else if (difference <= 5_000) score += 25;
    else if (difference <= 10_000) score += 10;
    else if (difference > 20_000) return Number.NEGATIVE_INFINITY;
  }

  if (hasDifferentVersion(info.name, candidate.name)) return Number.NEGATIVE_INFINITY;
  return score;
};

/**
 * 从平台搜索列表中选出最可信的候选
 * @param candidates - 平台候选歌曲
 * @param info - 网易云歌曲信息
 * @returns 最佳候选或 null
 */
export const pickBestCandidate = (candidates, info) => {
  const ranked = candidates
    .slice(0, 10)
    .map((candidate) => ({ candidate, score: scoreCandidate(candidate, info) }))
    .sort((left, right) => right.score - left.score);
  return ranked[0]?.score >= 25 ? ranked[0].candidate : null;
};
