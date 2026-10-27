import crypto from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pluginSource = await readFile(path.join(root, "plugin", "splayer-unblockmusic.js"), "utf8");

/**
 * 创建可播放的 FLAC 响应头
 * @returns 8192 字节 FLAC 片段
 */
export const createFlacBytes = () => {
  const bytes = new Uint8Array(8192);
  bytes.set([0x66, 0x4c, 0x61, 0x43, 0x80, 0x00, 0x00, 0x22]);
  const sampleRate = 44_100;
  const channels = 2;
  const bitsPerSample = 24;
  const totalSamples = 11_895_828;
  const offset = 18;
  bytes[offset] = sampleRate >> 12;
  bytes[offset + 1] = sampleRate >> 4;
  bytes[offset + 2] =
    ((sampleRate & 15) << 4) | ((channels - 1) << 1) | (((bitsPerSample - 1) >> 4) & 1);
  bytes[offset + 3] = (((bitsPerSample - 1) & 15) << 4) | (Math.floor(totalSamples / 2 ** 32) & 15);
  bytes[offset + 4] = (totalSamples >>> 24) & 255;
  bytes[offset + 5] = (totalSamples >>> 16) & 255;
  bytes[offset + 6] = (totalSamples >>> 8) & 255;
  bytes[offset + 7] = totalSamples & 255;
  return bytes;
};

/**
 * 创建可识别的 128kbps MP3 响应头
 * @returns 8192 字节 MP3 片段
 */
export const createMp3Bytes = () => {
  const bytes = new Uint8Array(8192);
  bytes.set([0xff, 0xfb, 0x90, 0xc4, 0x00, 0x00, 0x00, 0x00]);
  return bytes;
};

export const KUWO_SEARCH_BODY = {
  content: [
    {},
    {
      musicpage: {
        abslist: [
          {
            MUSICRID: "MUSIC_228908",
            SONGNAME: "晴天",
            ARTIST: "周杰伦",
            DURATION: "269",
            ALBUMID: "1293",
            ALBUM: "叶惠美",
          },
          {
            MUSICRID: "MUSIC_80456317",
            SONGNAME: "晴天 (Live)",
            ARTIST: "周杰伦",
            DURATION: "249",
            ALBUMID: "11246770",
            ALBUM: "演唱会",
          },
        ],
      },
    },
  ],
};

export const KUGOU_SEARCH_BODY = {
  data: {
    info: [
      {
        hash: "b3a52a7a958bf0aed0ebfba2e9a818b7",
        "320hash": "1b56126a8a03924f1dd066259c095cbc",
        sqhash: "0a69169202de95aaf24a9944ccf0730d",
        songname: "晴天",
        singername: "周杰伦",
        duration: 269,
        album_id: "966846",
        album_name: "叶惠美",
      },
    ],
  },
};

/**
 * 创建阿里云式 FLAC 探测响应
 * @param url - 播放地址
 * @returns 二进制响应
 */
export const flacResponse = (url) => ({
  status: 206,
  headers: {
    "content-type": "audio/x-flac",
    "content-range": "bytes 0-8191/55397039",
  },
  body: createFlacBytes(),
  url,
});

/**
 * 创建 MP3 探测响应
 * @param url - 播放地址
 * @returns 二进制响应
 */
export const mp3Response = (url) => ({
  status: 206,
  headers: {
    "content-type": "audio/mpeg",
    "content-range": "bytes 0-8191/181521",
  },
  body: createMp3Bytes(),
  url,
});

/**
 * 载入构建后的插件并模拟 SPlayer 宿主
 * @param options - 请求实现与设置覆盖
 * @returns 注册信息、处理器和宿主状态
 */
export const loadPlugin = async ({ request, settings = {} }) => {
  const registration = {};
  const handlers = {};
  const settingHandlers = {};
  const requests = [];
  const logs = [];
  const hostSettings = {
    sourceOrder: "bodian,kugou,kuwo",
    preferLossless: true,
    sidecarEnabled: false,
    endpoint: "http://127.0.0.1:18321",
    token: "",
    ...settings,
  };

  const splayer = {
    pluginId: "splayer.unblock-music",
    apiLevel: 2,
    register(args) {
      Object.assign(registration, args);
    },
    on(action, handler) {
      handlers[action] = handler;
    },
    onSettingChange(key, handler) {
      settingHandlers[key] = handler;
    },
    getSetting(key) {
      return hostSettings[key];
    },
    async request(url, options) {
      requests.push({ url, options });
      return request(url, options);
    },
    log: {
      debug(message) {
        logs.push(["debug", message]);
      },
      info(message) {
        logs.push(["info", message]);
      },
      warn(message) {
        logs.push(["warn", message]);
      },
      error(message) {
        logs.push(["error", message]);
      },
    },
    utils: {
      crypto: {
        md5(value) {
          return crypto.createHash("md5").update(value).digest("hex");
        },
      },
    },
  };

  vm.runInNewContext(
    pluginSource,
    {
      splayer,
      URL,
      URLSearchParams,
      Uint8Array,
      ArrayBuffer,
      console,
      setTimeout,
      clearTimeout,
    },
    { timeout: 1_000 },
  );

  return {
    registration,
    handlers,
    settingHandlers,
    requests,
    logs,
    settings: hostSettings,
    /**
     * 修改设置并触发插件监听
     * @param key - 设置键
     * @param value - 新值
     */
    changeSetting(key, value) {
      hostSettings[key] = value;
      settingHandlers[key]?.(value);
    },
  };
};
