import assert from "node:assert/strict";
import { test } from "node:test";
import { createYtDlpRunner, normalizeYtDlpResult } from "../src/ytdlp.js";

const data = {
  url: "https://rr2---sn.test.googlevideo.com/videoplayback?expire=1793212497",
  ext: "m4a",
  abr: 128,
  filesize: 5_152_105,
};

test("规范化 yt-dlp 播放结果并识别降级", () => {
  const result = normalizeYtDlpResult(data, "lossless");
  assert.equal(result.quality, "lq");
  assert.equal(result.bitrate, 128_000);
  assert.equal(result.degraded, true);
  assert.equal(result.expire, 1_793_212_497_000);
});

test("识别 FLAC 为无损", () => {
  const result = normalizeYtDlpResult(
    { url: "https://cdn.test/song.flac", ext: "flac", acodec: "flac" },
    "lossless",
  );
  assert.equal(result.quality, "lossless");
  assert.equal(result.degraded, false);
});

test("传入 Cookie 文件并固定搜索参数", async () => {
  let call;
  const runner = createYtDlpRunner({
    executable: "/usr/bin/yt-dlp",
    cookies: "/tmp/cookies.txt",
    execFileImpl: async (...args) => {
      call = args;
      return { stdout: JSON.stringify(data), stderr: "" };
    },
  });
  const result = await runner.run("晴天 - 周杰伦", 10_000, "lossless");
  assert.equal(result.provider, "ytdlp");
  assert.equal(call[0], "/usr/bin/yt-dlp");
  assert.ok(call[1].includes("--cookies"));
  assert.ok(call[1].includes("/tmp/cookies.txt"));
  assert.equal(call[1].at(-1), "ytsearch1:晴天 - 周杰伦");
});

test("YouTube bot check 返回可读 Cookie 错误", async () => {
  const runner = createYtDlpRunner({
    execFileImpl: async () => {
      throw Object.assign(new Error("exit 1"), {
        stderr: "ERROR: Sign in to confirm you're not a bot",
      });
    },
  });
  await assert.rejects(() => runner.run("晴天", 10_000, "hq"), {
    code: "YTDLP_COOKIE_REQUIRED",
  });
});
