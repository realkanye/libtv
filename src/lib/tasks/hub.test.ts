import { beforeAll, describe, expect, it } from "vitest";
import { getTaskHub } from "./hub";
import type { UnifiedRequest } from "@/lib/providers/types";
import type { TaskView } from "./types";

async function waitFor(
  pred: () => boolean,
  timeout = 6000,
  interval = 25
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (pred()) return;
    await new Promise((r) => setTimeout(r, interval));
  }
  throw new Error("waitFor 超时");
}

beforeAll(() => {
  // 加速 mock 视频的异步链路
  process.env.LIBTV_MOCK_VIDEO_MS = "150";
});

describe("TaskHub 全链路（MockProvider，离线）", () => {
  it("同步任务（文本）创建即完成", async () => {
    const hub = getTaskHub();
    const req: UnifiedRequest = {
      providerId: "mock",
      modelId: "mock-text",
      mode: "text-to-text",
      prompt: "你好",
      params: {},
    };
    const task = hub.create("node-text", req);
    expect(task.status).toBe("queued");

    await waitFor(() => hub.getView(task.id)?.status === "succeeded");
    const view = hub.getView(task.id)!;
    expect(view.outputs[0].type).toBe("text");
    expect(view.outputs[0].text).toContain("你好");
  });

  it(
    "异步任务（视频）经轮询推进至完成，并广播中间状态",
    async () => {
      const hub = getTaskHub();
      const req: UnifiedRequest = {
        providerId: "mock",
        modelId: "mock-video",
        mode: "text-to-video",
        prompt: "海浪",
        params: { aspectRatio: "16:9", duration: 5 },
      };
      const seen: TaskView["status"][] = [];
      const task = hub.create("node-video", req);
      const unsub = hub.subscribe(task.id, (v) => seen.push(v.status));

      await waitFor(() => hub.getView(task.id)?.status === "succeeded", 8000);
      unsub();

      const view = hub.getView(task.id)!;
      expect(view.outputs[0].type).toBe("video");
      expect(view.outputs[0].url).toBeTruthy();
      expect(seen).toContain("running");
      expect(seen[seen.length - 1]).toBe("succeeded");
    },
    10000
  );

  it("retry 重置并重跑任务", async () => {
    const hub = getTaskHub();
    const task = hub.create("node-retry", {
      providerId: "mock",
      modelId: "mock-text",
      mode: "text-to-text",
      prompt: "重试我",
      params: {},
    });
    await waitFor(() => hub.getView(task.id)?.status === "succeeded");

    const retried = hub.retry(task.id)!;
    expect(retried.id).toBe(task.id);
    expect(retried.status).toBe("queued");
    await waitFor(() => hub.getView(task.id)?.status === "succeeded");
    expect(hub.getView(task.id)?.outputs[0].text).toContain("重试我");
  });
});
