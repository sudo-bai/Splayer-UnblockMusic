/**
 * @name        Splayer-UnblockMusic
 * @id          splayer.unblock-music
 * @version     0.3.0
 * @description 内置 HTTP 音源为网易云歌曲补充播放地址，可选 sidecar 提供 yt-dlp 增强
 * @author      Splayer-UnblockMusic contributors
 * @type        source
 * @grant       network
 * @apiLevel    2
 * @license     AGPL-3.0-only
 * @updateUrl   https://raw.githubusercontent.com/sudo-bai/Splayer-UnblockMusic/main/plugin/splayer-unblockmusic.js
 *
 * 内置 provider 兼容逻辑参考 UnblockNeteaseMusic/server（LGPL-3.0-only）
 * 详见仓库中的 THIRD_PARTY_NOTICES.md
 */
(() => {
  // src/errors.js
  var createError = (message, code, cause) => {
    const error = new Error(message, cause ? { cause } : void 0);
    error.code = code;
    return error;
  };
  var errorMessage = (error) => error instanceof Error ? error.message : String(error ?? "未知错误");

  // src/matching.js
  var VERSION_MARKERS = /(?:^|[\s(（[【_-])(live|remix|cover|instrumental|karaoke|demo|acoustic|现场|演唱会|翻唱|伴奏|混音)(?=$|[\s)）\]】_-])/i;
  var normalizeText = (value) => String(value ?? "").normalize("NFKC").toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, "");
  var normalizeTitle = (value) => normalizeText(
    String(value ?? "").replace(/[（(【\[].*?[）)】\]]/g, " ").replace(/\s+/g, " ")
  );
  var splitArtists = (value) => {
    const values = Array.isArray(value) ? value.map((item) => typeof item === "string" ? item : item?.name) : String(value ?? "").split(/[&/、,，]/);
    return [...new Set(values.map((item) => String(item ?? "").trim()).filter(Boolean))];
  };
  var hasDifferentVersion = (sourceTitle, candidateTitle) => !VERSION_MARKERS.test(String(sourceTitle ?? "")) && VERSION_MARKERS.test(String(candidateTitle ?? ""));
  var scoreCandidate = (candidate, info) => {
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
      if (difference <= 2e3) score += 35;
      else if (difference <= 5e3) score += 25;
      else if (difference <= 1e4) score += 10;
      else if (difference > 2e4) return Number.NEGATIVE_INFINITY;
    }
    if (hasDifferentVersion(info.name, candidate.name)) return Number.NEGATIVE_INFINITY;
    return score;
  };
  var pickBestCandidate = (candidates, info) => {
    const ranked = candidates.slice(0, 10).map((candidate) => ({ candidate, score: scoreCandidate(candidate, info) })).sort((left, right) => right.score - left.score);
    return ranked[0]?.score >= 25 ? ranked[0].candidate : null;
  };

  // src/metadata.js
  var parseDuration = (musicInfo) => {
    const direct = Number(musicInfo?.durationMs ?? musicInfo?.duration);
    if (Number.isFinite(direct) && direct > 0) return direct;
    const interval = String(musicInfo?.interval ?? "").trim();
    const match = interval.match(/^(\d+):(\d{2})$/);
    if (!match) return 0;
    return (Number(match[1]) * 60 + Number(match[2])) * 1e3;
  };
  var formatNeteaseSong = (song) => ({
    id: String(song.id),
    name: String(song.name ?? "").trim(),
    artists: splitArtists(song.artists ?? []),
    durationMs: Number(song.duration) || 0
  });
  var getTrackInfo = async (musicInfo, songId, requestClient2) => {
    let name = String(musicInfo?.name ?? "").trim();
    let artists = splitArtists(musicInfo?.singer ?? musicInfo?.artists);
    let durationMs = parseDuration(musicInfo);
    if (!name || artists.length === 0) {
      const response = await requestClient2.json(
        `https://music.163.com/api/song/detail?ids=[${encodeURIComponent(songId)}]`,
        {
          headers: {
            Referer: "https://music.163.com/",
            "User-Agent": "Mozilla/5.0"
          }
        }
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
      keyword: `${name} - ${artists.slice(0, 2).join(" / ") || name}`
    };
  };

  // src/quality.js
  var QUALITIES = ["lq", "sq", "hq", "lossless", "hi-res"];
  var QUALITY_RANK = {
    lq: 0,
    sq: 1,
    hq: 2,
    lossless: 3,
    "hi-res": 4
  };
  var normalizeQuality = (quality) => typeof quality === "string" && QUALITIES.includes(quality) ? quality : "hq";
  var mapQuality = (audio) => {
    const bitrate = Number(audio.bitrate);
    const sampleRate = Number(audio.sampleRate);
    const bitsPerSample = Number(audio.bitsPerSample);
    const isLossless = audio.format === "flac" || bitrate >= 9e5;
    if (isLossless) {
      return sampleRate >= 96e3 && bitsPerSample >= 24 ? "hi-res" : "lossless";
    }
    if (bitrate >= 32e4) return "hq";
    if (bitrate >= 192e3) return "sq";
    return "lq";
  };
  var meetsQuality = (result, target) => QUALITY_RANK[result.quality] >= QUALITY_RANK[normalizeQuality(target)];
  var pickBetterResult = (current, candidate) => {
    if (!current) return candidate;
    if (!candidate) return current;
    return QUALITY_RANK[candidate.quality] > QUALITY_RANK[current.quality] ? candidate : current;
  };

  // src/music-resolver.js
  var RESOLUTION_BUDGET = 18e3;
  var RESULT_CACHE_TTL = 6e4;
  var RESULT_CACHE_LIMIT = 128;
  var DEFAULT_SOURCE_TIMEOUTS = {
    bodian: 5e3,
    kugou: 4500,
    kuwo: 3500,
    sidecar: 14e3
  };
  var withTimeout = (promise, timeout, source) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(createError(`${source} 解析超时`, "SOURCE_TIMEOUT"));
    }, timeout);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
  var normalizeResult = (result, source) => {
    if (!result || typeof result.url !== "string" || !/^https?:\/\//i.test(result.url)) {
      throw createError(`${source} 返回了无效播放地址`, "INVALID_AUDIO_URL");
    }
    const bitrate = Number.isFinite(Number(result.bitrate)) ? Number(result.bitrate) : null;
    const quality = normalizeQuality(result.quality ?? mapQuality({ ...result, bitrate }));
    return {
      ...result,
      bitrate,
      quality,
      provider: typeof result.provider === "string" ? result.provider : source
    };
  };
  var createMusicResolver = ({
    providers,
    context,
    log,
    resolutionBudget = RESOLUTION_BUDGET,
    sourceTimeouts = DEFAULT_SOURCE_TIMEOUTS,
    now = () => Date.now()
  }) => {
    const cache = /* @__PURE__ */ new Map();
    const pending = /* @__PURE__ */ new Map();
    let generation = 0;
    const readCache = (key) => {
      const entry = cache.get(key);
      if (!entry) return void 0;
      if (entry.until <= now()) {
        cache.delete(key);
        return void 0;
      }
      cache.delete(key);
      cache.set(key, entry);
      return entry.value;
    };
    const writeCache = (key, value) => {
      cache.delete(key);
      while (cache.size >= RESULT_CACHE_LIMIT) cache.delete(cache.keys().next().value);
      cache.set(key, { value, until: now() + RESULT_CACHE_TTL });
    };
    const execute = async ({
      info,
      quality,
      sourceOrder,
      preferLossless,
      sidecar,
      signature,
      currentGeneration
    }) => {
      const requestedQuality = normalizeQuality(quality);
      const deadline = now() + resolutionBudget;
      const builtinDeadline = sidecar ? Math.min(deadline, now() + 4e3) : deadline;
      const failures = [];
      let best = null;
      for (const source of sourceOrder) {
        const provider = providers[source];
        if (!provider) continue;
        const remaining = builtinDeadline - now();
        if (remaining <= 0) break;
        const timeout = Math.max(
          1,
          Math.min(sourceTimeouts[source] ?? DEFAULT_SOURCE_TIMEOUTS[source] ?? 4e3, remaining)
        );
        try {
          const result2 = await withTimeout(
            Promise.resolve(provider(info, context, { preferLossless })),
            timeout,
            source
          );
          const normalized = normalizeResult(result2, source);
          best = pickBetterResult(best, normalized);
          if (meetsQuality(best, requestedQuality)) break;
        } catch (error) {
          failures.push(`${source}: ${errorMessage(error)}`);
          log.warn(`[${source}] ${errorMessage(error)}`);
        }
      }
      if ((!best || !meetsQuality(best, requestedQuality)) && sidecar) {
        const remaining = deadline - now();
        if (remaining >= 1e3) {
          try {
            const result2 = await withTimeout(
              Promise.resolve(sidecar.resolve(info, requestedQuality, Math.min(remaining, 14e3))),
              Math.min(remaining, 14e3),
              "sidecar"
            );
            if (result2) best = pickBetterResult(best, normalizeResult(result2, "sidecar"));
          } catch (error) {
            failures.push(`sidecar: ${errorMessage(error)}`);
            log.warn(`[sidecar] ${errorMessage(error)}`);
          }
        } else {
          failures.push("sidecar: 总时间预算不足");
        }
      }
      if (!best) {
        throw createError(
          `所有音源均未解析成功${failures.length ? `：${failures.join("；")}` : ""}`,
          "NO_AUDIO_SOURCE"
        );
      }
      const result = {
        ...best,
        requestedQuality,
        degraded: !meetsQuality(best, requestedQuality),
        cached: false
      };
      log.info(`《${info.name}》由 ${result.provider} 解析，音质 ${result.quality}`);
      if (result.degraded) log.warn("未找到请求音质，已返回当前可用最佳音质");
      if (currentGeneration === generation) {
        writeCache(
          JSON.stringify([info.id, requestedQuality, sourceOrder, preferLossless, signature]),
          result
        );
      }
      return result;
    };
    return {
      /**
       * 解析网易云歌曲播放地址
       * @param request - 歌曲信息、音质与当次配置
       * @returns 播放结果
       */
      async resolve(request) {
        const requestedQuality = normalizeQuality(request.quality);
        const key = JSON.stringify([
          request.info.id,
          requestedQuality,
          request.sourceOrder,
          request.preferLossless,
          request.signature
        ]);
        const cached = readCache(key);
        if (cached) return { ...cached, cached: true };
        const active = pending.get(key);
        if (active) return active;
        const currentGeneration = generation;
        const operation = execute({
          ...request,
          quality: requestedQuality,
          currentGeneration
        }).finally(() => {
          if (pending.get(key) === operation) pending.delete(key);
        });
        if (pending.size < RESULT_CACHE_LIMIT) pending.set(key, operation);
        return operation;
      },
      /**
       * 清空设置变更后的运行缓存
       */
      clear() {
        generation += 1;
        cache.clear();
        pending.clear();
      }
    };
  };

  // src/promise-cache.js
  var createPromiseCache = (limit = 128, now = () => Date.now()) => {
    const cache = /* @__PURE__ */ new Map();
    const read = (key) => {
      const entry = cache.get(key);
      if (!entry) return void 0;
      if (entry.until <= now()) {
        cache.delete(key);
        return void 0;
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
      async get(key, loader, ttl = 6e4) {
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
      }
    };
  };

  // src/probe.js
  var readHeader = (headers, name) => {
    if (!headers || typeof headers !== "object") return "";
    const key = Object.keys(headers).find((item) => item.toLowerCase() === name);
    return key ? String(headers[key] ?? "") : "";
  };
  var toBytes = (body) => {
    if (body instanceof Uint8Array) return body;
    if (body instanceof ArrayBuffer) return new Uint8Array(body);
    if (ArrayBuffer.isView(body)) {
      return new Uint8Array(body.buffer, body.byteOffset, body.byteLength);
    }
    return new Uint8Array();
  };
  var parseFlac = (bytes, size) => {
    const offset = 18;
    if (bytes.length < offset + 8) return { format: "flac", bitrate: 999e3 };
    const sampleRate = bytes[offset] << 12 | bytes[offset + 1] << 4 | bytes[offset + 2] >> 4;
    const bitsPerSample = ((bytes[offset + 2] & 1) << 4 | bytes[offset + 3] >> 4) + 1;
    const totalSamples = (bytes[offset + 3] & 15) * 4294967296 + bytes[offset + 4] * 16777216 + bytes[offset + 5] * 65536 + bytes[offset + 6] * 256 + bytes[offset + 7];
    const duration = sampleRate > 0 && totalSamples > 0 ? totalSamples / sampleRate : 0;
    const bitrate = size > 0 && duration > 0 ? Math.round(size * 8 / duration) : 999e3;
    return { format: "flac", bitrate, sampleRate, bitsPerSample };
  };
  var parseMp3 = (bytes) => {
    const table = {
      3: {
        3: [0, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448],
        2: [0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384],
        1: [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320]
      },
      2: {
        3: [0, 32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256],
        2: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160]
      }
    };
    table[2][1] = table[2][2];
    table[0] = table[2];
    let pointer = 0;
    if (bytes[0] === 73 && bytes[1] === 68 && bytes[2] === 51) {
      const size = (bytes[6] & 127) << 21 | (bytes[7] & 127) << 14 | (bytes[8] & 127) << 7 | bytes[9] & 127;
      pointer = 10 + size;
    }
    for (; pointer + 3 < bytes.length; pointer += 1) {
      const first = bytes[pointer];
      const second = bytes[pointer + 1];
      const third = bytes[pointer + 2];
      if (first !== 255 || (second & 224) !== 224) continue;
      const version = second >> 3 & 3;
      const layer = second >> 1 & 3;
      const bitrateIndex = third >> 4;
      const value = table[version]?.[layer]?.[bitrateIndex];
      if (Number.isFinite(value) && value > 0) return value * 1e3;
    }
    return null;
  };
  var probeAudio = async (url, requestClient2) => {
    const response = await requestClient2.bytes(url, {
      method: "GET",
      headers: {
        Range: "bytes=0-8191",
        "Accept-Encoding": "identity"
      }
    });
    const bytes = toBytes(response.body);
    if (bytes.length === 0) throw createError("播放地址返回空音频", "AUDIO_EMPTY");
    const contentRange = readHeader(response.headers, "content-range");
    const contentLength = readHeader(response.headers, "content-length");
    const size = Number(contentRange.split("/").pop() || contentLength) || null;
    const contentType = readHeader(response.headers, "content-type").toLowerCase();
    const isFlac = bytes[0] === 102 && bytes[1] === 76 && bytes[2] === 97 && bytes[3] === 67;
    const audio = isFlac || contentType.includes("flac") ? parseFlac(bytes, size) : { format: "mp3", bitrate: parseMp3(bytes) };
    return { url, size, ...audio };
  };

  // src/providers/kuwo-search.js
  var SEARCH_TTL = 3e5;
  var formatCandidate = (song) => ({
    id: String(song.MUSICRID ?? "").split("_").pop(),
    name: String(song.SONGNAME ?? "").trim(),
    artists: splitArtists(song.ARTIST),
    durationMs: Number(song.DURATION) * 1e3 || 0,
    albumId: String(song.ALBUMID ?? ""),
    albumName: String(song.ALBUM ?? "")
  });
  var searchKuwo = (info, context) => context.searchCache.get(
    `kuwo:${info.keyword}`,
    async () => {
      const keyword = encodeURIComponent(info.keyword.replace(" - ", " "));
      const url = `https://search.kuwo.cn/r.s?correct=1&vipver=1&stype=comprehensive&encoding=utf8&rformat=json&mobi=1&show_copyright_off=1&searchapi=6&all=${keyword}`;
      const response = await context.request.json(url);
      const list = response.body?.content?.[1]?.musicpage?.abslist;
      if (!Array.isArray(list) || list.length === 0) {
        throw createError("酷我未搜索到歌曲", "KUWO_SEARCH_EMPTY");
      }
      const candidate = pickBestCandidate(list.map(formatCandidate), info);
      if (!candidate) throw createError("酷我未找到可信匹配", "KUWO_NOT_MATCHED");
      return candidate;
    },
    SEARCH_TTL
  );

  // src/providers/bodian.js
  var DEVICE_ID = String(Math.floor(Math.random() * 1e11));
  var AD_URL = "https://bd-api.kuwo.cn/api/service/advert/watch?uid=-1&token=&timestamp=1724306124436&sign=15a676d66285117ad714e8c8371691da";
  var REQUEST_HEADERS = {
    "User-Agent": "Dart/2.19 (dart:io)",
    plat: "ar",
    channel: "aliopen",
    devid: DEVICE_ID,
    ver: "3.9.0",
    host: "bd-api.kuwo.cn"
  };
  var signUrl = (value, md5) => {
    const url = new URL(value);
    const withTimestamp = `${value}&timestamp=${Date.now()}`;
    const filtered = withTimestamp.substring(withTimestamp.indexOf("?") + 1).replace(/[^a-zA-Z0-9]/g, "").split("").sort().join("");
    const signature = md5(`kuwotest${filtered}${url.pathname}`);
    return `${withTimestamp}&sign=${signature}`;
  };
  var unlockBodian = async (context) => {
    try {
      await context.request.json(AD_URL, {
        method: "POST",
        headers: {
          ...REQUEST_HEADERS,
          qimei36: "1e9970cbcdc20a031dee9f37100017e1840e",
          "Content-Type": "application/json; charset=utf-8"
        },
        body: JSON.stringify({ type: 5, subType: 5, musicId: 0, adToken: "" })
      });
    } catch (error) {
      context.log.debug(`波点解锁请求失败：${error.message}`);
    }
  };
  var requestBodianUrl = async (musicId, lossless, context) => {
    const quality = lossless ? "2000kflac" : "320kmp3";
    const url = signUrl(
      `https://bd-api.kuwo.cn/api/play/music/v2/audioUrl?&br=${quality}&musicId=${musicId}`,
      context.md5
    );
    const response = await context.request.json(url, {
      headers: {
        ...REQUEST_HEADERS,
        "X-Forwarded-For": "1.0.1.114"
      }
    });
    const playUrl = response.body?.data?.audioUrl;
    if (response.body?.code !== 200 || typeof playUrl !== "string" || !playUrl) {
      throw createError(response.body?.msg || "波点未返回播放地址", "BODIAN_URL_EMPTY");
    }
    return playUrl;
  };
  var resolveBodian = async (info, context, options) => {
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

  // src/providers/kugou.js
  var SEARCH_TTL2 = 3e5;
  var formatCandidate2 = (song) => ({
    id: String(song.hash ?? ""),
    hqId: String(song["320hash"] ?? ""),
    sqId: String(song.sqhash ?? ""),
    name: String(song.songname ?? "").trim(),
    artists: splitArtists(song.singername),
    durationMs: Number(song.duration) * 1e3 || 0,
    albumId: String(song.album_id ?? ""),
    albumName: String(song.album_name ?? "")
  });
  var fetchTrackUrl = async (candidate, hash, context) => {
    if (!hash) throw createError("酷狗缺少音频哈希", "KUGOU_HASH_MISSING");
    const key = context.md5(`${hash}kgcloudv2`);
    const url = `http://trackercdn.kugou.com/i/v2/?key=${key}&hash=${hash}&appid=1005&pid=2&cmd=25&behavior=play&album_id=${candidate.albumId}`;
    const response = await context.request.json(url);
    const playUrl = Array.isArray(response.body?.url) ? response.body.url[0] : null;
    if (typeof playUrl !== "string" || !playUrl) {
      throw createError("酷狗未返回播放地址", "KUGOU_URL_EMPTY");
    }
    return playUrl;
  };
  var resolveKugou = async (info, context, options) => {
    const candidate = await context.searchCache.get(
      `kugou:${info.keyword}`,
      async () => {
        const url = `http://mobilecdn.kugou.com/api/v3/search/song?keyword=${encodeURIComponent(info.keyword)}&page=1&pagesize=10`;
        const response = await context.request.json(url);
        const list = response.body?.data?.info;
        if (!Array.isArray(list) || list.length === 0) {
          throw createError("酷狗未搜索到歌曲", "KUGOU_SEARCH_EMPTY");
        }
        const matched = pickBestCandidate(list.map(formatCandidate2), info);
        if (!matched) throw createError("酷狗未找到可信匹配", "KUGOU_NOT_MATCHED");
        return matched;
      },
      SEARCH_TTL2
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

  // src/providers/kuwo.js
  var resolveKuwo = async (info, context) => {
    const candidate = await searchKuwo(info, context);
    const url = `https://antiserver.kuwo.cn/anti.s?type=convert_url&format=mp3&response=url&rid=MUSIC_${candidate.id}`;
    const response = await context.request.text(url, {
      headers: { "User-Agent": "okhttp/3.10.0" }
    });
    const playUrl = String(response.body).match(/https?:\/\/[^\s$"]+/)?.[0];
    if (!playUrl) throw createError("酷我未返回播放地址", "KUWO_URL_EMPTY");
    return probeAudio(playUrl, context.request);
  };

  // src/providers/index.js
  var PROVIDERS = {
    bodian: resolveBodian,
    kugou: resolveKugou,
    kuwo: resolveKuwo
  };
  var BUILTIN_SOURCES = Object.keys(PROVIDERS);

  // src/request-client.js
  var createRequestClient = (request, timeout = 3e3) => {
    const send = async (url, options, expected, allowHttpErrors = false) => {
      let response;
      try {
        response = await request(url, { ...options, timeout: options.timeout ?? timeout });
      } catch (error) {
        throw createError(`网络请求失败：${new URL(url).hostname}`, "REQUEST_FAILED", error);
      }
      if (!allowHttpErrors && (response.status < 200 || response.status > 299)) {
        throw createError(`HTTP ${response.status}：${new URL(url).hostname}`, "HTTP_ERROR");
      }
      if (expected === "json" && typeof response.body === "string") {
        try {
          return { ...response, body: JSON.parse(response.body) };
        } catch (error) {
          throw createError(`响应不是有效 JSON：${new URL(url).hostname}`, "INVALID_JSON", error);
        }
      }
      return response;
    };
    return {
      /**
       * 请求并解析 JSON 响应
       * @param url - 请求地址
       * @param options - SPlayer 请求选项
       * @param allowHttpErrors - 是否返回非 2xx 响应
       * @returns 宿主响应
       */
      json: (url, options = {}, allowHttpErrors = false) => send(url, { ...options, responseType: "json" }, "json", allowHttpErrors),
      /**
       * 请求文本响应
       * @param url - 请求地址
       * @param options - SPlayer 请求选项
       * @returns 宿主响应
       */
      text: (url, options = {}) => send(url, { ...options, responseType: "text" }, "text"),
      /**
       * 请求二进制响应
       * @param url - 请求地址
       * @param options - SPlayer 请求选项
       * @returns 宿主响应
       */
      bytes: (url, options = {}) => send(url, { ...options, responseType: "arraybuffer" }, "bytes")
    };
  };

  // src/sidecar-client.js
  var createSidecarClient = (requestClient2) => ({
    /**
     * 生成 sidecar 配置签名
     * @param endpoint - 服务地址
     * @param token - 访问 Token
     * @returns 配置签名
     */
    signature(endpoint, token) {
      return `${endpoint}
${token}`;
    },
    /**
     * 调用 sidecar 解析播放地址
     * @param info - 网易云歌曲信息
     * @param quality - 请求音质
     * @param timeout - 本次调用超时
     * @param endpoint - 服务地址
     * @param token - 访问 Token
     * @returns 规范化播放结果
     */
    async resolve(info, quality, timeout, endpoint, token) {
      let parsed;
      try {
        parsed = new URL(endpoint);
      } catch (error) {
        throw createError("sidecar 地址无效", "SIDECAR_ENDPOINT_INVALID", error);
      }
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        throw createError("sidecar 地址只支持 http/https", "SIDECAR_ENDPOINT_INVALID");
      }
      const headers = { "Content-Type": "application/json" };
      if (token) headers.Authorization = `Bearer ${token}`;
      const response = await requestClient2.json(
        `${endpoint.replace(/\/+$/, "")}/v1/resolve`,
        {
          method: "POST",
          headers,
          body: JSON.stringify({ id: info.id, quality, keyword: info.keyword }),
          timeout
        },
        true
      );
      if (response.status === 401)
        throw createError("sidecar 认证失败，请检查 Token", "SIDECAR_UNAUTHORIZED");
      if (response.status === 429) throw createError("sidecar 正忙，请稍后重试", "SIDECAR_BUSY");
      const body = response.body;
      if (!body || typeof body !== "object" || typeof body.url !== "string" || !body.url) {
        const message = typeof body?.message === "string" ? body.message : `HTTP ${response.status}`;
        throw createError(`sidecar 解析失败：${message}`, "SIDECAR_RESOLVE_FAILED");
      }
      return {
        url: body.url,
        quality: normalizeQuality(body.quality ?? quality),
        provider: typeof body.provider === "string" ? body.provider : "sidecar",
        bitrate: Number.isFinite(Number(body.bitrate)) ? Number(body.bitrate) : null,
        size: Number.isFinite(Number(body.size)) ? Number(body.size) : null,
        expire: Number.isFinite(Number(body.expire)) ? Number(body.expire) : void 0
      };
    }
  });

  // src/settings.js
  var DEFAULT_ENDPOINT = "http://127.0.0.1:18321";
  var DEFAULT_SOURCE_ORDER = "bodian,kugou,kuwo";
  var parseSourceOrder = (value) => {
    const sources = String(value ?? "").split(",").map((source) => source.trim().toLowerCase()).filter((source) => BUILTIN_SOURCES.includes(source));
    return [...new Set(sources)].length ? [...new Set(sources)] : [...BUILTIN_SOURCES];
  };
  var PLUGIN_SETTINGS = [
    {
      key: "sourceOrder",
      type: "text",
      label: "内置音源顺序",
      description: "逗号分隔，可选 bodian、kugou、kuwo",
      default: DEFAULT_SOURCE_ORDER,
      placeholder: DEFAULT_SOURCE_ORDER
    },
    {
      key: "preferLossless",
      type: "switch",
      label: "优先无损",
      description: "请求无损音质时优先尝试 FLAC",
      default: true
    },
    {
      key: "sidecarEnabled",
      type: "switch",
      label: "启用 sidecar 增强",
      description: "内置音源无法满足音质时，调用本地 sidecar 使用 yt-dlp 兜底",
      default: false
    },
    {
      key: "endpoint",
      type: "text",
      label: "Sidecar 地址",
      description: "仅在启用 sidecar 增强时使用",
      default: DEFAULT_ENDPOINT,
      placeholder: DEFAULT_ENDPOINT
    },
    {
      key: "token",
      type: "text",
      label: "Sidecar Token",
      description: "与 sidecar 的 UNM_TOKEN 保持一致；未设置 Token 时可留空",
      default: ""
    }
  ];

  // src/plugin.js
  var BUILTIN_PROVIDER_TIMEOUT = 3e3;
  var readStringSetting = (key, fallback) => {
    const value = splayer.getSetting(key);
    return typeof value === "string" && value.trim() ? value.trim() : fallback;
  };
  var readBooleanSetting = (key, fallback) => {
    const value = splayer.getSetting(key);
    return typeof value === "boolean" ? value : fallback;
  };
  var getSongId = (musicInfo) => {
    for (const field of ["id", "songmid", "songId"]) {
      const value = musicInfo?.[field];
      if (typeof value === "string" && /^\d+$/.test(value.trim())) return value.trim();
      if (typeof value === "number" && Number.isSafeInteger(value)) return String(value);
    }
    throw new Error("宿主未提供有效的网易云数字歌曲 ID");
  };
  var requestClient = createRequestClient(
    (url, options) => splayer.request(url, options),
    BUILTIN_PROVIDER_TIMEOUT
  );
  var searchCache = createPromiseCache(128);
  var runtimeContext = {
    request: requestClient,
    md5: (value) => splayer.utils.crypto.md5(value),
    searchCache,
    log: splayer.log
  };
  var resolver = createMusicResolver({
    providers: PROVIDERS,
    context: runtimeContext,
    log: splayer.log
  });
  var sidecarClient = createSidecarClient(requestClient);
  var getConfig = () => {
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
        token
      ])
    };
  };
  var handleMusicUrl = async ({ source, quality = "hq", musicInfo }) => {
    if (source !== "wy") throw new Error(`Splayer-UnblockMusic 不支持来源：${source}`);
    const songId = getSongId(musicInfo);
    const config = getConfig();
    const info = await getTrackInfo(musicInfo, songId, requestClient);
    const sidecar = config.sidecarEnabled ? {
      resolve: (trackInfo, requestedQuality, timeout) => sidecarClient.resolve(
        trackInfo,
        requestedQuality,
        timeout,
        config.endpoint,
        config.token
      )
    } : null;
    const result = await resolver.resolve({
      info,
      quality,
      sourceOrder: config.sourceOrder,
      preferLossless: config.preferLossless,
      sidecar,
      signature: `${config.signature}
${sidecarClient.signature(config.endpoint, config.token)}`
    });
    return {
      url: result.url,
      quality: result.quality,
      ...Number.isFinite(result.expire) ? { expire: result.expire } : {}
    };
  };
  splayer.register({
    sources: {
      wy: {
        name: "Splayer-UnblockMusic",
        actions: ["musicUrl"],
        qualities: [...QUALITIES]
      }
    },
    settings: PLUGIN_SETTINGS
  });
  for (const setting of PLUGIN_SETTINGS) {
    splayer.onSettingChange(setting.key, () => {
      resolver.clear();
      searchCache.clear();
    });
  }
  splayer.on("musicUrl", handleMusicUrl);
})();
