import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import type { MediaStatsModel } from '../models/media-stats.model';
import type { OverviewModel } from '../models/overview.model';

@Injectable({
  providedIn: 'root',
})
export class OverviewApiService {
  private readonly http = inject(HttpClient);
  private readonly apiUrl = '/api/v1/media-stats';

  /**
   * Get overview dashboard data
   * Since /api/v1/overview doesn't exist yet, we transform MediaStats data
   * into overview format with mock queue/activity data
   */
  getOverview(): Observable<OverviewModel> {
    return this.http
      .get<MediaStatsModel>(this.apiUrl)
      .pipe(map((stats) => this.transformToOverview(stats)));
  }

  private transformToOverview(stats: MediaStatsModel): OverviewModel {
    // Calculate mock metrics from real MediaStats data
    const totalFiles = stats.total_files;
    const hevcCount = stats.codec_distribution.hevc;
    const h264Count = stats.codec_distribution.h264;

    // Mock success rate based on HEVC adoption
    const successRate = totalFiles > 0 ? Math.round((hevcCount / totalFiles) * 100) : 0;

    // Mock storage saved (estimate based on folders)
    const totalSavedGB = stats.folders.reduce(
      (sum, folder) => sum + (folder.space_saved_estimate_gb || 0),
      0
    );

    return {
      system_health: {
        active_nodes: {
          current: 1, // Mock: single node active
          total: 1,
        },
        queue_status: {
          encoding_count: h264Count > 0 ? Math.min(5, h264Count) : 0, // Mock: encoding up to 5 files
        },
        storage_saved: {
          total_tb: Number((totalSavedGB / 1024).toFixed(2)),
        },
        success_rate: {
          percentage: successRate,
        },
      },
      queue_summary: {
        queued: h264Count > 10 ? h264Count - 5 : 0, // Mock: remaining H.264 files
        encoding: h264Count > 0 ? Math.min(5, h264Count) : 0,
        completed: hevcCount,
        failed: stats.codec_distribution.other, // Mock: other codecs as "failed"
      },
      recent_activity: this.generateMockActivity(stats),
      top_libraries: this.generateTopLibraries(stats),
      last_updated: stats.scan_timestamp,
    };
  }

  private generateMockActivity(stats: MediaStatsModel): OverviewModel['recent_activity'] {
    // Generate mock recent activity from folder stats
    return stats.folders.slice(0, 10).map((folder, index) => ({
      id: `activity-${index}`,
      file_name: `${folder.name}_sample_file_${index + 1}.mkv`,
      library: folder.name,
      codec_change: 'H.264 → H.265',
      savings_gb: Number((Math.random() * 5 + 1).toFixed(2)), // Random 1-6 GB saved
      duration_seconds: Math.floor(Math.random() * 300 + 60), // Random 1-6 minutes
      completed_at: new Date(Date.now() - index * 3600000).toISOString(), // Staggered hours
    }));
  }

  private generateTopLibraries(stats: MediaStatsModel): OverviewModel['top_libraries'] {
    return stats.folders
      .sort((a, b) => b.file_count - a.file_count)
      .slice(0, 5)
      .map((folder) => ({
        name: folder.name,
        job_count: folder.codec_distribution.hevc,
        total_savings_gb: Number((folder.space_saved_estimate_gb || 0).toFixed(2)),
      }));
  }
}
