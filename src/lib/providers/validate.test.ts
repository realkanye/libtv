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
