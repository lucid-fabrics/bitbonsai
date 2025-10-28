import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  EventEmitter,
  Input,
  inject,
  Output,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { BehaviorSubject, catchError, map, Observable, of } from 'rxjs';
import { LibrariesClient } from '../../../../core/clients/libraries.client';
import type { BulkJobCreationResult, Library } from '../../../libraries/models/library.model';
import { BytesBo } from '../../../nodes/bos/bytes.bo';

interface WizardStep {
  id: number;
  title: string;
  description: string;
}

@Component({
  selector: 'app-add-files-modal',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './add-files-modal.component.html',
  styleUrls: ['./add-files-modal.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AddFilesModalComponent {
  private readonly librariesApi = inject(LibrariesClient);
  private readonly destroyRef = inject(DestroyRef);

  @Input() isOpen = false;
  @Output() close = new EventEmitter<void>();
  @Output() jobsCreated = new EventEmitter<{ jobsCreated: number }>();

  // Expose BOs for template
  protected readonly BytesBo = BytesBo;

  // Wizard steps (simplified to 2 steps)
  protected readonly steps: WizardStep[] = [
    {
      id: 1,
      title: 'Select Library & Policy',
      description: 'Choose library and encoding policy',
    },
    {
      id: 2,
      title: 'Creating Jobs',
      description: 'Jobs are being created in the background',
    },
  ];

  // Current step state
  protected currentStep = 1;

  // Step 1: Library and policy selection
  protected readonly libraries$: Observable<Library[]>;
  protected readonly isLoading$ = new BehaviorSubject<boolean>(true);
  protected readonly error$ = new BehaviorSubject<string | null>(null);
  protected selectedLibraryId: string | null = null;
  protected selectedPolicyId: string | null = null;

  // Step 2: Job creation progress
  protected isCreatingJobs = false;
  protected creationResult$ = new BehaviorSubject<BulkJobCreationResult | null>(null);
  protected creationError$ = new BehaviorSubject<string | null>(null);

  constructor() {
    // Fetch libraries with cached stats (INSTANT - no file scanning)
    this.libraries$ = this.librariesApi.getLibraries().pipe(
      map((libraries) => {
        this.isLoading$.next(false);
        // Filter to only enabled libraries with policies
        return libraries.filter((lib) => lib.enabled && lib.policies && lib.policies.length > 0);
      }),
      catchError((error) => {
        this.isLoading$.next(false);
        this.error$.next(error?.message || 'Failed to load libraries. Please try again.');
        return of([]);
      })
    );
  }

  // Step 1: Selection methods
  protected selectLibrary(library: Library): void {
    this.selectedLibraryId = library.id;
    // Auto-select default policy or first available policy
    if (library.defaultPolicyId) {
      this.selectedPolicyId = library.defaultPolicyId;
    } else if (library.policies && library.policies.length > 0) {
      this.selectedPolicyId = library.policies[0].id;
    }
  }

  protected isLibrarySelected(libraryId: string): boolean {
    return this.selectedLibraryId === libraryId;
  }

  protected onPolicyChange(policyId: string): void {
    this.selectedPolicyId = policyId;
  }

  protected getSelectedLibrary(libraries: Library[]): Library | null {
    return libraries.find((lib) => lib.id === this.selectedLibraryId) || null;
  }

  protected canProceed(): boolean {
    return this.selectedLibraryId !== null && this.selectedPolicyId !== null;
  }

  // Step 2: Job creation
  protected createJobs(): void {
    if (!this.selectedLibraryId || !this.selectedPolicyId) {
      return;
    }

    this.isCreatingJobs = true;
    this.currentStep = 2;
    this.creationError$.next(null);

    this.librariesApi
      .createAllJobs(this.selectedLibraryId, { policyId: this.selectedPolicyId })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (result) => {
          this.isCreatingJobs = false;
          this.creationResult$.next(result);
          this.jobsCreated.emit({ jobsCreated: result.jobsCreated });
        },
        error: (error) => {
          this.isCreatingJobs = false;
          this.creationError$.next(error?.message || 'Failed to create jobs. Please try again.');
        },
      });
  }

  // Modal controls
  protected closeModal(): void {
    if (!this.isCreatingJobs) {
      this.resetModal();
      this.close.emit();
    }
  }

  protected resetModal(): void {
    this.currentStep = 1;
    this.selectedLibraryId = null;
    this.selectedPolicyId = null;
    this.isCreatingJobs = false;
    this.creationResult$.next(null);
    this.creationError$.next(null);
  }

  protected retryLoadLibraries(): void {
    window.location.reload();
  }

  protected viewQueue(): void {
    this.closeModal();
    // Navigate to queue page - handled by parent component
  }
}
