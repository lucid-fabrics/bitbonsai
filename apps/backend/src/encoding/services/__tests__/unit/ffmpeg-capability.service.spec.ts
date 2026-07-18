import { EventEmitter } from 'node:events';
import { Test, type TestingModule } from '@nestjs/testing';
import { FfmpegCapabilityService } from '../../ffmpeg-capability.service';

// ---------------------------------------------------------------------------
// child_process mock
// ---------------------------------------------------------------------------

const mockSpawn = jest.fn();

jest.mock('node:child_process', () => ({
  spawn: (...args: unknown[]) => mockSpawn(...args),
}));

// ---------------------------------------------------------------------------
// Fake process builder (same shape used by gpu-health.service.spec.ts)
// ---------------------------------------------------------------------------

interface FakeProcessOptions {
  stdoutData?: string;
  exitCode?: number | null;
  errorCode?: string;
  hang?: boolean;
}

function makeFakeProcess(opts: FakeProcessOptions = {}) {
  const proc = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    kill: jest.Mock;
  };

  proc.stdout = new EventEmitter();
  proc.kill = jest.fn();

  if (!opts.hang) {
    setImmediate(() => {
      if (opts.stdoutData) proc.stdout.emit('data', Buffer.from(opts.stdoutData));

      if (opts.errorCode !== undefined) {
        const err = Object.assign(new Error(opts.errorCode), { code: opts.errorCode });
        proc.emit('error', err);
      } else {
        proc.emit('close', opts.exitCode ?? 0);
      }
    });
  }

  return proc;
}

const SAMPLE_ENCODERS_OUTPUT = `Encoders:
 V..... = Video
 A..... = Audio
 S..... = Subtitle
 .F.... = Frame-level multithreading
 ..S... = Slice-level multithreading
 ...X.. = Codec is experimental
 ....B. = Supports draw_horiz_band
 .....D = Supports direct rendering method 1
 ------
 V..... libx264              libx264 H.264 / AVC / MPEG-4 AVC (codec h264)
 V..... libx265              libx265 H.265 / HEVC (codec hevc)
 V....D h264_nvenc           NVIDIA NVENC H.264 encoder (codec h264)
 V....D hevc_nvenc           NVIDIA NVENC hevc encoder (codec hevc)
 A..... aac                  AAC (Advanced Audio Coding)
`;

describe('FfmpegCapabilityService', () => {
  let service: FfmpegCapabilityService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [FfmpegCapabilityService],
    }).compile();

    service = module.get<FfmpegCapabilityService>(FfmpegCapabilityService);
  });

  describe('hasEncoder', () => {
    it('fails open (returns true for anything) before the probe has run', () => {
      expect(service.hasEncoder('hevc_nvenc')).toBe(true);
      expect(service.hasEncoder('totally_made_up_encoder')).toBe(true);
    });

    it('reflects the probed encoder set after onModuleInit', async () => {
      mockSpawn.mockReturnValue(makeFakeProcess({ stdoutData: SAMPLE_ENCODERS_OUTPUT }));

      await service.onModuleInit();

      expect(service.hasEncoder('hevc_nvenc')).toBe(true);
      expect(service.hasEncoder('libx265')).toBe(true);
      expect(service.hasEncoder('av1_qsv')).toBe(false);
    });

    it('fails open when the probe process errors (e.g. ENOENT)', async () => {
      mockSpawn.mockReturnValue(makeFakeProcess({ errorCode: 'ENOENT' }));

      await service.onModuleInit();

      expect(service.hasEncoder('anything')).toBe(true);
    });

    it('fails open when ffmpeg exits non-zero', async () => {
      mockSpawn.mockReturnValue(makeFakeProcess({ exitCode: 1 }));

      await service.onModuleInit();

      expect(service.hasEncoder('anything')).toBe(true);
    });

    it('fails open when spawn throws synchronously', async () => {
      mockSpawn.mockImplementation(() => {
        throw new Error('spawn EMFILE');
      });

      await service.onModuleInit();

      expect(service.hasEncoder('anything')).toBe(true);
    });

    it('fails open and kills the process on timeout', async () => {
      jest.useFakeTimers();
      const proc = makeFakeProcess({ hang: true });
      mockSpawn.mockReturnValue(proc);

      const initPromise = service.onModuleInit();
      await jest.advanceTimersByTimeAsync(10_000);
      await initPromise;

      expect(proc.kill).toHaveBeenCalledWith('SIGKILL');
      expect(service.hasEncoder('anything')).toBe(true);
      jest.useRealTimers();
    });
  });

  describe('refresh', () => {
    it('re-probes and updates the cached encoder set', async () => {
      mockSpawn.mockReturnValue(makeFakeProcess({ stdoutData: SAMPLE_ENCODERS_OUTPUT }));
      await service.onModuleInit();
      expect(service.hasEncoder('av1_qsv')).toBe(false);

      mockSpawn.mockReturnValue(
        makeFakeProcess({
          stdoutData: `Encoders:\n ------\n V....D av1_qsv               AV1 (Intel Quick Sync Video acceleration) (codec av1)\n`,
        })
      );
      await service.refresh();

      expect(service.hasEncoder('av1_qsv')).toBe(true);
    });
  });
});
