import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ArkProvider,
  arkImageSize,
  arkVideoPromptFlags,
  mapArkTaskState,
} from "./ark";
import type { UnifiedRequest } from "./types";

function mockFetch(payload: unknown, ok = true, status = 200) {
  const calls: { url: string; opts: RequestInit }[] = [];
  const fn = vi.fn(async (url: string, opts: RequestInit) => {
    calls.push({ url, opts });
    return {
      ok,
      status,
      headers: { get: () => "application/json" },
      text: async () => JSON.stringify(payload),
    } as unknown as Response;
  });
  vi.stubGlobal("fetch", fn);
  return calls;
}

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.ARK_API_KEY;
});

describe("arkImageSize", () => {
  it("按画幅比与分辨率档位推导尺寸", () => {
    expect(arkImageSize("16:9", "2K")).toBe("2048x1152");
    expect(arkImageSize("1:1", "1K")).toBe("1024x1024");
    expect(arkImageSize("9:16", "1K")).toBe("576x1024");
  });
});

describe("arkVideoPromptFlags", () => {
  it("拼接 Seedance 文本指令后缀", () => {
    const req = {
      params: { aspectRatio: "16:9", duration: 5, resolution: "720p" },
    } as UnifiedRequest;
    expect(arkVideoPromptFlags(req)).toBe(" --ratio 16:9 --duration 5 --resolution 720p");
  });
});

describe("mapArkTaskState", () => {
  it("succeeded 带视频地址", () => {
    expect(
      mapArkTaskState({ status: "succeeded", content: { video_url: "http://v/1.mp4" } })
    ).toMatchObject({ status: "succeeded", outputs: [{ type: "video", url: "http://v/1.mp4" }] });
  });
  it("succeeded 但缺地址 → failed", () => {
    expect(mapArkTaskState({ status: "succeeded" }).status).toBe("failed");
  });
  it("failed / running 映射", () => {
    expect(mapArkTaskState({ status: "failed" }).status).toBe("failed");
    expect(mapArkTaskState({ status: "running" }).status).toBe("running");
    expect(mapArkTaskState({ status: "queued" }).status).toBe("running");
  });
});

describe("ArkProvider 请求构造", () => {
  it("Seedream 同步出图：POST /images/generations", async () => {
    process.env.ARK_API_KEY = "test-key";
    const calls = mockFetch({ data: [{ url: "http://x/i.png" }] });
    const provider = new ArkProvider();
    const req: UnifiedRequest = {
      providerId: "ark",
      modelId: "doubao-seedream-4-0",
      mode: "text-to-image",
      prompt: "一只猫",
      params: { aspectRatio: "16:9", resolution: "2K", count: 1 },
    };
    const result = await provider.createTask(req);
    expect(result.kind).toBe("sync");
    if (result.kind === "sync") {
      expect(result.outputs[0].url).toBe("http://x/i.png");
    }
    expect(calls[0].url).toContain("/images/generations");
    const body = JSON.parse(calls[0].opts.body as string);
    expect(body.model).toBe("doubao-seedream-4-0");
    expect(body.size).toBe("2048x1152");
  });

  it("Seedance 异步视频：返回上游 task id", async () => {
    process.env.ARK_API_KEY = "test-key";
    const calls = mockFetch({ id: "cgt-123" });
    const provider = new ArkProvider();
    const req: UnifiedRequest = {
      providerId: "ark",
      modelId: "doubao-seedance-1-0-pro",
      mode: "image-to-video",
      prompt: "镜头推进",
      images: ["http://a/first.png"],
      params: { aspectRatio: "16:9", duration: 5, resolution: "720p" },
    };
    const result = await provider.createTask(req);
    expect(result).toEqual({ kind: "async", upstreamTaskId: "cgt-123" });
    expect(calls[0].url).toContain("/contents/generations/tasks");
    const body = JSON.parse(calls[0].opts.body as string);
    expect(body.content[0].text).toContain("--ratio 16:9");
    expect(body.content[1]).toMatchObject({
      type: "image_url",
      image_url: { url: "http://a/first.png" },
    });
  });

  it("鉴权失败映射为 auth_failed", async () => {
    process.env.ARK_API_KEY = "bad";
    mockFetch({ error: { message: "unauthorized" } }, false, 401);
    const provider = new ArkProvider();
    await expect(
      provider.createTask({
        providerId: "ark",
        modelId: "doubao-seedream-4-0",
        mode: "text-to-image",
        prompt: "x",
      })
    ).rejects.toMatchObject({ code: "auth_failed" });
  });
});
