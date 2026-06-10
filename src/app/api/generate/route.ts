import { NextResponse } from "next/server";

// Phase 0 的 mock 生成端点：模拟各类模型的延迟与产物。
// 后续阶段会替换为真实模型 Provider 抽象层。

const SAMPLE_VIDEO =
  "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4";
const SAMPLE_AUDIO =
  "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3";

const SHOT_TYPES = ["远景", "全景", "中景", "近景", "特写"];
const CAMERA_MOVES = ["固定机位", "缓慢推近", "横移跟随", "升降镜头", "环绕运镜"];

export async function POST(req: Request) {
  const { kind, prompt, model, context = [] } = await req.json();

  await new Promise((r) => setTimeout(r, 900 + Math.random() * 1200));

  const refNote = context.length ? `（参考了 ${context.length} 个上游节点）` : "";

  switch (kind) {
    case "text":
      return NextResponse.json({
        content: `【${model} 生成】${refNote}\n${prompt}\n\n——这是基于你的提示词生成的示例文本。Phase 0 使用 mock 数据，接入真实大语言模型后此处将返回真实生成结果。`,
      });
    case "image":
      return NextResponse.json({
        content: `https://picsum.photos/seed/${encodeURIComponent(
          prompt.slice(0, 24) + Date.now()
        )}/512/288`,
      });
    case "video":
      return NextResponse.json({ content: SAMPLE_VIDEO });
    case "audio":
      return NextResponse.json({ content: SAMPLE_AUDIO });
    case "script": {
      const shots = Array.from({ length: 5 }, (_, i) => ({
        id: `shot-${i + 1}`,
        scene: `场景 ${i + 1}`,
        shotType: SHOT_TYPES[i % SHOT_TYPES.length],
        description: `${prompt.slice(0, 30) || "故事"} —— 第 ${i + 1} 镜画面描述${refNote}`,
        cameraMove: CAMERA_MOVES[i % CAMERA_MOVES.length],
      }));
      return NextResponse.json({ content: prompt, shots });
    }
    default:
      return NextResponse.json({ error: "unknown kind" }, { status: 400 });
  }
}
