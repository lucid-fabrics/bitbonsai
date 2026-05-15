import { Test, type TestingModule } from '@nestjs/testing';
import { HardwareAccelerationService } from '../../hardware-acceleration.service';

// Mock node:child_process before imports resolve
const mockSpawn = jest.fn();
jest.mock('node:child_process', () => ({
  spawn: (...args: unknown[]) => mockSpawn(...args),
}));

// Mock node:fs for /dev/dri device checks
const mockExistsSync = jest.fn();
jest.mock('node:fs', () => ({
  existsSync: (...args: unknown[]) => mockExistsSync(...args),
}));

function makeSpawnMock(exitCode: number, emitError = false) {
  const emitter: Record<string, ((...args: unknown[]) => void)[]> = {};
  const mock = {
    stdout: { destroy: jest.fn() },
    stderr: { destroy: jest.fn() },
    kill: jest.fn(),
    on: jest.fn((event: string, cb: (...args: unknown[]) => void) => {
      emitter[event] = emitter[event] ?? [];
      emitter[event].push(cb);
    }),
    _emit: (event: string, ...args: unknown[]) => {
      for (const cb of emitter[event] ?? []) {
        cb(...args);
      }
    },
  };

  // Defer emission so listeners are registered first
  setImmediate(() => {
    if (emitError) {
      mock._emit('error', new Error('spawn error'));
    } else {
      mock._emit('close', exitCode);
    }
  });

  return mock;
}

describe('HardwareAccelerationService', () => {
  let service: HardwareAccelerationService;
  const originalPlatform = process.platform;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [HardwareAccelerationService],
    }).compile();

    service = module.get<HardwareAccelerationService>(HardwareAccelerationService);
  });

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform });
  });

  it('should be defined', () => {
    expect(service).toBeInstanceOf(HardwareAccelerationService);
  });

  describe('detectHardwareAcceleration', () => {
    it('should return NVIDIA config when nvidia-smi exits with code 0', async () => {
      mockSpawn.mockReturnValue(makeSpawnMock(0));
      mockExistsSync.mockReturnValue(false);

      const result = await service.detectHardwareAcceleration();

      expect(result.type).toBe('NVIDIA');
      expect(result.videoCodec).toBe('hevc_nvenc');
      expect(result.flags).toEqual(['-hwaccel', 'cuda', '-hwaccel_output_format', 'cuda']);
      expect(mockSpawn).toHaveBeenCalledWith('nvidia-smi', [
        '--query-gpu=name',
        '--format=csv,noheader',
      ]);
    });

    it('should return INTEL_QSV config when nvidia-smi fails and /dev/dri/renderD128 exists', async () => {
      mockSpawn.mockReturnValue(makeSpawnMock(1));
      mockExistsSync.mockImplementation((path: string) => path === '/dev/dri/renderD128');

      const result = await service.detectHardwareAcceleration();

      expect(result.type).toBe('INTEL_QSV');
      expect(result.videoCodec).toBe('hevc_qsv');
      expect(result.flags).toContain('qsv');
    });

    it('should return AMD config when nvidia-smi fails, no renderD128, but renderD129 exists', async () => {
      mockSpawn.mockReturnValue(makeSpawnMock(1));
      mockExistsSync.mockImplementation((path: string) => path === '/dev/dri/renderD129');

      const result = await service.detectHardwareAcceleration();

      expect(result.type).toBe('AMD');
      expect(result.videoCodec).toBe('hevc_vaapi');
      expect(result.flags).toContain('vaapi');
    });

    it('should return APPLE_M config on darwin when no GPU devices are found', async () => {
      mockSpawn.mockReturnValue(makeSpawnMock(1));
      mockExistsSync.mockReturnValue(false);
      Object.defineProperty(process, 'platform', { value: 'darwin' });

      const result = await service.detectHardwareAcceleration();

      expect(result.type).toBe('APPLE_M');
      expect(result.videoCodec).toBe('hevc_videotoolbox');
      expect(result.flags).toEqual(['-hwaccel', 'videotoolbox']);
    });

    it('should return CPU config when no hardware acceleration is available', async () => {
      mockSpawn.mockReturnValue(makeSpawnMock(1));
      mockExistsSync.mockReturnValue(false);
      Object.defineProperty(process, 'platform', { value: 'linux' });

      const result = await service.detectHardwareAcceleration();

      expect(result.type).toBe('CPU');
      expect(result.videoCodec).toBe('libx265');
      expect(result.flags).toEqual([]);
    });

    it('should fall through to next check when nvidia-smi spawn emits an error', async () => {
      mockSpawn.mockReturnValue(makeSpawnMock(0, true /* emitError */));
      mockExistsSync.mockReturnValue(false);
      Object.defineProperty(process, 'platform', { value: 'linux' });

      const result = await service.detectHardwareAcceleration();

      // Error on spawn → skip NVIDIA → no /dev/dri → CPU
      expect(result.type).toBe('CPU');
      expect(result.videoCodec).toBe('libx265');
    });
  });

  describe('selectCodecForPolicy', () => {
    it('should return hevc_nvenc for HEVC + NVIDIA', () => {
      expect(service.selectCodecForPolicy('HEVC', 'NVIDIA')).toBe('hevc_nvenc');
    });

    it('should return hevc_qsv for HEVC + INTEL_QSV', () => {
      expect(service.selectCodecForPolicy('HEVC', 'INTEL_QSV')).toBe('hevc_qsv');
    });

    it('should return libx265 for HEVC + CPU', () => {
      expect(service.selectCodecForPolicy('HEVC', 'CPU')).toBe('libx265');
    });

    it('should return av1_nvenc for AV1 + NVIDIA', () => {
      expect(service.selectCodecForPolicy('AV1', 'NVIDIA')).toBe('av1_nvenc');
    });

    it('should return libaom-av1 for AV1 + APPLE_M (no native AV1 encoder)', () => {
      expect(service.selectCodecForPolicy('AV1', 'APPLE_M')).toBe('libaom-av1');
    });

    it('should return h264_nvenc for H264 + NVIDIA', () => {
      expect(service.selectCodecForPolicy('H264', 'NVIDIA')).toBe('h264_nvenc');
    });

    it('should return h264_videotoolbox for H264 + APPLE_M', () => {
      expect(service.selectCodecForPolicy('H264', 'APPLE_M')).toBe('h264_videotoolbox');
    });

    it('should return libvpx-vp9 for VP9 on all hardware types (no HW encoder)', () => {
      expect(service.selectCodecForPolicy('VP9', 'NVIDIA')).toBe('libvpx-vp9');
      expect(service.selectCodecForPolicy('VP9', 'AMD')).toBe('libvpx-vp9');
      expect(service.selectCodecForPolicy('VP9', 'APPLE_M')).toBe('libvpx-vp9');
      expect(service.selectCodecForPolicy('VP9', 'CPU')).toBe('libvpx-vp9');
    });

    it('should return libx265 as final fallback for unknown codec', () => {
      expect(service.selectCodecForPolicy('UNKNOWN_CODEC', 'NVIDIA')).toBe('libx265');
    });

    it('should return CPU codec when hwType is unrecognised but codec is known', () => {
      // HEVC + unknown hwType → falls back to HEVC/CPU → libx265
      expect(service.selectCodecForPolicy('HEVC', 'UNKNOWN_HW')).toBe('libx265');
    });
  });
});
