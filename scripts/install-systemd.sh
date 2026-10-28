#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
UNIT_NAME="splayer-unblockmusic.service"
CONFIG_HOME="${XDG_CONFIG_HOME:-$HOME/.config}"
SYSTEMD_DIR="$CONFIG_HOME/systemd/user"
ENV_DIR="$CONFIG_HOME/splayer-unblockmusic"
ENV_FILE="$ENV_DIR/env"
UNIT_FILE="$SYSTEMD_DIR/$UNIT_NAME"
TEMPLATE="$ROOT_DIR/scripts/splayer-unblockmusic.service.in"
TOKEN="${UNM_TOKEN:-}"
DRY_RUN=0

usage() {
  cat <<'USAGE'
用法: install-systemd.sh [--token TOKEN] [--dry-run]

安装并启用 systemd 用户服务 splayer-unblockmusic.service
  --token TOKEN  首次安装时写入访问 Token；省略则自动生成
  --dry-run      只显示生成内容，不写入或启动服务
  -h, --help     显示帮助
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --token)
      [[ $# -ge 2 ]] || { echo "缺少 --token 参数" >&2; exit 1; }
      TOKEN="$2"
      shift 2
      ;;
    --dry-run)
      DRY_RUN=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "未知参数: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

[[ -f "$TEMPLATE" ]] || { echo "缺少服务模板: $TEMPLATE" >&2; exit 1; }
command -v node >/dev/null 2>&1 || { echo "未找到 node" >&2; exit 1; }
NODE_BIN="$(command -v node)"
YTDLP_BIN="$(command -v yt-dlp 2>/dev/null || true)"

if [[ -z "$TOKEN" ]]; then
  TOKEN="$(node -e 'process.stdout.write(require("node:crypto").randomBytes(24).toString("hex"))')"
fi
if [[ ! "$TOKEN" =~ ^[A-Za-z0-9._~-]+$ ]]; then
  echo "Token 只能包含字母、数字和 . _ ~ -" >&2
  exit 1
fi

UNIT_CONTENT="$(<"$TEMPLATE")"
UNIT_CONTENT="${UNIT_CONTENT//@PROJECT_DIR@/$ROOT_DIR}"
UNIT_CONTENT="${UNIT_CONTENT//@ENV_FILE@/$ENV_FILE}"
UNIT_CONTENT="${UNIT_CONTENT//@NODE_BIN@/$NODE_BIN}"

if [[ $DRY_RUN -eq 1 ]]; then
  echo "=== $UNIT_FILE ==="
  printf '%s\n' "$UNIT_CONTENT"
  echo
  echo "=== $ENV_FILE ==="
  if [[ -f "$ENV_FILE" ]]; then
    echo "已存在，将保留现有配置"
  else
    echo "UNM_HOST=127.0.0.1"
    echo "UNM_PORT=18321"
    echo "UNM_TOKEN=<生成的 Token>"
    echo "LOG_LEVEL=warn"
    if [[ -n "$YTDLP_BIN" ]]; then
      echo "YTDLP_PATH=$YTDLP_BIN"
    else
      echo "YTDLP_PATH=yt-dlp"
    fi
    echo "# YTDLP_COOKIES=$ENV_DIR/cookies.txt"
    echo "# YTDLP_COOKIES_FROM_BROWSER=brave:/path/to/profile"
  fi
  exit 0
fi

systemctl --user show-environment >/dev/null 2>&1 || {
  echo "systemd 用户实例不可用，请确认系统使用 systemd 且当前用户已登录" >&2
  exit 1
}

mkdir -p "$SYSTEMD_DIR" "$ENV_DIR"

if [[ ! -f "$ENV_FILE" ]]; then
  ENV_TMP="$(mktemp "$ENV_DIR/env.XXXXXX")"
  chmod 600 "$ENV_TMP"
  {
    echo "UNM_HOST=127.0.0.1"
    echo "UNM_PORT=18321"
    echo "UNM_TOKEN=$TOKEN"
    echo "LOG_LEVEL=warn"
    if [[ -n "$YTDLP_BIN" ]]; then
      echo "YTDLP_PATH=$YTDLP_BIN"
    else
      echo "# yt-dlp 未找到；安装后可添加 YTDLP_PATH=/path/to/yt-dlp"
      echo "YTDLP_PATH=yt-dlp"
    fi
    echo "# YTDLP_COOKIES=$ENV_DIR/cookies.txt"
    echo "# YTDLP_COOKIES_FROM_BROWSER=brave:/path/to/profile"
  } >"$ENV_TMP"
  mv "$ENV_TMP" "$ENV_FILE"
  echo "已创建环境文件: $ENV_FILE"
else
  echo "保留现有环境文件: $ENV_FILE"
fi

UNIT_TMP="$(mktemp "$SYSTEMD_DIR/$UNIT_NAME.XXXXXX")"
printf '%s\n' "$UNIT_CONTENT" >"$UNIT_TMP"
chmod 644 "$UNIT_TMP"
mv "$UNIT_TMP" "$UNIT_FILE"

systemctl --user daemon-reload
systemctl --user enable --now "$UNIT_NAME"
systemctl --user --no-pager --full status "$UNIT_NAME" || true

echo
echo "服务已安装并启动"
echo "状态: systemctl --user status $UNIT_NAME"
echo "日志: journalctl --user -u $UNIT_NAME -f"
echo "配置: $ENV_FILE"
echo "插件 Token: 可从 $ENV_FILE 读取"
