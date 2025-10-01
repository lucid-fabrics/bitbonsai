import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  EventEmitter,
  Input,
  OnInit,
  Output,
  inject,
} from '@angular/core';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import type {
  CreateLibraryDto,
  Library,
  UpdateLibraryDto,
} from '../../../../core/models/library.model';
import { MediaType } from '../../../../core/models/library.model';
import type { Node } from '../../../../core/models/node.model';

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

  @Input() library?: Library;
  @Input() nodes: Node[] = [];
  @Output() readonly formSubmit = new EventEmitter<CreateLibraryDto | UpdateLibraryDto>();
  @Output() readonly formCancel = new EventEmitter<void>();

  libraryForm!: FormGroup;
  mediaTypes = Object.values(MediaType);
  isEditMode = false;

  ngOnInit(): void {
    this.isEditMode = !!this.library;
    this.initializeForm();
  }

  private initializeForm(): void {
    this.libraryForm = this.fb.group({
      name: [this.library?.name || '', [Validators.required, Validators.maxLength(255)]],
      path: [
        this.library?.path || '',
        [Validators.required, Validators.pattern(/^\/.*/)], // Must start with /
      ],
      mediaType: [this.library?.mediaType || MediaType.MOVIE, [Validators.required]],
      nodeId: [this.library?.node.id || '', [Validators.required]],
      enabled: [this.library?.enabled ?? true],
    });
  }

  onSubmit(): void {
    if (this.libraryForm.valid) {
      const formValue = this.libraryForm.value;

      if (this.isEditMode) {
        // For updates, only send changed fields
        const updates: UpdateLibraryDto = {};
        if (formValue.name !== this.library?.name) updates.name = formValue.name;
        if (formValue.path !== this.library?.path) updates.path = formValue.path;
        if (formValue.mediaType !== this.library?.mediaType)
          updates.mediaType = formValue.mediaType;
        if (formValue.nodeId !== this.library?.node.id) updates.nodeId = formValue.nodeId;
        if (formValue.enabled !== this.library?.enabled) updates.enabled = formValue.enabled;

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
