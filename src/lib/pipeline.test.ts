// 画布编排逻辑测试：store 节点操作 + 脚本流水线 + 整组执行拓扑。
// startGeneration 打桩为「直接置成功」，验证编排本身（建节点/连线/顺序/复用）。

import { beforeEach, describe, expect, it, vi } from "vitest";

// node 环境下给 zustand persist 一个内存 localStorage
const mem = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, v),
  removeItem: (k: string) => void mem.delete(k),
});

const generationOrder: string[] = [];
vi.mock("./taskClient", () => ({
  startGeneration: vi.fn(async (nodeId: string) => {
    generationOrder.push(nodeId);
    // 模拟生成成功：写回内容
    const { useCanvasStore } = await import("./store");
    useCanvasStore.getState().updateNodeData(nodeId, {
      status: "done",
      content: `out-${nodeId}`,
    });
    return true;
  }),
  retryGeneration: vi.fn(),
  resumeActiveTasks: vi.fn(),
  subscribeTask: vi.fn(),
  releaseNodeStreams: vi.fn(),
}));

import { useCanvasStore } from "./store";
import {
  generateShotImages,
  generateShotVideos,
  runGroup,
  createComposeNode,
} from "./pipeline";

function reset() {
  useCanvasStore.setState({ nodes: [], edges: [], past: [], future: [] });
  generationOrder.length = 0;
}

describe("store 节点操作", () => {
  beforeEach(reset);

  it("副本保留连线，复制粘贴不保留", () => {
    const s = useCanvasStore.getState();
    const a = s.addNode("image", { x: 0, y: 0 });
    const b = s.addNode("video", { x: 300, y: 0 });
    useCanvasStore.getState().addEdgeBetween(a, b);

    const dup = useCanvasStore.getState().duplicateNode(b)!;
    expect(
      useCanvasStore.getState().edges.some((e) => e.source === a && e.target === dup)
    ).toBe(true);

    useCanvasStore.getState().copyNode(b);
    const pasted = useCanvasStore.getState().pasteNode({ x: 50, y: 50 })!;
    expect(
      useCanvasStore.getState().edges.some((e) => e.target === pasted)
    ).toBe(false);
  });

  it("removeNodes 同步清理相关连线", () => {
    const s = useCanvasStore.getState();
    const a = s.addNode("image", { x: 0, y: 0 });
    const b = s.addNode("video", { x: 300, y: 0 });
    useCanvasStore.getState().addEdgeBetween(a, b);
    useCanvasStore.getState().removeNodes([a]);
    expect(useCanvasStore.getState().nodes).toHaveLength(1);
    expect(useCanvasStore.getState().edges).toHaveLength(0);
  });

  it("撤销/重做：新建与删除可回退", () => {
    const s = useCanvasStore.getState();
    const a = s.addNode("text", { x: 0, y: 0 });
    expect(useCanvasStore.getState().nodes).toHaveLength(1);

    useCanvasStore.getState().addNode("image", { x: 100, y: 0 });
    expect(useCanvasStore.getState().nodes).toHaveLength(2);

    useCanvasStore.getState().undo(); // 撤销加 image
    expect(useCanvasStore.getState().nodes).toHaveLength(1);
    useCanvasStore.getState().redo(); // 重做
    expect(useCanvasStore.getState().nodes).toHaveLength(2);

    useCanvasStore.getState().removeNodes([a]); // 删 text
    expect(useCanvasStore.getState().nodes).toHaveLength(1);
    useCanvasStore.getState().undo(); // 撤销删除
    expect(useCanvasStore.getState().nodes).toHaveLength(2);
    expect(useCanvasStore.getState().nodes.some((n) => n.id === a)).toBe(true);
  });

  it("新建操作会清空重做栈", () => {
    const s = useCanvasStore.getState();
    s.addNode("text", { x: 0, y: 0 });
    useCanvasStore.getState().undo();
    expect(useCanvasStore.getState().nodes).toHaveLength(0);
    // 撤销后做新操作 → 重做栈应清空
    useCanvasStore.getState().addNode("image", { x: 0, y: 0 });
    useCanvasStore.getState().redo(); // 无可重做
    expect(useCanvasStore.getState().nodes).toHaveLength(1);
    expect(useCanvasStore.getState().nodes[0].data.kind).toBe("image");
  });

  it("upstreamInputs 按类型分组且只取已完成节点", () => {
    const s = useCanvasStore.getState();
    const img = s.addContentNode("image", { x: 0, y: 0 }, { content: "/i.png" });
    const txt = s.addContentNode("text", { x: 0, y: 100 }, { content: "设定" });
    const pending = s.addNode("image", { x: 0, y: 200 }); // 未完成
    const target = s.addNode("video", { x: 300, y: 0 });
    const st = useCanvasStore.getState();
    st.addEdgeBetween(img, target);
    st.addEdgeBetween(txt, target);
    st.addEdgeBetween(pending, target);

    const inputs = useCanvasStore.getState().upstreamInputs(target);
    expect(inputs.images).toEqual(["/i.png"]);
    expect(inputs.refTexts).toEqual(["设定"]);
  });
});

