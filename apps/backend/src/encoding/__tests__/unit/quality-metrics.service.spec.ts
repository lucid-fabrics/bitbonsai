import { EventEmitter } from 'node:events';
import { Test, type TestingModule } from '@nestjs/testing';
import { QualityMetricsService } from '../../quality-metrics.service';

// Mock the entire child_process module at the module level so spawn is writable
jest.mock('node:child_process', () => ({
  spawn: jest.fn(),
}));

// Import after mock so we get the mocked version
// eslint-disable-next-line @typescript-eslint/no-require-imports
const childProcess = require('node:child_process') as { spawn: jest.Mock };

// ---------------------------------------------------------------------------
// Fake spawn factory
// ---------------------------------------------------------------------------

interface FakeProcess extends EventEmitter {
  stderr: EventEmitter;
  stdout: EventEmitter;
}

function makeFakeProcess(stderrOutput: string, exitCode: number | null = 0): FakeProcess {
  const proc = new EventEmitter() as FakeProcess;
  proc.stderr = new EventEmitter();
  proc.stdout = new EventEmitter();

  setImmediate(() => {
    proc.stderr.emit('data', Buffer.from(stderrOutput));
    proc.emit('close', exitCode);
  });

  return proc;
}

function makeErrorProcess(): FakeProcess {
  const proc = new EventEmitter() as FakeProcess;
  proc.stderr = new EventEmitter();
  proc.stdout = new EventEmitter();
  setImmediate(() => proc.emit('error', new Error('ENOENT')));
  return proc;
}

