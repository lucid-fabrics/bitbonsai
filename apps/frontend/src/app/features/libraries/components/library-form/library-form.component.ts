import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  inject,
  input,
  type OnInit,
  output,
} from '@angular/core';
import {
  FormBuilder,
  type FormControl,
  type FormGroup,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import type { Node } from '../../../nodes/models/node.model';
import type { CreateLibraryDto, Library, UpdateLibraryDto } from '../../models/library.model';
import { MediaType } from '../../models/library.model';

interface LibraryFormControls {
  name: FormControl<string>;
  path: FormControl<string>;
  mediaType: FormControl<MediaType>;
  nodeId: FormControl<string>;
  enabled: FormControl<boolean>;
}

@Component({
  selector: 'app-library-form',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './library-form.component.html',
  styleUrls: ['./library-form.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LibraryFormComponent implements OnInit {
  private readonly fb = inject(FormBuilder);

  readonly library = input<Library>();
  readonly nodes = input<Node[]>([]);
  readonly formSubmit = output<CreateLibraryDto | UpdateLibraryDto>();
  readonly formCancel = output<void>();

  libraryForm!: FormGroup<LibraryFormControls>;
  mediaTypes = Object.values(MediaType);
  isEditMode = false;

  ngOnInit(): void {
    const lib = this.library();
    this.isEditMode = !!lib;
    this.initializeForm();
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
      nodeId: this.fb.control(lib?.node?.id || '', {
        validators: [Validators.required],
        nonNullable: true,
      }),
      enabled: this.fb.control(lib?.enabled ?? true, { nonNullable: true }),
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
        if (formValue.nodeId !== lib.node.id) updates.nodeId = formValue.nodeId;
        if (formValue.enabled !== lib.enabled) updates.enabled = formValue.enabled;

        this.formSubmit.emit(updates);
      } else {
        // For creation, send all required fields
        const createDto: CreateLibraryDto = {
          name: formValue.name,
          path: formValue.path,
          mediaType: formValue.mediaType,
          nodeId: formValue.nodeId,
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

  get nodeIdControl() {
    return this.libraryForm.get('nodeId');
  }

  get enabledControl() {
    return this.libraryForm.get('enabled');
  }
}
