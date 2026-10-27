#!/usr/bin/env bash
set -euo pipefail

UNIT_NAME="splayer-unblockmusic.service"
CONFIG_HOME="${XDG_CONFIG_HOME:-$HOME/.config}"
SYSTEMD_DIR="$CONFIG_HOME/systemd/user"
UNIT_FILE="$SYSTEMD_DIR/$UNIT_NAME"
ENV_DIR="$CONFIG_HOME/splayer-unblockmusic"
ENV_FILE="$ENV_DIR/env"
PURGE_CONFIG=0
DRY_RUN=0

usage() {
  cat <<'USAGE'
用法: uninstall-systemd.sh [--purge-config] [--dry-run]

停用并删除 splayer-unblockmusic systemd 用户服务
  --purge-config  同时删除环境文件中的 Token 和配置
  --dry-run       只显示将执行的操作
  -h, --help      显示帮助
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --purge-config)
      PURGE_CONFIG=1
      shift
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

if [[ $DRY_RUN -eq 1 ]]; then
  echo "systemctl --user disable --now $UNIT_NAME"
  echo "rm -f $UNIT_FILE"
  echo "systemctl --user daemon-reload"
  echo "systemctl --user reset-failed $UNIT_NAME"
  [[ $PURGE_CONFIG -eq 1 ]] && echo "rm -f $ENV_FILE"
  exit 0
fi

systemctl --user disable --now "$UNIT_NAME" >/dev/null 2>&1 || true
rm -f "$UNIT_FILE"
systemctl --user daemon-reload >/dev/null 2>&1 || true
systemctl --user reset-failed "$UNIT_NAME" >/dev/null 2>&1 || true

if [[ $PURGE_CONFIG -eq 1 ]]; then
  rm -f "$ENV_FILE"
  rmdir "$ENV_DIR" 2>/dev/null || true
  echo "已删除服务与环境配置"
else
  echo "已删除服务，保留配置: $ENV_FILE"
fi
