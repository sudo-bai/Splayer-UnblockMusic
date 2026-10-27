import { BUILTIN_SOURCES } from "./providers/index.js";

export const DEFAULT_ENDPOINT = "http://127.0.0.1:18321";
export const DEFAULT_SOURCE_ORDER = "bodian,kugou,kuwo";

/**
 * 解析用户配置的内置音源顺序
 * @param value - 逗号分隔的音源顺序
 * @returns 去重后的有效音源
 */
export const parseSourceOrder = (value) => {
  const sources = String(value ?? "")
    .split(",")
    .map((source) => source.trim().toLowerCase())
    .filter((source) => BUILTIN_SOURCES.includes(source));
  return [...new Set(sources)].length ? [...new Set(sources)] : [...BUILTIN_SOURCES];
};

export const PLUGIN_SETTINGS = [
  {
    key: "sourceOrder",
    type: "text",
    label: "内置音源顺序",
    description: "逗号分隔，可选 bodian、kugou、kuwo",
    default: DEFAULT_SOURCE_ORDER,
    placeholder: DEFAULT_SOURCE_ORDER,
  },
  {
    key: "preferLossless",
    type: "switch",
    label: "优先无损",
    description: "请求无损音质时优先尝试 FLAC",
    default: true,
  },
  {
    key: "sidecarEnabled",
    type: "switch",
    label: "启用 sidecar 增强",
    description: "内置音源无法满足音质时，调用本地 sidecar 使用 yt-dlp 等额外音源",
    default: false,
  },
  {
    key: "endpoint",
    type: "text",
    label: "Sidecar 地址",
    description: "仅在启用 sidecar 增强时使用",
    default: DEFAULT_ENDPOINT,
    placeholder: DEFAULT_ENDPOINT,
  },
  {
    key: "token",
    type: "text",
    label: "Sidecar Token",
    description: "与 sidecar 的 UNM_TOKEN 保持一致；未设置 Token 时可留空",
    default: "",
  },
];
