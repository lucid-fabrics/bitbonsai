import { Component, inject, input, OnInit, output, signal } from '@angular/core';
import { DirectoryInfo, FileBrowserService } from '../../services/file-browser.service';

@Component({
  selector: 'app-path-selector',
  standalone: true,
  imports: [],
  templateUrl: './path-selector.component.html',
  styleUrls: ['./path-selector.component.scss'],
})
export class PathSelectorComponent implements OnInit {
  private readonly fileBrowser = inject(FileBrowserService);

  readonly apiUrl = input.required<string>();
  readonly pathSelected = output<string>();
  readonly closed = output<void>();

  currentPath = signal('/');
  parentPath = signal<string | null>(null);
  directories = signal<DirectoryInfo[]>([]);
  isLoading = signal(false);
  error = signal<string | null>(null);

  ngOnInit(): void {
    this.browse('/');
  }

  browse(path: string): void {
    this.isLoading.set(true);
    this.error.set(null);

    this.fileBrowser.browse(this.apiUrl(), path).subscribe({
      next: (result) => {
        this.currentPath.set(result.currentPath);
        this.parentPath.set(result.parentPath);
        this.directories.set(result.directories);
        this.isLoading.set(false);
      },
      error: (err) => {
        console.error('Failed to browse directory:', err);
        this.error.set('Failed to load directory contents');
        this.isLoading.set(false);
      },
    });
  }

  selectDirectory(dir: DirectoryInfo): void {
    if (dir.isAccessible) {
      this.browse(dir.path);
      this.pathSelected.emit(dir.path);
    }
  }

  goToParent(): void {
    const parent = this.parentPath();
    if (parent) {
      this.browse(parent);
      this.pathSelected.emit(parent);
    }
  }

  close(): void {
    this.closed.emit();
  }
}
