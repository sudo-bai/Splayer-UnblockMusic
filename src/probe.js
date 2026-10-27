import { createError } from "./errors.js";

/**
 * 读取不区分大小写的响应头
 * @param headers - 宿主响应头
 * @param name - 响应头名称
 * @returns 响应头值
 */
const readHeader = (headers, name) => {
  if (!headers || typeof headers !== "object") return "";
  const key = Object.keys(headers).find((item) => item.toLowerCase() === name);
  return key ? String(headers[key] ?? "") : "";
};

/**
 * 把宿主返回的二进制正文转为 Uint8Array
 * @param body - 宿主响应正文
 * @returns 二进制数据
 */
const toBytes = (body) => {
  if (body instanceof Uint8Array) return body;
  if (body instanceof ArrayBuffer) return new Uint8Array(body);
  if (ArrayBuffer.isView(body)) {
    return new Uint8Array(body.buffer, body.byteOffset, body.byteLength);
  }
  return new Uint8Array();
};

/**
 * 解析 FLAC STREAMINFO 元数据
 * @param bytes - 音频头部
 * @param size - 完整文件大小
 * @returns FLAC 码率与采样信息
 */
const parseFlac = (bytes, size) => {
  const offset = 18;
  if (bytes.length < offset + 8) return { format: "flac", bitrate: 999_000 };
  const sampleRate = (bytes[offset] << 12) | (bytes[offset + 1] << 4) | (bytes[offset + 2] >> 4);
  const bitsPerSample = (((bytes[offset + 2] & 1) << 4) | (bytes[offset + 3] >> 4)) + 1;
  const totalSamples =
    (bytes[offset + 3] & 15) * 4_294_967_296 +
    bytes[offset + 4] * 16_777_216 +
    bytes[offset + 5] * 65_536 +
    bytes[offset + 6] * 256 +
    bytes[offset + 7];
  const duration = sampleRate > 0 && totalSamples > 0 ? totalSamples / sampleRate : 0;
  const bitrate = size > 0 && duration > 0 ? Math.round((size * 8) / duration) : 999_000;
  return { format: "flac", bitrate, sampleRate, bitsPerSample };
};

/**
 * 解析 MP3 帧头码率
 * @param bytes - 音频头部
 * @returns 码率，无法识别时为 null
 */
const parseMp3 = (bytes) => {
  const table = {
    3: {
      3: [0, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448],
      2: [0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384],
      1: [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
    },
    2: {
      3: [0, 32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256],
      2: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
    },
  };
  table[2][1] = table[2][2];
  table[0] = table[2];

  let pointer = 0;
  if (bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) {
    const size =
      ((bytes[6] & 127) << 21) |
      ((bytes[7] & 127) << 14) |
      ((bytes[8] & 127) << 7) |
      (bytes[9] & 127);
    pointer = 10 + size;
  }

  for (; pointer + 3 < bytes.length; pointer += 1) {
    const first = bytes[pointer];
    const second = bytes[pointer + 1];
    const third = bytes[pointer + 2];
    if (first !== 0xff || (second & 0xe0) !== 0xe0) continue;
    const version = (second >> 3) & 3;
    const layer = (second >> 1) & 3;
    const bitrateIndex = third >> 4;
    const value = table[version]?.[layer]?.[bitrateIndex];
    if (Number.isFinite(value) && value > 0) return value * 1_000;
  }
  return null;
};

/**
 * 探测播放地址是否可访问并提取实际音质
 * @param url - 播放地址
 * @param requestClient - 网络请求客户端
 * @returns 可播放地址及音频信息
 */
export const probeAudio = async (url, requestClient) => {
  const response = await requestClient.bytes(url, {
    method: "GET",
    headers: {
      Range: "bytes=0-8191",
      "Accept-Encoding": "identity",
    },
  });
  const bytes = toBytes(response.body);
  if (bytes.length === 0) throw createError("播放地址返回空音频", "AUDIO_EMPTY");

  const contentRange = readHeader(response.headers, "content-range");
  const contentLength = readHeader(response.headers, "content-length");
  const size = Number(contentRange.split("/").pop() || contentLength) || null;
  const contentType = readHeader(response.headers, "content-type").toLowerCase();
  const isFlac = bytes[0] === 0x66 && bytes[1] === 0x4c && bytes[2] === 0x61 && bytes[3] === 0x43;
  const audio =
    isFlac || contentType.includes("flac")
      ? parseFlac(bytes, size)
      : { format: "mp3", bitrate: parseMp3(bytes) };

  return { url, size, ...audio };
};
