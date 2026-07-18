import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { Logger } from '@nestjs/common';

/**
 * Minimal synthetic-fixture generator for the nightly self-test corpus.
 *
 * A sibling of encoding/__tests__/fixtures/video-generator.ts, not a
 * wrapper around it: that file lives under __tests__/, which
 * apps/backend/tsconfig.json excludes from the production build, so it
 * cannot be imported from a runtime service. This is deliberately scoped
 * down to only what the self-test corpus needs (mkv only, no corruption/
 * series-episode helpers) rather than a full copy of that surface.
 */

export interface SelfTestVideoOptions {
  filename: string;
  codec: 'h264' | 'hevc' | 'av1';
  duration: number; // seconds
  targetSizeMB: number;
  audio: 'aac' | 'ac3';
  pixFmt?: 'yuv420p' | 'yuv420p10le';
  hdr?: boolean;
  bitmapSubtitles?: boolean;
}

const logger = new Logger('SelfTestFixtureGenerator');

function getCodecArgs(codec: SelfTestVideoOptions['codec'], bitrate: string): string[] {
  switch (codec) {
    case 'h264':
      return ['-c:v', 'libx264', '-preset', 'ultrafast', '-b:v', bitrate];
    case 'hevc':
      return ['-c:v', 'libx265', '-preset', 'ultrafast', '-b:v', bitrate];
    case 'av1':
      return ['-c:v', 'libaom-av1', '-cpu-used', '8', '-b:v', bitrate];
    default:
      return ['-c:v', 'libx264', '-preset', 'ultrafast', '-b:v', bitrate];
  }
}

function getAudioArgs(audio: SelfTestVideoOptions['audio']): string[] {
  return audio === 'ac3'
    ? ['-c:a', 'ac3', '-b:a', '192k']
    : ['-c:a', 'aac', '-b:a', '128k'];
}

function calculateBitrate(targetSizeMB: number, duration: number): string {
  const targetSizeBits = targetSizeMB * 8 * 1024 * 1024;
  return `${Math.floor(targetSizeBits / duration / 1000)}k`;
}

/**
 * Generate a synthetic 480p MKV fixture into `outputDir` via real ffmpeg.
 * Returns the absolute output path. Overwrites any existing file at that
 * path - self-test fixtures are throwaway and regenerated every run.
 */
export async function generateSelfTestVideo(
  options: SelfTestVideoOptions,
  outputDir: string
): Promise<string> {
  const outputPath = path.join(outputDir, options.filename);
  const bitrate = calculateBitrate(options.targetSizeMB, options.duration);
  const pixFmt = options.hdr ? 'yuv420p10le' : options.pixFmt || 'yuv420p';

  // A subtitle stream needs a real input to encode from - lavfi has no
  // subtitle source, so write a throwaway one-line SRT and mux it in as a
  // third input, explicitly mapped.
  const srtInputPath = options.bitmapSubtitles
    ? path.join(outputDir, `.subs-${Date.now()}-${Math.random().toString(36).slice(2)}.srt`)
    : null;
  if (srtInputPath) {
    fs.writeFileSync(srtInputPath, '1\n00:00:00,000 --> 00:00:05,000\nTest subtitle\n', 'utf8');
  }

  const args = [
    '-f',
    'lavfi',
    '-i',
    `testsrc=size=854x480:rate=24:duration=${options.duration}`,
    '-f',
    'lavfi',
    '-i',
    `sine=frequency=1000:duration=${options.duration}`,
  ];
  if (srtInputPath) {
    args.push('-i', srtInputPath);
  }
  args.push(...getCodecArgs(options.codec, bitrate), ...getAudioArgs(options.audio));
  args.push('-pix_fmt', pixFmt);

  if (options.hdr) {
    args.push('-color_primaries', 'bt2020', '-color_trc', 'smpte2084', '-colorspace', 'bt2020nc');
  }

  if (srtInputPath) {
    args.push('-map', '0:v', '-map', '1:a', '-map', '2:s', '-c:s', 'dvd_subtitle');
  }

  args.push('-y', outputPath);

  return new Promise((resolve, reject) => {
    const ffmpeg = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    ffmpeg.stderr?.on('data', (data) => {
      stderr += data.toString();
    });

    const cleanupSrt = () => {
      if (srtInputPath && fs.existsSync(srtInputPath)) {
        try {
          fs.unlinkSync(srtInputPath);
        } catch {
          // best-effort cleanup of the throwaway subtitle input
        }
      }
    };

    ffmpeg.on('close', (code) => {
      cleanupSrt();
      if (code === 0) {
        resolve(outputPath);
      } else {
        logger.warn(`Fixture generation failed for ${options.filename}: ${stderr.slice(-500)}`);
        reject(new Error(`FFmpeg fixture generation failed with code ${code}`));
      }
    });

    ffmpeg.on('error', (err) => {
      cleanupSrt();
      reject(err);
    });
  });
}
