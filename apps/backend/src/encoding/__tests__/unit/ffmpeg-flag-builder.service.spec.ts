import { Test, type TestingModule } from '@nestjs/testing';
import type { Job, Policy } from '@prisma/client';
import { FfmpegFlagBuilderService } from '../../ffmpeg-flag-builder.service';
import {
  type HardwareAccelConfig,
  HardwareAccelerationService,
} from '../../hardware-acceleration.service';

const makeJob = (overrides: Partial<Job> = {}): Job =>
  ({
    id: 'job-1',
    filePath: '/videos/movie.mkv',
    sourceCodec: 'h264',
    targetCodec: 'hevc',
    type: 'ENCODE',
    decisionData: null,
    codecOverride: null,
    healthMessage: null,
    streamInfo: null,
    ...overrides,
  }) as unknown as Job;

const makePolicy = (overrides: Partial<Policy> = {}): Policy =>
  ({
    id: 'policy-1',
    targetCodec: 'HEVC',
    targetQuality: 23,
    advancedSettings: {},
    ...overrides,
  }) as unknown as Policy;

const makeHwaccel = (overrides: Partial<HardwareAccelConfig> = {}): HardwareAccelConfig => ({
  type: 'CPU',
  flags: [],
  videoCodec: 'libx265',
  ...overrides,
});

