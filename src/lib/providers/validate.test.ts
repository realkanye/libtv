import { describe, expect, it } from "vitest";
import { validateAndNormalize } from "./validate";

describe("validateAndNormalize", () => {
  it("接受合法的文生图请求并套用默认参数", () => {
    const r = validateAndNormalize({
      providerId: "ark",
      modelId: "doubao-seedream-4-0",
      mode: "text-to-image",
      prompt: "一只猫",
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.params?.aspectRatio).toBe("16:9");
      expect(r.value.params?.count).toBe(1);
      expect(r.value.params?.resolution).toBe("2K");
    }
  });

  it("文生类缺少提示词时拦截", () => {
    const r = validateAndNormalize({
      providerId: "mock",
      modelId: "mock-text",
      mode: "text-to-text",
      prompt: "   ",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toBe("请输入提示词");
  });

  it("模型不支持该模式时给出可读提示", () => {
    const r = validateAndNormalize({
      providerId: "ark",
      modelId: "doubao-seedance-1-0-pro", // 视频模型
      mode: "image-to-image",
      prompt: "x",
      images: ["http://a/1.png"],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toContain("不支持");
  });

  it("首尾帧必须连入两张图片", () => {
    const one = validateAndNormalize({
      providerId: "kling",
      modelId: "kling-v2-5-turbo",
      mode: "keyframe-video",
      prompt: "x",
      images: ["http://a/1.png"],
    });
    expect(one.ok).toBe(false);

    const two = validateAndNormalize({
      providerId: "kling",
      modelId: "kling-v2-5-turbo",
      mode: "keyframe-video",
      prompt: "x",
      images: ["http://a/1.png", "http://a/2.png"],
    });
    expect(two.ok).toBe(true);
  });

  it("超出参考图上限时拦截", () => {
    const r = validateAndNormalize({
      providerId: "ark",
      modelId: "doubao-seedream-4-0",
      mode: "image-to-image",
      prompt: "x",
      images: ["1", "2", "3", "4", "5"],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toContain("最多");
  });

  it("参数取值非法时拦截", () => {
    const r = validateAndNormalize({
      providerId: "kling",
      modelId: "kling-v2-5-turbo",
      mode: "text-to-video",
      prompt: "x",
      params: { duration: 7 },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toContain("时长");
  });

  it("视频合成：至少两个视频，音频最多一条", () => {
    const tooFew = validateAndNormalize({
      providerId: "local",
      modelId: "ffmpeg-compose",
      mode: "compose-video",
      prompt: "",
      videos: ["/uploads/a.mp4"],
    });
    expect(tooFew.ok).toBe(false);

    const ok = validateAndNormalize({
      providerId: "local",
      modelId: "ffmpeg-compose",
      mode: "compose-video",
      prompt: "",
      videos: ["/uploads/a.mp4", "/uploads/b.mp4"],
      audios: ["/uploads/bgm.mp3"],
    });
    expect(ok.ok).toBe(true);

    const tooManyAudio = validateAndNormalize({
      providerId: "local",
      modelId: "ffmpeg-compose",
      mode: "compose-video",
      prompt: "",
      videos: ["/a.mp4", "/b.mp4"],
      audios: ["/1.mp3", "/2.mp3"],
    });
    expect(tooManyAudio.ok).toBe(false);
  });

  it("非合成模型拒绝视频输入", () => {
    const r = validateAndNormalize({
      providerId: "kling",
      modelId: "kling-v2-5-turbo",
      mode: "text-to-video",
      prompt: "x",
      videos: ["/uploads/a.mp4"],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toContain("不支持视频输入");
  });

  it("同一模型按模式区分能力条目（方舟 LLM 文本/脚本）", () => {
    const text = validateAndNormalize({
      providerId: "ark",
      modelId: "doubao-seed-1-6-251015",
      mode: "text-to-text",
      prompt: "你好",
    });
    expect(text.ok).toBe(true);
    if (text.ok) expect(text.capability.kind).toBe("text");

    const script = validateAndNormalize({
      providerId: "ark",
      modelId: "doubao-seed-1-6-251015",
      mode: "text-to-script",
      prompt: "一个故事",
    });
    expect(script.ok).toBe(true);
    if (script.ok) expect(script.capability.kind).toBe("script");
  });

  it("裁掉模型未声明的参数", () => {
    const r = validateAndNormalize({
      providerId: "mock",
      modelId: "mock-text",
      mode: "text-to-text",
      prompt: "hi",
      params: { duration: 5, aspectRatio: "16:9" },
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.params).toEqual({});
    }
  });
});
