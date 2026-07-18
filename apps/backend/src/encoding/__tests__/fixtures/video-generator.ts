import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { Logger } from '@nestjs/common';

/**
 * Video Generator Utility for Integration Tests
 *
 * Generates realistic test video files with FFmpeg:
 * - Various codecs (H.264, H.265/HEVC, VP9, AV1, MPEG-2)
 * - Various resolutions (480p, 720p, 1080p, 4K)
 * - Various containers (MP4, MKV, AVI, TS)
 * - Audio tracks (AAC, AC3, DTS, multiple tracks)
 * - Subtitles (SRT, ASS embedded)
 * - Realistic filenames (movies/series/anime)
 * - Size constraints (10MB-500MB)
 */

export interface VideoOptions {
  filename: string;
  codec: 'h264' | 'hevc' | 'vp9' | 'av1' | 'mpeg2';
  resolution: '480p' | '720p' | '1080p' | '4k';
  container: 'mp4' | 'mkv' | 'avi' | 'ts';
  duration: number; // seconds
  targetSizeMB?: number; // target file size in MB
  audio?: 'aac' | 'ac3' | 'dts' | 'multiple';
  subtitles?: boolean;
  // 10-bit source (only meaningful for hevc/av1 - h264/vp9/mpeg2 encoders in
  // this build are 8-bit only). hdr:true implies 10-bit and additionally
  // tags BT.2020/PQ colorimetry so the pipeline's HDR-detection path sees a
  // real HDR10-flavored source, not just a bit-depth bump.
  pixFmt?: 'yuv420p' | 'yuv420p10le';
  hdr?: boolean;
  // Bitmap (image-based) subtitles, as opposed to the text-based mov_text
  // `subtitles` option above. Real PGS streams aren't synthesizable from
  // scratch (no lavfi source, and ffmpeg's PGS encoder is decode-only in
  // most builds) - dvd_subtitle is used as a stand-in bitmap format since
  // it exercises the same "MP4 can't hold bitmap subs" pipeline path.
  bitmapSubtitles?: boolean;
}

export interface CorruptedVideoOptions {
  filename: string;
  corruptionType: 'missing-header' | 'partial-download' | 'truncated';
  sizeMB?: number;
}

const logger = new Logger('VideoGenerator');

/**
 * Get fixtures directory path
 */
export function getFixturesDir(): string {
  const fixturesDir = path.join(__dirname, 'generated');
  if (!fs.existsSync(fixturesDir)) {
    fs.mkdirSync(fixturesDir, { recursive: true });
  }
  return fixturesDir;
}

/**
 * Get resolution dimensions
 */
function getResolutionDimensions(resolution: string): {
  width: number;
  height: number;
} {
  switch (resolution) {
    case '480p':
      return { width: 854, height: 480 };
    case '720p':
      return { width: 1280, height: 720 };
    case '1080p':
      return { width: 1920, height: 1080 };
    case '4k':
      return { width: 3840, height: 2160 };
    default:
      return { width: 1280, height: 720 };
  }
}

/**
 * Calculate bitrate to achieve target file size
 */
function calculateBitrate(targetSizeMB: number, duration: number): string {
  // Convert MB to bits, divide by duration in seconds, then by 1000 for kbps
  const targetSizeBits = targetSizeMB * 8 * 1024 * 1024;
  const bitrate = Math.floor(targetSizeBits / duration / 1000);
  return `${bitrate}k`;
}

/**
 * Get codec-specific FFmpeg arguments
 */
function getCodecArgs(codec: string, bitrate: string): string[] {
  switch (codec) {
    case 'h264':
      return ['-c:v', 'libx264', '-preset', 'ultrafast', '-b:v', bitrate];
    case 'hevc':
      return ['-c:v', 'libx265', '-preset', 'ultrafast', '-b:v', bitrate];
    case 'vp9':
      return ['-c:v', 'libvpx-vp9', '-b:v', bitrate];
    case 'av1':
      return ['-c:v', 'libaom-av1', '-cpu-used', '8', '-b:v', bitrate];
    case 'mpeg2':
      return ['-c:v', 'mpeg2video', '-b:v', bitrate];
    default:
      return ['-c:v', 'libx264', '-preset', 'ultrafast', '-b:v', bitrate];
  }
}

