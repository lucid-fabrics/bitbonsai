import type { AccelerationType } from '@prisma/client';
import { calculateOptimalWorkers, getRecommendationSummary } from '../../optimal-worker-calculator';

describe('calculateOptimalWorkers', () => {
  // ── GPU acceleration ──────────────────────────────────────────────────────

  describe('GPU acceleration (NVIDIA, INTEL_QSV, AMD, APPLE_M)', () => {
    const gpuTypes: AccelerationType[] = ['NVIDIA', 'INTEL_QSV', 'AMD', 'APPLE_M'];

    for (const acc of gpuTypes) {
      it(`${acc}: uses 2 CPU cores per job`, () => {
        const result = calculateOptimalWorkers(16, acc);
        expect(result.cpuCoresPerJob).toBe(2);
      });
    }

    it('NVIDIA: caps at 8 workers even with many cores', () => {
      const result = calculateOptimalWorkers(64, 'NVIDIA');
      expect(result.recommendedMaxWorkers).toBe(8);
    });

    it('NVIDIA: calculates workers from availableCores / 2', () => {
      // 8 cores → availableCores = 6 → floor(6/2) = 3
      const result = calculateOptimalWorkers(8, 'NVIDIA');
      expect(result.recommendedMaxWorkers).toBe(3);
    });

    it('APPLE_M: ensures at least 1 worker for minimal CPU count', () => {
      const result = calculateOptimalWorkers(2, 'APPLE_M');
      // availableCores = max(2-2,1) = 1, floor(1/2) = 0 → max(0,1) = 1
      expect(result.recommendedMaxWorkers).toBe(1);
    });

    it('GPU: estimatedLoadAverage = cpuCoresPerJob * recommendedMaxWorkers', () => {
      const result = calculateOptimalWorkers(16, 'NVIDIA');
      expect(result.estimatedLoadAverage).toBe(
        result.cpuCoresPerJob * result.recommendedMaxWorkers
      );
    });

    it('GPU: reasoning mentions GPU acceleration', () => {
      const result = calculateOptimalWorkers(16, 'NVIDIA');
      expect(result.reasoning).toContain('GPU');
    });
  });

  // ── CPU encoding: high-core (32+) ────────────────────────────────────────

  describe('CPU encoding: high-core systems (>=32)', () => {
    it('32 cores: uses 8 cores per job', () => {
      const result = calculateOptimalWorkers(32, 'CPU');
      expect(result.cpuCoresPerJob).toBe(8);
    });

    it('64 cores: uses 8 cores per job', () => {
      const result = calculateOptimalWorkers(64, 'CPU');
      expect(result.cpuCoresPerJob).toBe(8);
    });

    it('32 cores: floor((32-2)/8) = 3 workers', () => {
      const result = calculateOptimalWorkers(32, 'CPU');
      expect(result.recommendedMaxWorkers).toBe(3);
    });

    it('64 cores: floor((64-2)/8) = 7 workers', () => {
      const result = calculateOptimalWorkers(64, 'CPU');
      expect(result.recommendedMaxWorkers).toBe(7);
    });
  });

  // ── CPU encoding: mid-range (16-31) ──────────────────────────────────────

  describe('CPU encoding: mid-range systems (16–31)', () => {
    it('16 cores: uses 6 cores per job', () => {
      const result = calculateOptimalWorkers(16, 'CPU');
      expect(result.cpuCoresPerJob).toBe(6);
    });

    it('31 cores: uses 6 cores per job', () => {
      const result = calculateOptimalWorkers(31, 'CPU');
      expect(result.cpuCoresPerJob).toBe(6);
    });

    it('16 cores: floor((16-2)/6) = 2 workers', () => {
      const result = calculateOptimalWorkers(16, 'CPU');
      expect(result.recommendedMaxWorkers).toBe(2);
    });

    it('24 cores: floor((24-2)/6) = 3 workers', () => {
      const result = calculateOptimalWorkers(24, 'CPU');
      expect(result.recommendedMaxWorkers).toBe(3);
    });
  });

  // ── CPU encoding: low-end (8-15) ─────────────────────────────────────────

  describe('CPU encoding: low-end systems (8–15)', () => {
    it('8 cores: uses 4 cores per job', () => {
      const result = calculateOptimalWorkers(8, 'CPU');
      expect(result.cpuCoresPerJob).toBe(4);
    });

    it('15 cores: uses 4 cores per job', () => {
      const result = calculateOptimalWorkers(15, 'CPU');
      expect(result.cpuCoresPerJob).toBe(4);
    });

    it('8 cores: floor((8-2)/4) = 1 worker', () => {
      const result = calculateOptimalWorkers(8, 'CPU');
      expect(result.recommendedMaxWorkers).toBe(1);
    });

    it('12 cores: floor((12-2)/4) = 2 workers', () => {
      const result = calculateOptimalWorkers(12, 'CPU');
      expect(result.recommendedMaxWorkers).toBe(2);
    });
  });

  // ── CPU encoding: very low-end (<8) ──────────────────────────────────────

  describe('CPU encoding: very low-end systems (<8)', () => {
    it('4 cores: always 1 worker', () => {
      const result = calculateOptimalWorkers(4, 'CPU');
      expect(result.recommendedMaxWorkers).toBe(1);
    });

    it('2 cores: always 1 worker (min clamp)', () => {
      const result = calculateOptimalWorkers(2, 'CPU');
      expect(result.recommendedMaxWorkers).toBe(1);
    });

    it('1 core: always 1 worker', () => {
      const result = calculateOptimalWorkers(1, 'CPU');
      expect(result.recommendedMaxWorkers).toBe(1);
    });

    it('4 cores: cpuCoresPerJob = availableCores = max(4-2,1) = 2', () => {
      const result = calculateOptimalWorkers(4, 'CPU');
      expect(result.cpuCoresPerJob).toBe(2);
    });

    it('reasoning mentions limited CPU', () => {
      const result = calculateOptimalWorkers(4, 'CPU');
      expect(result.reasoning).toContain('Limited');
    });
  });

  // ── estimatedLoadAverage ─────────────────────────────────────────────────

  describe('estimatedLoadAverage', () => {
    it('equals cpuCoresPerJob * recommendedMaxWorkers', () => {
      const result = calculateOptimalWorkers(24, 'CPU');
      expect(result.estimatedLoadAverage).toBe(
        result.cpuCoresPerJob * result.recommendedMaxWorkers
      );
    });
  });

  // ── ramGb optional parameter ──────────────────────────────────────────────

  it('accepts optional ramGb without error', () => {
    expect(() => calculateOptimalWorkers(16, 'CPU', 32)).not.toThrow();
  });
});

// ── getRecommendationSummary ──────────────────────────────────────────────────

describe('getRecommendationSummary', () => {
  const config = {
    recommendedMaxWorkers: 3,
    reasoning: 'test',
    cpuCoresPerJob: 6,
    estimatedLoadAverage: 18,
  };

  it('returns optimal message when current equals recommended', () => {
    const summary = getRecommendationSummary(3, config);
    expect(summary).toContain('optimal');
    expect(summary).toContain('3');
  });

  it('returns reduce message when current > recommended', () => {
    const summary = getRecommendationSummary(5, config);
    expect(summary).toContain('reducing');
    expect(summary).toContain('5');
    expect(summary).toContain('3');
  });

  it('returns increase message when current < recommended', () => {
    const summary = getRecommendationSummary(1, config);
    expect(summary).toContain('increase');
    expect(summary).toContain('1');
    expect(summary).toContain('3');
  });
});
