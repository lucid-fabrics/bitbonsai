import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject, type OnInit, signal } from '@angular/core';
import { FontAwesomeModule } from '@fortawesome/angular-fontawesome';
import { Store } from '@ngrx/store';
import { RichTooltipDirective } from '../../shared/directives/rich-tooltip.directive';
import { MediaStatsActions } from './+state/dashboard.actions';
import { MediaStatsSelectors } from './+state/dashboard.selectors';
import { FileInfoBo } from './bos/file-info.bo';
import { FilesDialogComponent } from './modals/files-dialog/files-dialog.modal';
import { MediaStatsClient } from './services/media-stats.client';

interface FolderInfo {
  name: string;
}

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, FontAwesomeModule, FilesDialogComponent, RichTooltipDirective],
  templateUrl: './dashboard.page.html',
  styleUrls: ['./dashboard.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DashboardComponent implements OnInit {
  private readonly store = inject(Store);
  private readonly mediaStatsApi = inject(MediaStatsClient);

  readonly stats$ = this.store.select(MediaStatsSelectors.selectMediaStats);
  readonly isLoading$ = this.store.select(MediaStatsSelectors.selectIsLoading);
  readonly error$ = this.store.select(MediaStatsSelectors.selectError);

  // Dialog state
  readonly dialogOpen = signal(false);
  readonly dialogFolderName = signal('');
  readonly dialogCodec = signal('');
  readonly dialogFiles = signal<FileInfoBo[]>([]);
  readonly dialogLoading = signal(false);

  ngOnInit(): void {
    this.store.dispatch(MediaStatsActions.loadMediaStats());
  }

  triggerScan(): void {
    this.store.dispatch(MediaStatsActions.triggerScan());
  }

  viewFilesToEncode(folder: FolderInfo): void {
    this.dialogFolderName.set(folder.name);
    this.dialogCodec.set('h264');
    this.dialogLoading.set(true);
    this.dialogOpen.set(true);

    this.mediaStatsApi.getFolderFiles(folder.name, 'h264').subscribe({
      next: (response) => {
        const files = response.files.map((f) => new FileInfoBo(f));
        this.dialogFiles.set(files);
        this.dialogLoading.set(false);
      },
      error: (error) => {
        console.error('Failed to load files:', error);
        this.dialogLoading.set(false);
        this.dialogOpen.set(false);
      },
    });
  }

  closeDialog(): void {
    this.dialogOpen.set(false);
    this.dialogFiles.set([]);
  }

  getBadgeExplanation(badgeText: string): string {
    switch (badgeText.toLowerCase()) {
      case 'complete':
        return 'All files in this library have been encoded to H.265. No further encoding needed.';
      case 'in progress':
        return 'Some files are encoded, but there are still H.264 files that can be optimized.';
      case 'not started':
        return 'No files have been encoded yet. This library is a good candidate for encoding.';
      default:
        return 'This badge shows the encoding status for this library.';
    }
  }
}
