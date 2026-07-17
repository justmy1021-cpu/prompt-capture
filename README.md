<div align="center">
  <img src="public/icons/icon-128.png" width="96" height="96" alt="Prompt Capture 图标">
  <h1>Prompt Capture</h1>
  <p>在网页中快速采集视觉灵感，并使用视觉模型生成图片、风格与布局 Prompt。</p>
</div>

## 功能介绍

Prompt Capture 是一款基于 Chrome Manifest V3 的视觉灵感采集扩展。点击扩展图标后，网页内会出现可拖动的悬浮工具栏，无需离开当前页面即可完成采集和 Prompt 生成。

- 支持框选网页区域、直接选择网页图片和采集当前页面。
- 选中内容后可预览、重选并确认生成。
- 生成图片 Prompt、风格 Prompt 和布局 Prompt。
- 支持阿里云百炼、火山引擎方舟和 OpenAI Compatible 视觉模型。
- 支持中文、英文和中英双语输出。
- 历史截图、Prompt 和模型配置保存在当前浏览器本地。
- 默认快捷键：Windows/Linux 使用 `Alt + Shift + C`，macOS 使用 `Option + Shift + C`。

## 下载安装

### 使用 Release 安装包

1. 打开仓库右侧的 **Releases** 页面。
2. 下载最新版本的 `Prompt-Capture-v0.2.5.zip`。
3. 将 ZIP 完整解压到一个固定文件夹，不要直接从压缩包内打开。
4. 在 Chrome 地址栏输入 `chrome://extensions/`。
5. 打开页面右上角的“开发者模式”。
6. 点击“加载已解压的扩展程序”。
7. 选择刚才解压的文件夹；该文件夹根目录中应能看到 `manifest.json`。

升级版本时，下载并解压新的安装包，然后在 `chrome://extensions/` 中点击 Prompt Capture 卡片上的“重新加载”。

## 首次配置

首次使用前，需要在插件设置页完成模型配置：

1. 点击扩展图标，打开网页内悬浮工具栏。
2. 点击右上角的设置按钮。
3. 选择模型服务商。
4. 填写模型 ID、API Key 和接口地址。
5. 点击“API Key 测试”。
6. 测试通过后返回采集页面。

当前内置配置：

| 服务商 | 默认模型或说明 |
| --- | --- |
| 阿里云百炼 | `qwen3-vl-flash` |
| 火山引擎方舟 | `doubao-seed-2-1-pro-260628`，也可填写 `ep-...` 推理接入点 ID |
| OpenAI Compatible | 自行填写兼容视觉模型的模型 ID 与 Chat Completions 地址 |

模型必须支持图片输入。普通文本模型无法分析截图，也无法通过连接测试。

## 使用方法

1. 在需要采集的网页中点击 Prompt Capture 扩展图标，或使用快捷键。
2. 选择“当前页面”“选择图片”或“框选截图”。
3. 确认采集内容；如不合适，可以重选或切换采集方式。
4. 点击“确认生成”，等待视觉模型分析。
5. 在结果页切换图片、风格和布局 Prompt，并点击复制按钮使用。
6. 在历史页查看或清理已保存的记录。

按 `Esc` 可以退出正在进行的网页选择。

## 权限与隐私

扩展使用以下主要权限：

- `activeTab`、`tabs`、`scripting`：在用户主动触发时读取当前标签页并注入采集界面。
- `captureVisibleTab` 相关能力：截取当前可见网页内容并按选区裁剪。
- `storage`：在浏览器本地保存设置、截图和 Prompt 历史。
- `clipboardWrite`、`offscreen`：将生成的 Prompt 复制到剪贴板。

API Key、模型配置、截图和历史记录保存在 `chrome.storage.local`。生成或测试连接时，截图和 API Key 会发送到设置页中填写的模型接口地址。请只使用你信任的服务商和接口地址。

Chrome 内置页面、扩展管理页和 Chrome Web Store 等受保护页面不允许内容脚本注入，因此无法采集。

## 本地开发

环境要求：Node.js 20 或更高版本，npm 10 或更高版本。

```bash
npm install
npm test
npm run dev
```

生成生产版本：

```bash
npm run build
```

构建产物位于 `dist/`。在 `chrome://extensions/` 中选择“加载已解压的扩展程序”，然后选择该目录即可测试。

## 项目结构

```text
src/       React 界面、样式和模型服务配置
public/    Manifest、后台脚本、内容脚本和插件图标
tests/     自动测试
dist/      可直接加载的生产构建
```

## 当前版本

`v0.2.5`
