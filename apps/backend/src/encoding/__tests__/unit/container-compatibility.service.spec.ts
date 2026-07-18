import { Test, type TestingModule } from '@nestjs/testing';
import { ContainerCompatibilityService } from '../../container-compatibility.service';

jest.mock('child_process', () => ({
  spawn: jest.fn(),
}));

import { spawn } from 'child_process';
import { EventEmitter } from 'events';

describe('ContainerCompatibilityService', () => {
  let service: ContainerCompatibilityService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [ContainerCompatibilityService],
    }).compile();

    service = module.get<ContainerCompatibilityService>(ContainerCompatibilityService);

    jest.spyOn((service as any).logger, 'log').mockImplementation();
    jest.spyOn((service as any).logger, 'warn').mockImplementation();
    jest.spyOn((service as any).logger, 'debug').mockImplementation();
    jest.spyOn((service as any).logger, 'error').mockImplementation();
  });

  afterEach(() => {
    jest.clearAllMocks();
    jest.restoreAllMocks();
  });

  const createMockProcess = (exitCode: number, stdout: string, stderr = '') => {
    const proc = new EventEmitter() as any;
    proc.stdout = new EventEmitter();
    proc.stderr = new EventEmitter();
    proc.stdout.destroy = jest.fn();
    proc.stderr.destroy = jest.fn();
    proc.kill = jest.fn();

    (spawn as jest.Mock).mockReturnValue(proc);

    // Simulate async data and close
    setTimeout(() => {
      if (stdout) proc.stdout.emit('data', Buffer.from(stdout));
      if (stderr) proc.stderr.emit('data', Buffer.from(stderr));
      proc.emit('close', exitCode);
    }, 10);

    return proc;
  };

  describe('checkCompatibility', () => {
    it('should return empty issues for MKV target', async () => {
      const streamData = {
        streams: [
          { index: 0, codec_name: 'hevc', codec_type: 'video' },
          { index: 1, codec_name: 'ac3', codec_type: 'audio' },
        ],
      };

      createMockProcess(0, JSON.stringify(streamData));

      const issues = await service.checkCompatibility('/test/file.mkv', 'mkv');

      expect(issues).toEqual([]);
    });

    it('should detect AC3 audio incompatibility with MP4', async () => {
      const streamData = {
        streams: [
          { index: 0, codec_name: 'h264', codec_type: 'video' },
          { index: 1, codec_name: 'ac3', codec_type: 'audio' },
        ],
      };

      createMockProcess(0, JSON.stringify(streamData));

      const issues = await service.checkCompatibility('/test/file.mkv', 'mp4');

      expect(issues).toHaveLength(1);
      expect(issues[0].code).toBe('AC3_DTS_MP4_INCOMPATIBLE');
      // WARNING (not BLOCKER): the flag builder auto-transcodes to AAC
      expect(issues[0].severity).toBe('WARNING');
      expect(issues[0].message).toContain('will be automatically converted to AAC');
    });

    it('should accept preFetchedStreams and skip its own ffprobe', async () => {
      const streams = [
        { index: 0, codec_name: 'h264', codec_type: 'video' },
        { index: 1, codec_name: 'ac3', codec_type: 'audio' },
      ];

      const issues = await service.checkCompatibility('/test/file.mkv', 'mp4', streams);

      expect(spawn).not.toHaveBeenCalled();
      expect(issues).toHaveLength(1);
      expect(issues[0].code).toBe('AC3_DTS_MP4_INCOMPATIBLE');
    });

    it('should detect EAC3 audio incompatibility', async () => {
      const streamData = {
        streams: [
          { index: 0, codec_name: 'hevc', codec_type: 'video' },
          { index: 1, codec_name: 'eac3', codec_type: 'audio' },
        ],
      };

      createMockProcess(0, JSON.stringify(streamData));

      const issues = await service.checkCompatibility('/test/file.mkv', 'mp4');

      expect(issues).toHaveLength(1);
      expect(issues[0].metadata?.incompatibleCodecs).toContain('E-AC3 (Dolby Digital Plus)');
    });

    it('should detect DTS audio incompatibility', async () => {
      const streamData = {
        streams: [
          { index: 0, codec_name: 'h264', codec_type: 'video' },
          { index: 1, codec_name: 'dts', codec_type: 'audio' },
        ],
      };

      createMockProcess(0, JSON.stringify(streamData));

      const issues = await service.checkCompatibility('/test/file.mkv', 'mp4');

      expect(issues).toHaveLength(1);
      expect(issues[0].metadata?.incompatibleCodecs).toContain('DTS');
    });

    it('should detect TrueHD audio incompatibility', async () => {
      const streamData = {
        streams: [
          { index: 0, codec_name: 'hevc', codec_type: 'video' },
          { index: 1, codec_name: 'truehd', codec_type: 'audio' },
        ],
      };

      createMockProcess(0, JSON.stringify(streamData));

      const issues = await service.checkCompatibility('/test/file.mkv', 'mp4');

      expect(issues).toHaveLength(1);
    });

    it('should detect PCM audio incompatibility', async () => {
      const streamData = {
        streams: [
          { index: 0, codec_name: 'h264', codec_type: 'video' },
          { index: 1, codec_name: 'pcm_s16le', codec_type: 'audio' },
        ],
      };

      createMockProcess(0, JSON.stringify(streamData));

      const issues = await service.checkCompatibility('/test/file.mkv', 'mp4');

      expect(issues).toHaveLength(1);
    });

    it('should not flag compatible audio codecs', async () => {
      const streamData = {
        streams: [
          { index: 0, codec_name: 'h264', codec_type: 'video' },
          { index: 1, codec_name: 'aac', codec_type: 'audio' },
        ],
      };

      createMockProcess(0, JSON.stringify(streamData));

      const issues = await service.checkCompatibility('/test/file.mp4', 'mp4');

      expect(issues).toEqual([]);
    });

    it('should handle files with no audio streams', async () => {
      const streamData = {
        streams: [{ index: 0, codec_name: 'h264', codec_type: 'video' }],
      };

      createMockProcess(0, JSON.stringify(streamData));

      const issues = await service.checkCompatibility('/test/file.mkv', 'mp4');

      expect(issues).toEqual([]);
    });

    it('should detect multiple incompatible audio tracks', async () => {
      const streamData = {
        streams: [
          { index: 0, codec_name: 'hevc', codec_type: 'video' },
          {
            index: 1,
            codec_name: 'ac3',
            codec_type: 'audio',
            tags: { title: 'Surround 5.1' },
          },
          {
            index: 2,
            codec_name: 'dts',
            codec_type: 'audio',
            tags: { title: 'DTS-HD' },
          },
        ],
      };

      createMockProcess(0, JSON.stringify(streamData));

      const issues = await service.checkCompatibility('/test/file.mkv', 'mp4');

      expect(issues).toHaveLength(1);
      expect(issues[0].metadata?.incompatibleTrackCount).toBe(2);
      expect(issues[0].affectedStreams).toEqual([1, 2]);
    });

    it('should provide suggested actions', async () => {
      const streamData = {
        streams: [
          { index: 0, codec_name: 'h264', codec_type: 'video' },
          { index: 1, codec_name: 'ac3', codec_type: 'audio' },
        ],
      };

      createMockProcess(0, JSON.stringify(streamData));

      const issues = await service.checkCompatibility('/test/file.mkv', 'mp4');

      expect(Array.isArray(issues[0].suggestedActions)).toBe(true);
      expect(issues[0].suggestedActions.length).toBeGreaterThanOrEqual(2);

      const mkv = issues[0].suggestedActions.find((a: any) => a.id === 'use_mkv_container');
      expect(mkv).not.toBeUndefined();
      expect(mkv!.recommended).toBe(true);

      const aac = issues[0].suggestedActions.find((a: any) => a.id === 'transcode_audio_aac');
      expect(aac).not.toBeUndefined();
    });

    it('should return empty on ffprobe failure', async () => {
      const proc = new EventEmitter() as any;
      proc.stdout = new EventEmitter();
      proc.stderr = new EventEmitter();
      proc.stdout.destroy = jest.fn();
      proc.stderr.destroy = jest.fn();
      proc.kill = jest.fn();

      (spawn as jest.Mock).mockReturnValue(proc);

      setTimeout(() => {
        proc.emit('error', new Error('ffprobe not found'));
      }, 10);

      const issues = await service.checkCompatibility('/test/file.mkv', 'mp4');

      expect(issues).toEqual([]);
    });

    it('should return empty on non-zero exit code', async () => {
      createMockProcess(1, '', 'Error reading file');

      const issues = await service.checkCompatibility('/test/missing.mkv', 'mp4');

      expect(issues).toEqual([]);
    });

    it('should default to mp4 target container', async () => {
      const streamData = {
        streams: [
          { index: 0, codec_name: 'h264', codec_type: 'video' },
          { index: 1, codec_name: 'ac3', codec_type: 'audio' },
        ],
      };

      createMockProcess(0, JSON.stringify(streamData));

      const issues = await service.checkCompatibility('/test/file.mkv');

      expect(issues).toHaveLength(1);
    });
  });

  describe('getStreamInfo', () => {
    it('is public and returns parsed streams from ffprobe', async () => {
      const streamData = {
        streams: [{ index: 0, codec_name: 'hevc', codec_type: 'video' }],
      };

      createMockProcess(0, JSON.stringify(streamData));

      const streams = await service.getStreamInfo('/test/file.mkv');

      expect(streams).toEqual(streamData.streams);
    });
  });

  describe('toJobStreamInfo', () => {
    it('maps streams to compact entries with pixFmt/colorTransfer when present', () => {
      const entries = service.toJobStreamInfo([
        {
          index: 0,
          codec_name: 'hevc',
          codec_type: 'video',
          pix_fmt: 'yuv420p10le',
          color_transfer: 'smpte2084',
        },
        { index: 1, codec_name: 'ac3', codec_type: 'audio' },
        { index: 2, codec_name: 'subrip', codec_type: 'subtitle' },
      ]);

      expect(entries).toEqual([
        {
          index: 0,
          type: 'video',
          codec: 'hevc',
          pixFmt: 'yuv420p10le',
          colorTransfer: 'smpte2084',
        },
        { index: 1, type: 'audio', codec: 'ac3' },
        { index: 2, type: 'subtitle', codec: 'subrip' },
      ]);
      expect('pixFmt' in entries[1]).toBe(false);
      expect('colorTransfer' in entries[1]).toBe(false);
    });

    it('defaults missing codec fields to unknown and omits non-string pix_fmt', () => {
      const entries = service.toJobStreamInfo([{ index: 3, pix_fmt: 42, color_transfer: null }]);

      expect(entries).toEqual([{ index: 3, type: 'unknown', codec: 'unknown' }]);
      expect('pixFmt' in entries[0]).toBe(false);
      expect('colorTransfer' in entries[0]).toBe(false);
    });
  });
});