/**
 * Get audio codec FFmpeg arguments
 */
function getAudioArgs(audio?: string): string[] {
  switch (audio) {
    case 'aac':
      return ['-c:a', 'aac', '-b:a', '128k'];
    case 'ac3':
      return ['-c:a', 'ac3', '-b:a', '192k'];
    case 'dts':
      return ['-c:a', 'dca', '-b:a', '256k'];
    case 'multiple':
      // Generate multiple audio tracks
      return [
        '-c:a:0',
        'aac',
        '-b:a:0',
        '128k',
        '-c:a:1',
        'ac3',
        '-b:a:1',
        '192k',
        '-metadata:s:a:0',
        'language=eng',
        '-metadata:s:a:1',
        'language=jpn',
      ];
    default:
      return ['-c:a', 'aac', '-b:a', '128k'];
  }
}

/**
 * Generate a test video file
 */
export async function generateVideo(
  options: VideoOptions,
  outputDir?: string
): Promise<string> {
  const fixturesDir = outputDir || getFixturesDir();
  const outputPath = path.join(fixturesDir, options.filename);

  // Skip if file already exists
  if (fs.existsSync(outputPath)) {
    logger.log(`Video already exists: ${options.filename}`);
    return outputPath;
  }

  const { width, height } = getResolutionDimensions(options.resolution);
  const targetSizeMB = options.targetSizeMB || 50;
  const bitrate = calculateBitrate(targetSizeMB, options.duration);

  const codecArgs = getCodecArgs(options.codec, bitrate);
  const audioArgs = getAudioArgs(options.audio || 'aac');
  const pixFmt = options.hdr ? 'yuv420p10le' : options.pixFmt || 'yuv420p';

  // A subtitle stream needs a real input to encode from - lavfi has no
  // subtitle source, so write a throwaway one-line SRT and mux it in as a
  // third input, explicitly mapped alongside video/audio. Without this,
  // `-c:s <codec>` has no matching stream and silently does nothing.
  const wantsSubtitles = options.subtitles || options.bitmapSubtitles;
  const srtInputPath = wantsSubtitles
    ? path.join(fixturesDir, `.subs-${Date.now()}-${Math.random().toString(36).slice(2)}.srt`)
    : null;
  if (srtInputPath) {
    fs.writeFileSync(
      srtInputPath,
      '1\n00:00:00,000 --> 00:00:05,000\nTest subtitle\n',
      'utf8'
    );
  }

  // Build FFmpeg command
  const args = [
    '-f',
    'lavfi',
    '-i',
    `testsrc=size=${width}x${height}:rate=24:duration=${options.duration}`,
    '-f',
    'lavfi',
    '-i',
    `sine=frequency=1000:duration=${options.duration}`,
  ];
  if (srtInputPath) {
    args.push('-i', srtInputPath);
  }
  args.push(...codecArgs, ...audioArgs, '-pix_fmt', pixFmt);

  // HDR10-flavored colorimetry: tags the stream so the pipeline's HDR
  // detection sees real BT.2020/PQ metadata, not just a 10-bit pixel format.
  if (options.hdr) {
    args.push(
      '-color_primaries',
      'bt2020',
      '-color_trc',
      'smpte2084',
      '-colorspace',
      'bt2020nc'
    );
  }

  if (srtInputPath) {
    // Explicit mapping: lavfi inputs have no subtitle stream to auto-select,
    // so without this the third input would be silently dropped.
    args.push('-map', '0:v', '-map', '1:a', '-map', '2:s');
    // Bitmap subs (dvd_subtitle, a PGS stand-in - see VideoOptions doc) take
    // priority when both flags are set; a file only needs one subtitle track.
    args.push('-c:s', options.bitmapSubtitles ? 'dvd_subtitle' : 'mov_text');
  }

  args.push('-y', outputPath);

  logger.log(`Generating ${options.codec} video: ${options.filename} (${targetSizeMB}MB)`);

  return new Promise((resolve, reject) => {
    const ffmpeg = spawn('ffmpeg', args, {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stderr = '';
    ffmpeg.stderr?.on('data', (data) => {
      stderr += data.toString();
    });

    ffmpeg.on('close', (code) => {
      if (srtInputPath && fs.existsSync(srtInputPath)) {
        try {
          fs.unlinkSync(srtInputPath);
        } catch {
          // best-effort cleanup of the throwaway subtitle input
        }
      }
      if (code === 0) {
        const stats = fs.statSync(outputPath);
        const actualSizeMB = stats.size / 1024 / 1024;
        logger.log(
          `Generated ${options.filename}: ${actualSizeMB.toFixed(2)}MB (target: ${targetSizeMB}MB)`
        );
        resolve(outputPath);
      } else {
        logger.error(`Failed to generate ${options.filename}: ${stderr}`);
        reject(new Error(`FFmpeg failed with code ${code}`));
      }
    });

    ffmpeg.on('error', (err) => {
      if (srtInputPath && fs.existsSync(srtInputPath)) {
        try {
          fs.unlinkSync(srtInputPath);
        } catch {
          // best-effort cleanup of the throwaway subtitle input
        }
      }
      logger.error(`FFmpeg error: ${err.message}`);
      reject(err);
    });
  });
}

/**
 * Generate a corrupted video file
 */
export async function generateCorruptedVideo(options: CorruptedVideoOptions): Promise<string> {
  const fixturesDir = getFixturesDir();
  const outputPath = path.join(fixturesDir, options.filename);

  // Skip if file already exists
  if (fs.existsSync(outputPath)) {
    logger.log(`Corrupted video already exists: ${options.filename}`);
    return outputPath;
  }

  logger.log(`Generating corrupted video: ${options.filename} (${options.corruptionType})`);

  switch (options.corruptionType) {
    case 'missing-header': {
      // Generate valid video first, then remove header
      const tempPath = await generateVideo({
        filename: `temp-${options.filename}`,
        codec: 'h264',
        resolution: '720p',
        container: 'mp4',
        duration: 10,
        targetSizeMB: options.sizeMB || 10,
      });

      // Remove first 1KB (header)
      const data = fs.readFileSync(tempPath);
      fs.writeFileSync(outputPath, data.subarray(1024));
      fs.unlinkSync(tempPath);
      break;
    }

    case 'partial-download': {
      // Generate valid video, then truncate
      const tempPath = await generateVideo({
        filename: `temp-${options.filename}`,
        codec: 'h264',
        resolution: '720p',
        container: 'mp4',
        duration: 10,
        targetSizeMB: options.sizeMB || 10,
      });

      // Keep only first 50%
      const data = fs.readFileSync(tempPath);
      fs.writeFileSync(outputPath, data.subarray(0, Math.floor(data.length / 2)));
      fs.unlinkSync(tempPath);
      break;
    }

    case 'truncated': {
      // Generate valid video, then truncate at end
      const tempPath = await generateVideo({
        filename: `temp-${options.filename}`,
        codec: 'h264',
        resolution: '720p',
        container: 'mp4',
        duration: 10,
        targetSizeMB: options.sizeMB || 10,
      });

      // Remove last 1KB
      const data = fs.readFileSync(tempPath);
      fs.writeFileSync(outputPath, data.subarray(0, data.length - 1024));
      fs.unlinkSync(tempPath);
      break;
    }
  }

  logger.log(`Generated corrupted video: ${options.filename}`);
  return outputPath;
}

/**
 * Generate TV series episodes
 */
export async function generateSeriesEpisodes(
  seriesName: string,
  season: number,
  episodeCount: number,
  options: Partial<VideoOptions> = {}
): Promise<string[]> {
  const episodes: string[] = [];

  for (let ep = 1; ep <= episodeCount; ep++) {
    const filename = `${seriesName}.S${season.toString().padStart(2, '0')}E${ep.toString().padStart(2, '0')}.${options.container || 'mkv'}`;

    const episodePath = await generateVideo({
      filename,
      codec: options.codec || 'h264',
      resolution: options.resolution || '1080p',
      container: options.container || 'mkv',
      duration: options.duration || 30,
      targetSizeMB: options.targetSizeMB || 100,
      audio: options.audio || 'aac',
      subtitles: options.subtitles ?? true,
    });

    episodes.push(episodePath);
  }

  logger.log(`Generated ${episodeCount} episodes for ${seriesName} S${season}`);
  return episodes;
}

/**
 * Cleanup all generated fixtures
 */
export function cleanupFixtures(): void {
  const fixturesDir = getFixturesDir();

  if (!fs.existsSync(fixturesDir)) {
    return;
  }

  const files = fs.readdirSync(fixturesDir);
  for (const file of files) {
    const filePath = path.join(fixturesDir, file);
    try {
      fs.unlinkSync(filePath);
    } catch (err: unknown) {
      logger.warn(`Failed to delete ${file}: ${err}`);
    }
  }

  try {
    fs.rmdirSync(fixturesDir);
    logger.log(`Cleaned up fixtures directory: ${fixturesDir}`);
  } catch (err: unknown) {
    logger.warn(`Failed to remove fixtures directory: ${err}`);
  }
}

/**
 * Get realistic movie/series/anime filenames for testing
 */
export const REALISTIC_FILENAMES = {
  movies: [
    'The.Matrix.1999.1080p.BluRay.x264.mkv',
    'Inception.2010.2160p.UHD.BluRay.x265.HEVC.mkv',
    'Interstellar.2014.1080p.BluRay.DTS.x264.mkv',
    'Blade.Runner.2049.2017.4K.UHD.BluRay.HEVC.mkv',
  ],
  series: [
    'Breaking.Bad.S05E16.Felina.1080p.BluRay.x264.mkv',
    'The.Mandalorian.S02E08.1080p.WEB-DL.H264.mkv',
    'Stranger.Things.S04E09.2160p.NF.WEB-DL.x265.10bit.HDR.mkv',
  ],
  anime: [
    '[SubsPlease] Attack on Titan - 87 (1080p) [A1B2C3D4].mkv',
    '[Erai-raws] Demon Slayer - 26 [1080p][Multiple Subtitle].mkv',
    'Your Name (2016) [1080p] [BluRay] [5.1] [YTS].mkv',
  ],
};

/**
 * Verify video file with FFprobe
 */
export async function verifyVideoFile(filePath: string): Promise<{
  isValid: boolean;
  codec?: string;
  resolution?: string;
  duration?: number;
}> {
  return new Promise((resolve) => {
    const ffprobe = spawn('ffprobe', [
      '-v',
      'error',
      '-select_streams',
      'v:0',
      '-show_entries',
      'stream=codec_name,width,height',
      '-show_entries',
      'format=duration',
      '-of',
      'json',
      filePath,
    ]);

    let output = '';

    ffprobe.stdout?.on('data', (data) => {
      output += data.toString();
    });

    ffprobe.on('close', (code) => {
      if (code !== 0) {
        resolve({ isValid: false });
        return;
      }

      try {
        const data = JSON.parse(output);
        const stream = data.streams?.[0];
        const format = data.format;

        if (!stream || !format) {
          resolve({ isValid: false });
          return;
        }

        resolve({
          isValid: true,
          codec: stream.codec_name,
          resolution: `${stream.width}x${stream.height}`,
          duration: parseFloat(format.duration),
        });
      } catch (_err: unknown) {
        resolve({ isValid: false });
      }
    });

    ffprobe.on('error', () => {
      resolve({ isValid: false });
    });
  });
}
