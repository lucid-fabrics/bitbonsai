jest.mock('child_process', () => ({
  spawn: jest.fn(),
}));

jest.mock('fs', () => ({
  ...jest.requireActual('fs'),
  existsSync: jest.fn(),
  writeFileSync: jest.fn(),
  unlinkSync: jest.fn(),
}));

import { spawn } from 'child_process';
import { EventEmitter } from 'events';
import { existsSync } from 'fs';
import { generateSelfTestVideo } from '../../self-test-fixture-generator';

describe('generateSelfTestVideo', () => {
  const createMockProcess = (exitCode: number, stderr = '') => {
    const proc = new EventEmitter() as any;
    proc.stdout = new EventEmitter();
    proc.stderr = new EventEmitter();
    proc.stdout.destroy = jest.fn();
    proc.stderr.destroy = jest.fn();

    (spawn as jest.Mock).mockReturnValue(proc);

    setTimeout(() => {
      if (stderr) proc.stderr.emit('data', Buffer.from(stderr));
      proc.emit('close', exitCode);
    }, 10);

    return proc;
  };

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('resolves with the output path on a successful encode', async () => {
    createMockProcess(0);

    const result = await generateSelfTestVideo(
      { filename: 'test.mkv', codec: 'h264', duration: 8, targetSizeMB: 5, audio: 'aac' },
      '/tmp/self-test'
    );

    expect(result).toBe('/tmp/self-test/test.mkv');
  });

  it('rejects when ffmpeg exits non-zero', async () => {
    createMockProcess(1, 'encoder not found');

    await expect(
      generateSelfTestVideo(
        { filename: 'test.mkv', codec: 'hevc', duration: 8, targetSizeMB: 5, audio: 'aac' },
        '/tmp/self-test'
      )
    ).rejects.toThrow('FFmpeg fixture generation failed');
  });

  it('rejects when ffmpeg cannot be spawned', async () => {
    const proc = new EventEmitter() as any;
    proc.stdout = new EventEmitter();
    proc.stderr = new EventEmitter();
    proc.stdout.destroy = jest.fn();
    proc.stderr.destroy = jest.fn();
    (spawn as jest.Mock).mockReturnValue(proc);
    setTimeout(() => proc.emit('error', new Error('ENOENT')), 10);

    await expect(
      generateSelfTestVideo(
        { filename: 'test.mkv', codec: 'h264', duration: 8, targetSizeMB: 5, audio: 'aac' },
        '/tmp/self-test'
      )
    ).rejects.toThrow('ENOENT');
  });

  it('requests a 10-bit pixel format and HDR colorimetry when hdr is set', async () => {
    createMockProcess(0);

    await generateSelfTestVideo(
      { filename: 'hdr.mkv', codec: 'hevc', duration: 8, targetSizeMB: 5, audio: 'aac', hdr: true },
      '/tmp/self-test'
    );

    const args = (spawn as jest.Mock).mock.calls[0][1] as string[];
    expect(args).toEqual(
      expect.arrayContaining([
        '-pix_fmt',
        'yuv420p10le',
        '-color_primaries',
        'bt2020',
        '-color_trc',
        'smpte2084',
        '-colorspace',
        'bt2020nc',
      ])
    );
  });

  it('requests the bare 10-bit pixel format when pixFmt is set without hdr', async () => {
    createMockProcess(0);

    await generateSelfTestVideo(
      {
        filename: '10bit.mkv',
        codec: 'hevc',
        duration: 8,
        targetSizeMB: 5,
        audio: 'aac',
        pixFmt: 'yuv420p10le',
      },
      '/tmp/self-test'
    );

    const args = (spawn as jest.Mock).mock.calls[0][1] as string[];
    expect(args).toEqual(expect.arrayContaining(['-pix_fmt', 'yuv420p10le']));
    expect(args).not.toContain('-color_primaries');
  });

  it('writes a throwaway SRT input and maps a bitmap subtitle stream when requested', async () => {
    (existsSync as jest.Mock).mockReturnValue(true);
    createMockProcess(0);

    await generateSelfTestVideo(
      {
        filename: 'subs.mkv',
        codec: 'h264',
        duration: 8,
        targetSizeMB: 5,
        audio: 'aac',
        bitmapSubtitles: true,
      },
      '/tmp/self-test'
    );

    const args = (spawn as jest.Mock).mock.calls[0][1] as string[];
    // Three inputs: video, audio, and the throwaway subtitle file.
    expect(args.filter((a) => a === '-i')).toHaveLength(3);
    expect(args).toEqual(
      expect.arrayContaining(['-map', '0:v', '-map', '1:a', '-map', '2:s', '-c:s', 'dvd_subtitle'])
    );
  });

  it('does not add a subtitle input when bitmapSubtitles is not requested', async () => {
    createMockProcess(0);

    await generateSelfTestVideo(
      { filename: 'plain.mkv', codec: 'h264', duration: 8, targetSizeMB: 5, audio: 'aac' },
      '/tmp/self-test'
    );

    const args = (spawn as jest.Mock).mock.calls[0][1] as string[];
    expect(args.filter((a) => a === '-i')).toHaveLength(2);
    expect(args).not.toContain('-map');
  });
});
