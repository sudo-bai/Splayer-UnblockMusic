# Third-Party Notices

## UnblockNeteaseMusic/server

- Project: https://github.com/UnblockNeteaseMusic/server
- npm package: `@unblockneteasemusic/server`
- Version: `0.28.0`
- License: LGPL-3.0-only
- License texts: `LICENSES/LGPL-3.0-only.txt`, `LICENSES/GPL-3.0-only.txt`

### Usage

The optional sidecar uses the package as a runtime dependency. The package is not bundled into `plugin/splayer-unblockmusic.js` and is not modified by this project.

The built-in HTTP providers in `src/providers/` contain compatibility logic adapted from the upstream LGPL-3.0-only provider implementations. The project as a whole is distributed under AGPL-3.0-only, and the applicable LGPL/GPL license texts are included in this repository.

## yt-dlp

- Project: https://github.com/yt-dlp/yt-dlp
- License: Unlicense
- Usage: Optional external executable invoked by the sidecar

This repository does not bundle yt-dlp. Users install and update it separately.

## SPlayer-Next

- Project: https://github.com/SPlayer-Dev/SPlayer-Next
- License: AGPL-3.0
- Usage: Target host application and public plugin API

This project is not affiliated with or endorsed by the SPlayer-Next project.

## Build dependencies

The plugin is bundled with [esbuild](https://github.com/evanw/esbuild), and source formatting is checked with [Prettier](https://github.com/prettier/prettier). These are development-only MIT-licensed dependencies and are not included in the imported plugin file.
