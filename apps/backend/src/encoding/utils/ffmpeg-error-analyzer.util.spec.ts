import type { FFmpegErrorAnalysis } from './ffmpeg-error-analyzer.util';
import {
  analyzeFfmpegError,
  ErrorCategory,
  formatErrorForDisplay,
} from './ffmpeg-error-analyzer.util';

describe('analyzeFfmpegError', () => {
  // ── PATTERN 1: SOURCE_CORRUPTED ──────────────────────────────────────────

  describe('SOURCE_CORRUPTED via corruption patterns', () => {
    const corruptionPatterns = [
      'could not find ref with poc',
      'error submitting packet to decoder',
      'invalid data found',
      'corrupt decoded frame',
      'error while decoding',
      'missing reference picture',
      'illegal short term buffer',
      'moov atom not found',
      'invalid nal unit size',
    ];

    for (const pattern of corruptionPatterns) {
      it(`detects corruption via "${pattern}"`, () => {
        const result = analyzeFfmpegError(255, pattern, 1, 0);
        expect(result.category).toBe(ErrorCategory.SOURCE_CORRUPTED);
        expect(result.isRetriable).toBe(false);
      });
    }

    it('is case-insensitive for corruption patterns', () => {
      const result = analyzeFfmpegError(255, 'INVALID DATA FOUND in stream', 0, 0);
      expect(result.category).toBe(ErrorCategory.SOURCE_CORRUPTED);
    });

    it('uses exit code -1 for corruption detection', () => {
      const result = analyzeFfmpegError(-1, 'moov atom not found', 2, 0);
      expect(result.category).toBe(ErrorCategory.SOURCE_CORRUPTED);
    });

    it('uses exit code 1 for corruption detection', () => {
      const result = analyzeFfmpegError(1, 'error while decoding', 4, 0);
      expect(result.category).toBe(ErrorCategory.SOURCE_CORRUPTED);
    });

    it('does NOT flag corruption when progress >= 5', () => {
      const result = analyzeFfmpegError(255, 'invalid data found', 5, 0);
      expect(result.category).not.toBe(ErrorCategory.SOURCE_CORRUPTED);
    });

    it('shouldBlacklist is false when retryCount < 3', () => {
      const result = analyzeFfmpegError(255, 'invalid data found', 1, 2);
      expect(result.shouldBlacklist).toBe(false);
    });

    it('shouldBlacklist is true when retryCount >= 3', () => {
      const result = analyzeFfmpegError(255, 'invalid data found', 1, 3);
      expect(result.shouldBlacklist).toBe(true);
    });
  });

  // ── PATTERN 2: SOURCE_MISSING ────────────────────────────────────────────

  describe('SOURCE_MISSING', () => {
    it('detects "no such file"', () => {
      const result = analyzeFfmpegError(1, 'no such file or directory', 0, 0);
      expect(result.category).toBe(ErrorCategory.SOURCE_MISSING);
      expect(result.shouldBlacklist).toBe(true);
      expect(result.isRetriable).toBe(false);
    });

    it('detects "file not found"', () => {
      const result = analyzeFfmpegError(1, 'file not found', 0, 0);
      expect(result.category).toBe(ErrorCategory.SOURCE_MISSING);
    });
  });

  // ── PATTERN 3: INSUFFICIENT_RESOURCES ───────────────────────────────────

  describe('INSUFFICIENT_RESOURCES', () => {
    it('detects "no space left"', () => {
      const result = analyzeFfmpegError(1, 'no space left on device', 50, 0);
      expect(result.category).toBe(ErrorCategory.INSUFFICIENT_RESOURCES);
      expect(result.isRetriable).toBe(true);
      expect(result.shouldBlacklist).toBe(false);
    });

    it('detects "cannot allocate memory"', () => {
      const result = analyzeFfmpegError(1, 'cannot allocate memory', 10, 0);
      expect(result.category).toBe(ErrorCategory.INSUFFICIENT_RESOURCES);
    });

    it('detects "out of memory"', () => {
      const result = analyzeFfmpegError(1, 'out of memory', 20, 0);
      expect(result.category).toBe(ErrorCategory.INSUFFICIENT_RESOURCES);
    });
  });

  // ── PATTERN 4: PROCESS_INTERRUPTED ──────────────────────────────────────

  describe('PROCESS_INTERRUPTED', () => {
    it('detects exit 255 with low progress and retryCount < 2', () => {
      const result = analyzeFfmpegError(255, 'unknown error', 2, 1);
      expect(result.category).toBe(ErrorCategory.PROCESS_INTERRUPTED);
      expect(result.isRetriable).toBe(true);
    });

    it('detects exit -1 with low progress and retryCount < 2', () => {
      const result = analyzeFfmpegError(-1, 'signal killed', 0, 0);
      expect(result.category).toBe(ErrorCategory.PROCESS_INTERRUPTED);
    });

    it('includes progress in technicalDetails', () => {
      const result = analyzeFfmpegError(255, 'error', 3, 1);
      expect(result.technicalDetails).toContain('3.00%');
    });
  });

  // ── PATTERN 5: PERSISTENT EARLY FAILURE ─────────────────────────────────

  describe('SOURCE_CORRUPTED persistent early failure', () => {
    it('flags persistent failure at exit 255, progress < 5, retryCount >= 2', () => {
      const result = analyzeFfmpegError(255, 'some error', 2, 2);
      expect(result.category).toBe(ErrorCategory.SOURCE_CORRUPTED);
      expect(result.shouldBlacklist).toBe(true);
      expect(result.isRetriable).toBe(false);
    });

    it('flags persistent failure at exit -1, retryCount >= 2', () => {
      const result = analyzeFfmpegError(-1, 'error', 4, 5);
      expect(result.category).toBe(ErrorCategory.SOURCE_CORRUPTED);
    });

    it('includes retry count and exit code in technicalDetails', () => {
      const result = analyzeFfmpegError(255, 'error', 1, 3);
      expect(result.technicalDetails).toContain('3 retries');
      expect(result.technicalDetails).toContain('255');
    });
  });

  // ── PATTERN 6: CODEC_INCOMPATIBILITY ────────────────────────────────────

  describe('CODEC_INCOMPATIBILITY', () => {
    it('detects "encoder X not found"', () => {
      const result = analyzeFfmpegError(1, "encoder 'libx265' not found", 50, 0);
      expect(result.category).toBe(ErrorCategory.CODEC_INCOMPATIBILITY);
      expect(result.isRetriable).toBe(false);
      expect(result.shouldBlacklist).toBe(false);
    });

    it('detects "unknown encoder"', () => {
      const result = analyzeFfmpegError(1, 'unknown encoder: libsvtav1', 50, 0);
      expect(result.category).toBe(ErrorCategory.CODEC_INCOMPATIBILITY);
    });

    it('detects "codec not supported"', () => {
      const result = analyzeFfmpegError(1, 'codec not supported', 50, 0);
      expect(result.category).toBe(ErrorCategory.CODEC_INCOMPATIBILITY);
    });

    it('includes encoder name in technicalDetails when matched', () => {
      const result = analyzeFfmpegError(1, "encoder 'libx265' not found", 50, 0);
      expect(result.technicalDetails).toContain('libx265');
    });
  });

  // ── PATTERN 7: UNKNOWN ───────────────────────────────────────────────────

  describe('UNKNOWN fallback', () => {
    it('returns UNKNOWN for unrecognized errors', () => {
      const result = analyzeFfmpegError(1, 'something went terribly wrong', 50, 0);
      expect(result.category).toBe(ErrorCategory.UNKNOWN);
    });

    it('isRetriable true when retryCount < 3', () => {
      const result = analyzeFfmpegError(1, 'random error', 50, 2);
      expect(result.isRetriable).toBe(true);
    });

    it('isRetriable false when retryCount >= 3', () => {
      const result = analyzeFfmpegError(1, 'random error', 50, 3);
      expect(result.isRetriable).toBe(false);
    });

    it('extracts error lines into technicalDetails', () => {
      const stderr = 'line1\nERROR: something failed\nline3';
      const result = analyzeFfmpegError(1, stderr, 50, 0);
      expect(result.technicalDetails).toContain('ERROR: something failed');
    });

    it('falls back to last lines when no error lines found', () => {
      const stderr = 'line1\nline2\nline3';
      const result = analyzeFfmpegError(1, stderr, 50, 0);
      expect(result.technicalDetails).toMatch(/line\d*/);
    });
  });
});

