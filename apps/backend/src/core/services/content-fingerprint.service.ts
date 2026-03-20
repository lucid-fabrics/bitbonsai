import { open, stat } from 'node:fs/promises';
import { Injectable, Logger } from '@nestjs/common';

/**
 * ContentFingerprintService
 *
 * Generates content-based fingerprints for video files using xxHash.
 * Survives file renames/moves - same content always produces same hash.
 *
 * Algorithm:
 * - Files >= 100KB: Read 4KB at 10 evenly-spaced positions (40KB total I/O)
 * - Files < 100KB: Hash entire content
 * - Uses xxHash64 (WASM, no native deps) for speed
 *
 * This enables:
 * - Detecting renamed files that were already encoded (skip re-encoding)
 * - Cross-path blacklisting (renamed file that repeatedly fails stays blacklisted)
 */
@Injectable()
export class ContentFingerprintService {
  private readonly logger = new Logger(ContentFingerprintService.name);

  private readonly SAMPLE_COUNT = 10;
  private readonly SAMPLE_SIZE = 4096; // 4KB per sample
  private readonly SMALL_FILE_THRESHOLD = 100 * 1024; // 100KB

  private xxhash: { h64Raw(input: Uint8Array, seed?: bigint): bigint } | null = null;

  private async getHasher() {
    if (!this.xxhash) {
      const xxhashWasm = await import('xxhash-wasm');
      const hasher = await (xxhashWasm.default as () => Promise<typeof this.xxhash>)();
      this.xxhash = hasher;
    }
    return this.xxhash!;
  }

  /**
   * Compute a content fingerprint for a file.
   * Returns null if file is inaccessible.
   */
  async computeFingerprint(filePath: string): Promise<string | null> {
    try {
      const fileStats = await stat(filePath);
      const fileSize = fileStats.size;

      if (fileSize === 0) {
        return null;
      }

      const hasher = await this.getHasher();
      let data: Buffer;

      if (fileSize < this.SMALL_FILE_THRESHOLD) {
        // Small file: read entirely
        const fh = await open(filePath, 'r');
        try {
          data = Buffer.alloc(fileSize);
          await fh.read(data, 0, fileSize, 0);
        } finally {
          await fh.close();
        }
      } else {
        // Large file: sample at evenly-spaced positions
        const fh = await open(filePath, 'r');
        try {
          const buffers: Buffer[] = [];

          for (let i = 0; i < this.SAMPLE_COUNT; i++) {
            const position = Math.floor((fileSize / this.SAMPLE_COUNT) * i);
            const readSize = Math.min(this.SAMPLE_SIZE, fileSize - position);
            const buf = Buffer.alloc(readSize);
            await fh.read(buf, 0, readSize, position);
            buffers.push(buf);
          }

          data = Buffer.concat(buffers);
        } finally {
          await fh.close();
        }
      }

      // Include file size in the hash to reduce collisions
      const sizeBuffer = Buffer.alloc(8);
      sizeBuffer.writeBigInt64LE(BigInt(fileSize));
      const combined = Buffer.concat([sizeBuffer, data]);

      const hash = hasher.h64Raw(new Uint8Array(combined));
      return hash.toString(16).padStart(16, '0');
    } catch (error: unknown) {
      this.logger.warn(
        `Failed to fingerprint ${filePath}: ${error instanceof Error ? error.message : String(error)}`
      );
      return null;
    }
  }
}
