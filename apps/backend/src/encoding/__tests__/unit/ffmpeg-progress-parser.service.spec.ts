import { Test, type TestingModule } from '@nestjs/testing';
import { FfmpegProgressParserService } from '../../ffmpeg-progress-parser.service';

describe('FfmpegProgressParserService', () => {
  let service: FfmpegProgressParserService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [FfmpegProgressParserService],
    }).compile();

    service = module.get(FfmpegProgressParserService);
  });

  // ─── parseProgress ────────────────────────────────────────────────────────

  describe('parseProgress', () => {
    it('parses a typical ffmpeg progress line', () => {
      const line =
        'frame= 2450 fps= 87 q=28.0 size=   12288kB time=00:01:42.50 bitrate=1234.5kbits/s speed=3.62x';

      const result = service.parseProgress(line);

      expect(result).toEqual({
        frame: 2450,
        fps: 87,
        currentTime: '00:01:42.50',
      });
    });

    it('parses a line with single-digit fps', () => {
      const line =
        'frame=  100 fps=  5 q=30.0 size=     512kB time=00:00:04.00 bitrate= 999.0kbits/s speed=0.5x';

      const result = service.parseProgress(line);

      expect(result).toEqual({
        frame: 100,
        fps: 5,
        currentTime: '00:00:04.00',
      });
    });

    it('parses a line with fractional fps', () => {
      const line =
        'frame=  300 fps= 23.97 q=25.0 size=   2048kB time=00:00:12.54 bitrate= 500.0kbits/s speed=1.00x';

      const result = service.parseProgress(line);

      expect(result!.fps).toBeCloseTo(23.97);
      expect(result!.frame).toBe(300);
    });

    it('returns null for a non-progress line', () => {
      const line = 'Input #0, matroska,webm, from /path/to/file.mkv:';
      expect(service.parseProgress(line)).toBeNull();
    });

    it('returns null for an empty string', () => {
      expect(service.parseProgress('')).toBeNull();
    });

    it('returns null for a line with frame but missing time', () => {
      const line = 'frame= 100 fps= 24 q=28.0 size= 1024kB bitrate=500kbits/s';
      expect(service.parseProgress(line)).toBeNull();
    });

    it('returns null for metadata/header lines', () => {
      const line = 'Stream #0:0: Video: h264, yuv420p, 1920x1080';
      expect(service.parseProgress(line)).toBeNull();
    });
  });

  // ─── calculateProgressPercentage ─────────────────────────────────────────

  describe('calculateProgressPercentage', () => {
    it('calculates correct percentage for midpoint', () => {
      const result = service.calculateProgressPercentage('00:01:00.00', 120);
      expect(result).toBe(50);
    });

    it('returns 100 when currentTime equals duration', () => {
      const result = service.calculateProgressPercentage('00:02:00.00', 120);
      expect(result).toBe(100);
    });

    it('clamps to 100 when currentTime exceeds duration', () => {
      const result = service.calculateProgressPercentage('00:03:00.00', 120);
      expect(result).toBe(100);
    });

    it('returns 0 for time 00:00:00.00', () => {
      const result = service.calculateProgressPercentage('00:00:00.00', 120);
      expect(result).toBe(0);
    });

    it('returns 0 for N/A time string', () => {
      expect(service.calculateProgressPercentage('N/A', 120)).toBe(0);
    });

    it('returns 0 for n/a (lowercase)', () => {
      expect(service.calculateProgressPercentage('n/a', 120)).toBe(0);
    });

    it('returns 0 for empty string', () => {
      expect(service.calculateProgressPercentage('', 120)).toBe(0);
    });

    it('handles hours correctly', () => {
      // 1h 30m = 5400s out of 7200s total = 75%
      const result = service.calculateProgressPercentage('01:30:00.00', 7200);
      expect(result).toBe(75);
    });

    it('handles fractional seconds', () => {
      // 30.5s out of 61s = ~50%
      const result = service.calculateProgressPercentage('00:00:30.50', 61);
      expect(result).toBeCloseTo(50, 0);
    });

    it('parses microseconds format when parts.length !== 3', () => {
      // 60_000_000 microseconds = 60 seconds, out of 120s = 50%
      const result = service.calculateProgressPercentage('60000000', 120);
      expect(result).toBe(50);
    });

    it('returns 0 for invalid non-HH:MM:SS string with non-numeric microseconds', () => {
      const result = service.calculateProgressPercentage('invalid', 120);
      expect(result).toBe(0);
    });

    it('returns 0 for zero microseconds', () => {
      const result = service.calculateProgressPercentage('0', 120);
      expect(result).toBe(0);
    });
  });

  // ─── parseTimestampToSeconds ──────────────────────────────────────────────

  describe('parseTimestampToSeconds', () => {
    it('converts HH:MM:SS.MS to seconds', () => {
      expect(service.parseTimestampToSeconds('01:30:00.00')).toBe(5400);
    });

    it('converts minutes and seconds correctly', () => {
      expect(service.parseTimestampToSeconds('00:02:30.00')).toBe(150);
    });

    it('handles fractional seconds', () => {
      expect(service.parseTimestampToSeconds('00:00:01.50')).toBeCloseTo(1.5);
    });

    it('returns 0 for timestamp without colons', () => {
      expect(service.parseTimestampToSeconds('invalid')).toBe(0);
    });

    it('returns 0 for empty string', () => {
      expect(service.parseTimestampToSeconds('')).toBe(0);
    });

    it('converts 00:00:00.00 to 0', () => {
      expect(service.parseTimestampToSeconds('00:00:00.00')).toBe(0);
    });

    it('handles large hour values', () => {
      expect(service.parseTimestampToSeconds('10:00:00.00')).toBe(36000);
    });
  });

  // ─── formatSecondsToTimestamp ─────────────────────────────────────────────

  describe('formatSecondsToTimestamp', () => {
    it('formats seconds to HH:MM:SS.ms', () => {
      expect(service.formatSecondsToTimestamp(3661)).toBe('01:01:01.00');
    });

    it('formats 0 seconds to 00:00:00.00', () => {
      expect(service.formatSecondsToTimestamp(0)).toBe('00:00:00.00');
    });

    it('pads single-digit hours, minutes, seconds', () => {
      expect(service.formatSecondsToTimestamp(3661)).toBe('01:01:01.00');
    });

    it('formats fractional seconds with milliseconds', () => {
      // 1.5 seconds → 00:00:01.50
      expect(service.formatSecondsToTimestamp(1.5)).toBe('00:00:01.50');
    });

    it('formats 90 seconds as 00:01:30.00', () => {
      expect(service.formatSecondsToTimestamp(90)).toBe('00:01:30.00');
    });

    it('handles large values (1 hour)', () => {
      expect(service.formatSecondsToTimestamp(3600)).toBe('01:00:00.00');
    });

    it('handles values > 24 hours', () => {
      // 25h = 90000s
      const result = service.formatSecondsToTimestamp(90000);
      expect(result).toBe('25:00:00.00');
    });
  });
});
