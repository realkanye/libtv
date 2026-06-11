import { afterEach, describe, expect, it, vi } from "vitest";
import { KlingProvider, klingImageField, mapKlingTaskState } from "./kling";
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

function withKeys() {
  process.env.KLING_ACCESS_KEY = "ak";
  process.env.KLING_SECRET_KEY = "sk";
}

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.KLING_ACCESS_KEY;
  delete process.env.KLING_SECRET_KEY;
});

describe("klingImageField", () => {
  it("data URI 取 base64，普通 URL 透传", () => {
    expect(klingImageField("data:image/png;base64,ABCD")).toBe("ABCD");
    expect(klingImageField("http://a/1.png")).toBe("http://a/1.png");
  });
});

describe("mapKlingTaskState", () => {
  it("succeed/failed/processing 映射", () => {
    expect(
      mapKlingTaskState({
        data: { task_status: "succeed", task_result: { videos: [{ url: "http://v/1.mp4" }] } },
      })
    ).toMatchObject({ status: "succeeded", outputs: [{ url: "http://v/1.mp4" }] });
    expect(
      mapKlingTaskState({ data: { task_status: "failed", task_status_msg: "boom" } })
    ).toMatchObject({ status: "failed", error: { message: "boom" } });
    expect(mapKlingTaskState({ data: { task_status: "processing" } }).status).toBe(
      "running"
    );
  });
});

describe("KlingProvider 请求构造", () => {
  it("文生视频走 text2video，task id 编入端点", async () => {
    withKeys();
    const calls = mockFetch({ code: 0, data: { task_id: "k1" } });
    const provider = new KlingProvider();
    const req: UnifiedRequest = {
      providerId: "kling",
      modelId: "kling-v2-5-turbo",
      mode: "text-to-video",
      prompt: "日落",
      params: { aspectRatio: "16:9", duration: 5 },
    };
    const result = await provider.createTask(req);
    expect(result).toEqual({ kind: "async", upstreamTaskId: "text2video:k1" });
    expect(calls[0].url).toContain("/v1/videos/text2video");
    const body = JSON.parse(calls[0].opts.body as string);
    expect(body.model_name).toBe("kling-v2-5-turbo");
    expect(body.duration).toBe("5");
  });

  it("图+文生视频：连入参考文本合并进 prompt", async () => {
    withKeys();
    const calls = mockFetch({ code: 0, data: { task_id: "k9" } });
    const provider = new KlingProvider();
    await provider.createTask({
      providerId: "kling",
      modelId: "kling-v2-5-turbo",
      mode: "image-to-video",
      prompt: "镜头缓慢推近",
      images: ["http://a/first.png"],
      refTexts: ["氛围紧张", "夜晚"],
      params: { aspectRatio: "16:9", duration: 5 },
    });
    const body = JSON.parse(calls[0].opts.body as string);
    expect(body.prompt).toBe("镜头缓慢推近\n氛围紧张\n夜晚");
    expect(body.image).toBe("http://a/first.png");
  });

  it("首尾帧走 image2video，带 image_tail", async () => {
    withKeys();
    const calls = mockFetch({ code: 0, data: { task_id: "k2" } });
    const provider = new KlingProvider();
    const req: UnifiedRequest = {
      providerId: "kling",
      modelId: "kling-v2-5-turbo",
      mode: "keyframe-video",
      prompt: "变身",
      images: ["http://a/first.png", "http://a/last.png"],
      params: { aspectRatio: "16:9", duration: 5 },
    };
    const result = await provider.createTask(req);
    expect(result).toEqual({ kind: "async", upstreamTaskId: "image2video:k2" });
    expect(calls[0].url).toContain("/v1/videos/image2video");
    const body = JSON.parse(calls[0].opts.body as string);
    expect(body.image).toBe("http://a/first.png");
    expect(body.image_tail).toBe("http://a/last.png");
  });

  it("生图走 /v1/images/generations，查询路径区分 images 端点", async () => {
    withKeys();
    const calls = mockFetch({ code: 0, data: { task_id: "img1" } });
    const provider = new KlingProvider();
    const result = await provider.createTask({
      providerId: "kling",
      modelId: "kling-v2",
      mode: "image-to-image",
      prompt: "改成夜景",
      images: ["data:image/png;base64,QUJD"],
      params: { aspectRatio: "16:9", count: 2 },
    });
    expect(result).toEqual({ kind: "async", upstreamTaskId: "images:img1" });
    expect(calls[0].url).toContain("/v1/images/generations");
    const body = JSON.parse(calls[0].opts.body as string);
    expect(body.image).toBe("QUJD"); // data URI 已剥成 base64
    expect(body.n).toBe(2);

    // 查询
    mockFetch({
      code: 0,
      data: {
        task_status: "succeed",
        task_result: { images: [{ index: 0, url: "http://img/1.png" }] },
      },
    });
    const state = await provider.getTask("images:img1");
    expect(state.status).toBe("succeeded");
    expect(state.outputs?.[0]).toEqual({ type: "image", url: "http://img/1.png" });
  });

  it("业务码非 0 时按错误码映射", async () => {
    withKeys();
    mockFetch({ code: 1301, message: "risk" });
    const provider = new KlingProvider();
    await expect(
      provider.createTask({
        providerId: "kling",
        modelId: "kling-v2-5-turbo",
        mode: "text-to-video",
        prompt: "x",
        params: { duration: 5, aspectRatio: "16:9" },
      })
    ).rejects.toMatchObject({ code: "content_rejected" });
  });
});
