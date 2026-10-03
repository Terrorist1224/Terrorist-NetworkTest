# Terrorist NetworkTest

Terrorist NetworkTest 是面向 Windows 的桌面网络下载测速工具。它使用持续下载测量当前网络速度、吞吐量和累计流量，支持暂停续测、历史记录及托盘后台运行。

## 功能

- 下载测速，可选择 0（自动）、4、8、16 或 32 个线程；自动模式固定使用 8 个线程。
- 内置和彩云、Cloudflare Speed、Cachefly、Steam Akamai 和 Steam Cloudflare 通道，也可以添加自定义下载地址。
- 自动停止条件可选限量（GB）、限时（分钟）或不限制。
- 暂停后可修改线程和停止条件再继续。累计流量保留；限时只计算实际测速时间，暂停时钟不计入。
- 每秒速度曲线、实时速度和 Mbps 吞吐、累计流量及历史记录。
- 关闭主窗口后继续在托盘运行。历史记录最多保留最近 20 次测速。

本程序目前只测量本程序发起的下载流量，不测上传速度，也不统计其他应用的流量。计量值来自下载响应正文，不含 HTTP 报头、重传及其他程序的流量。

## 安装与升级

在 Windows 10/11 x64 上运行单文件安装程序。自行构建后，文件位于：

```text
release/Terrorist NetworkTest 1.0.0.exe
```

首次安装时可选择目标路径；安装器会在所选位置下创建 `TerroristNetWorkTest` 文件夹，默认只为当前用户安装。不创建桌面或开始菜单快捷方式。

升级时，先从托盘彻底退出程序，再运行新版安装包。安装器根据固定的应用 ID 定位原安装目录并覆盖程序文件；安装包排除 `data`，因此不会在升级时覆盖设置、通道和测速记录。**不要先卸载旧版**，卸载会删除这些数据。项目目前没有应用内自动更新功能；如果未来版本改变数据格式，仍需单独验证兼容性。建议升级前备份安装目录中的 `data` 文件夹。

## 数据与卸载

- 设置、自定义通道、测速记录、Chromium 会话数据、崩溃转储和应用临时文件保存在安装目录的 `data` 文件夹中。历史记录最多保留最近 20 条。
- 可通过 Windows“已安装的应用”或安装目录中的 `unins000.exe` 卸载。卸载会删除程序文件、`data` 和应用安装记录；需要保留设置或记录时，请先备份 `data`。
- 安装器会短暂使用 Windows 临时目录释放组件。打包脚本要求本机临时目录位于 C 盘。正常安装完成后，安装器创建的临时目录会清理；卸载器自身的临时副本可能按照 [Inno Setup 的说明](https://jrsoftware.org/isfaq.php)保留到下次 Windows 重启。
- 如果手动移动已安装的程序，请同时移动整个 `TerroristNetWorkTest` 文件夹；安装器记录的旧路径不会因手动移动而自动更新。

## 开发与构建

开发环境为 Windows 10/11 x64 和 Node.js 22.12 或更新版本。克隆项目后运行：

```powershell
npm ci
npm run dev
```

也可以在 Windows 上双击根目录的 `start-dev.cmd` 启动开发版。开发版数据保存在 `.tmp/user-data/`。

构建并生成安装程序：

```powershell
npm run package:win
```

脚本会先运行类型检查和测试，再构建应用并使用 [Inno Setup 安装脚本](installer/setup.iss)生成单文件安装程序，输出到 `release/`。打包需要本机安装 Inno Setup 7 编译器，且 Windows 临时目录必须位于 C 盘。发布新版本时，需要同步更新 `package.json`、`package-lock.json`、`src/shared/version.ts`、`installer/setup.iss` 和 `scripts/package-win.ps1` 中的版本号，再更新[更新日志](CHANGELOG.md)。本项目没有代码签名证书；Windows 可能对未签名安装程序显示安全提示。

常用命令：

| 命令                  | 用途                                   |
| --------------------- | -------------------------------------- |
| `npm run dev`         | 启动开发版                             |
| `npm run typecheck`   | 检查 TypeScript 和 Vue 类型            |
| `npm test`            | 运行测试                               |
| `npm run build`       | 构建 Electron 应用文件，不生成安装程序 |
| `npm run package:win` | 检查、构建并打包 Windows x64 安装程序  |

## 项目结构

```text
src/main/       Electron 主进程、测速引擎、设置和历史记录
src/preload/    渲染进程的受控 IPC 接口
src/renderer/   Vue 界面、图表和历史记录页面
src/shared/     主进程与渲染进程共用的数据类型
tests/          测速与计量测试
resources/      托盘与应用图标
installer/      Inno Setup 安装程序脚本
scripts/        打包和后台性能检查脚本
```

## 通道与服务使用

内置通道使用各服务当前公开的下载资源。服务商可能变更地址、限制并发或限制流量；测速前请确认自己有权使用这些资源，并遵守对应服务条款。自定义通道仅支持 HTTP 或 HTTPS 下载地址。

## 开源许可

本项目采用 [MIT License](LICENSE)。第三方服务及其下载资源仍受各自条款约束。
