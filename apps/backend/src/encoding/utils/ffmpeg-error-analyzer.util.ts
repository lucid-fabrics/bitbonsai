/**
 * FFmpeg Error Analyzer
 *
 * Provides human-readable explanations for FFmpeg failures with actionable recommendations.
 * Categorizes errors and helps users understand what went wrong and how to fix it.
 */

const MAX_RETRY_ATTEMPTS = 3;
const MIN_RETRIES_FOR_EARLY_FAILURE_CORRUPTION = 2;

export interface FFmpegErrorAnalysis {
  category: ErrorCategory;
  title: string;
  description: string;
  technicalDetails?: string;
  recommendations: string[];
  isRetriable: boolean;
  shouldBlacklist: boolean;
}

export enum ErrorCategory {
  SOURCE_CORRUPTED = 'SOURCE_CORRUPTED',
  SOURCE_MISSING = 'SOURCE_MISSING',
  INSUFFICIENT_RESOURCES = 'INSUFFICIENT_RESOURCES',
  CODEC_INCOMPATIBILITY = 'CODEC_INCOMPATIBILITY',
  PROCESS_INTERRUPTED = 'PROCESS_INTERRUPTED',
  UNKNOWN = 'UNKNOWN',
}

/**
 * Analyze FFmpeg error and provide human-readable explanation
 *
 * @param exitCode - FFmpeg exit code
 * @param stderr - FFmpeg stderr output
 * @param progress - Job progress when failure occurred (0-100)
 * @param retryCount - Number of times job has been retried
 * @returns Detailed error analysis with recommendations
 */
export function analyzeFfmpegError(
  exitCode: number,
  stderr: string,
  progress: number,
  retryCount: number
): FFmpegErrorAnalysis {
  const stderrLower = stderr.toLowerCase();

  // PATTERN 1: Source file corruption (most common with exit 255)
  if (isSourceCorrupted(exitCode, stderrLower, progress)) {
    return {
      category: ErrorCategory.SOURCE_CORRUPTED,
      title: '🔴 Source File is Corrupted',
      description:
        'The video file contains corrupted or invalid data that cannot be processed. FFmpeg encountered errors while trying to decode the video stream.',
      technicalDetails: extractCorruptionDetails(stderrLower),
      recommendations: [
        '❌ **Do Not Retry** - This file cannot be encoded in its current state',
        '📥 Re-download the source file from the original source',
        '💿 If from physical media, re-rip using a reliable tool',
        '🔍 Check the source file with: ffmpeg -v error -i file.mkv -f null -',
        '🗑️ Consider blacklisting this file to prevent further retry attempts',
      ],
      isRetriable: false,
      shouldBlacklist: retryCount >= MAX_RETRY_ATTEMPTS, // Blacklist after 3 attempts
    };
  }

  // PATTERN 2: File was deleted/moved
  if (stderrLower.includes('no such file') || stderrLower.includes('file not found')) {
    return {
      category: ErrorCategory.SOURCE_MISSING,
      title: '📁 Source File Not Found',
      description:
        'The source file was moved or deleted after the job was created. The file may have been manually moved, or the storage volume may have been unmounted.',
      technicalDetails: 'File does not exist at the expected path',
      recommendations: [
        '🔍 Check if the file exists at the original location',
        '💾 Verify storage volumes are mounted correctly',
        '♻️ Re-scan the library to update file locations',
        '❌ If file was intentionally deleted, remove this job',
      ],
      isRetriable: false,
      shouldBlacklist: true,
    };
  }

  // PATTERN 3: Insufficient resources (disk space, memory)
  if (
    stderrLower.includes('no space left') ||
    stderrLower.includes('cannot allocate memory') ||
    stderrLower.includes('out of memory')
  ) {
    return {
      category: ErrorCategory.INSUFFICIENT_RESOURCES,
      title: '💾 Insufficient System Resources',
      description:
        'The system ran out of disk space or memory while encoding. Large 4K HDR files require significant temporary storage space.',
      technicalDetails: extractResourceError(stderrLower),
      recommendations: [
        '🗑️ Free up disk space on the system drive',
        '💿 Ensure at least 20% free space for encoding overhead',
        '🔄 Retry the job after freeing up resources',
        '⚙️ Consider reducing concurrent workers in node settings',
      ],
      isRetriable: true,
      shouldBlacklist: false,
    };
  }

  // PATTERN 4: Process interrupted/killed (exit 255 without corruption)
  if (
    (exitCode === 255 || exitCode === -1) &&
    progress < 5 &&
    retryCount < MIN_RETRIES_FOR_EARLY_FAILURE_CORRUPTION
  ) {
    return {
      category: ErrorCategory.PROCESS_INTERRUPTED,
      title: '⚠️ Encoding Process Interrupted',
      description:
        'The encoding process was terminated unexpectedly shortly after starting. This could be due to system issues, resource constraints, or file access problems.',
      technicalDetails: `Exit code ${exitCode}, failed at ${progress.toFixed(2)}% progress`,
      recommendations: [
        '🔄 Retry the job (automatic retry will be attempted)',
        '🔍 Check system logs for out-of-memory or crash reports',
        '💾 Verify the storage volume is accessible',
        '⚙️ If repeated failures occur, check node health',
      ],
      isRetriable: true,
      shouldBlacklist: false,
    };
  }

  // PATTERN 5: Early failure with exit 255 after retries (likely corruption)
  if (
    (exitCode === 255 || exitCode === -1) &&
    progress < 5 &&
    retryCount >= MIN_RETRIES_FOR_EARLY_FAILURE_CORRUPTION
  ) {
    return {
      category: ErrorCategory.SOURCE_CORRUPTED,
      title: '🔴 Persistent Early Failure - Likely Corrupted',
      description:
        'This file consistently fails within the first few percent of encoding after multiple retry attempts. This pattern strongly indicates corrupted source data that was not detected during health check.',
      technicalDetails: `Failed at ${progress.toFixed(2)}% after ${retryCount} retries with exit code ${exitCode}`,
      recommendations: [
        '❌ **Stop Retrying** - File is likely corrupted',
        '📥 Re-download or re-rip the source file',
        '🗑️ Blacklist this file to prevent further attempts',
        '🔍 Use ffprobe to verify file integrity',
      ],
      isRetriable: false,
      shouldBlacklist: true,
    };
  }

  // PATTERN 6: Codec incompatibility
  if (
    (stderrLower.includes('encoder') && stderrLower.includes('not found')) ||
    stderrLower.includes('unknown encoder') ||
    stderrLower.includes('codec not supported')
  ) {
    return {
      category: ErrorCategory.CODEC_INCOMPATIBILITY,
      title: '🎬 Codec Not Supported',
      description:
        'The requested video or audio codec is not available or supported in this FFmpeg build.',
      technicalDetails: extractCodecError(stderrLower),
      recommendations: [
        '🔧 Check FFmpeg codec support: ffmpeg -codecs',
        '📦 Verify FFmpeg installation includes required codecs',
        '⚙️ Update encoding policy to use supported codecs',
        '🐛 Report this issue if it persists',
      ],
      isRetriable: false,
      shouldBlacklist: false,
    };
  }

  // PATTERN 7: Generic/Unknown error
  return {
    category: ErrorCategory.UNKNOWN,
    title: '❓ Encoding Failed',
    description:
      'The encoding process failed for an unknown reason. Review the technical details below for more information.',
    technicalDetails: extractLastErrors(stderr),
    recommendations: [
      '🔄 Retry the job to see if the issue is transient',
      '📋 Review the complete error log for more details',
      '🐛 If repeated failures occur, report this issue with the error log',
      '🔍 Check system resources and node health',
    ],
    isRetriable: retryCount < MAX_RETRY_ATTEMPTS,
    shouldBlacklist: false,
  };
}

