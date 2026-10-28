# Splayer-UnblockMusic

为 [SPlayer-Next](https://github.com/SPlayer-Dev/SPlayer-Next) 的网易云来源 `wy` 补充播放地址。

- **默认安装只需要导入一个 `.js` 文件**
- 内置酷狗、波点、酷我 HTTP 音源，无需 Node.js、sidecar 或 `yt-dlp`
- 可选启用本地 sidecar，使用 `yt-dlp` 等额外音源兜底
- 不修改 SPlayer-Next 主程序，不影响应用更新
- 只使用 SPlayer 公开插件 API，插件 API level 2，权限 `network`

![SPlayer-Next source plugin](https://img.shields.io/badge/SPlayer--Next-source%20plugin-07c160)
![Plugin API](https://img.shields.io/badge/plugin%20API-level%202-blue)
![License](https://img.shields.io/badge/license-AGPL--3.0-blue)

## 架构

```text
SPlayer-Next
  └─ splayer.unblock-music 单文件插件
       ├─ 内置 provider
       │    ├─ bodian
       │    ├─ kugou
       │    └─ kuwo
       │
       └─ 可选 sidecar fallback
            ├─ @unblockneteasemusic/server
            └─ yt-dlp
```

插件运行在 SPlayer 的 JavaScript 沙箱中，只使用以下公开能力：

- `splayer.register`
- `splayer.on`
- `splayer.getSetting`
- `splayer.onSettingChange`
- `splayer.request`
- `splayer.log`
- `splayer.utils`

插件产物不包含 `require`、ES `import`、`child_process`、`fs`、WebAssembly、DOM 或 Electron API。

## 直接安装插件

下载或构建：

```text
plugin/splayer-unblockmusic.js
```

打开 SPlayer-Next：

```text
设置 → 插件管理 → 本地导入
```

导入该文件并启用即可。默认配置不调用 sidecar，也不要求安装 Node.js。

播放网易云歌曲时，如果官方播放地址不可用，SPlayer 会调用本插件，插件按以下默认顺序解析：

```text
bodian → kugou → kuwo
```

## 插件设置

| 设置          | 默认值                   | 说明                                 |
| ------------- | ------------------------ | ------------------------------------ |
| 内置音源顺序  | `bodian,kugou,kuwo`      | 逗号分隔；未知音源会被忽略           |
| 优先无损      | 开启                     | 请求无损音质时优先尝试 FLAC          |
| 启用 sidecar  | **关闭**                 | 开启后仅在内部音源无法满足音质时兜底 |
| Sidecar 地址  | `http://127.0.0.1:18321` | sidecar 未启用时不访问               |
| Sidecar Token | 空                       | 与 sidecar 的 `UNM_TOKEN` 一致       |

修改设置后会自动清空运行缓存。

## 解析策略

1. 内置音源严格按设置中的顺序执行
2. 每个音源都有独立超时，达到目标音质后立即停止
3. 低于目标音质时继续尝试后续音源，并保留当前最佳结果
4. 如果已启用 sidecar 且内部音源未达到目标音质，再调用 sidecar
5. 最终返回音质更高的结果
6. 相同请求在 60 秒内复用缓存，并合并并发请求

时间预算：

```text
波点：5 秒
酷狗：4.5 秒
酷我：3.5 秒
可选 sidecar：最多 5 秒
总解析预算：16 秒
```

SPlayer `musicUrl` 的超时是 20 秒，插件会在其之前结束解析。

## 内置音源

### 波点

- 通过酷我公开搜索接口找到歌曲
- 发送解锁请求后获取 FLAC 或 320kbps MP3
- 默认作为第一优先音源

### 酷狗

- 使用酷狗公开搜索接口匹配歌曲
- 依次尝试 SQ、320kbps 和普通哈希
- 部分版权歌曲可能返回付费限制，此时自动继续下一个音源

### 酷我

- 使用酷我搜索接口匹配歌曲
- 通过公开转换接口获取 MP3
- 作为最后的纯 HTTP 兜底

音质根据实际音频头部探测，不以接口返回值直接推断。FLAC 会读取 STREAMINFO，MP3 会读取帧头码率。

## 可选 sidecar

只有需要 `yt-dlp` 或其他 UNM 音源时才需要 sidecar。

### 安装

```bash
git clone https://github.com/sudo-bai/Splayer-UnblockMusic.git
cd Splayer-UnblockMusic
pnpm install
pnpm systemd:install
```

安装脚本会创建：

```text
~/.config/splayer-unblockmusic/env
~/.config/systemd/user/splayer-unblockmusic.service
```

默认 sidecar 只运行 `ytdlp`：

```dotenv
UNM_SOURCES=ytdlp
```

读取 Token：

```bash
grep '^UNM_TOKEN=' ~/.config/splayer-unblockmusic/env
```

然后在 SPlayer 插件设置中：

1. 打开“启用 sidecar 增强”
2. 填写 `http://127.0.0.1:18321`
3. 填写读取到的 Token

### YouTube Cookie

YouTube 对部分网络会要求登录验证。出现以下错误时，需要为 yt-dlp 提供 Cookie：

```text
Sign in to confirm you're not a bot
Use --cookies-from-browser or --cookies for the authentication
```

推荐使用浏览器扩展导出仅包含 `youtube.com` 的 `cookies.txt`：

```bash
mkdir -p ~/.config/yt-dlp ~/.config/splayer-unblockmusic
# 将导出的 cookies.txt 保存到下面这个路径
chmod 600 ~/.config/splayer-unblockmusic/cookies.txt
```

创建 `~/.config/yt-dlp/config`：

```text
--cookies /home/skadi/.config/splayer-unblockmusic/cookies.txt
```

然后重启：

```bash
systemctl --user restart splayer-unblockmusic.service
```

也可以尝试 `--cookies-from-browser`，但浏览器 Cookie 加密、Profile 和登录态可能导致读取失败。

### 配置

`~/.config/splayer-unblockmusic/env`：

```dotenv
UNM_HOST=127.0.0.1
UNM_PORT=18321
UNM_TOKEN=change-me
UNM_SOURCES=ytdlp
ENABLE_FLAC=true
LOG_LEVEL=warn
YTDLP_PATH=/usr/bin/yt-dlp
```

| 变量              | 默认值      | 说明                        |
| ----------------- | ----------- | --------------------------- |
| `UNM_HOST`        | `127.0.0.1` | 监听地址                    |
| `UNM_PORT`        | `18321`     | 监听端口                    |
| `UNM_TOKEN`       | 空          | Bearer Token                |
| `UNM_SOURCES`     | `ytdlp`     | 按顺序尝试的 UNM 音源       |
| `ENABLE_FLAC`     | `true`      | 是否请求无损音源            |
| `UNM_MIN_BITRATE` | `0`         | 期望最低码率                |
| `YTDLP_PATH`      | 空          | `yt-dlp` 可执行文件路径     |
| `LOG_LEVEL`       | `warn`      | 上游 UNM 与 yt-dlp 日志级别 |

可用的上游音源：

```text
qq,kugou,kuwo,bodian,migu,joox,youtube,youtubedl,ytdlp,bilibili,bilivideo,pyncmd
```

QQ、咪咕、JOOX 等音源可能需要上游库支持的 Cookie 环境变量。

### systemd 管理

```bash
systemctl --user status splayer-unblockmusic.service
systemctl --user restart splayer-unblockmusic.service
journalctl --user -u splayer-unblockmusic.service -f
```

项目快捷命令：

```bash
pnpm systemd:status
pnpm systemd:logs
```

卸载服务但保留配置：

```bash
pnpm systemd:uninstall
```

同时删除配置：

```bash
pnpm systemd:uninstall -- --purge-config
```

不使用 systemd 时也可以直接运行：

```bash
UNM_TOKEN=change-me pnpm start
```

## HTTP API

sidecar 只暴露固定的解析协议，不接受调用方指定音源或命令。

### 健康检查

```http
GET /health
```

无需认证。

### 解析

```http
POST /v1/resolve
Authorization: Bearer change-me
Content-Type: application/json

{
  "id": "186016",
  "quality": "lossless"
}
```

响应：

```json
{
  "url": "https://cdn.example/song.flac",
  "provider": "bodian",
  "bitrate": 1642935,
  "size": 55397039,
  "quality": "lossless",
  "requestedQuality": "lossless",
  "degraded": false,
  "cached": false
}
```

支持音质：

```text
lq,sq,hq,lossless,hi-res
```

## 安全设计

- 插件默认不访问 sidecar
- sidecar 默认只监听 `127.0.0.1`
- 建议始终设置 `UNM_TOKEN`
- Token 只作为 Bearer Header 使用，不写入日志
- API 只接受网易云数字 ID
- 请求体最大 16KB
- 同时最多处理 2 个 sidecar 解析请求
- `yt-dlp` 使用固定参数执行
- 不输出完整播放地址

不要把无认证的 sidecar 暴露到公网。

## 开发

```bash
pnpm install
pnpm check
pnpm test
```

构建：

```bash
pnpm build
```

源码位于 `src/`，通过 esbuild 打包为：

```text
plugin/splayer-unblockmusic.js
```

`pnpm check` 会：

- 重新构建插件
- 检查产物没有 Node、DOM、Electron 或 WebAssembly 依赖
- 检查插件 ID、API level 和权限
- 检查 Prettier 格式
- 检查 shell 脚本语法

测试不依赖真实外网，覆盖：

- 酷狗、波点、酷我 provider
- 无 sidecar 时的完整解析链路
- sidecar 默认关闭和显式开启
- sidecar 认证与 fallback
- 音源顺序、音质降级和超时
- 缓存与并发请求复用
- HTTP 服务、配置和 systemd 脚本

## 常见问题

### 只导入插件能用吗

可以。默认使用纯 JS 内置音源，不需要 Node.js、sidecar 或 `yt-dlp`。

### 为什么还需要 sidecar

sidecar 只用于其他 UNM 音源和 `yt-dlp`。不需要这些功能时不要开启。

### 日志里出现酷狗取流失败

这通常表示该歌曲在酷狗受版权或付费限制。插件会自动继续波点、酷我，必要时再尝试 sidecar。

### SPlayer 没有调用插件

说明官方接口已经返回可用地址。SPlayer 只在官方地址不可用时调用音源插件。

### 返回地址失效

播放地址通常有时效，插件只缓存 60 秒。重新播放会重新解析。

## 限制

- 只处理 SPlayer 的网易云来源 `wy`
- 内置音源依赖第三方公开接口，接口变化可能导致某个音源暂时不可用
- 自动匹配可能把 Live、Remix 或翻唱版本匹配错
- `yt-dlp` 的可用性取决于网络环境和 YouTube 风控
- 不绕过 DRM，不提供音乐内容

## 许可证与免责声明

本项目使用 [AGPL-3.0-only](./LICENSE)。

第三方组件和行为参考：

- [UnblockNeteaseMusic/server](https://github.com/UnblockNeteaseMusic/server)，LGPL-3.0-only
- [yt-dlp](https://github.com/yt-dlp/yt-dlp)，Unlicense

详见 [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md)。

本项目是社区项目，与 SPlayer-Next、网易云音乐、UnblockNeteaseMusic、yt-dlp 均无官方隶属或背书关系。请仅使用你有权访问和播放的音乐，并遵守相关平台服务条款及当地法律法规。
