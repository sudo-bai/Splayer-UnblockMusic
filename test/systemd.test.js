import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("systemd 服务模板包含稳定运行配置", () => {
  const template = fs.readFileSync(
    path.join(root, "scripts", "splayer-unblockmusic.service.in"),
    "utf8",
  );
  assert.match(template, /Restart=on-failure/);
  assert.match(template, /NoNewPrivileges=true/);
  assert.match(template, /EnvironmentFile=-@ENV_FILE@/);
  assert.match(template, /ExecStart="@NODE_BIN@" "@PROJECT_DIR@\/src\/sidecar\.js"/);
});

test("安装脚本 dry-run 能渲染绝对路径", () => {
  const result = spawnSync("bash", ["scripts/install-systemd.sh", "--dry-run"], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, XDG_CONFIG_HOME: "/tmp/splayer-unblockmusic-systemd-test" },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /WorkingDirectory=\/.+Splayer-UnblockMusic/);
  assert.match(result.stdout, /ExecStart="\/.+" "\/.+\/src\/sidecar\.js"/);
  assert.match(result.stdout, /UNM_TOKEN=<生成的 Token>/);
});

test("卸载脚本 dry-run 不修改系统", () => {
  const result = spawnSync("bash", ["scripts/uninstall-systemd.sh", "--dry-run"], {
    cwd: root,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /systemctl --user disable --now splayer-unblockmusic\.service/);
});
