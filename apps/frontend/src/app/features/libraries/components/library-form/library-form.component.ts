import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  type ElementRef,
  inject,
  input,
  type OnDestroy,
  type OnInit,
  output,
  viewChild,
} from '@angular/core';
import {
  FormBuilder,
  type FormControl,
  type FormGroup,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { PathSelectorComponent } from '@bitbonsai/shared-ui';
import { environment } from '../../../../../environments/environment';
import type { Node } from '../../../nodes/models/node.model';
import type { CreateLibraryDto, Library, UpdateLibraryDto } from '../../models/library.model';
import { MediaType } from '../../models/library.model';

interface LibraryFormControls {
  name: FormControl<string>;
  path: FormControl<string>;
  mediaType: FormControl<MediaType>;
  enabled: FormControl<boolean>;
  watchEnabled: FormControl<boolean>;
}

@Component({
  selector: 'app-library-form',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, PathSelectorComponent],
  templateUrl: './library-form.component.html',
  styleUrls: ['./library-form.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LibraryFormComponent implements OnInit, OnDestroy {
  private readonly fb = inject(FormBuilder);

  readonly library = input<Library>();
  readonly nodes = input<Node[]>([]);
  readonly formSubmit = output<CreateLibraryDto | UpdateLibraryDto>();
  readonly formCancel = output<void>();

  readonly pathWrapper = viewChild<ElementRef>('pathWrapper');

  libraryForm!: FormGroup<LibraryFormControls>;
  mediaTypes = Object.values(MediaType);
  isEditMode = false;
  showFolderBrowser = false;
  apiUrl = environment.apiUrl;

  private clickListener?: (event: MouseEvent) => void;

  ngOnInit(): void {
    const lib = this.library();
    this.isEditMode = !!lib;
    this.initializeForm();
    this.setupClickOutsideListener();
  }

  ngOnDestroy(): void {
    if (this.clickListener) {
      document.removeEventListener('click', this.clickListener, true);
    }
  }

  private setupClickOutsideListener(): void {
    this.clickListener = (event: MouseEvent) => {
      const wrapper = this.pathWrapper()?.nativeElement;
      if (
        wrapper &&
        event.target &&
        !wrapper.contains(event.target as globalThis.Node) &&
        this.showFolderBrowser
      ) {
        this.showFolderBrowser = false;
      }
    };
    // Use capture phase to ensure we get the event before any stopPropagation
    document.addEventListener('click', this.clickListener, true);
  }

  onWrapperClick(event: Event): void {
    // Stop propagation to prevent document click listener from firing
    event.stopPropagation();
  }

  private initializeForm(): void {
    const lib = this.library();
    this.libraryForm = this.fb.group<LibraryFormControls>({
      name: this.fb.control(lib?.name || '', {
        validators: [Validators.required, Validators.maxLength(255)],
        nonNullable: true,
      }),
      path: this.fb.control(lib?.path || '', {
        validators: [Validators.required, Validators.pattern(/^\/.*/)],
        nonNullable: true,
      }),
      mediaType: this.fb.control(lib?.mediaType || MediaType.MOVIE, {
        validators: [Validators.required],
        nonNullable: true,
      }),
      enabled: this.fb.control(lib?.enabled ?? true, { nonNullable: true }),
      watchEnabled: this.fb.control(lib?.watchEnabled ?? false, { nonNullable: true }),
    });
  }

  onSubmit(): void {
    if (this.libraryForm.valid) {
      const formValue = this.libraryForm.getRawValue();
      const lib = this.library();

      if (this.isEditMode && lib) {
        // For updates, only send changed fields
        const updates: UpdateLibraryDto = {};
        if (formValue.name !== lib.name) updates.name = formValue.name;
        if (formValue.path !== lib.path) updates.path = formValue.path;
        if (formValue.mediaType !== lib.mediaType) updates.mediaType = formValue.mediaType;
        if (formValue.enabled !== lib.enabled) updates.enabled = formValue.enabled;
        if (formValue.watchEnabled !== lib.watchEnabled)
          updates.watchEnabled = formValue.watchEnabled;

        this.formSubmit.emit(updates);
      } else {
        // For creation, send all required fields
        const createDto: CreateLibraryDto = {
          name: formValue.name,
          path: formValue.path,
          mediaType: formValue.mediaType,
        };
        this.formSubmit.emit(createDto);
      }
    }
  }

  onCancel(): void {
    this.formCancel.emit();
  }

  get nameControl() {
    return this.libraryForm.get('name');
  }

  get pathControl() {
    return this.libraryForm.get('path');
  }

  get mediaTypeControl() {
    return this.libraryForm.get('mediaType');
  }

  get enabledControl() {
    return this.libraryForm.get('enabled');
  }

  get watchEnabledControl() {
    return this.libraryForm.get('watchEnabled');
  }

  onPathFocus(): void {
    const currentPath = this.libraryForm.get('path')?.value || '/';
    if (currentPath.startsWith('/')) {
      this.showFolderBrowser = true;
    }
  }

  onPathInput(event: Event): void {
    const input = event.target as HTMLInputElement;
    const path = input.value;
    if (path.startsWith('/') && path.length > 0) {
      this.showFolderBrowser = true;
    }
  }

  onFolderSelected(path: string): void {
    this.libraryForm.patchValue({ path });
    // Keep dropdown open for further navigation
  }

  closeFolderBrowser(): void {
    this.showFolderBrowser = false;
  }
}
