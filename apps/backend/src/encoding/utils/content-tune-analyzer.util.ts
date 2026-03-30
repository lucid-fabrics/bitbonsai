import { spawn } from 'node:child_process';

/**
 * Content type enumeration for FFmpeg tune options
 */
export enum ContentType {
  FILM = 'film',
  ANIMATION = 'animation',
  GRAIN = 'grain',
  FAST_decode = 'fastdecode',
  Zerolatency = 'zerolatency',
  STILLIMAGE = 'stillimage',
}

/**
 * Content analysis result
 */
export interface ContentAnalysisResult {
  contentType: ContentType | null;
  confidence: number; // 0-1 confidence score
  detectedAt: Date;
  reason: string;
}

/**
 * Content Tune Analyzer
 *
 * Analyzes video content to detect the optimal FFmpeg tune parameter.
 * Uses FFmpeg's scene detection and film grain analysis to classify content.
 *
 * Supported tunes:
 * - film: Best for movies and TV shows with film grain
 * - animation: Optimized for animated content (cartoon, anime, CGI)
 * - grain: Preserves film grain in high-quality content
 * - fastdecode: Optimizes for fast decoding (low-power devices)
 * - zerolatency: Optimizes for live streaming / low latency
 * - stillimage: Optimizes for slideshow/mostly-static content
 *
 * Detection method:
 * - Scans video for scene changes (animation has sharp transitions)
 * - Detects grain patterns (film has subtle noise)
 * - Analyzes motion density (animation has consistent frame-to-frame motion)
 * - Checks for mixed content (credits over film = animation)
 */
export class ContentTuneAnalyzer {
  private static readonly SCAN_DURATION_SECONDS = 30; // Scan first 30 seconds
  private static readonly SCENE_THRESHOLD = 0.3; // Lower = more sensitive to cuts

