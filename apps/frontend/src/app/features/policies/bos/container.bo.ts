/**
 * Business Object for container format utilities
 * Following SRP: Separates container format logic from components
 */

export interface ContainerFormat {
  value: string | null;
  label: string;
  description: string;
  icon: string;
  extension: string;
}

export class ContainerBo {
  /**
   * Supported container formats with metadata
   */
  static readonly FORMATS: readonly ContainerFormat[] = [
    {
      value: 'mkv',
      label: 'MKV',
      description: 'Matroska - Universal compatibility, supports all codecs and features',
      icon: 'videocam',
      extension: '.mkv',
    },
    {
      value: 'mp4',
      label: 'MP4',
      description: 'MPEG-4 - Streaming optimized, best for web and mobile devices',
      icon: 'play-circle',
      extension: '.mp4',
    },
    {
      value: 'webm',
      label: 'WebM',
      description: 'WebM - Web optimized, open format for HTML5 video',
      icon: 'globe',
      extension: '.webm',
    },
    {
      value: null,
      label: 'Keep Original',
      description: "Preserve the source file's original container format",
      icon: 'lock-closed',
      extension: '',
    },
  ] as const;

  /**
   * Get format by value
   */
  static getFormat(value: string | null): ContainerFormat | undefined {
    return ContainerBo.FORMATS.find((format) => format.value === value);
  }

  /**
   * Get format label
   */
  static getLabel(value: string | null): string {
    return ContainerBo.getFormat(value)?.label ?? 'Unknown';
  }

  /**
   * Get format description
   */
  static getDescription(value: string | null): string {
    return ContainerBo.getFormat(value)?.description ?? '';
  }

  /**
   * Get format icon
   */
  static getIcon(value: string | null): string {
    return ContainerBo.getFormat(value)?.icon ?? 'help-circle';
  }

  /**
   * Check if format is valid
   */
  static isValid(value: string | null): boolean {
    return ContainerBo.FORMATS.some((format) => format.value === value);
  }

  /**
   * Get all format values for validation
   */
  static getValidValues(): Array<string | null> {
    return ContainerBo.FORMATS.map((format) => format.value);
  }

  /**
   * Get format for UI dropdown display
   */
  static getFormatOptions(): Array<{ value: string | null; label: string; description: string }> {
    return ContainerBo.FORMATS.map((format) => ({
      value: format.value,
      label: format.label,
      description: format.description,
    }));
  }

  /**
   * Determine if container change is needed
   */
  static needsContainerChange(
    sourceContainer: string | null,
    targetContainer: string | null
  ): boolean {
    // If target is null (keep original), no change needed
    if (targetContainer === null) {
      return false;
    }

    // Normalize container names (mkv = matroska)
    const normalizedSource = ContainerBo.normalizeContainer(sourceContainer);
    const normalizedTarget = ContainerBo.normalizeContainer(targetContainer);

    return normalizedSource !== normalizedTarget;
  }

  /**
   * Normalize container name for comparison
   */
  private static normalizeContainer(container: string | null): string | null {
    if (!container) return null;

    const normalized = container.toLowerCase().trim();

    // Map matroska to mkv for consistency
    if (normalized === 'matroska') return 'mkv';

    return normalized;
  }

  /**
   * Get human-readable remux explanation
   */
  static getRemuxExplanation(
    sourceCodec: string,
    targetCodec: string,
    sourceContainer: string | null,
    targetContainer: string | null
  ): string {
    const codecMatch = sourceCodec.toLowerCase() === targetCodec.toLowerCase();
    const containerChange = ContainerBo.needsContainerChange(sourceContainer, targetContainer);

    if (codecMatch && containerChange) {
      const sourceLabel = ContainerBo.getLabel(sourceContainer);
      const targetLabel = ContainerBo.getLabel(targetContainer);
      return `Fast remux: ${sourceLabel} → ${targetLabel} (seconds, no re-encoding)`;
    }

    if (codecMatch && !containerChange) {
      return 'File already matches target - will be skipped';
    }

    return `Full transcode: ${sourceCodec} → ${targetCodec} (hours, quality settings apply)`;
  }
}
