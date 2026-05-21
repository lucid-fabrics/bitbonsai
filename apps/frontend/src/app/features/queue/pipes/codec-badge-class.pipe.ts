import { Pipe, PipeTransform } from '@angular/core';

/**
 * PERFORMANCE: Pure pipe for codec badge CSS class
 * Replaces function call in template to prevent unnecessary re-executions
 * Pure pipes only execute when input reference changes
 */
@Pipe({
  name: 'codecBadgeClass',
  standalone: true,
  pure: true, // CRITICAL: Pure pipe for performance
})
export class CodecBadgeClassPipe implements PipeTransform {
  transform(codec: string | undefined): string {
    if (!codec) return 'codec-unknown';
    const codecLower = codec.toLowerCase();
    if (codecLower.includes('hevc') || codecLower.includes('h.265')) return 'codec-hevc';
    if (codecLower.includes('av1')) return 'codec-av1';
    if (codecLower.includes('h.264') || codecLower.includes('avc')) return 'codec-h264';
    if (codecLower.includes('vp9')) return 'codec-vp9';
    return 'codec-other';
  }
}
