# LibTV（复刻项目）

复刻 LiblibAI 旗下专业 AI 视频创作平台 **LibTV**（liblib.tv）：以「无限画布 + 节点式工作流」为核心范式，将剧本、分镜、图像、视频、音频统一为画布上可编排、可复用的节点，支撑从剧本到成片的全流程创作，并同时面向人类创作者与 AI Agent（Skill/CLI）两类入口。

功能规格依据官方《LibTV 使用指南》整理。

## 技术栈

- Next.js (App Router) + TypeScript + Tailwind CSS
- [@xyflow/react](https://reactflow.dev)（React Flow）— 无限画布与节点编排
- Zustand — 画布状态管理

## 当前进度：Phase 1 — Provider 抽象层 + 异步任务中枢

在 Phase 0 无限画布骨架之上，搭建了「没 Bug 的下限」所需的生成架构：

- ✅ **Provider 抽象层**：统一生成接口（`createTask` / `getTask` / `capabilities`），画布节点只跟统一接口对话。已接入 `MockProvider`、火山方舟（即梦）、可灵 Kling 三家。
- ✅ **能力声明式注册**（`src/lib/providers/catalog.ts`）：每个模型声明支持的模式（文生/图生/首尾帧）、时长/画幅/张数范围。前端模型下拉、参数面板、连线校验，以及服务端请求校验，全部由这份声明驱动 —— 从根本上消灭「参数不合法被上游打回」一类 Bug。
- ✅ **请求校验在本层完成**（zod + 能力声明）：不合法请求根本不会发往上游，错误信息是中文人话。
- ✅ **异步任务中枢**（`src/lib/tasks`）：服务端 `TaskStore`（文件持久化）+ 集中式指数退避轮询器，前端通过 **SSE** 实时订阅「排队→生成中(xx%)→完成」。
- ✅ **产物转存**：任务完成立即把时效 URL 下载到本地 `public/generated/`，节点引用永久地址；转存失败则保留原始地址不丢结果。
- ✅ **密钥安全**：所有 Key 仅存于服务端环境变量，可灵 JWT 服务端按需签发，浏览器永不接触。`/api/providers` 上报可用性，未配置的模型在前端置灰。
- ✅ **连线语义**：图片连视频=图生视频首帧；两张图=首尾帧；文本连入=提示词增强。连线时实时校验目标模型是否支持该组合。
- ✅ **失败可重试**：余额不足 / 审核拦截 / 限流 / 超时等上游错误翻译为明确提示，节点上一键重试。
- ✅ **崩溃恢复**：进程重启后 `instrumentation.ts` 恢复进行中的任务。
- ✅ **契约测试 + 全链路集成测试**（vitest）：Provider 请求构造/响应解析、JWT 签发、任务中枢全链路（基于 MockProvider 离线跑通）。

### 接入真实模型

复制 `.env.example` 为 `.env.local` 填入密钥即可（不配也能用 Mock 全功能离线运行）：

| Provider | 模型 | 鉴权 |
|---|---|---|
| 火山方舟（即梦） | Seedream 4.0（同步出图）、Seedance 1.0 Pro（异步视频） | `ARK_API_KEY` |
| 可灵 Kling | kling-v2-5-turbo（文生/图生/首尾帧视频） | `KLING_ACCESS_KEY` / `KLING_SECRET_KEY` |

> 新接一家平台：实现 `GenerationProvider`、在 `catalog.ts` 声明能力、在 `registry.ts` 登记，三步即可，画布与任务中枢无需改动。

## 路线图

- ✅ **Phase 1**：生成 Provider 抽象层 + 异步任务中枢，接入可灵 / 即梦
- **Phase 2**：节点能力补全 — 文件拖入上传、节点右键菜单（副本/资产）、脚本→批量分镜图→批量视频流水线
- **Phase 3**：高级控件 — 打组与整组执行、分镜组宫格、多角度/打光/摄像机参数、九宫格 Slash 指令
- **Phase 4**：视频合成时间轴、导演台（3D 构图）、Skill API（Agent 入口）

## 本地运行

```bash
npm install
npm run dev          # 开发服务器
npm test             # 契约 + 集成测试
npm run typecheck    # 类型检查
```

打开 http://localhost:3000，双击画布空白处即可开始创建节点。无需任何密钥即可用 Mock Provider 跑通完整链路。
