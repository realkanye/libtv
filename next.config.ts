import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // ffmpeg/ffprobe 静态二进制按文件路径解析，必须保持外部依赖不被打包
  serverExternalPackages: ["ffmpeg-static", "ffprobe-static"],
};

export default nextConfig;
