// 把节点自身提示词与「上游文本/脚本节点连入的参考文本」合并成最终提示词。
// 这是 LibTV「文本连入 = 提示词增强」语义的落地点：图+文生图、图+文生视频
// 都靠它把连入的文字真正喂给模型（而不是被丢弃）。纯函数，便于测试。

export function effectivePrompt(req: {
  prompt: string;
  refTexts?: string[];
}): string {
  const refs = (req.refTexts ?? []).map((s) => s.trim()).filter(Boolean);
  const base = (req.prompt ?? "").trim();
  return [base, ...refs].filter(Boolean).join("\n");
}