describe("脚本流水线", () => {
  beforeEach(reset);

  const shots = [
    { id: "s1", scene: "码头", shotType: "远景", description: "夜晚码头", cameraMove: "推近" },
    { id: "s2", scene: "巷口", shotType: "特写", description: "霓虹灯下", cameraMove: "固定" },
  ];

  it("生成分镜图：建节点+连线+写提示词，二次执行复用节点", async () => {
    const scriptId = useCanvasStore.getState().addContentNode(
      "script",
      { x: 0, y: 0 },
      { shots, content: "剧本" }
    );
    const [ok, total] = await generateShotImages(scriptId);
    expect([ok, total]).toEqual([2, 2]);

    const after = useCanvasStore.getState();
    const imageNodes = after.nodes.filter((n) => n.data.kind === "image");
    expect(imageNodes).toHaveLength(2);
    expect(imageNodes[0].data.prompt).toContain("夜晚码头");
    expect(
      after.edges.filter((e) => e.source === scriptId)
    ).toHaveLength(2);

    // 二次执行不重复建节点
    await generateShotImages(scriptId);
    expect(
      useCanvasStore.getState().nodes.filter((n) => n.data.kind === "image")
    ).toHaveLength(2);
  });

  it("批量生成视频：从就绪分镜图接出视频节点（图生视频）", async () => {
    const scriptId = useCanvasStore.getState().addContentNode(
      "script",
      { x: 0, y: 0 },
      { shots, content: "剧本" }
    );
    await generateShotImages(scriptId); // 桩会把分镜图置为 done
    const [ok, total] = await generateShotVideos(scriptId);
    expect([ok, total]).toEqual([2, 2]);

    const after = useCanvasStore.getState();
    const videoNodes = after.nodes.filter((n) => n.data.kind === "video");
    expect(videoNodes).toHaveLength(2);
    expect(videoNodes[0].data.prompt).toContain("运镜");
    // 视频节点必须由分镜图连入（首帧语义）
    for (const v of videoNodes) {
      const incoming = after.edges.find((e) => e.target === v.id)!;
      const src = after.nodes.find((n) => n.id === incoming.source)!;
      expect(src.data.kind).toBe("image");
    }
  });
});

describe("整组执行", () => {
  beforeEach(reset);

  it("按拓扑顺序执行：上游先于下游", async () => {
    const s = useCanvasStore.getState();
    const t = s.addNode("text", { x: 0, y: 0 }, { prompt: "设定" });
    const i = s.addNode("image", { x: 300, y: 0 }, { prompt: "画面" });
    const v = s.addNode("video", { x: 600, y: 0 }, { prompt: "动起来" });
    const st = useCanvasStore.getState();
    st.addEdgeBetween(t, i);
    st.addEdgeBetween(i, v);

    const [ok, ran] = await runGroup([v, t, i]); // 故意乱序传入
    expect([ok, ran]).toEqual([3, 3]);
    expect(generationOrder.indexOf(t)).toBeLessThan(generationOrder.indexOf(i));
    expect(generationOrder.indexOf(i)).toBeLessThan(generationOrder.indexOf(v));
  });

  it("跳过无提示词的素材节点", async () => {
    const s = useCanvasStore.getState();
    const upload = s.addContentNode("image", { x: 0, y: 0 }, { content: "/u.png" });
    const v = s.addNode("video", { x: 300, y: 0 }, { prompt: "动起来" });
    useCanvasStore.getState().addEdgeBetween(upload, v);
    const [, ran] = await runGroup([upload, v]);
    expect(ran).toBe(1);
  });
});

describe("视频合成节点", () => {
  beforeEach(reset);

  it("按画布位置排序连线，BGM 一并接入", () => {
    const s = useCanvasStore.getState();
    // 故意按乱序创建：位置决定拼接顺序
    const v2 = s.addContentNode("video", { x: 0, y: 300 }, { content: "/b.mp4" });
    const v1 = s.addContentNode("video", { x: 0, y: 0 }, { content: "/a.mp4" });
    const bgm = s.addContentNode("audio", { x: 0, y: 600 }, { content: "/bgm.mp3" });

    const composeId = createComposeNode([v2, v1], bgm)!;
    const after = useCanvasStore.getState();
    const compose = after.nodes.find((n) => n.id === composeId)!;
    expect(compose.data.providerId).toBe("local");
    expect(compose.data.modelId).toBe("ffmpeg-compose");

    const incoming = after.edges.filter((e) => e.target === composeId);
    // y 更小的 v1 在前
    expect(incoming[0].source).toBe(v1);
    expect(incoming[1].source).toBe(v2);
    expect(incoming[2].source).toBe(bgm);

    // upstreamInputs 按此顺序给出 videos
    const inputs = after.upstreamInputs(composeId);
    expect(inputs.videos).toEqual(["/a.mp4", "/b.mp4"]);
    expect(inputs.audios).toEqual(["/bgm.mp3"]);
  });
});
