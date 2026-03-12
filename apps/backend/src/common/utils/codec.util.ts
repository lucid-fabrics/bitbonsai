/**
 * Shared codec normalization utility.
 *
 * Extracted from FfmpegService to break circular dependency
 * between QueueService and FfmpegService. Both services can
 * import this directly without going through each other.
 */

const CODEC_MAP: Record<string, string> = {
  // HEVC / H.265 variants
  hevc: 'hevc',
  h265: 'hevc',
  'h.265': 'hevc',
  hvc1: 'hevc',
  x265: 'hevc',
  // H.264 / AVC variants
  h264: 'h264',
  'h.264': 'h264',
  avc: 'h264',
  avc1: 'h264',
  x264: 'h264',
  // VP9 variants
  vp9: 'vp9',
  'vp 9': 'vp9',
  vp09: 'vp9',
  // AV1 variants
  av1: 'av1',
  av01: 'av1',
  // VP8
  vp8: 'vp8',
  vp08: 'vp8',
  // MPEG variants
  mpeg2: 'mpeg2',
  'mpeg-2': 'mpeg2',
  mpeg4: 'mpeg4',
  'mpeg-4': 'mpeg4',
};

/**
 * Normalize codec name to standard format.
 * Maps various codec names to standardized identifiers.
 */
export function normalizeCodec(codec: string): string {
  const normalized = codec.toLowerCase().trim();
  return CODEC_MAP[normalized] || normalized;
}
