// ffmpeg 视频合成的纯逻辑层：探测结果 → ffmpeg 参数。
// 不执行任何进程（执行在 local.ts），因此可被契约测试完整覆盖。

/** ffprobe 探测出的单个片段信息。 */
export interface ClipInfo {
  path: string;
  hasAudio: boolean;
  /** 秒。 */
  duration: number;
}

export interface ComposeOptions {
  width: number;
  height: number;
  fps: number;
  /** 可选 BGM 音轨（与视频原声 amix 混合）。 */
  bgmPath?: string;
  outputPath: string;
}

export function resolutionToSize(resolution?: string): {
  width: number;
  height: number;
} {
  return resolution === "1080p"
    ? { width: 1920, height: 1080 }
    : { width: 1280, height: 720 };
}

/**
 * 构造单条 ffmpeg 命令参数：
 * - 每个片段统一缩放/补边到目标分辨率、统一帧率与 SAR；
 * - 无音轨的片段用 anullsrc 生成等长静音，保证 concat 音轨对齐；
 * - 可选 BGM 与拼接后的原声 amix 混合（以视频长度为准）。
 */
export function buildComposeArgs(
  clips: ClipInfo[],
  opts: ComposeOptions
): string[] {
  const args: string[] = ["-y"];
  // 视频输入
  for (const clip of clips) {
    args.push("-i", clip.path);
  }
  // 为无音轨片段补静音输入（紧随视频输入之后，按需追加）
  const silentInputIndex = new Map<number, number>();
  let nextInput = clips.length;
  for (let i = 0; i < clips.length; i++) {
    if (!clips[i].hasAudio) {
      args.push(
        "-f",
        "lavfi",
        "-t",
        clips[i].duration.toFixed(3),
        "-i",
        "anullsrc=r=44100:cl=stereo"
      );
      silentInputIndex.set(i, nextInput++);
    }
  }
  // 可选 BGM 输入
  let bgmIndex = -1;
  if (opts.bgmPath) {
    args.push("-i", opts.bgmPath);
    bgmIndex = nextInput++;
  }

  const { width, height, fps } = opts;
  const filters: string[] = [];
  const concatInputs: string[] = [];
  for (let i = 0; i < clips.length; i++) {
    filters.push(
      `[${i}:v]scale=${width}:${height}:force_original_aspect_ratio=decrease,` +
        `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=${fps}[v${i}]`
    );
    const audioSrc = clips[i].hasAudio
      ? `[${i}:a]`
      : `[${silentInputIndex.get(i)}:a]`;
    filters.push(
      `${audioSrc}aformat=sample_rates=44100:channel_layouts=stereo[a${i}]`
    );
    concatInputs.push(`[v${i}][a${i}]`);
  }
  filters.push(
    `${concatInputs.join("")}concat=n=${clips.length}:v=1:a=1[vout][acat]`
  );
  let audioOut = "[acat]";
  if (bgmIndex >= 0) {
    filters.push(
      `[${bgmIndex}:a]aformat=sample_rates=44100:channel_layouts=stereo[bgm]`,
      `[acat][bgm]amix=inputs=2:duration=first:dropout_transition=2[aout]`
    );
    audioOut = "[aout]";
  }

  args.push(
    "-filter_complex",
    filters.join(";"),
    "-map",
    "[vout]",
    "-map",
    audioOut,
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "23",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-b:a",
    "128k",
    "-movflags",
    "+faststart",
    opts.outputPath
  );
  return args;
}

/** 裁取视频片段 [start, end]（秒）。重新编码以保证关键帧精确。 */
export function buildTrimArgs(
  input: string,
  start: number,
  end: number,
  output: string
): string[] {
  if (!(end > start)) {
    throw new Error("裁取终点必须大于起点");
  }
  return [
    "-y",
    "-ss",
    start.toFixed(3),
    "-to",
    end.toFixed(3),
    "-i",
    input,
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "23",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-b:a",
    "128k",
    "-movflags",
    "+faststart",
    output,
  ];
}

/** 从视频提取音频为 mp3。 */
export function buildExtractAudioArgs(input: string, output: string): string[] {
  return ["-y", "-i", input, "-vn", "-c:a", "libmp3lame", "-q:a", "2", output];
}

/** 截取音频片段 [start, end]（秒）。 */
export function buildAudioTrimArgs(
  input: string,
  start: number,
  end: number,
  output: string
): string[] {
  if (!(end > start)) {
    throw new Error("截取终点必须大于起点");
  }
  return [
    "-y",
    "-ss",
    start.toFixed(3),
    "-to",
    end.toFixed(3),
    "-i",
    input,
    "-c:a",
    "libmp3lame",
    "-q:a",
    "2",
    output,
  ];
}

/**
 * 音频变速（不改变音调）。ffmpeg atempo 单次仅支持 0.5–2.0，
 * 超出范围时串联多级 atempo。
 */
export function buildAudioSpeedArgs(
  input: string,
  speed: number,
  output: string
): string[] {
  if (!(speed > 0)) {
    throw new Error("变速倍率必须为正数");
  }
  const factors: number[] = [];
  let remaining = speed;
  while (remaining > 2.0) {
    factors.push(2.0);
    remaining /= 2.0;
  }
  while (remaining < 0.5) {
    factors.push(0.5);
    remaining /= 0.5;
  }
  factors.push(Number(remaining.toFixed(4)));
  const filter = factors.map((f) => `atempo=${f}`).join(",");
  return [
    "-y",
    "-i",
    input,
    "-filter:a",
    filter,
    "-c:a",
    "libmp3lame",
    "-q:a",
    "2",
    output,
  ];
}

/** 解析 `ffprobe -show_streams -show_format -of json` 的输出。 */
export function parseProbeOutput(
  path: string,
  json: string
): ClipInfo {
  let parsed: {
    streams?: { codec_type?: string; duration?: string }[];
    format?: { duration?: string };
  };
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error(`ffprobe 输出无法解析: ${path}`);
  }
  const streams = parsed.streams ?? [];
  const hasVideo = streams.some((s) => s.codec_type === "video");
  if (!hasVideo) {
    throw new Error(`文件不含视频流: ${path}`);
  }
  const hasAudio = streams.some((s) => s.codec_type === "audio");
  const duration = Number(parsed.format?.duration ?? 0);
  if (!duration || !Number.isFinite(duration)) {
    throw new Error(`无法读取视频时长: ${path}`);
  }
  return { path, hasAudio, duration };
}
