import assert from "node:assert/strict";
import { test } from "node:test";
import { pickBestCandidate } from "../src/matching.js";

const info = {
  name: "晴天",
  artists: ["周杰伦"],
  durationMs: 269_000,
};

test("匹配时优先选择非 Live 的同名候选", () => {
  const candidates = [
    {
      id: "live",
      name: "晴天 (Live)",
      artists: ["周杰伦"],
      durationMs: 249_000,
    },
    {
      id: "studio",
      name: "晴天",
      artists: ["周杰伦"],
      durationMs: 269_000,
    },
  ];
  assert.equal(pickBestCandidate(candidates, info).id, "studio");
});

test("只有 Live 版本时不会冒充原曲", () => {
  const candidates = [
    {
      id: "live",
      name: "晴天 (Live)",
      artists: ["周杰伦"],
      durationMs: 269_000,
    },
  ];
  assert.equal(pickBestCandidate(candidates, info), null);
});

test("拒绝同名但歌手不同的候选", () => {
  const candidates = [
    {
      id: "other-artist",
      name: "晴天",
      artists: ["其他歌手"],
      durationMs: 269_000,
    },
  ];
  assert.equal(pickBestCandidate(candidates, info), null);
});

test("拒绝时长相差超过 20 秒的候选", () => {
  const candidates = [
    {
      id: "long-version",
      name: "晴天",
      artists: ["周杰伦"],
      durationMs: 300_000,
    },
  ];
  assert.equal(pickBestCandidate(candidates, info), null);
});
