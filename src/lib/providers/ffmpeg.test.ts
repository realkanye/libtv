import { describe, expect, it } from "vitest";
import {
  buildAudioSpeedArgs,
  buildAudioTrimArgs,
  buildComposeArgs,
  buildExtractAudioArgs,
  buildTrimArgs,
  parseProbeOutput,
  resolutionToSize,
} from "./ffmpeg";

describe("resolutionToSize", () => {
  it("映射分辨率档位", () => {
    expect(resolutionToSize("720p")).toEqual({ width: 1280, height: 720 });
    expect(resolutionToSize("1080p")).toEqual({ width: 1920, height: 1080 });
    expect(resolutionToSize(undefined)).toEqual({ width: 1280, height: 720 });
  });
});

describe("parseProbeOutput", () => {
  it("解析含音轨的视频", () => {
    const json = JSON.stringify({
      streams: [{ codec_type: "video" }, { codec_type: "audio" }],
      format: { duration: "5.04" },
    });
    expect(parseProbeOutput("/a.mp4", json)).toEqual({
      path: "/a.mp4",
      hasAudio: true,
      duration: 5.04,
    });
  });
  it("无视频流时报错", () => {
    const json = JSON.stringify({
      streams: [{ codec_type: "audio" }],
      format: { duration: "3" },
    });
    expect(() => parseProbeOutput("/a.mp3", json)).toThrow("不含视频流");
  });
});

describe("buildComposeArgs", () => {
  const opts = { width: 1280, height: 720, fps: 30, outputPath: "/out.mp4" };

  it("两段都有音轨：无静音输入，concat n=2", () => {
    const args = buildComposeArgs(
      [
        { path: "/a.mp4", hasAudio: true, duration: 5 },
        { path: "/b.mp4", hasAudio: true, duration: 3 },
      ],
      opts
    );
    expect(args.filter((a) => a === "-i")).toHaveLength(2);
    const filter = args[args.indexOf("-filter_complex") + 1];
    expect(filter).toContain("concat=n=2:v=1:a=1");
    expect(filter).not.toContain("anullsrc");
    expect(args[args.length - 1]).toBe("/out.mp4");
  });

  it("无音轨片段补等长静音输入", () => {
    const args = buildComposeArgs(
      [
        { path: "/a.mp4", hasAudio: false, duration: 2.5 },
        { path: "/b.mp4", hasAudio: true, duration: 3 },
      ],
      opts
    );
    const i = args.indexOf("anullsrc=r=44100:cl=stereo");
    expect(i).toBeGreaterThan(0);
    expect(args[args.indexOf("-t") + 1]).toBe("2.500");
    const filter = args[args.indexOf("-filter_complex") + 1];
    // 第 0 段无音轨 → 用静音输入（索引 2）作为其音轨
    expect(filter).toContain("[2:a]aformat");
  });

  it("BGM 与拼接原声 amix 混合", () => {
    const args = buildComposeArgs(
      [
        { path: "/a.mp4", hasAudio: true, duration: 5 },
        { path: "/b.mp4", hasAudio: true, duration: 3 },
      ],
      { ...opts, bgmPath: "/bgm.mp3" }
    );
    const filter = args[args.indexOf("-filter_complex") + 1];
    expect(filter).toContain("amix=inputs=2:duration=first");
    expect(args).toContain("/bgm.mp3");
    expect(args[args.indexOf("-map", args.indexOf("-map") + 1) + 1]).toBe("[aout]");
  });
});

describe("媒体编辑工具参数构造", () => {
  it("视频裁取：-ss/-to 精确到毫秒，重编码", () => {
    const args = buildTrimArgs("/in.mp4", 1.5, 4.25, "/out.mp4");
    expect(args[args.indexOf("-ss") + 1]).toBe("1.500");
    expect(args[args.indexOf("-to") + 1]).toBe("4.250");
    expect(args).toContain("libx264");
    expect(args[args.length - 1]).toBe("/out.mp4");
  });
  it("裁取终点不大于起点时报错", () => {
    expect(() => buildTrimArgs("/in.mp4", 3, 3, "/o.mp4")).toThrow("大于起点");
    expect(() => buildAudioTrimArgs("/in.mp3", 5, 2, "/o.mp3")).toThrow();
  });
  it("提取音频：-vn + mp3 编码", () => {
    const args = buildExtractAudioArgs("/in.mp4", "/out.mp3");
    expect(args).toContain("-vn");
    expect(args).toContain("libmp3lame");
  });
  it("音频变速：范围内单级 atempo", () => {
    const args = buildAudioSpeedArgs("/in.mp3", 1.5, "/out.mp3");
    expect(args[args.indexOf("-filter:a") + 1]).toBe("atempo=1.5");
  });
  it("音频变速：超出 0.5–2.0 时串联多级 atempo", () => {
    const fast = buildAudioSpeedArgs("/in.mp3", 4, "/o.mp3");
    expect(fast[fast.indexOf("-filter:a") + 1]).toBe("atempo=2,atempo=2");
    const slow = buildAudioSpeedArgs("/in.mp3", 0.25, "/o.mp3");
    expect(slow[slow.indexOf("-filter:a") + 1]).toBe("atempo=0.5,atempo=0.5");
  });
  it("变速倍率非正时报错", () => {
    expect(() => buildAudioSpeedArgs("/in.mp3", 0, "/o.mp3")).toThrow();
  });
});
