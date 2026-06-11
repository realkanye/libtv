import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ArkProvider,
  arkImageSize,
  arkVideoPromptFlags,
  mapArkTaskState,
  parseScriptShots,
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

describe("parseScriptShots", () => {
  it("解析裸 JSON 数组", () => {
    const shots = parseScriptShots(
      '[{"scene":"a","shotType":"全景","description":"画面","cameraMove":"固定"}]'
    );
    expect(shots).toHaveLength(1);
    expect(shots[0].id).toBe("shot-1");
  });
  it("容忍代码块围栏与前后废话", () => {
    const shots = parseScriptShots(
      '好的，以下是分镜：\n```json\n[{"scene":"a","description":"x"},{"scene":"b","description":"y"}]\n```\n希望有帮助'
    );
    expect(shots).toHaveLength(2);
    expect(shots[1].shotType).toBe("中景"); // 缺省值
  });
  it("非法输入返回空数组", () => {
    expect(parseScriptShots("完全不是 JSON")).toEqual([]);
    expect(parseScriptShots('{"not":"array"}')).toEqual([]);
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

  it("图+文生图：连入的参考文本合并进 prompt，参考图进 image", async () => {
    process.env.ARK_API_KEY = "test-key";
    const calls = mockFetch({ data: [{ url: "http://x/i.png" }] });
    const provider = new ArkProvider();
    await provider.createTask({
      providerId: "ark",
      modelId: "doubao-seedream-4-0",
      mode: "image-to-image",
      prompt: "改成夜景",
      images: ["http://a/ref.png"],
      refTexts: ["保持人物一致", "电影感打光"],
      params: { aspectRatio: "1:1", resolution: "2K", count: 1 },
    });
    const body = JSON.parse(calls[0].opts.body as string);
    expect(body.prompt).toBe("改成夜景\n保持人物一致\n电影感打光");
    expect(body.image).toBe("http://a/ref.png");
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

  it("LLM 文生文：POST /chat/completions，refTexts 拼入用户消息", async () => {
    process.env.ARK_API_KEY = "test-key";
    const calls = mockFetch({
      choices: [{ message: { content: "生成的剧情文本" } }],
    });
    const provider = new ArkProvider();
    const result = await provider.createTask({
      providerId: "ark",
      modelId: "doubao-seed-1-6-251015",
      mode: "text-to-text",
      prompt: "写一段开场",
      refTexts: ["世界观设定：赛博朋克"],
      params: {},
    });
    expect(result.kind).toBe("sync");
    if (result.kind === "sync") {
      expect(result.outputs[0]).toEqual({ type: "text", text: "生成的剧情文本" });
    }
    expect(calls[0].url).toContain("/chat/completions");
    const body = JSON.parse(calls[0].opts.body as string);
    expect(body.messages[1].content).toContain("赛博朋克");
  });

  it("LLM 文生分镜：解析 JSON 输出为分镜行", async () => {
    process.env.ARK_API_KEY = "test-key";
    mockFetch({
      choices: [
        {
          message: {
            content:
              '```json\n[{"scene":"码头","shotType":"远景","description":"夜晚的码头","cameraMove":"缓慢推近"}]\n```',
          },
        },
      ],
    });
    const provider = new ArkProvider();
    const result = await provider.createTask({
      providerId: "ark",
      modelId: "doubao-seed-1-6-251015",
      mode: "text-to-script",
      prompt: "码头故事",
      params: {},
    });
    expect(result.kind).toBe("sync");
    if (result.kind === "sync") {
      expect(result.outputs[0].type).toBe("script");
      expect(result.outputs[0].shots).toHaveLength(1);
      expect(result.outputs[0].shots![0].scene).toBe("码头");
    }
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
