import {
  CompressionRatios,
  estimateEncodingTime,
  estimateOutputSize,
  estimateSavingsPercent,
  formatSize,
  getCompressionRatio,
} from './encoding-estimation.util';

describe('EncodingEstimationUtil', () => {
  describe('getCompressionRatio', () => {
    it('should return 0.45 for H.264 to HEVC', () => {
      expect(getCompressionRatio('H.264', 'HEVC')).toBe(CompressionRatios.H264_TO_HEVC);
    });

    it('should return 0.40 for H.264 to AV1', () => {
      expect(getCompressionRatio('h264', 'av1')).toBe(CompressionRatios.H264_TO_AV1);
    });

    it('should return 0.85 for HEVC to HEVC re-encode', () => {
      expect(getCompressionRatio('HEVC', 'HEVC')).toBe(CompressionRatios.HEVC_TO_HEVC);
    });

    it('should return 0.75 for HEVC to AV1', () => {
      expect(getCompressionRatio('hevc', 'av1')).toBe(CompressionRatios.HEVC_TO_AV1);
    });

    it('should return high ratio for same codec', () => {
      expect(getCompressionRatio('H.264', 'H.264')).toBe(CompressionRatios.SAME_CODEC);
    });

    it('should handle case-insensitive input', () => {
      expect(getCompressionRatio('AVC', 'HEVC')).toBe(CompressionRatios.H264_TO_HEVC);
    });
  });

  describe('estimateOutputSize', () => {
    it('should estimate 45% of source for H.264 to HEVC', () => {
      const source = BigInt(10000000000); // 10 GB
      const estimated = estimateOutputSize(source, 'H.264', 'HEVC');
      expect(Number(estimated)).toBeGreaterThan(4000000000);
      expect(Number(estimated)).toBeLessThan(5000000000);
    });

    it('should handle number input', () => {
      const estimated = estimateOutputSize(10000000000, 'H.264', 'HEVC');
      expect(typeof estimated).toBe('bigint');
    });

    it('should respect CRF adjustment for higher quality', () => {
      const source = BigInt(10000000000);
      const estimated = estimateOutputSize(source, 'H.264', 'HEVC', '18');
      // Higher quality = larger file = higher output
      expect(Number(estimated)).toBeGreaterThan(
        Number(estimateOutputSize(source, 'H.264', 'HEVC', '28'))
      );
    });
  });

  describe('estimateSavingsPercent', () => {
    it('should calculate accurate savings percentage', () => {
      const source = BigInt(10000000000);
      const estimated = BigInt(4500000000);
      const savings = estimateSavingsPercent(source, estimated);
      expect(savings).toBe(55);
    });

    it('should handle number input', () => {
      const savings = estimateSavingsPercent(10000000000, 5000000000);
      expect(savings).toBe(50);
    });
  });

  describe('formatSize', () => {
    it('should format bytes correctly', () => {
      expect(formatSize(500)).toBe('500 B');
      expect(formatSize(1024)).toBe('1 KB');
      expect(formatSize(1048576)).toBe('1 MB');
      expect(formatSize(1073741824)).toBe('1 GB');
    });

    it('should handle bigint', () => {
      expect(formatSize(BigInt(1073741824))).toBe('1 GB');
    });

    it('should show decimal for MB precision', () => {
      expect(formatSize(1572864)).toBe('1.5 MB');
    });
  });

  describe('estimateEncodingTime', () => {
    it('should estimate base time for 1080p H.264', () => {
      const time = estimateEncodingTime(600, '1920x1080', 'H.264'); // 10 min video
      expect(time).toBeGreaterThan(5);
      expect(time).toBeLessThan(20);
    });

    it('should scale for 4K content', () => {
      const hdTime = estimateEncodingTime(600, '1920x1080', 'H.264');
      const fourKTime = estimateEncodingTime(600, '3840x2160', 'H.264');
      expect(fourKTime).toBeGreaterThan(hdTime);
    });

    it('should account for codec complexity', () => {
      const h264Time = estimateEncodingTime(600, '1920x1080', 'H.264');
      const hevcTime = estimateEncodingTime(600, '1920x1080', 'HEVC');
      const av1Time = estimateEncodingTime(600, '1920x1080', 'AV1');
      expect(hevcTime).toBeGreaterThan(h264Time);
      expect(av1Time).toBeGreaterThan(hevcTime);
    });
  });
});
