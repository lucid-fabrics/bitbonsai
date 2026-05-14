import { Injectable, Logger } from '@nestjs/common';
import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import * as path from 'path';
import { NodeConfigService } from '../../core/services/node-config.service';
import { PrismaService } from '../../prisma/prisma.service';

export interface SegmentDescriptor {
  index: number;
  startSeconds: number;
  endSeconds: number;
  durationSeconds: number;
  tempPath: string;
}

export interface SegmentPlan {
  segments: SegmentDescriptor[];
  segmentsDir: string;
  concatListPath: string;
  totalSegments: number;
}

@Injectable()
export class SegmentedEncodeService {
  private readonly logger = new Logger(SegmentedEncodeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly nodeConfig: NodeConfigService
  ) {}

  // Gate: should this job use segmented encoding?
  shouldUseSegmentedEncode(
    sourceDurationSeconds: number,
    segmentedEncodeEnabled: boolean,
    thresholdMinutes: number
  ): boolean {
    if (!segmentedEncodeEnabled) return false;
    return sourceDurationSeconds >= thresholdMinutes * 60;
  }

  // Build segment plan from source duration
  planSegments(
    jobId: string,
    sourceDurationSeconds: number,
    segmentsDir: string,
    segmentDurationSecs: number
  ): SegmentPlan {
    const segments: SegmentDescriptor[] = [];
    let start = 0;
    let index = 0;
    const ext = 'mkv'; // always segment to mkv for compatibility

    while (start < sourceDurationSeconds) {
      const end = Math.min(start + segmentDurationSecs, sourceDurationSeconds);
      const duration = end - start;
      segments.push({
        index,
        startSeconds: start,
        endSeconds: end,
        durationSeconds: duration,
        tempPath: path.join(segmentsDir, `seg_${String(index).padStart(4, '0')}.${ext}`),
      });
      start = end;
      index++;
    }

    const concatListPath = path.join(segmentsDir, 'concat.txt');
    return { segments, segmentsDir, concatListPath, totalSegments: segments.length };
  }

  // Persist segment plan to DB
  async persistSegmentPlan(jobId: string, plan: SegmentPlan): Promise<void> {
    const nodeId = this.nodeConfig.getNodeId() ?? 'unknown';
    await this.prisma.$transaction(
      plan.segments.map((seg) =>
        this.prisma.jobSegment.create({
          data: {
            jobId,
            segmentIndex: seg.index,
            startSeconds: seg.startSeconds,
            endSeconds: seg.endSeconds,
            durationSeconds: seg.durationSeconds,
            tempPath: seg.tempPath,
            nodeId,
          },
        })
      )
    );
  }

  // Find the last successfully verified segment index; returns -1 if none complete
  async findResumePoint(
    jobId: string
  ): Promise<{ lastVerifiedIndex: number; partialSegmentIndex: number | null }> {
    const segments = await this.prisma.jobSegment.findMany({
      where: { jobId },
      orderBy: { segmentIndex: 'asc' },
      select: { segmentIndex: true, completedAt: true, verifiedAt: true, tempPath: true },
    });

    let lastVerifiedIndex = -1;
    let partialSegmentIndex: number | null = null;

    for (const seg of segments) {
      if (seg.verifiedAt) {
        lastVerifiedIndex = seg.segmentIndex;
      } else if (seg.completedAt && !seg.verifiedAt) {
        partialSegmentIndex = seg.segmentIndex;
      }
    }

    return { lastVerifiedIndex, partialSegmentIndex };
  }

  // Reset a partial segment (completed but not verified) — delete file + reset DB row
  async resetPartialSegment(jobId: string, segmentIndex: number, tempPath: string): Promise<void> {
    await fs.unlink(tempPath).catch(() => {}); // best-effort delete
    await this.prisma.jobSegment.update({
      where: { jobId_segmentIndex: { jobId, segmentIndex } },
      data: { completedAt: null, verifiedAt: null, durationVerified: null, sizeBytes: null },
    });
    this.logger.warn(`Reset partial segment ${segmentIndex} for job ${jobId}`);
  }

  // Mark a segment as completed (post-encode, pre-verify)
  async markSegmentCompleted(jobId: string, segmentIndex: number): Promise<void> {
    await this.prisma.jobSegment.update({
      where: { jobId_segmentIndex: { jobId, segmentIndex } },
      data: { completedAt: new Date() },
    });
  }

