import { Component, ChangeDetectionStrategy, inject, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Store } from '@ngrx/store';
import { FontAwesomeModule } from '@fortawesome/angular-fontawesome';
import { MediaStatsActions } from './+state/dashboard.actions';
import { MediaStatsSelectors } from './+state/dashboard.selectors';
import { FilesDialogComponent } from './files-dialog/files-dialog.component';
import { MediaStatsApiService } from '../../core/services/media-stats-api.service';
import { FileInfoBo } from '../../core/business-objects/file-info.bo';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, FontAwesomeModule, FilesDialogComponent],
  templateUrl: './dashboard.component.html',
  styleUrls: ['./dashboard.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class DashboardComponent implements OnInit {
  private readonly store = inject(Store);
  private readonly mediaStatsApi = inject(MediaStatsApiService);

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

  viewFilesToEncode(folder: any): void {
    this.dialogFolderName.set(folder.name);
    this.dialogCodec.set('h264');
    this.dialogLoading.set(true);
    this.dialogOpen.set(true);

    this.mediaStatsApi.getFolderFiles(folder.name, 'h264').subscribe({
      next: (response) => {
        const files = response.files.map(f => new FileInfoBo(f));
        this.dialogFiles.set(files);
        this.dialogLoading.set(false);
      },
      error: (error) => {
        console.error('Failed to load files:', error);
        this.dialogLoading.set(false);
        this.dialogOpen.set(false);
      }
    });
  }

  closeDialog(): void {
    this.dialogOpen.set(false);
    this.dialogFiles.set([]);
  }
}
