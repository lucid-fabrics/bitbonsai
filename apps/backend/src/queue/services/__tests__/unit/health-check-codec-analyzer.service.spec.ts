import { Test, type TestingModule } from '@nestjs/testing';
import { FileHealthStatus } from '@prisma/client';
import { FfmpegService } from '../../../../encoding/ffmpeg.service';
import {
  HealthCheckIssueCategory,
  HealthCheckIssueSeverity,
} from '../../../models/health-check-issue.model';
import { HealthCheckCodecAnalyzerService } from '../../health-check-codec-analyzer.service';

describe('HealthCheckCodecAnalyzerService', () => {
  let service: HealthCheckCodecAnalyzerService;
  let ffmpegService: { normalizeCodec: jest.Mock };

  beforeEach(async () => {
    ffmpegService = {
      normalizeCodec: jest.fn((c: string) => c.toLowerCase()),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HealthCheckCodecAnalyzerService,
        { provide: FfmpegService, useValue: ffmpegService },
      ],
    }).compile();

    service = module.get<HealthCheckCodecAnalyzerService>(HealthCheckCodecAnalyzerService);
  });

  describe('checkCodecMatch', () => {
    it('returns null when codecs differ', () => {
      const result = service.checkCodecMatch('h264', 'hevc');

      expect(result).toBeNull();
    });

    it('returns null when codecs differ after normalization', () => {
      const result = service.checkCodecMatch('H264', 'HEVC');

      expect(result).toBeNull();
    });

    it('returns a BLOCKER issue when codecs match', () => {
      const result = service.checkCodecMatch('hevc', 'hevc');

      expect(result).not.toBeNull();
      expect(result!.severity).toBe(HealthCheckIssueSeverity.BLOCKER);
      expect(result!.category).toBe(HealthCheckIssueCategory.CODEC);
    });

    it('returns correct code when codecs match', () => {
      const result = service.checkCodecMatch('hevc', 'hevc');

      expect(result!.code).toBe('CODEC_ALREADY_MATCHES_TARGET');
    });

    it('includes codec display name in message when codecs match', () => {
      const result = service.checkCodecMatch('hevc', 'hevc');

      expect(result!.message).toBe('This file is already encoded in HEVC (H.265) format');
    });

    it('normalizes mixed-case codecs before comparison', () => {
      const result = service.checkCodecMatch('HEVC', 'hevc');

      expect(result).not.toBeNull();
      expect(result!.code).toBe('CODEC_ALREADY_MATCHES_TARGET');
    });

    it('sets codecMatch metadata to true', () => {
      const result = service.checkCodecMatch('h264', 'h264');

      expect(result!.metadata!.codecMatch).toBe(true);
      expect(result!.metadata!.sourceCodec).toBe('h264');
      expect(result!.metadata!.targetCodec).toBe('h264');
    });

    it('includes three suggested actions', () => {
      const result = service.checkCodecMatch('hevc', 'hevc');

      expect(result!.suggestedActions).toHaveLength(3);
    });

    it('marks skip_encoding as the recommended action', () => {
      const result = service.checkCodecMatch('hevc', 'hevc');
      const recommended = result!.suggestedActions.filter((a) => a.recommended);

      expect(recommended).toHaveLength(1);
      expect(recommended[0].id).toBe('skip_encoding');
    });

    it('includes force_reencode and cancel_job as non-recommended actions', () => {
      const result = service.checkCodecMatch('hevc', 'hevc');
      const ids = result!.suggestedActions.map((a) => a.id);

      expect(ids).toContain('force_reencode');
      expect(ids).toContain('cancel_job');
    });
  });

  describe('getCodecDisplayName', () => {
    it('returns HEVC display name', () => {
      expect(service.getCodecDisplayName('hevc')).toBe('HEVC (H.265)');
    });

    it('returns H.264 display name', () => {
      expect(service.getCodecDisplayName('h264')).toBe('H.264 (AVC)');
    });

    it('returns AV1 display name', () => {
      expect(service.getCodecDisplayName('av1')).toBe('AV1');
    });

    it('returns VP9 display name', () => {
      expect(service.getCodecDisplayName('vp9')).toBe('VP9');
    });

    it('falls back to uppercase for unknown codec', () => {
      expect(service.getCodecDisplayName('xvid')).toBe('XVID');
    });

    it('handles uppercase input for known codecs', () => {
      expect(service.getCodecDisplayName('HEVC')).toBe('HEVC (H.265)');
    });
  });

  describe('calculateExpectedSavingsPercent', () => {
    it('returns 5 for same codec', () => {
      const result = service.calculateExpectedSavingsPercent('hevc', 'hevc', BigInt(1_000_000));

      expect(result).toBe(5);
    });

    it('returns 35 for h264 → hevc', () => {
      const result = service.calculateExpectedSavingsPercent('h264', 'hevc', BigInt(1_000_000));

      expect(result).toBe(35);
    });

    it('returns 50 for h264 → av1', () => {
      const result = service.calculateExpectedSavingsPercent('h264', 'av1', BigInt(1_000_000));

      expect(result).toBe(50);
    });

    it('returns 30 for h264 → vp9', () => {
      const result = service.calculateExpectedSavingsPercent('h264', 'vp9', BigInt(1_000_000));

      expect(result).toBe(30);
    });

    it('returns 25 for hevc → av1', () => {
      const result = service.calculateExpectedSavingsPercent('hevc', 'av1', BigInt(1_000_000));

      expect(result).toBe(25);
    });

    it('returns -30 for hevc → h264 (negative savings)', () => {
      const result = service.calculateExpectedSavingsPercent('hevc', 'h264', BigInt(1_000_000));

      expect(result).toBe(-30);
    });

    it('returns -10 for av1 → hevc (negative savings)', () => {
      const result = service.calculateExpectedSavingsPercent('av1', 'hevc', BigInt(1_000_000));

      expect(result).toBe(-10);
    });

    it('returns 0 for unknown codec pair', () => {
      const result = service.calculateExpectedSavingsPercent('xvid', 'mpeg2', BigInt(1_000_000));

      expect(result).toBe(0);
    });

    it('normalizes codec case before lookup', () => {
      const result = service.calculateExpectedSavingsPercent('H264', 'HEVC', BigInt(1_000_000));

      expect(result).toBe(35);
    });
  });

  describe('checkCodecMatchWithThreshold', () => {
    it('always returns a BLOCKER issue', () => {
      const result = service.checkCodecMatchWithThreshold('h264', 'hevc', 10, 30);

      expect(result).not.toBeNull();
      expect(result!.severity).toBe(HealthCheckIssueSeverity.BLOCKER);
    });

    it('returns correct code', () => {
      const result = service.checkCodecMatchWithThreshold('h264', 'hevc', 10, 30);

      expect(result!.code).toBe('SAVINGS_BELOW_THRESHOLD');
    });

    it('includes expected savings and threshold in message', () => {
      const result = service.checkCodecMatchWithThreshold('h264', 'hevc', 10, 30);

      expect(result!.message).toBe('Expected savings (10%) is below the policy threshold (30%)');
    });

    it('sets correct metadata', () => {
      const result = service.checkCodecMatchWithThreshold('h264', 'hevc', 10, 30);

      expect(result!.metadata!.sourceCodec).toBe('h264');
      expect(result!.metadata!.targetCodec).toBe('hevc');
      expect(result!.metadata!.expectedSavings).toBe(10);
      expect(result!.metadata!.minSavingsThreshold).toBe(30);
    });

    it('marks skip_encoding as recommended', () => {
      const result = service.checkCodecMatchWithThreshold('h264', 'hevc', 10, 30);
      const recommended = result!.suggestedActions.filter((a) => a.recommended);

      expect(recommended).toHaveLength(1);
      expect(recommended[0].id).toBe('skip_encoding');
    });

    it('includes savings percentage in skip action description', () => {
      const result = service.checkCodecMatchWithThreshold('h264', 'hevc', 10, 30);
      const skipAction = result!.suggestedActions.find((a) => a.id === 'skip_encoding')!;

      expect(skipAction.description).toContain('10%');
      expect(skipAction.description).toContain('30%');
    });

    it('has category CODEC', () => {
      const result = service.checkCodecMatchWithThreshold('h264', 'hevc', 5, 20);

      expect(result!.category).toBe(HealthCheckIssueCategory.CODEC);
    });

    it('normalizes codec case before storing in metadata', () => {
      const result = service.checkCodecMatchWithThreshold('H264', 'HEVC', 10, 30);

      expect(result!.metadata!.sourceCodec).toBe('h264');
      expect(result!.metadata!.targetCodec).toBe('hevc');
    });
  });

  describe('buildHealthMessage', () => {
    it('formats HEALTHY status with score', () => {
      const result = service.buildHealthMessage({
        status: FileHealthStatus.HEALTHY,
        score: 100,
        issues: [],
        warnings: [],
      });

      expect(result).toBe('✅ Score: 100/100');
    });

    it('formats CORRUPTED status with score', () => {
      const result = service.buildHealthMessage({
        status: FileHealthStatus.CORRUPTED,
        score: 0,
        issues: [],
        warnings: [],
      });

      expect(result).toBe('❌ Score: 0/100');
    });

    it('formats WARNING status with score', () => {
      const result = service.buildHealthMessage({
        status: FileHealthStatus.WARNING,
        score: 75,
        issues: [],
        warnings: [],
      });

      expect(result).toBe('⚠️ Score: 75/100');
    });

    it('formats AT_RISK status with score', () => {
      const result = service.buildHealthMessage({
        status: FileHealthStatus.AT_RISK,
        score: 50,
        issues: [],
        warnings: [],
      });

      expect(result).toBe('⚠️ Score: 50/100');
    });

    it('formats UNKNOWN status with score', () => {
      const result = service.buildHealthMessage({
        status: FileHealthStatus.UNKNOWN,
        score: 0,
        issues: [],
        warnings: [],
      });

      expect(result).toBe('❓ Score: 0/100');
    });

    it('appends issues when present', () => {
      const result = service.buildHealthMessage({
        status: FileHealthStatus.CORRUPTED,
        score: 10,
        issues: ['Corrupt frame at 00:01:23', 'Missing keyframe'],
        warnings: [],
      });

      expect(result).toBe('❌ Score: 10/100 | Issues: Corrupt frame at 00:01:23; Missing keyframe');
    });

    it('appends warnings when present', () => {
      const result = service.buildHealthMessage({
        status: FileHealthStatus.WARNING,
        score: 80,
        issues: [],
        warnings: ['Low bitrate', 'High noise'],
      });

      expect(result).toBe('⚠️ Score: 80/100 | Warnings: Low bitrate; High noise');
    });

    it('appends both issues and warnings when both present', () => {
      const result = service.buildHealthMessage({
        status: FileHealthStatus.AT_RISK,
        score: 55,
        issues: ['Corrupt header'],
        warnings: ['Low bitrate'],
      });

      expect(result).toBe('⚠️ Score: 55/100 | Issues: Corrupt header | Warnings: Low bitrate');
    });

    it('joins multiple issues with semicolon', () => {
      const result = service.buildHealthMessage({
        status: FileHealthStatus.CORRUPTED,
        score: 20,
        issues: ['Issue A', 'Issue B', 'Issue C'],
        warnings: [],
      });

      expect(result).toContain('Issue A; Issue B; Issue C');
    });
  });
});