/**
 * Check if error indicates source file corruption
 */
function isSourceCorrupted(exitCode: number, stderrLower: string, progress: number): boolean {
  // Exit code 255 with early failure (<5%) and corruption patterns
  if ((exitCode === 255 || exitCode === -1 || exitCode === 1) && progress < 5) {
    const corruptionPatterns = [
      'could not find ref with poc',
      'error submitting packet to decoder',
      'invalid data found',
      'corrupt decoded frame',
      'error while decoding',
      'missing reference picture',
      'illegal short term buffer',
      'moov atom not found',
      'invalid nal unit size',
    ];

    return corruptionPatterns.some((pattern) => stderrLower.includes(pattern));
  }

  return false;
}

/**
 * Extract corruption-specific details from stderr
 */
function extractCorruptionDetails(stderrLower: string): string {
  if (stderrLower.includes('could not find ref with poc')) {
    return 'HEVC Reference Frame Error: Video stream is missing required reference frames for decoding. This typically indicates corrupted I-frames or P-frames in the HEVC stream.';
  }
  if (stderrLower.includes('invalid data found')) {
    return 'Invalid Stream Data: The video container or codec stream contains malformed data that violates the format specification.';
  }
  if (stderrLower.includes('error while decoding')) {
    return "Decoder Error: FFmpeg's video decoder encountered corrupted frames that cannot be processed.";
  }
  if (stderrLower.includes('moov atom not found')) {
    return 'MP4 Container Corruption: The MP4 file is missing the required MOOV metadata atom, indicating incomplete or corrupted file.';
  }
  return 'Video stream contains corrupted data that prevents decoding';
}

/**
 * Extract resource error details from stderr
 */
function extractResourceError(stderrLower: string): string {
  if (stderrLower.includes('no space left')) {
    return 'Disk full: No space left on device for temporary encoding files';
  }
  if (stderrLower.includes('cannot allocate memory') || stderrLower.includes('out of memory')) {
    return 'Memory exhausted: System ran out of available RAM during encoding';
  }
  return 'System resource limitation reached';
}

/**
 * Extract codec error details from stderr
 */
function extractCodecError(stderrLower: string): string {
  const match = stderrLower.match(/encoder '([^']+)' not found/);
  if (match) {
    return `Encoder '${match[1]}' is not available in this FFmpeg build`;
  }
  return 'Requested codec not supported or available';
}

/**
 * Extract last error lines from stderr
 */
function extractLastErrors(stderr: string): string {
  const lines = stderr.trim().split('\n');
  const errorLines = lines.filter(
    (line) =>
      line.toLowerCase().includes('error') ||
      line.toLowerCase().includes('failed') ||
      line.toLowerCase().includes('invalid')
  );

  return errorLines.length > 0 ? errorLines.slice(-5).join('\n') : lines.slice(-10).join('\n');
}

/**
 * Format error analysis as human-readable string for database storage
 */
export function formatErrorForDisplay(analysis: FFmpegErrorAnalysis): string {
  const parts: string[] = [];

  parts.push(`${analysis.title}\n`);
  parts.push(`${analysis.description}\n`);

  if (analysis.technicalDetails) {
    parts.push(`\n**Technical Details:**\n${analysis.technicalDetails}\n`);
  }

  parts.push(`\n**Recommended Actions:**`);
  for (const recommendation of analysis.recommendations) {
    parts.push(`\n  ${recommendation}`);
  }

  return parts.join('');
}
