import { afterEach, describe, expect, it } from "vitest";
import { getConfig, maskSecret } from "./config";

describe("maskSecret", () => {
  it("保留尾 4 位", () => {
    expect(maskSecret("sk-1234567890")).toBe("••••7890");
    expect(maskSecret("abcd")).toBe("••••");
    expect(maskSecret("")).toBe("");
    expect(maskSecret(undefined)).toBe("");
  });
});

describe("getConfig 优先级（无配置文件时回落环境变量）", () => {
  afterEach(() => {
    delete process.env.ARK_API_KEY;
    delete process.env.ARK_SEEDREAM_MODEL;
    delete process.env.KLING_ACCESS_KEY;
  });

  it("从环境变量读取并 trim", () => {
    process.env.ARK_API_KEY = "  sk-test-123  ";
    process.env.ARK_SEEDREAM_MODEL = "doubao-seedream-4-0";
    const cfg = getConfig();
    expect(cfg.arkApiKey).toBe("sk-test-123");
    expect(cfg.arkSeedreamModel).toBe("doubao-seedream-4-0");
  });

  it("未设置的字段为 undefined", () => {
    const cfg = getConfig();
    expect(cfg.klingAccessKey).toBeUndefined();
    // baseUrl 默认值由 env.ts 应用，config 本身不含默认
    expect(cfg.arkBaseUrl).toBeUndefined();
  });
});
