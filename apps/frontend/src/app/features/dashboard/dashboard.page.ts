import { AsyncPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, inject, type OnInit } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FontAwesomeModule } from '@fortawesome/angular-fontawesome';
import { TranslocoModule } from '@ngneat/transloco';
import { Store } from '@ngrx/store';
import { MediaStatsClient } from '../../core/clients/media-stats.client';
import { RichTooltipDirective } from '../../shared/directives/rich-tooltip.directive';
import { MediaStatsActions } from './+state/dashboard.actions';
import { MediaStatsSelectors } from './+state/dashboard.selectors';
import { FileInfoBo } from './bos/file-info.bo';
import { FilesDialogComponent } from './modals/files-dialog/files-dialog.modal';

interface FolderInfo {
  name: string;
}

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [
    AsyncPipe,
    FontAwesomeModule,
    TranslocoModule,
    FilesDialogComponent,
    RichTooltipDirective,
  ],
  templateUrl: './dashboard.page.html',
  styleUrls: ['./dashboard.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DashboardComponent implements OnInit {
  private readonly store = inject(Store);
  private readonly mediaStatsApi = inject(MediaStatsClient);
  private readonly destroyRef = inject(DestroyRef);

  readonly stats$ = this.store.select(MediaStatsSelectors.selectMediaStats);
  readonly isLoading$ = this.store.select(MediaStatsSelectors.selectIsLoading);
  readonly error$ = this.store.select(MediaStatsSelectors.selectError);

  // Dialog state
  dialogOpen = false;
  dialogFolderName = '';
  dialogCodec = '';
  dialogFiles: FileInfoBo[] = [];
  dialogLoading = false;

  ngOnInit(): void {
    this.store.dispatch(MediaStatsActions.loadMediaStats());
  }

  triggerScan(): void {
    this.store.dispatch(MediaStatsActions.triggerScan());
  }

  viewFilesToEncode(folder: FolderInfo): void {
    this.dialogFolderName = folder.name;
    this.dialogCodec = 'h264';
    this.dialogLoading = true;
    this.dialogOpen = true;

    this.mediaStatsApi
      .getFolderFiles(folder.name, 'h264')
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => {
          const files = response.files.map((f) => new FileInfoBo(f));
          this.dialogFiles = files;
          this.dialogLoading = false;
        },
        error: () => {
          this.dialogLoading = false;
          this.dialogOpen = false;
        },
      });
  }

  closeDialog(): void {
    this.dialogOpen = false;
    this.dialogFiles = [];
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
