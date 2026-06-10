import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

// 测试只覆盖 Provider 层与任务中枢等纯 Node 逻辑，不加载 React/Next 运行时。
export default defineConfig({
  resolve: {
    alias: { "@": resolve(__dirname, "src") },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
