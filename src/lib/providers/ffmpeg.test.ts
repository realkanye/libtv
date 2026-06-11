import { describe, expect, it } from "vitest";
import {
  buildComposeArgs,
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