describe('extractCorruptionDetails branches', () => {
  // Each branch of extractCorruptionDetails is exercised by triggering SOURCE_CORRUPTED
  // with a specific corruption pattern and checking technicalDetails.

  it('returns HEVC reference frame message for "could not find ref with poc"', () => {
    const result = analyzeFfmpegError(255, 'could not find ref with poc', 1, 0);
    expect(result.technicalDetails).toContain('HEVC Reference Frame Error');
  });

  it('returns invalid stream message for "invalid data found"', () => {
    const result = analyzeFfmpegError(255, 'invalid data found', 1, 0);
    expect(result.technicalDetails).toContain('Invalid Stream Data');
  });

  it('returns decoder error message for "error while decoding"', () => {
    const result = analyzeFfmpegError(255, 'error while decoding', 1, 0);
    expect(result.technicalDetails).toContain('Decoder Error');
  });

  it('returns MP4 container corruption message for "moov atom not found"', () => {
    const result = analyzeFfmpegError(255, 'moov atom not found', 1, 0);
    expect(result.technicalDetails).toContain('MP4 Container Corruption');
  });

  it('returns generic fallback for "error submitting packet to decoder"', () => {
    const result = analyzeFfmpegError(255, 'error submitting packet to decoder', 1, 0);
    expect(result.technicalDetails).toContain('corrupted data');
  });

  it('returns generic fallback for "corrupt decoded frame"', () => {
    const result = analyzeFfmpegError(255, 'corrupt decoded frame', 1, 0);
    expect(result.technicalDetails).toContain('corrupted data');
  });

  it('returns generic fallback for "missing reference picture"', () => {
    const result = analyzeFfmpegError(255, 'missing reference picture', 1, 0);
    expect(result.technicalDetails).toContain('corrupted data');
  });

  it('returns generic fallback for "illegal short term buffer"', () => {
    const result = analyzeFfmpegError(255, 'illegal short term buffer', 1, 0);
    expect(result.technicalDetails).toContain('corrupted data');
  });

  it('returns generic fallback for "invalid nal unit size"', () => {
    const result = analyzeFfmpegError(255, 'invalid nal unit size', 1, 0);
    expect(result.technicalDetails).toContain('corrupted data');
  });
});