describe('QualityMetricsService (unit)', () => {
  let service: QualityMetricsService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [QualityMetricsService],
    }).compile();

    service = module.get(QualityMetricsService);

    // Default: no useful output, exits 0
    childProcess.spawn.mockReturnValue(makeFakeProcess('', 0));
  });

  // ── calculateVmaf ─────────────────────────────────────────────────────────

  describe('calculateVmaf', () => {
    it('returns parsed VMAF score from primary "VMAF score:" pattern', async () => {
      childProcess.spawn.mockReturnValue(makeFakeProcess('VMAF score: 92.35\nsome other line', 0));
      const result = await service.calculateVmaf('/orig.mkv', '/enc.mkv');
      expect(result).toBeCloseTo(92.35);
    });

    it('returns parsed score from alternative "score:" pattern', async () => {
      childProcess.spawn.mockReturnValue(makeFakeProcess('score: 75.10', 0));
      const result = await service.calculateVmaf('/orig.mkv', '/enc.mkv');
      expect(result).toBeCloseTo(75.1);
    });

    it('returns null when stderr has no recognisable score', async () => {
      childProcess.spawn.mockReturnValue(makeFakeProcess('no score here', 0));
      const result = await service.calculateVmaf('/orig.mkv', '/enc.mkv');
      expect(result).toBeNull();
    });

    it('falls back to calculateVmafSimple on non-zero exit code then returns score', async () => {
      childProcess.spawn
        .mockReturnValueOnce(makeFakeProcess('model not found', 1))
        .mockReturnValueOnce(makeFakeProcess('VMAF score: 88.00', 0));

      const result = await service.calculateVmaf('/orig.mkv', '/enc.mkv');
      expect(result).toBeCloseTo(88.0);
    });

    it('returns null when fallback also finds no score', async () => {
      childProcess.spawn
        .mockReturnValueOnce(makeFakeProcess('error', 1))
        .mockReturnValueOnce(makeFakeProcess('nothing', 0));

      const result = await service.calculateVmaf('/orig.mkv', '/enc.mkv');
      expect(result).toBeNull();
    });

    it('returns null when ffmpeg spawn emits error event', async () => {
      childProcess.spawn.mockReturnValue(makeErrorProcess());
      const result = await service.calculateVmaf('/orig.mkv', '/enc.mkv');
      expect(result).toBeNull();
    });
  });

  // ── calculatePsnr ─────────────────────────────────────────────────────────

  describe('calculatePsnr', () => {
    it('returns parsed PSNR score', async () => {
      childProcess.spawn.mockReturnValue(makeFakeProcess('psnr_avg:38.54 other data', 0));
      const result = await service.calculatePsnr('/orig.mkv', '/enc.mkv');
      expect(result).toBeCloseTo(38.54);
    });

    it('returns null when psnr_avg not present', async () => {
      childProcess.spawn.mockReturnValue(makeFakeProcess('no psnr info', 0));
      const result = await service.calculatePsnr('/orig.mkv', '/enc.mkv');
      expect(result).toBeNull();
    });

    it('returns null on spawn error', async () => {
      childProcess.spawn.mockReturnValue(makeErrorProcess());
      const result = await service.calculatePsnr('/orig.mkv', '/enc.mkv');
      expect(result).toBeNull();
    });

    it('spawns ffmpeg with psnr lavfi filter', async () => {
      childProcess.spawn.mockReturnValue(makeFakeProcess('psnr_avg:40.00', 0));
      await service.calculatePsnr('/orig.mkv', '/enc.mkv');
      const spawnArgs: string[] = childProcess.spawn.mock.calls[0][1];
      expect(spawnArgs).toContain('psnr');
    });
  });

  // ── calculateSsim ─────────────────────────────────────────────────────────

  describe('calculateSsim', () => {
    it('returns parsed SSIM score', async () => {
      childProcess.spawn.mockReturnValue(makeFakeProcess('ssim_avg:0.9876 other', 0));
      const result = await service.calculateSsim('/orig.mkv', '/enc.mkv');
      expect(result).toBeCloseTo(0.9876);
    });

    it('returns null when ssim_avg not present', async () => {
      childProcess.spawn.mockReturnValue(makeFakeProcess('nothing relevant', 0));
      const result = await service.calculateSsim('/orig.mkv', '/enc.mkv');
      expect(result).toBeNull();
    });

    it('returns null on spawn error', async () => {
      childProcess.spawn.mockReturnValue(makeErrorProcess());
      const result = await service.calculateSsim('/orig.mkv', '/enc.mkv');
      expect(result).toBeNull();
    });

    it('spawns ffmpeg with ssim lavfi filter', async () => {
      childProcess.spawn.mockReturnValue(makeFakeProcess('ssim_avg:0.99', 0));
      await service.calculateSsim('/orig.mkv', '/enc.mkv');
      const spawnArgs: string[] = childProcess.spawn.mock.calls[0][1];
      expect(spawnArgs).toContain('ssim');
    });
  });

  // ── calculateAllQualityMetrics ────────────────────────────────────────────

  describe('calculateAllQualityMetrics', () => {
    it('returns all three metrics when all succeed', async () => {
      childProcess.spawn
        .mockReturnValueOnce(makeFakeProcess('VMAF score: 91.00', 0))
        .mockReturnValueOnce(makeFakeProcess('psnr_avg:42.00', 0))
        .mockReturnValueOnce(makeFakeProcess('ssim_avg:0.9950', 0));

      const result = await service.calculateAllQualityMetrics('/orig.mkv', '/enc.mkv');
      expect(result.vmaf).toBeCloseTo(91.0);
      expect(result.psnr).toBeCloseTo(42.0);
      expect(result.ssim).toBeCloseTo(0.995);
      expect(result.calculatedAt).toBeInstanceOf(Date);
    });

    it('omits metrics that return null', async () => {
      childProcess.spawn.mockReturnValue(makeFakeProcess('no data', 0));

      const result = await service.calculateAllQualityMetrics('/orig.mkv', '/enc.mkv');
      expect(result.vmaf).toBeUndefined();
      expect(result.psnr).toBeUndefined();
      expect(result.ssim).toBeUndefined();
      expect(result.calculatedAt).toBeInstanceOf(Date);
    });

    it('always includes calculatedAt timestamp', async () => {
      childProcess.spawn.mockReturnValue(makeFakeProcess('', 0));
      const before = new Date();
      const result = await service.calculateAllQualityMetrics('/orig.mkv', '/enc.mkv');
      const after = new Date();
      expect(result.calculatedAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(result.calculatedAt.getTime()).toBeLessThanOrEqual(after.getTime());
    });

    it('returns partial results when PSNR spawn errors but others succeed', async () => {
      childProcess.spawn
        .mockReturnValueOnce(makeFakeProcess('VMAF score: 85.00', 0))
        .mockReturnValueOnce(makeErrorProcess())
        .mockReturnValueOnce(makeFakeProcess('ssim_avg:0.9700', 0));

      const result = await service.calculateAllQualityMetrics('/orig.mkv', '/enc.mkv');
      expect(result.vmaf).toBeCloseTo(85.0);
      expect(result.psnr).toBeUndefined();
      expect(result.ssim).toBeCloseTo(0.97);
    });

    it('returns only calculatedAt when all metrics fail', async () => {
      childProcess.spawn.mockReturnValue(makeErrorProcess());

      const result = await service.calculateAllQualityMetrics('/orig.mkv', '/enc.mkv');
      expect(result.vmaf).toBeUndefined();
      expect(result.psnr).toBeUndefined();
      expect(result.ssim).toBeUndefined();
    });
  });
});
