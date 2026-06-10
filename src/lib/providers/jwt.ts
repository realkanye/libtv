// 可灵开放平台的鉴权：用 AccessKey/SecretKey 签发短时效 HS256 JWT。
// 仅服务端使用（依赖 node:crypto）。无需引入 jsonwebtoken 等第三方库。

import { createHmac } from "node:crypto";

function base64url(input: Buffer | string): string {
  const buf = typeof input === "string" ? Buffer.from(input) : input;
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/**
 * 签发可灵 API token。默认有效期 30 分钟（提前于 24h 任务有效期刷新）。
 * payload 约定：iss=AccessKey，exp/nbf 控制时效。
 */
export function signKlingToken(
  accessKey: string,
  secretKey: string,
  ttlSeconds = 1800
): string {
  const header = { alg: "HS256", typ: "JWT" };
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: accessKey,
    exp: now + ttlSeconds,
    nbf: now - 5,
  };

  const encodedHeader = base64url(JSON.stringify(header));
  const encodedPayload = base64url(JSON.stringify(payload));
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const signature = base64url(
    createHmac("sha256", secretKey).update(signingInput).digest()
  );
  return `${signingInput}.${signature}`;
}