describe('extractResourceError branches', () => {
  it('returns disk full message for "no space left"', () => {
    const result = analyzeFfmpegError(1, 'no space left on device', 50, 0);
    expect(result.technicalDetails).toContain('Disk full');
  });

  it('returns memory message for "cannot allocate memory"', () => {
    const result = analyzeFfmpegError(1, 'cannot allocate memory', 50, 0);
    expect(result.technicalDetails).toContain('Memory exhausted');
  });

  it('returns memory message for "out of memory"', () => {
    const result = analyzeFfmpegError(1, 'out of memory', 50, 0);
    expect(result.technicalDetails).toContain('Memory exhausted');
  });
});

describe('extractCodecError branches', () => {
  it('returns encoder name in message when matched by regex', () => {
    const result = analyzeFfmpegError(1, "encoder 'libsvtav1' not found", 50, 0);
    expect(result.technicalDetails).toContain('libsvtav1');
    expect(result.technicalDetails).toContain('not available');
  });

  it('returns fallback message when no encoder name regex match', () => {
    const result = analyzeFfmpegError(1, 'unknown encoder: libsvtav1', 50, 0);
    expect(result.technicalDetails).toContain('not supported');
  });

  it('returns fallback for "codec not supported"', () => {
    const result = analyzeFfmpegError(1, 'codec not supported', 50, 0);
    expect(result.technicalDetails).toContain('not supported');
  });
});

describe('formatErrorForDisplay', () => {
  it('includes title and description', () => {
    const analysis: FFmpegErrorAnalysis = {
      category: ErrorCategory.UNKNOWN,
      title: 'Test Title',
      description: 'Test description',
      recommendations: ['Do this', 'Do that'],
      isRetriable: true,
      shouldBlacklist: false,
    };
    const output = formatErrorForDisplay(analysis);
    expect(output).toContain('Test Title');
    expect(output).toContain('Test description');
  });

  it('includes technicalDetails when present', () => {
    const analysis: FFmpegErrorAnalysis = {
      category: ErrorCategory.UNKNOWN,
      title: 'Title',
      description: 'Desc',
      technicalDetails: 'Some technical info',
      recommendations: ['Rec1'],
      isRetriable: false,
      shouldBlacklist: false,
    };
    const output = formatErrorForDisplay(analysis);
    expect(output).toContain('Technical Details');
    expect(output).toContain('Some technical info');
  });

  it('omits Technical Details section when technicalDetails is absent', () => {
    const analysis: FFmpegErrorAnalysis = {
      category: ErrorCategory.UNKNOWN,
      title: 'Title',
      description: 'Desc',
      recommendations: ['Rec1'],
      isRetriable: false,
      shouldBlacklist: false,
    };
    const output = formatErrorForDisplay(analysis);
    expect(output).not.toContain('Technical Details');
  });

  it('includes all recommendations', () => {
    const analysis: FFmpegErrorAnalysis = {
      category: ErrorCategory.UNKNOWN,
      title: 'Title',
      description: 'Desc',
      recommendations: ['Step A', 'Step B', 'Step C'],
      isRetriable: false,
      shouldBlacklist: false,
    };
    const output = formatErrorForDisplay(analysis);
    expect(output).toContain('Step A');
    expect(output).toContain('Step B');
    expect(output).toContain('Step C');
  });
});
