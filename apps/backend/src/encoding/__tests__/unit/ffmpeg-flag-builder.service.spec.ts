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
        { provide: HardwareAccelerationService, useValue: mockHardwareAccelerationService },
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
    it('uses stream copy flags for REMUX job', () => {
      const job = makeJob({ type: 'REMUX' } as Partial<Job>);
      const args = service.buildFfmpegCommand(job, makePolicy(), makeHwaccel(), '/out/movie.mp4');
      expect(args).toContain('-c:v');
      expect(args[args.indexOf('-c:v') + 1]).toBe('copy');
      expect(args).toContain('-c:a');
      expect(args[args.indexOf('-c:a') + 1]).toBe('copy');
      expect(args).toContain('-map');
      expect(args[args.indexOf('-map') + 1]).toBe('0');
    });

    it('does not add -ss for REMUX job', () => {
      const job = makeJob({ type: 'REMUX' } as Partial<Job>);
      const args = service.buildFfmpegCommand(
        job,
        makePolicy(),
        makeHwaccel(),
        '/out/movie.mp4',
        '00:01:00.000'
      );
      expect(args).not.toContain('-ss');
    });

    it('sets MKV format for REMUX with mkv container', () => {
      const job = makeJob({ type: 'REMUX', targetContainer: 'mkv' } as Partial<Job>);
      const args = service.buildFfmpegCommand(job, makePolicy(), makeHwaccel(), '/out/movie.mkv');
      expect(args).toContain('matroska');
    });

    it('sets MP4 format and movflags for REMUX with mp4 container', () => {
      const job = makeJob({ type: 'REMUX', targetContainer: 'mp4' } as Partial<Job>);
      const args = service.buildFfmpegCommand(job, makePolicy(), makeHwaccel(), '/out/movie.mp4');
      expect(args).toContain('mp4');
      expect(args).toContain('+frag_keyframe+empty_moov+default_base_moof');
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

    it('adds -ss before -i when resumeFromTimestamp provided', () => {
      const job = makeJob();
      const args = service.buildFfmpegCommand(
        job,
        makePolicy(),
        makeHwaccel(),
        '/out/out.mkv',
        '00:05:00.000'
      );
      const ssIdx = args.indexOf('-ss');
      const iIdx = args.indexOf('-i');
      expect(ssIdx).toBeGreaterThanOrEqual(0);
      expect(ssIdx).toBeLessThan(iIdx);
      expect(args[ssIdx + 1]).toBe('00:05:00.000');
    });

    it('does not add -ss when no resumeFromTimestamp', () => {
      const args = service.buildFfmpegCommand(
        makeJob(),
        makePolicy(),
        makeHwaccel(),
        '/out/out.mkv'
      );
      expect(args).not.toContain('-ss');
    });

    it('spreads hwaccel flags before -i', () => {
      const hwaccel = makeHwaccel({ flags: ['-hwaccel', 'cuda'], type: 'NVIDIA' });
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
        decisionData: JSON.stringify({ actionConfig: { audioCodec: 'aac', audioBitrate: '192k' } }),
      });
      const args = service.buildFfmpegCommand(job, makePolicy(), makeHwaccel(), '/out/out.mkv');
      expect(args).toContain('-b:a');
      expect(args[args.indexOf('-b:a') + 1]).toBe('192k');
    });

    it('uses audio codec from policy advancedSettings when decision does not override', () => {
      const policy = makePolicy({ advancedSettings: { audioCodec: 'eac3' } } as Partial<Policy>);
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
        decisionData: JSON.stringify({ actionConfig: { ffmpegFlags: ['-tune', 'film'] } }),
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
});
