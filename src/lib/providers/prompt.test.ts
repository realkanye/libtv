import { describe, expect, it } from "vitest";
import { effectivePrompt } from "./prompt";

describe("effectivePrompt（图+文 提示词增强）", () => {
  it("合并节点提示词与连入的参考文本", () => {
    expect(
      effectivePrompt({ prompt: "生成一张海报", refTexts: ["主角是红发女孩", "赛博朋克风"] })
    ).toBe("生成一张海报\n主角是红发女孩\n赛博朋克风");
  });
  it("节点无提示词时仅用连入文本（纯图+文）", () => {
    expect(effectivePrompt({ prompt: "  ", refTexts: ["把这张图变成夜景"] })).toBe(
      "把这张图变成夜景"
    );
  });
  it("无参考文本时即节点提示词", () => {
    expect(effectivePrompt({ prompt: "日落" })).toBe("日落");
  });
  it("过滤空白参考", () => {
    expect(effectivePrompt({ prompt: "x", refTexts: ["", "  ", "y"] })).toBe("x\ny");
  });
});