describe('FfmpegFlagBuilderService', () => {
  let service: FfmpegFlagBuilderService;

  const mockHardwareAccelerationService = {
    selectCodecForPolicy: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FfmpegFlagBuilderService,
        {
          provide: HardwareAccelerationService,
          useValue: mockHardwareAccelerationService,
        },
      ],
    }).compile();

    service = module.get(FfmpegFlagBuilderService);
    mockHardwareAccelerationService.selectCodecForPolicy.mockReturnValue('libx265');
  });

  // ── validateFfmpegFlags ──────────────────────────────────────────────────

  describe('validateFfmpegFlags', () => {
    it('returns empty array for empty input', () => {
      expect(service.validateFfmpegFlags([])).toEqual([]);
    });

    it('passes whitelisted standalone flags', () => {
      expect(service.validateFfmpegFlags(['-crf'])).toEqual(['-crf']);
    });

    it('passes whitelisted flag with its value', () => {
      expect(service.validateFfmpegFlags(['-preset', 'fast'])).toEqual(['-preset', 'fast']);
    });

    it('throws on disallowed flag', () => {
      expect(() => service.validateFfmpegFlags(['-vcodec'])).toThrow(
        "FFmpeg flag '-vcodec' is not allowed for security reasons"
      );
    });

    it('throws on command injection attempt', () => {
      expect(() => service.validateFfmpegFlags(['-preset', 'fast; rm -rf /'])).toThrow(
        'contains invalid characters'
      );
    });

    it('allows valid -map value matching stream pattern', () => {
      expect(service.validateFfmpegFlags(['-map', '0:v:0'])).toEqual(['-map', '0:v:0']);
    });

    it('allows -map value "0"', () => {
      expect(service.validateFfmpegFlags(['-map', '0'])).toEqual(['-map', '0']);
    });

    it('throws on -map with file path injection', () => {
      expect(() => service.validateFfmpegFlags(['-map', 'file:/etc/passwd'])).toThrow(
        "FFmpeg -map flag value 'file:/etc/passwd' is invalid"
      );
    });

    it('throws on -map with relative path traversal', () => {
      expect(() => service.validateFfmpegFlags(['-map', '../secret'])).toThrow(
        "FFmpeg -map flag value '../secret' is invalid"
      );
    });

    it('handles multiple valid flags in sequence', () => {
      const input = ['-crf', '23', '-preset', 'slow'];
      expect(service.validateFfmpegFlags(input)).toEqual(['-crf', '23', '-preset', 'slow']);
    });

    it('validates x265-params flag with value', () => {
      expect(service.validateFfmpegFlags(['-x265-params', 'aq-mode=3'])).toEqual([
        '-x265-params',
        'aq-mode=3',
      ]);
    });
  });

  // ── selectCodecForPolicy ────────────────────────────────────────────────

  describe('selectCodecForPolicy', () => {
    it('delegates to HardwareAccelerationService', () => {
      mockHardwareAccelerationService.selectCodecForPolicy.mockReturnValue('hevc_nvenc');
      const result = service.selectCodecForPolicy('HEVC', 'NVIDIA');
      expect(mockHardwareAccelerationService.selectCodecForPolicy).toHaveBeenCalledWith(
        'HEVC',
        'NVIDIA'
      );
      expect(result).toBe('hevc_nvenc');
    });
  });

  // ── buildFfmpegCommand – REMUX mode ─────────────────────────────────────

  describe('buildFfmpegCommand – REMUX', () => {
    it('uses stream copy flags for REMUX job (default mkv target copies everything)', () => {
      const job = makeJob({ type: 'REMUX' } as Partial<Job>);
      const args = service.buildFfmpegCommand(job, makePolicy(), makeHwaccel(), '/out/movie.mkv');
      expect(args[args.indexOf('-c:v') + 1]).toBe('copy');
      expect(args[args.indexOf('-c:a') + 1]).toBe('copy');
      expect(args[args.indexOf('-c:s') + 1]).toBe('copy');
      expect(args[args.indexOf('-map') + 1]).toBe('0');
    });

    it('maps only real video and audio for REMUX to mp4 (no -map 0, no subtitles)', () => {
      const job = makeJob({ type: 'REMUX', targetContainer: 'mp4' } as Partial<Job>);
      const args = service.buildFfmpegCommand(job, makePolicy(), makeHwaccel(), '/out/movie.mp4');
      const mapIdx = args.indexOf('-map');
      expect(args[mapIdx + 1]).toBe('0:V');
      expect(args[mapIdx + 2]).toBe('-map');
      expect(args[mapIdx + 3]).toBe('0:a?');
      expect(args).not.toContain('0');
      expect(args).not.toContain('0:s?');
      expect(args).not.toContain('-c:s');
      expect(args[args.indexOf('-c:v') + 1]).toBe('copy');
      expect(args[args.indexOf('-c:a') + 1]).toBe('copy');
    });

    it('sets MKV format for REMUX with mkv container', () => {
      const job = makeJob({
        type: 'REMUX',
        targetContainer: 'mkv',
      } as Partial<Job>);
      const args = service.buildFfmpegCommand(job, makePolicy(), makeHwaccel(), '/out/movie.mkv');
      expect(args).toContain('matroska');
    });

    it('sets MP4 format and movflags for REMUX with mp4 container', () => {
      const job = makeJob({
        type: 'REMUX',
        targetContainer: 'mp4',
      } as Partial<Job>);
      const args = service.buildFfmpegCommand(job, makePolicy(), makeHwaccel(), '/out/movie.mp4');
      expect(args).toContain('mp4');
      expect(args[args.indexOf('-movflags') + 1]).toBe('+faststart');
      expect(args).not.toContain('+frag_keyframe+empty_moov+default_base_moof');
    });
  });

  // ── buildFfmpegCommand – ENCODE mode ────────────────────────────────────

  describe('buildFfmpegCommand – ENCODE', () => {
    it('includes -i with file path', () => {
      const job = makeJob();
      const args = service.buildFfmpegCommand(job, makePolicy(), makeHwaccel(), '/out/out.mkv');
      expect(args).toContain('-i');
      expect(args[args.indexOf('-i') + 1]).toBe('/videos/movie.mkv');
    });

    it('never emits -ss for ENCODE jobs', () => {
      const args = service.buildFfmpegCommand(
        makeJob(),
        makePolicy(),
        makeHwaccel(),
        '/out/out.mkv'
      );
      expect(args).not.toContain('-ss');
    });

    it('spreads hwaccel flags before -i', () => {
      const hwaccel = makeHwaccel({
        flags: ['-hwaccel', 'cuda'],
        type: 'NVIDIA',
      });
      const args = service.buildFfmpegCommand(makeJob(), makePolicy(), hwaccel, '/out/out.mkv');
      expect(args).toContain('-hwaccel');
    });

    it('sets codec from selectCodecForPolicy result', () => {
      mockHardwareAccelerationService.selectCodecForPolicy.mockReturnValue('hevc_nvenc');
      const args = service.buildFfmpegCommand(
        makeJob(),
        makePolicy(),
        makeHwaccel(),
        '/out/out.mkv'
      );
      const cvIdx = args.indexOf('-c:v');
      expect(args[cvIdx + 1]).toBe('hevc_nvenc');
    });

    it('sets -crf from policy targetQuality', () => {
      const policy = makePolicy({ targetQuality: 28 } as Partial<Policy>);
      const args = service.buildFfmpegCommand(makeJob(), policy, makeHwaccel(), '/out/out.mkv');
      expect(args[args.indexOf('-crf') + 1]).toBe('28');
    });

    it('defaults audio to copy when no decision or policy override', () => {
      const args = service.buildFfmpegCommand(
        makeJob(),
        makePolicy(),
        makeHwaccel(),
        '/out/out.mkv'
      );
      expect(args[args.indexOf('-c:a') + 1]).toBe('copy');
    });

    it('uses audio codec from decisionData', () => {
      const job = makeJob({
        decisionData: JSON.stringify({ actionConfig: { audioCodec: 'aac' } }),
      });
      const args = service.buildFfmpegCommand(job, makePolicy(), makeHwaccel(), '/out/out.mkv');
      expect(args[args.indexOf('-c:a') + 1]).toBe('aac');
    });

    it('uses audio bitrate from decisionData', () => {
      const job = makeJob({
        decisionData: JSON.stringify({
          actionConfig: { audioCodec: 'aac', audioBitrate: '192k' },
        }),
      });
      const args = service.buildFfmpegCommand(job, makePolicy(), makeHwaccel(), '/out/out.mkv');
      expect(args).toContain('-b:a');
      expect(args[args.indexOf('-b:a') + 1]).toBe('192k');
    });

    it('uses audio codec from policy advancedSettings when decision does not override', () => {
      const policy = makePolicy({
        advancedSettings: { audioCodec: 'eac3' },
      } as Partial<Policy>);
      const args = service.buildFfmpegCommand(makeJob(), policy, makeHwaccel(), '/out/out.mkv');
      expect(args[args.indexOf('-c:a') + 1]).toBe('eac3');
    });

    it('applies -threads when ffmpegThreads set on job', () => {
      const job = makeJob({ ffmpegThreads: 4 } as Partial<Job>);
      const args = service.buildFfmpegCommand(job, makePolicy(), makeHwaccel(), '/out/out.mkv');
      expect(args).toContain('-threads');
      expect(args[args.indexOf('-threads') + 1]).toBe('4');
    });

    it('validates and applies ffmpegFlags from policy advancedSettings', () => {
      const policy = makePolicy({
        advancedSettings: { ffmpegFlags: ['-preset', 'slow'] },
      } as Partial<Policy>);
      const args = service.buildFfmpegCommand(makeJob(), policy, makeHwaccel(), '/out/out.mkv');
      expect(args).toContain('-preset');
    });

    it('throws when policy ffmpegFlags contain disallowed flag', () => {
      const policy = makePolicy({
        advancedSettings: { ffmpegFlags: ['-vcodec', 'libx265'] },
      } as Partial<Policy>);
      expect(() =>
        service.buildFfmpegCommand(makeJob(), policy, makeHwaccel(), '/out/out.mkv')
      ).toThrow("FFmpeg flag '-vcodec' is not allowed");
    });

    it('applies ffmpegFlags from decisionData', () => {
      const job = makeJob({
        decisionData: JSON.stringify({
          actionConfig: { ffmpegFlags: ['-tune', 'film'] },
        }),
      });
      const args = service.buildFfmpegCommand(job, makePolicy(), makeHwaccel(), '/out/out.mkv');
      expect(args).toContain('-tune');
    });

    it('silently ignores malformed decisionData JSON', () => {
      const job = makeJob({ decisionData: '{bad json' });
      expect(() =>
        service.buildFfmpegCommand(job, makePolicy(), makeHwaccel(), '/out/out.mkv')
      ).not.toThrow();
    });

    it('always appends -progress pipe:2 and -nostdin', () => {
      const args = service.buildFfmpegCommand(
        makeJob(),
        makePolicy(),
        makeHwaccel(),
        '/out/out.mkv'
      );
      expect(args).toContain('-progress');
      expect(args[args.indexOf('-progress') + 1]).toBe('pipe:2');
      expect(args).toContain('-nostdin');
    });

    it('appends -y and output path at the end', () => {
      const outputPath = '/tmp/out.mkv';
      const args = service.buildFfmpegCommand(makeJob(), makePolicy(), makeHwaccel(), outputPath);
      expect(args[args.length - 1]).toBe(outputPath);
      expect(args[args.length - 2]).toBe('-y');
    });

    it('defaults unknown container to matroska', () => {
      const job = makeJob({ targetContainer: 'avi' } as Partial<Job>);
      const args = service.buildFfmpegCommand(job, makePolicy(), makeHwaccel(), '/out/out.avi');
      expect(args).toContain('matroska');
    });
  });

  // ── buildFfmpegCommand – ENCODE stream mapping ──────────────────────────

  describe('buildFfmpegCommand – ENCODE stream mapping', () => {
    it('always maps real video then all audio (-map 0:V -map 0:a? adjacent)', () => {
      const args = service.buildFfmpegCommand(
        makeJob(),
        makePolicy(),
        makeHwaccel(),
        '/out/out.mkv'
      );
      const mapIdx = args.indexOf('-map');
      expect(args[mapIdx + 1]).toBe('0:V');
      expect(args[mapIdx + 2]).toBe('-map');
      expect(args[mapIdx + 3]).toBe('0:a?');
      expect(args).not.toContain('0:v');
      expect(args).not.toContain('0:a');
    });

    it('maps and copies subtitles for mkv target', () => {
      const args = service.buildFfmpegCommand(
        makeJob(),
        makePolicy(),
        makeHwaccel(),
        '/out/out.mkv'
      );
      expect(args).toContain('0:s?');
      expect(args[args.indexOf('-c:s') + 1]).toBe('copy');
    });

    it('drops subtitles entirely for mp4 target without streamInfo', () => {
      const job = makeJob({ targetContainer: 'mp4' } as Partial<Job>);
      const args = service.buildFfmpegCommand(job, makePolicy(), makeHwaccel(), '/out/out.mp4');
      expect(args).not.toContain('0:s?');
      expect(args).not.toContain('-c:s');
      expect(args).not.toContain('mov_text');
    });
  });

  // ── buildFfmpegCommand – quality flag per encoder family ────────────────

  describe('buildFfmpegCommand – quality flag', () => {
    const cases: [string, string][] = [
      ['NVIDIA', '-cq'],
      ['INTEL_QSV', '-global_quality'],
      ['AMD', '-qp'],
      ['APPLE_M', '-q:v'],
      ['CPU', '-crf'],
    ];

    it.each(cases)('uses %s quality flag %s', (hwType, qualityFlag) => {
      const hwaccel = makeHwaccel({ type: hwType } as Partial<HardwareAccelConfig>);
      const args = service.buildFfmpegCommand(makeJob(), makePolicy(), hwaccel, '/out/out.mkv');
      expect(args[args.indexOf(qualityFlag) + 1]).toBe('23');
    });

    it('uses codec override with -crf and no hwaccel flags when codecOverride is set', () => {
      const job = makeJob({ codecOverride: 'libx265' } as Partial<Job>);
      const hwaccel = makeHwaccel({
        type: 'NVIDIA',
        flags: ['-hwaccel', 'cuda', '-hwaccel_output_format', 'cuda'],
        videoCodec: 'hevc_nvenc',
      });
      const args = service.buildFfmpegCommand(job, makePolicy(), hwaccel, '/out/out.mkv');
      expect(args[args.indexOf('-c:v') + 1]).toBe('libx265');
      expect(args[args.indexOf('-crf') + 1]).toBe('23');
      expect(args).not.toContain('-cq');
      expect(args).not.toContain('-hwaccel');
    });
  });

  // ── buildFfmpegCommand – VAAPI video filter merging ─────────────────────

  describe('buildFfmpegCommand – VAAPI -vf', () => {
    const vaapiHwaccel = (): HardwareAccelConfig =>
      makeHwaccel({
        type: 'AMD',
        flags: ['-hwaccel', 'vaapi', '-vaapi_device', '/dev/dri/renderD129'],
        videoCodec: 'hevc_vaapi',
        videoFilter: 'format=nv12,hwupload',
      } as Partial<HardwareAccelConfig>);

    it('emits exactly one -vf with hwupload chain after -i', () => {
      const args = service.buildFfmpegCommand(
        makeJob(),
        makePolicy(),
        vaapiHwaccel(),
        '/out/out.mkv'
      );
      expect(args.filter((a) => a === '-vf')).toHaveLength(1);
      const vfIdx = args.indexOf('-vf');
      expect(vfIdx).toBeGreaterThan(args.indexOf('-i'));
      expect(args[vfIdx + 1]).toBe('format=nv12,hwupload');
    });

    it('merges policy -vf with hwupload chain appended last', () => {
      const policy = makePolicy({
        advancedSettings: { ffmpegFlags: ['-vf', 'scale=1280:720'] },
      } as Partial<Policy>);
      const args = service.buildFfmpegCommand(makeJob(), policy, vaapiHwaccel(), '/out/out.mkv');
      expect(args.filter((a) => a === '-vf')).toHaveLength(1);
      expect(args[args.indexOf('-vf') + 1]).toBe('scale=1280:720,format=nv12,hwupload');
    });

    it('emits no -vf when codecOverride forces software fallback', () => {
      const job = makeJob({ codecOverride: 'libx265' } as Partial<Job>);
      const args = service.buildFfmpegCommand(job, makePolicy(), vaapiHwaccel(), '/out/out.mkv');
      expect(args).not.toContain('-vf');
    });
  });

  // ── buildFfmpegCommand – streamInfo parsing defaults ────────────────────

  describe('buildFfmpegCommand – streamInfo defensive parsing', () => {
    it('treats non-array streamInfo as absent (mp4 gets no subtitle map)', () => {
      const job = makeJob({ targetContainer: 'mp4', streamInfo: { bogus: true } } as Partial<Job>);
      const args = service.buildFfmpegCommand(job, makePolicy(), makeHwaccel(), '/out/out.mp4');
      expect(args).not.toContain('-c:s');
      expect(args.some((a) => a.startsWith('0:s'))).toBe(false);
    });

    it('treats array of malformed entries as absent', () => {
      const job = makeJob({
        targetContainer: 'mp4',
        streamInfo: [{ index: 0 }, 'garbage', null, 42],
      } as Partial<Job>);
      const args = service.buildFfmpegCommand(job, makePolicy(), makeHwaccel(), '/out/out.mp4');
      expect(args).not.toContain('-c:s');
      expect(args.some((a) => a.startsWith('0:s'))).toBe(false);
    });
  });

  // ── buildFfmpegCommand – MP4 subtitle mapping from streamInfo ───────────

  describe('buildFfmpegCommand – MP4 subtitles via streamInfo', () => {
    it('maps only text subtitles individually and converts to mov_text', () => {
      const job = makeJob({
        targetContainer: 'mp4',
        streamInfo: [
          { index: 0, type: 'video', codec: 'h264', pixFmt: 'yuv420p' },
          { index: 1, type: 'audio', codec: 'aac' },
          { index: 2, type: 'subtitle', codec: 'subrip' },
          { index: 3, type: 'subtitle', codec: 'hdmv_pgs_subtitle' },
          { index: 4, type: 'subtitle', codec: 'ass' },
        ],
      } as Partial<Job>);
      const args = service.buildFfmpegCommand(job, makePolicy(), makeHwaccel(), '/out/out.mp4');
      expect(args).toContain('0:s:0?');
      expect(args).toContain('0:s:2?');
      expect(args).not.toContain('0:s:1?');
      expect(args).not.toContain('0:s?');
      expect(args.filter((a) => a === '-c:s')).toHaveLength(1);
      expect(args[args.indexOf('-c:s') + 1]).toBe('mov_text');
    });

    it('maps no subtitles when streamInfo has only bitmap subs', () => {
      const job = makeJob({
        targetContainer: 'mp4',
        streamInfo: [
          { index: 0, type: 'video', codec: 'h264' },
          { index: 1, type: 'subtitle', codec: 'hdmv_pgs_subtitle' },
          { index: 2, type: 'subtitle', codec: 'dvd_subtitle' },
        ],
      } as Partial<Job>);
      const args = service.buildFfmpegCommand(job, makePolicy(), makeHwaccel(), '/out/out.mp4');
      expect(args).not.toContain('-c:s');
      expect(args.some((a) => a.startsWith('0:s'))).toBe(false);
    });

    it('keeps blanket -map 0:s? with -c:s copy for mkv target even with streamInfo', () => {
      const job = makeJob({
        targetContainer: 'mkv',
        streamInfo: [
          { index: 0, type: 'video', codec: 'h264' },
          { index: 1, type: 'subtitle', codec: 'hdmv_pgs_subtitle' },
        ],
      } as Partial<Job>);
      const args = service.buildFfmpegCommand(job, makePolicy(), makeHwaccel(), '/out/out.mkv');
      expect(args).toContain('0:s?');
      expect(args[args.indexOf('-c:s') + 1]).toBe('copy');
      expect(args.some((a) => /^0:s:\d/.test(a))).toBe(false);
    });
  });

  // ── buildFfmpegCommand – MP4 incompatible-audio auto-transcode ──────────

  describe('buildFfmpegCommand – MP4 audio auto-transcode', () => {
    const audioStreamInfo = [
      { index: 0, type: 'video', codec: 'h264' },
      { index: 1, type: 'audio', codec: 'aac' },
      { index: 2, type: 'audio', codec: 'ac3' },
      { index: 3, type: 'audio', codec: 'dts' },
    ];

    it('adds per-stream aac overrides after base -c:a copy for incompatible tracks only', () => {
      const job = makeJob({ targetContainer: 'mp4', streamInfo: audioStreamInfo } as Partial<Job>);
      const args = service.buildFfmpegCommand(job, makePolicy(), makeHwaccel(), '/out/out.mp4');
      expect(args[args.indexOf('-c:a') + 1]).toBe('copy');
      expect(args[args.indexOf('-c:a:1') + 1]).toBe('aac');
      expect(args[args.indexOf('-b:a:1') + 1]).toBe('384k');
      expect(args[args.indexOf('-c:a:2') + 1]).toBe('aac');
      expect(args[args.indexOf('-b:a:2') + 1]).toBe('384k');
      expect(args).not.toContain('-c:a:0');
      expect(args.indexOf('-c:a')).toBeLessThan(args.indexOf('-c:a:1'));
    });

    it('skips per-stream overrides when a decision already set a non-copy audio codec', () => {
      const job = makeJob({
        targetContainer: 'mp4',
        streamInfo: audioStreamInfo,
        decisionData: JSON.stringify({ actionConfig: { audioCodec: 'aac' } }),
      } as Partial<Job>);
      const args = service.buildFfmpegCommand(job, makePolicy(), makeHwaccel(), '/out/out.mp4');
      expect(args[args.indexOf('-c:a') + 1]).toBe('aac');
      expect(args).not.toContain('-c:a:1');
      expect(args).not.toContain('-c:a:2');
    });

    it('adds no overrides for mkv target', () => {
      const job = makeJob({ targetContainer: 'mkv', streamInfo: audioStreamInfo } as Partial<Job>);
      const args = service.buildFfmpegCommand(job, makePolicy(), makeHwaccel(), '/out/out.mkv');
      expect(args).not.toContain('-c:a:1');
      expect(args).not.toContain('-c:a:2');
    });
  });

  // ── buildFfmpegCommand – 10-bit source handling ─────────────────────────

  describe('buildFfmpegCommand – 10-bit sources', () => {
    // Cover-art mjpeg stream first: must be skipped when finding the video stream
    const tenBitStreamInfo = [
      { index: 0, type: 'video', codec: 'mjpeg', pixFmt: 'yuvj420p' },
      { index: 1, type: 'video', codec: 'hevc', pixFmt: 'yuv420p10le' },
      { index: 2, type: 'audio', codec: 'aac' },
    ];

    it('strips the -hwaccel_output_format pair from NVIDIA flags, keeps -hwaccel cuda', () => {
      const job = makeJob({ streamInfo: tenBitStreamInfo } as Partial<Job>);
      const hwaccel = makeHwaccel({
        type: 'NVIDIA',
        flags: ['-hwaccel', 'cuda', '-hwaccel_output_format', 'cuda'],
        videoCodec: 'hevc_nvenc',
      });
      const args = service.buildFfmpegCommand(job, makePolicy(), hwaccel, '/out/out.mkv');
      expect(args[args.indexOf('-hwaccel') + 1]).toBe('cuda');
      expect(args).not.toContain('-hwaccel_output_format');
    });

    it('keeps -hwaccel_output_format for 8-bit sources', () => {
      const job = makeJob({
        streamInfo: [{ index: 0, type: 'video', codec: 'h264', pixFmt: 'yuv420p' }],
      } as Partial<Job>);
      const hwaccel = makeHwaccel({
        type: 'NVIDIA',
        flags: ['-hwaccel', 'cuda', '-hwaccel_output_format', 'cuda'],
        videoCodec: 'hevc_nvenc',
      });
      const args = service.buildFfmpegCommand(job, makePolicy(), hwaccel, '/out/out.mkv');
      expect(args).toContain('-hwaccel_output_format');
    });

    it('pushes -pix_fmt yuv420p after the quality flag for H264 target', () => {
      const job = makeJob({ streamInfo: tenBitStreamInfo } as Partial<Job>);
      const policy = makePolicy({ targetCodec: 'H264' } as Partial<Policy>);
      const args = service.buildFfmpegCommand(job, policy, makeHwaccel(), '/out/out.mkv');
      const pixIdx = args.indexOf('-pix_fmt');
      expect(args[pixIdx + 1]).toBe('yuv420p');
      expect(pixIdx).toBeGreaterThan(args.indexOf('-crf'));
    });

    it('does not add -pix_fmt for non-H264 targets', () => {
      const job = makeJob({ streamInfo: tenBitStreamInfo } as Partial<Job>);
      const args = service.buildFfmpegCommand(job, makePolicy(), makeHwaccel(), '/out/out.mkv');
      expect(args).not.toContain('-pix_fmt');
    });

    it('upgrades VAAPI filter to format=p010 for 10-bit non-H264 target', () => {
      const job = makeJob({ streamInfo: tenBitStreamInfo } as Partial<Job>);
      const hwaccel = makeHwaccel({
        type: 'AMD',
        flags: ['-hwaccel', 'vaapi', '-vaapi_device', '/dev/dri/renderD129'],
        videoCodec: 'hevc_vaapi',
        videoFilter: 'format=nv12,hwupload',
      } as Partial<HardwareAccelConfig>);
      const args = service.buildFfmpegCommand(job, makePolicy(), hwaccel, '/out/out.mkv');
      expect(args[args.indexOf('-vf') + 1]).toBe('format=p010,hwupload');
    });

    it('keeps VAAPI nv12 filter for 10-bit source with H264 target', () => {
      const job = makeJob({ streamInfo: tenBitStreamInfo } as Partial<Job>);
      const policy = makePolicy({ targetCodec: 'H264' } as Partial<Policy>);
      const hwaccel = makeHwaccel({
        type: 'AMD',
        flags: ['-hwaccel', 'vaapi', '-vaapi_device', '/dev/dri/renderD129'],
        videoCodec: 'h264_vaapi',
        videoFilter: 'format=nv12,hwupload',
      } as Partial<HardwareAccelConfig>);
      const args = service.buildFfmpegCommand(job, policy, hwaccel, '/out/out.mkv');
      expect(args[args.indexOf('-vf') + 1]).toBe('format=nv12,hwupload');
    });
  });

  // ── buildFfmpegCommand – MP4 output flags ───────────────────────────────

  describe('buildFfmpegCommand – MP4 faststart', () => {
    it('uses -movflags +faststart for ENCODE mp4 output (no frag flags)', () => {
      const job = makeJob({ targetContainer: 'mp4' } as Partial<Job>);
      const args = service.buildFfmpegCommand(job, makePolicy(), makeHwaccel(), '/out/out.mp4');
      expect(args[args.indexOf('-movflags') + 1]).toBe('+faststart');
      expect(args).not.toContain('+frag_keyframe+empty_moov+default_base_moof');
    });
  });

  // ── buildFfmpegCommand – timestamp resilience ───────────────────────────

  describe('buildFfmpegCommand – genpts', () => {
    it('adds -fflags +genpts before -i when health check flagged timestamp issues', () => {
      const job = makeJob({
        healthMessage: 'Timestamp issues detected (may cause playback glitches)',
      } as Partial<Job>);
      const args = service.buildFfmpegCommand(job, makePolicy(), makeHwaccel(), '/out/out.mkv');
      const fflagsIdx = args.indexOf('-fflags');
      expect(args[fflagsIdx + 1]).toBe('+genpts');
      expect(fflagsIdx).toBeGreaterThanOrEqual(0);
      expect(fflagsIdx).toBeLessThan(args.indexOf('-i'));
    });
  });
});
