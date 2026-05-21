import { Injectable } from '@angular/core';

@Injectable({
  providedIn: 'root',
})
export class QueueFormattingService {
  formatBytes(bytes: number): string {
    if (!bytes || Number.isNaN(bytes) || bytes < 0) return '0 B';
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${(bytes / k ** i).toFixed(2)} ${sizes[i]}`;
  }

  formatDate(dateString: string): string {
    return new Date(dateString).toLocaleString();
  }

  formatETA(etaSeconds: number | null | undefined): string {
    if (!etaSeconds || etaSeconds <= 0) return 'Calculating...';

    const hours = Math.floor(etaSeconds / 3600);
    const minutes = Math.floor((etaSeconds % 3600) / 60);
    const seconds = Math.floor(etaSeconds % 60);

    if (hours > 0) return `${hours}h ${minutes}m remaining`;
    if (minutes > 0) return `${minutes}m ${seconds}s remaining`;
    return `${seconds}s remaining`;
  }

  formatTimestamp(timestamp: string | null | undefined): string {
    if (!timestamp) return 'N/A';

    const date = new Date(timestamp);
    const now = new Date();
    const diffMins = Math.floor((now.getTime() - date.getTime()) / 60000);

    if (diffMins < 60) {
      if (diffMins < 1) return 'Just now';
      if (diffMins === 1) return '1 minute ago';
      return `${diffMins} minutes ago`;
    }

    const options: Intl.DateTimeFormatOptions = {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    };
    return date.toLocaleDateString('en-US', options);
  }

  formatRelativeTime(timestamp: string | null | undefined): string {
    if (!timestamp) return 'N/A';

    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffSecs = Math.floor(diffMs / 1000);
    const diffMins = Math.floor(diffSecs / 60);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffSecs < 60) return 'Just now';
    if (diffMins < 60) return diffMins === 1 ? '1 minute ago' : `${diffMins} minutes ago`;
    if (diffHours < 24) return diffHours === 1 ? '1 hour ago' : `${diffHours} hours ago`;
    if (diffDays < 30) return diffDays === 1 ? '1 day ago' : `${diffDays} days ago`;
    const diffMonths = Math.floor(diffDays / 30);
    if (diffMonths < 12) return diffMonths === 1 ? '1 month ago' : `${diffMonths} months ago`;
    const diffYears = Math.floor(diffMonths / 12);
    return diffYears === 1 ? '1 year ago' : `${diffYears} years ago`;
  }

  formatAbsoluteDateTime(timestamp: string | null | undefined): string {
    if (!timestamp) return '';

    const options: Intl.DateTimeFormatOptions = {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    };
    return new Date(timestamp).toLocaleDateString('en-US', options);
  }

  getElapsedTime(startedAt?: string): string {
    if (!startedAt) return '-';

    const elapsedSeconds = Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000);
    const hours = Math.floor(elapsedSeconds / 3600);
    const minutes = Math.floor((elapsedSeconds % 3600) / 60);
    const seconds = elapsedSeconds % 60;

    if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
    if (minutes > 0) return `${minutes}m ${seconds}s`;
    return `${seconds}s`;
  }

  getEncodingDuration(startedAt?: string, completedAt?: string): string {
    if (!startedAt || !completedAt) return '-';

    const durationSeconds = Math.floor(
      (new Date(completedAt).getTime() - new Date(startedAt).getTime()) / 1000
    );
    const hours = Math.floor(durationSeconds / 3600);
    const minutes = Math.floor((durationSeconds % 3600) / 60);
    const seconds = durationSeconds % 60;

    if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
    if (minutes > 0) return `${minutes}m ${seconds}s`;
    return `${seconds}s`;
  }

  calculateEncodingSpeed(job: {
    startedAt?: string;
    currentSize: number;
    originalSize: number;
  }): string {
    if (!job.startedAt || job.currentSize <= 0) return '-';

    const elapsedSeconds = (Date.now() - new Date(job.startedAt).getTime()) / 1000;
    if (elapsedSeconds <= 0) return '-';

    const bytesProcessed = job.originalSize - job.currentSize;
    return `${this.formatBytes(bytesProcessed / elapsedSeconds)}/s`;
  }
}
