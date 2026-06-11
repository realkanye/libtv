# LibTV（复刻）本地部署指南

一份「拉下来 → 装依赖 → 启动 → 在网页里填 key → 直接用」的指南。
不配任何 key 也能用 **Mock 模型 + 本地 ffmpeg 合成/剪辑**离线跑通整条画布流程。

---

## 1. 前置要求

- **Node.js ≥ 20**（建议 20 LTS 或更高；Next.js 16 要求 18.18+）
- **npm**（随 Node 自带）
- 操作系统：macOS / Linux / Windows 均可
- **ffmpeg 无需单独安装** —— 依赖里已内置静态二进制（`ffmpeg-static` / `ffprobe-static`），视频合成与媒体剪辑开箱即用

检查版本：

```bash
node -v   # 应 ≥ v20
npm -v
```

---

## 2. 安装

```bash
git clone <仓库地址> libtv
cd libtv
npm install
```

> 首次 `npm install` 会一并下载内置 ffmpeg 静态二进制（约几十 MB），请保持网络通畅。

---

## 3. 启动

### 开发模式（带热更新）

```bash
npm run dev
```

打开 **http://localhost:3000**。

### 生产模式（更快、更省资源）

```bash
npm run build
npm run start            # 默认 3000 端口
# 指定端口： npm run start -- -p 8080
```

> 生产模式是常驻 Node 服务，任务轮询器、SSE 状态流、进程重启后任务恢复都依赖它常驻运行，**不要**用静态导出方式部署。

---

## 4. 配置模型密钥（两种方式，任选其一）

### 方式 A：网页设置页（推荐，免改文件）

1. 启动后点击右上角 **⚙️ 设置**（或访问 `/settings`）
2. 按 Provider 分组填入密钥与模型 ID，点「保存配置」，**立即生效，无需重启**
3. 顶部状态条会显示每个 Provider 是否「✓ 已配置」

> 密钥只写入本机服务端文件 `.data/config.json`，浏览器只能看到掩码（如 `••••7777`）。
> 留空的密钥字段在保存时**不会覆盖**已有值。

### 方式 B：环境变量 `.env.local`

复制模板并填写：

```bash
cp .env.example .env.local
```

```bash
# 火山方舟（即梦）—— 一个 Key 同时驱动 Seedream 生图 / Seedance 视频 / 豆包 LLM
ARK_API_KEY=你的key
# 可选：填你账号实际开通的接入点（带版本后缀也行）；不填用内置默认
# ARK_SEEDREAM_MODEL=doubao-seedream-4-0
# ARK_SEEDANCE_MODEL=doubao-seedance-1-0-pro
# ARK_LLM_MODEL=doubao-seed-1-6-251015

# 可灵 Kling —— 服务端用 AK/SK 签发 JWT
KLING_ACCESS_KEY=你的AccessKey
KLING_SECRET_KEY=你的SecretKey
```

> 两种方式可混用，**优先级：设置页 > 环境变量 > 内置默认值**。

---

## 5. 各 Provider 的 key 从哪拿

| Provider | 需要的凭证 | 获取入口 |
|---|---|---|
| **火山方舟（即梦/字节）** | `API Key` + 各模型「接入点 ID」 | 火山方舟控制台 → API Key 管理；模型 ID 在「开通管理 / 在线推理」里复制（形如 `doubao-seedance-1-0-pro-2505xx`） |
| **可灵 Kling** | `AccessKey` + `SecretKey` | 可灵开放平台 → 密钥管理 |

> **重要**：火山的「模型 ID」常带版本日期后缀，且因账号开通情况而异。
> 所以设置页让你**直接粘贴你账号里的真实接入点 ID** —— 填对了就能跑通，不用改代码。

---

## 6. 数据与产物目录（均已 gitignore）

| 目录 | 用途 | 可否删除 |
|---|---|---|
| `.data/` | 任务持久化 `tasks.json` + 密钥 `config.json` | 删 `config.json` = 清空密钥；删 `tasks.json` = 清空任务历史 |
| `public/generated/` | 生成/合成/剪辑产物（时效 URL 已转存到此） | 可删，删后历史里的产物链接失效 |
| `public/uploads/` | 拖入上传的素材 | 可删，删后引用它的节点内容失效 |

画布本身（节点+连线）存在**浏览器 localStorage**，刷新不丢；换浏览器/清缓存会重置。

---

## 7. 验证安装是否成功

不配任何 key 即可自检：

```bash
npm test          # 运行 63 项测试（含真实 ffmpeg 合成/剪辑）
npm run typecheck # 类型检查
npm run build     # 生产构建
```

启动后在画布上：双击空白建「文本」节点 → 选 Mock 模型 → 输入提示词 → 生成，应能看到「排队→生成中→完成」。
连两个视频节点 → 框选 → 「视频合成」，应能用内置 ffmpeg 真实合成出一段 mp4。

---

## 8. 常见问题

- **某个模型在下拉里是灰的（未配置）**：去设置页填对应 key；Mock 与本地合成/剪辑永远可用。
- **生成失败提示「鉴权失败」**：key 填错或没有该模型权限。
- **生成失败提示「未找到模型」/ 上游 400**：模型「接入点 ID」与你账号不匹配，去设置页改成你账号里的真实 ID。
- **视频合成报 ffmpeg 失败**：通常是输入素材损坏；换一段素材重试。若你的环境 ffmpeg 静态包不可用，可设 `FFMPEG_PATH` / `FFPROBE_PATH` 指向自装的 ffmpeg。
- **产物 URL 过一会打不开**：上游产物有时效，本服务在任务完成时会自动转存到 `public/generated/`；若转存失败（网络受限）会回退到原始时效地址。