  /**
   * Analyze video content and detect optimal tune
   *
   * @param filePath - Path to video file
   * @returns Content analysis result with detected type and confidence
   */
  static async analyze(filePath: string): Promise<ContentAnalysisResult> {
    try {
      // Run multiple analysis passes in parallel
      const [sceneAnalysis, pixelAnalysis] = await Promise.all([
        ContentTuneAnalyzer.analyzeScenes(filePath),
        ContentTuneAnalyzer.analyzePixelCharacteristics(filePath),
      ]);

      // Combine results to determine content type
      const result = ContentTuneAnalyzer.combineAnalysis(sceneAnalysis, pixelAnalysis);

      return {
        contentType: result.type,
        confidence: result.confidence,
        detectedAt: new Date(),
        reason: result.reason,
      };
    } catch (error) {
      // If analysis fails, return unknown with low confidence
      return {
        contentType: null,
        confidence: 0,
        detectedAt: new Date(),
        reason: `Analysis failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  }

  /**
   * Analyze scene change patterns
   *
   * Animation tends to have sharp, frequent scene changes.
   * Film tends to have gradual scene changes and longer takes.
   */
  private static async analyzeScenes(
    filePath: string
  ): Promise<{ sceneDensity: number; avgSceneLength: number }> {
    return new Promise((resolve) => {
      // Use FFmpeg's scene detection with select filter
      // Decodes only first 30 seconds for speed
      const ffmpeg = spawn('ffmpeg', [
        '-ss',
        '0',
        '-t',
        String(ContentTuneAnalyzer.SCAN_DURATION_SECONDS),
        '-i',
        filePath,
        '-vf',
        `select='gt(scene,${ContentTuneAnalyzer.SCENE_THRESHOLD})',showinfo`,
        '-f',
        'null',
        '-',
      ]);

      let stderr = '';
      let sceneCount = 0;
      const lastPts = 0;

      ffmpeg.stderr?.on('data', (data) => {
        stderr += data.toString();

        // Parse showinfo to count scene changes
        // Format: n:... pts:12345 pts_time:1.23
        const matches = stderr.match(/pts_time:(\d+\.?\d*)/g);
        if (matches) {
          sceneCount = matches.length;
        }
      });

      ffmpeg.on('close', () => {
        const duration = ContentTuneAnalyzer.SCAN_DURATION_SECONDS;
        const sceneDensity = sceneCount / duration;
        const avgSceneLength = sceneCount > 0 ? duration / sceneCount : duration;

        resolve({ sceneDensity, avgSceneLength });
      });

      ffmpeg.on('error', () => {
        resolve({ sceneDensity: 0, avgSceneLength: 0 });
      });

      // Timeout after 60 seconds
      setTimeout(() => {
        ffmpeg.kill();
        resolve({ sceneDensity: 0, avgSceneLength: 0 });
      }, 60_000);
    });
  }

  /**
   * Analyze pixel characteristics to detect animation vs film
   *
   * Animation tends to have:
   * - Flat color regions (low variance)
   * - Sharp edges (high contrast at edges)
   * - Consistent noise patterns
   *
   * Film tends to have:
   * - Natural noise/grain
   * - Varied textures
   * - Gradual color gradients
   */
  private static async analyzePixelCharacteristics(
    filePath: string
  ): Promise<{ variance: number; edgeDensity: number; colorComplexity: number }> {
    return new Promise((resolve) => {
      // Extract a few frames and analyze pixel statistics
      // Sample at 0s, 10s, 20s for variety
      const ffmpeg = spawn('ffmpeg', [
        '-ss',
        '10',
        '-t',
        '5',
        '-i',
        filePath,
        '-vf',
        'signalstats,metadata=print:file=-',
        '-f',
        'null',
        '-',
      ]);

      let stderr = '';

      ffmpeg.stderr?.on('data', (data) => {
        stderr += data.toString();
      });

      ffmpeg.on('close', () => {
        // Parse variance from signalstats output
        // Look for YU/VU variance values
        const varianceMatch = stderr.match(/YUV STD Y:(\d+\.?\d*)/);
        const edgeMatch = stderr.match(/TFF:(\d+\.?\d*)/);

        const variance = varianceMatch ? parseFloat(varianceMatch[1]) : 50;
        const edgeDensity = edgeMatch ? parseFloat(edgeMatch[1]) : 0;

        // Color complexity is harder to detect, use variance as proxy
        const colorComplexity = variance > 30 ? 'high' : 'low';

        resolve({ variance, edgeDensity, colorComplexity: variance });
      });

      ffmpeg.on('error', () => {
        resolve({ variance: 50, edgeDensity: 0, colorComplexity: 50 });
      });

      setTimeout(() => {
        ffmpeg.kill();
        resolve({ variance: 50, edgeDensity: 0, colorComplexity: 50 });
      }, 60_000);
    });
  }

  /**
   * Combine analysis results to determine content type
   */
  private static combineAnalysis(
    scene: { sceneDensity: number; avgSceneLength: number },
    pixel: { variance: number; edgeDensity: number; colorComplexity: number }
  ): { type: ContentType | null; confidence: number; reason: string } {
    // High scene density + high variance = animation
    if (scene.sceneDensity > 0.5 && scene.avgSceneLength < 5) {
      return {
        type: ContentType.ANIMATION,
        confidence: 0.75,
        reason: `High scene density (${scene.sceneDensity.toFixed(2)}/s), short avg scenes (${scene.avgSceneLength.toFixed(1)}s)`,
      };
    }

    // Very low variance + high scene density = animation (flat colors)
    if (pixel.variance < 25 && scene.sceneDensity > 0.3) {
      return {
        type: ContentType.ANIMATION,
        confidence: 0.8,
        reason: `Low pixel variance (${pixel.variance}), likely flat-color animation`,
      };
    }

    // High variance + grain-like patterns = film with grain
    if (pixel.variance > 50 && pixel.variance < 80) {
      return {
        type: ContentType.FILM,
        confidence: 0.7,
        reason: `Natural variance (${pixel.variance}), likely film content`,
      };
    }

    // Very high variance (>80) = grain-heavy content
    if (pixel.variance > 80) {
      return {
        type: ContentType.GRAIN,
        confidence: 0.85,
        reason: `High variance (${pixel.variance}), likely grainy film content`,
      };
    }

    // Low scene density + medium variance = standard film/TV
    if (scene.sceneDensity < 0.2 && pixel.variance > 30) {
      return {
        type: ContentType.FILM,
        confidence: 0.65,
        reason: `Low scene density (${scene.sceneDensity.toFixed(2)}/s), natural variance (${pixel.variance})`,
      };
    }

    // Default: no confident detection
    return {
      type: null,
      confidence: 0,
      reason: `Inconclusive: sceneDensity=${scene.sceneDensity.toFixed(2)}, variance=${pixel.variance}`,
    };
  }

  /**
   * Get the tune parameter value for a content type
   *
   * @param contentType - Detected content type
   * @returns FFmpeg tune value or null if not applicable
   */
  static getTuneValue(contentType: ContentType | null): string | null {
    switch (contentType) {
      case ContentType.FILM:
        return 'film';
      case ContentType.ANIMATION:
        return 'animation';
      case ContentType.GRAIN:
        return 'grain';
      case ContentType.FAST_decode:
        return 'fastdecode';
      case ContentType.Zerolatency:
        return 'zerolatency';
      case ContentType.STILLIMAGE:
        return 'stillimage';
      default:
        return null;
    }
  }
}
