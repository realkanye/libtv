import { describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import { signKlingToken } from "./jwt";

function b64urlJson(part: string) {
  const b64 = part.replace(/-/g, "+").replace(/_/g, "/");
  return JSON.parse(Buffer.from(b64, "base64").toString("utf8"));
}

describe("signKlingToken", () => {
  it("生成结构正确的 HS256 JWT", () => {
    const token = signKlingToken("ak-123", "sk-456", 1800);
    const parts = token.split(".");
    expect(parts).toHaveLength(3);

    const header = b64urlJson(parts[0]);
    expect(header).toEqual({ alg: "HS256", typ: "JWT" });

    const payload = b64urlJson(parts[1]);
    expect(payload.iss).toBe("ak-123");
    expect(payload.exp - payload.nbf).toBeGreaterThanOrEqual(1800);
  });

  it("签名可被 SecretKey 验证", () => {
    const token = signKlingToken("ak", "secret", 60);
    const [h, p, sig] = token.split(".");
    const expected = createHmac("sha256", "secret")
      .update(`${h}.${p}`)
      .digest("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    expect(sig).toBe(expected);
  });
});
