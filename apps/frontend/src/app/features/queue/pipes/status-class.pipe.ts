import { Pipe, PipeTransform } from '@angular/core';
import { JobStatus } from '../models/job-status.enum';

/**
 * PERFORMANCE: Pure pipe for status badge CSS class
 * Replaces function call in template to prevent unnecessary re-executions
 * Pure pipes only execute when input reference changes
 */
@Pipe({
  name: 'statusClass',
  standalone: true,
  pure: true, // CRITICAL: Pure pipe for performance
})
export class StatusClassPipe implements PipeTransform {
  transform(status: JobStatus): string {
    return status ? `status-${status.toLowerCase()}` : 'status-unknown';
  }
}
