import { resolveBodian } from "./bodian.js";
import { resolveKugou } from "./kugou.js";
import { resolveKuwo } from "./kuwo.js";

export const PROVIDERS = {
  bodian: resolveBodian,
  kugou: resolveKugou,
  kuwo: resolveKuwo,
};

export const BUILTIN_SOURCES = Object.keys(PROVIDERS);