  // Verify segment duration via ffprobe; returns actual duration
  async verifySegment(segmentPath: string, expectedDuration: number): Promise<number> {
    return new Promise((resolve, reject) => {
      const args = [
        '-v',
        'error',
        '-show_entries',
        'format=duration',
        '-of',
        'csv=p=0',
        segmentPath,
      ];
      const proc = spawn('ffprobe', args);
      let stdout = '';
      proc.stdout.on('data', (d: Buffer) => {
        stdout += d.toString();
      });
      const timeout = setTimeout(() => {
        proc.kill('SIGKILL');
        reject(new Error('ffprobe timeout'));
      }, 15_000);
      proc.on('close', (code) => {
        clearTimeout(timeout);
        if (code !== 0) return reject(new Error(`ffprobe exited ${code} for ${segmentPath}`));
        const actual = parseFloat(stdout.trim());
        if (isNaN(actual))
          return reject(new Error(`ffprobe returned non-numeric duration for ${segmentPath}`));
        const diff = Math.abs(actual - expectedDuration);
        // Use a proportional tolerance (10% of segment, min 0.5s, max 2s) so that short
        // last-segments (< 4s) are not incorrectly rejected by the hard 2s threshold.
        const tolerance = Math.max(0.5, Math.min(2, expectedDuration * 0.1));
        if (diff > tolerance)
          return reject(
            new Error(
              `Segment duration mismatch: expected ${expectedDuration.toFixed(1)}s, got ${actual.toFixed(1)}s (diff ${diff.toFixed(1)}s, tolerance ${tolerance.toFixed(1)}s)`
            )
          );
        resolve(actual);
      });
      proc.on('error', reject);
    });
  }

  // Mark a segment as verified
  async markSegmentVerified(
    jobId: string,
    segmentIndex: number,
    actualDuration: number,
    tempPath: string
  ): Promise<void> {
    const stat = await fs.stat(tempPath).catch(() => null);
    await this.prisma.jobSegment.update({
      where: { jobId_segmentIndex: { jobId, segmentIndex } },
      data: {
        verifiedAt: new Date(),
        durationVerified: actualDuration,
        sizeBytes: stat ? BigInt(stat.size) : null,
      },
    });
  }

  // Write concat list file and run ffmpeg concat
  async concatSegments(
    concatListPath: string,
    segmentPaths: string[],
    outputPath: string,
    sourceFilePath: string
  ): Promise<void> {
    // Write concat list — FFmpeg concat demuxer parses the file directly (not via shell),
    // so use backslash-escaping rather than shell-style quoting.
    const listContent = segmentPaths
      .map((p) => {
        const escaped = p.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
        return `file '${escaped}'`;
      })
      .join('\n');
    await fs.writeFile(concatListPath, listContent, 'utf8');

    return new Promise((resolve, reject) => {
      // Include source file for chapter re-injection (-map_chapters 0 from source, -map 1 from concat)
      const args = [
        '-y',
        '-i',
        sourceFilePath, // input 0: source (for chapters)
        '-f',
        'concat',
        '-safe',
        '0',
        '-i',
        concatListPath, // input 1: concat list
        '-map_chapters',
        '0', // chapters from source
        '-map',
        '1', // streams from concat
        '-c',
        'copy',
        '-movflags',
        '+faststart',
        outputPath,
      ];
      this.logger.log(`Concatenating ${segmentPaths.length} segments → ${outputPath}`);
      const proc = spawn('ffmpeg', args);
      let stderr = '';
      proc.stderr.on('data', (d: Buffer) => {
        stderr += d.toString();
      });
      const timeout = setTimeout(() => {
        proc.kill('SIGKILL');
        reject(new Error('ffmpeg concat timed out'));
      }, 300_000); // 5min
      proc.on('close', (code) => {
        clearTimeout(timeout);
        if (code !== 0)
          return reject(new Error(`ffmpeg concat failed (exit ${code}): ${stderr.slice(-500)}`));
        resolve();
      });
      proc.on('error', reject);
    });
  }

  // Remove all segment files and directory
  async cleanupSegments(jobId: string, segmentsDir: string): Promise<void> {
    const segments = await this.prisma.jobSegment.findMany({
      where: { jobId },
      select: { tempPath: true },
    });
    if (segments.length === 0) return;
    for (const seg of segments) {
      await fs.unlink(seg.tempPath).catch(() => {});
    }
    await fs.rmdir(segmentsDir).catch(() => {});
    this.logger.log(`Cleaned up segments for job ${jobId}`);
  }

  // Get all segments for a job in order
  async getSegments(jobId: string): Promise<SegmentDescriptor[]> {
    const rows = await this.prisma.jobSegment.findMany({
      where: { jobId },
      orderBy: { segmentIndex: 'asc' },
    });
    return rows.map((r) => ({
      index: r.segmentIndex,
      startSeconds: r.startSeconds,
      endSeconds: r.endSeconds,
      durationSeconds: r.durationSeconds,
      tempPath: r.tempPath,
    }));
  }
}
