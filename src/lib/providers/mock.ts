// MockProvider：不依赖任何外部服务，保证开发 / 演示 / 离线集成测试可跑。
// 同步类（文本/分镜/音频/图片）即时返回；视频类模拟「创建→轮询」异步链路。

import type { ShotRow } from "@/lib/types";
import type {
  CreateTaskResult,
  GenerationOutput,
  GenerationProvider,
  ModelCapability,
  ProviderTaskState,
  UnifiedRequest,
} from "./types";
import { CATALOG } from "./catalog";
import { effectivePrompt } from "./prompt";

/** 在占位图上渲染文本，便于离线肉眼验证「图+文」已被合并喂给模型。 */
function placeholderImage(label: string, seed: string): string {
  const text = (label || "mock image").slice(0, 60);
  return `https://placehold.co/512x288/27272a/a1a1aa/png?text=${encodeURIComponent(
    text
  )}&seed=${encodeURIComponent(seed)}`;
}

const SAMPLE_VIDEO =
  "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4";
const SAMPLE_AUDIO =
  "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3";

const SHOT_TYPES = ["远景", "全景", "中景", "近景", "特写"];
const CAMERA_MOVES = ["固定机位", "缓慢推近", "横移跟随", "升降镜头", "环绕运镜"];

/** 模拟视频任务的「生成耗时」，让前端能看到排队→生成→完成的进度（测试可用环境变量调小）。 */
function mockVideoDurationMs(): number {
  return Number(process.env.LIBTV_MOCK_VIDEO_MS) || 3000;
}

function mockShots(prompt: string): ShotRow[] {
  return Array.from({ length: 5 }, (_, i) => ({
    id: `shot-${i + 1}`,
    scene: `场景 ${i + 1}`,
    shotType: SHOT_TYPES[i % SHOT_TYPES.length],
    description: `${prompt.slice(0, 30) || "故事"} —— 第 ${i + 1} 镜画面描述`,
    cameraMove: CAMERA_MOVES[i % CAMERA_MOVES.length],
  }));
}

export class MockProvider implements GenerationProvider {
  readonly id = "mock" as const;
  readonly label = "Mock（本地模拟）";

  isConfigured(): boolean {
    return true; // Mock 永远可用
  }

  capabilities(): ModelCapability[] {
    return CATALOG.filter((c) => c.providerId === "mock");
  }

  async createTask(req: UnifiedRequest): Promise<CreateTaskResult> {
    const seed = `${req.prompt.slice(0, 24)}-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2, 6)}`;

    switch (req.mode) {
      case "text-to-text":
        return {
          kind: "sync",
          outputs: [
            {
              type: "text",
              text: `【Mock 文本生成】\n${req.prompt}\n\n——这是基于提示词生成的示例文本。配置真实大语言模型后此处返回真实结果。`,
            },
          ],
        };
      case "text-to-script":
        return {
          kind: "sync",
          outputs: [{ type: "script", text: req.prompt, shots: mockShots(req.prompt) }],
        };
      case "text-to-audio":
        return { kind: "sync", outputs: [{ type: "audio", url: SAMPLE_AUDIO }] };
      case "text-to-image":
      case "image-to-image": {
        const count = req.params?.count ?? 1;
        const refN = req.images?.length ?? 0;
        // 占位图上直接渲染「合并后的提示词 + 参考图数量」，离线即可肉眼验证图+文已生效。
        const label =
          (refN ? `[参考${refN}图] ` : "") + effectivePrompt(req);
        const outputs: GenerationOutput[] = Array.from(
          { length: count },
          (_, i) => ({ type: "image", url: placeholderImage(label, `${seed}-${i}`) })
        );
        return { kind: "sync", outputs };
      }
      case "text-to-video":
      case "image-to-video":
      case "keyframe-video":
        // 异步：把开始时间编进 task id，getTask 据此推进进度。
        return { kind: "async", upstreamTaskId: `mock:${Date.now()}` };
      default:
        // 校验层保证不会到这里（mock 未声明的模式会被拦截）
        throw new Error(`MockProvider 不支持模式 ${req.mode}`);
    }
  }

  async getTask(upstreamTaskId: string): Promise<ProviderTaskState> {
    const startMs = Number(upstreamTaskId.split(":")[1] ?? 0);
    const elapsed = Date.now() - startMs;
    const total = mockVideoDurationMs();
    if (elapsed >= total) {
      return {
        status: "succeeded",
        progress: 100,
        outputs: [{ type: "video", url: SAMPLE_VIDEO }],
      };
    }
    const progress = Math.min(95, Math.round((elapsed / total) * 100));
    return { status: "running", progress };
  }
}
