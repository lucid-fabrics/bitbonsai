import { animate, style, transition, trigger } from '@angular/animations';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  type ElementRef,
  type OnDestroy,
  type OnInit,
  effect,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { PathSelectorComponent } from '@bitbonsai/shared-ui';
import { FontAwesomeModule } from '@fortawesome/angular-fontawesome';
import type { IconDefinition } from '@fortawesome/fontawesome-svg-core';
import { faCircle } from '@fortawesome/pro-regular-svg-icons';
import {
  faArrowLeft,
  faArrowRight,
  faBalanceScale,
  faBolt,
  faCircleCheck,
  faCircleInfo,
  faExclamationCircle,
  faFolder,
  faFolderOpen,
  faGears,
  faGem,
  faCheck,
  faListCheck,
  faPlus,
  faRocket,
  faRotateRight,
  faSliders,
  faSpinner,
  faStar,
  faTree,
  faWrench,
  faXmark,
} from '@fortawesome/pro-solid-svg-icons';
import { TranslocoModule } from '@ngneat/transloco';
import { Store } from '@ngrx/store';
import { from, of, type Observable } from 'rxjs';
import { concatMap, map, switchMap, tap } from 'rxjs/operators';
import { environment } from '../../../environments/environment';
import { LibrariesActions } from '../libraries/+state/libraries.actions';
import type { CreateJobsFromScanResult } from '../libraries/models/library.model';
import { MediaType } from '../libraries/models/library.model';
import { LibrariesService } from '../libraries/services/libraries.service';
import { PoliciesActions } from '../policies/+state/policies.actions';
import { PoliciesSelectors } from '../policies/+state/policies.selectors';
import {
  AudioHandling,
  type CreatePolicyRequest,
  PolicyPreset,
  type PresetInfoModel,
  TargetCodec,
} from '../policies/models/policy.model';
import { PolicyService } from '../policies/services/policy.service';

export enum QuickStartStep {
  Folders = 0,
  Preset = 1,
  Confirm = 2,
  Done = 3,
}

type QuickStartPhase = 'idle' | 'creating-policy' | 'creating-libraries' | 'queueing' | 'done';

interface FolderState {
  path: string;
  libraryId: string | null;
  jobsCreated: boolean;
}

/**
 * Returns the last non-empty '/'-separated segment of a path, stripping
 * trailing slashes first. Falls back to the full path when there is no '/'.
 */
function basename(path: string): string {
  const trimmed = path.replace(/\/+$/, '');
  const segments = trimmed.split('/').filter((segment) => segment.length > 0);
  return segments.length > 0 ? segments[segments.length - 1] : path;
}

@Component({
  selector: 'app-quick-start',
  standalone: true,
  imports: [FontAwesomeModule, RouterLink, TranslocoModule, PathSelectorComponent],
  templateUrl: './quick-start.page.html',
  styleUrls: ['./quick-start.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  animations: [
    trigger('stepTransition', [
      transition(':enter', [
        style({ opacity: 0, transform: 'translateX(20px)' }),
        animate('300ms ease-out', style({ opacity: 1, transform: 'translateX(0)' })),
      ]),
    ]),
  ],
})
export class QuickStartComponent implements OnInit, OnDestroy {
  private readonly store = inject(Store);
  private readonly librariesService = inject(LibrariesService);
  private readonly policyService = inject(PolicyService);
  private readonly destroyRef = inject(DestroyRef);

  readonly QuickStartStep = QuickStartStep;
  readonly totalSteps = 3;
  readonly apiUrl = environment.apiUrl;

  readonly icons = {
    star: faStar,
    tree: faTree,
    folderOpen: faFolderOpen,
    plus: faPlus,
    folder: faFolder,
    xmark: faXmark,
    circleInfo: faCircleInfo,
    arrowRight: faArrowRight,
    arrowLeft: faArrowLeft,
    sliders: faSliders,
    rocket: faRocket,
    exclamationCircle: faExclamationCircle,
    gears: faGears,
    spinner: faSpinner,
    circleCheck: faCircleCheck,
    circle: faCircle,
    rotateRight: faRotateRight,
    listCheck: faListCheck,
    bolt: faBolt,
  };

  private readonly presetIcons: Record<PolicyPreset, IconDefinition> = {
    [PolicyPreset.BALANCED_HEVC]: faBalanceScale,
    [PolicyPreset.FAST_HEVC]: faBolt,
    [PolicyPreset.QUALITY_AV1]: faGem,
    [PolicyPreset.COPY_IF_COMPLIANT]: faCheck,
    [PolicyPreset.CUSTOM]: faWrench,
  };

  readonly currentStep = signal<QuickStartStep>(QuickStartStep.Folders);

  // Step 1: Folders
  readonly paths = signal<string[]>([]);
  readonly currentFolderPath = signal('');
  readonly showFolderBrowser = signal(false);
  readonly pathWrapper = viewChild<ElementRef>('pathWrapper');
  private clickListener?: (event: MouseEvent) => void;

  // Step 2: Preset
  readonly presets$ = this.store.select(PoliciesSelectors.selectPresets);
  readonly presets = toSignal(this.presets$, { initialValue: [] as PresetInfoModel[] });
  readonly presetsLoading = toSignal(this.store.select(PoliciesSelectors.selectIsLoading), {
    initialValue: false,
  });
  readonly selectedPreset = signal<PresetInfoModel | null>(null);

  // Step 3: Confirm and run
  readonly phase = signal<QuickStartPhase>('idle');
  readonly error = signal<string | null>(null);
  private readonly phaseOrder: QuickStartPhase[] = [
    'creating-policy',
    'creating-libraries',
    'queueing',
  ];
  private readonly createdPolicyId = signal<string | null>(null);
  private readonly folderStates = signal<FolderState[]>([]);

  // Done screen
  readonly jobsCreated = signal(0);
  readonly sampleJobs = signal<string[]>([]);

  constructor() {
    effect(() => {
      const presets = this.presets();
      if (presets.length > 0 && this.selectedPreset() === null) {
        const recommended = presets.find((preset) => preset.recommended);
        this.selectedPreset.set(recommended ?? presets[0]);
      }
    });
  }

  ngOnInit(): void {
    this.store.dispatch(PoliciesActions.loadPresets());
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
        this.showFolderBrowser()
      ) {
        this.showFolderBrowser.set(false);
      }
    };
    document.addEventListener('click', this.clickListener, true);
  }

  onWrapperClick(event: Event): void {
    event.stopPropagation();
  }

  onPathFocus(): void {
    const currentPath = this.currentFolderPath() || '/';
    if (currentPath.startsWith('/')) {
      this.showFolderBrowser.set(true);
    }
  }

  onPathInput(event: Event): void {
    const path = (event.target as HTMLInputElement).value;
    this.currentFolderPath.set(path);
    if (path.startsWith('/') && path.length > 0) {
      this.showFolderBrowser.set(true);
    }
  }

  onFolderSelected(path: string): void {
    this.currentFolderPath.set(path);
  }

  closeFolderBrowser(): void {
    this.showFolderBrowser.set(false);
  }

  addFolder(): void {
    const path = this.currentFolderPath().trim();
    if (path.length > 0 && !this.paths().includes(path)) {
      this.paths.update((paths) => [...paths, path]);
    }
    this.currentFolderPath.set('');
    this.closeFolderBrowser();
  }

  removeFolder(path: string): void {
    this.paths.update((paths) => paths.filter((existing) => existing !== path));
  }

  selectPreset(preset: PresetInfoModel): void {
    this.selectedPreset.set(preset);
  }

  getPresetIcon(preset: PolicyPreset): IconDefinition {
    return this.presetIcons[preset] ?? faListCheck;
  }

  codecLabelKey(codec: TargetCodec): string {
    switch (codec) {
      case TargetCodec.HEVC:
        return 'quickstart.codecHevc';
      case TargetCodec.AV1:
        return 'quickstart.codecAv1';
      case TargetCodec.VP9:
        return 'quickstart.codecVp9';
      case TargetCodec.H264:
        return 'quickstart.codecH264';
      default:
        return 'quickstart.codecHevc';
    }
  }

  qualityLabelKey(crf: number): string {
    if (crf === 0) return 'quickstart.qualityOriginal';
    if (crf <= 18) return 'quickstart.qualityBest';
    if (crf <= 22) return 'quickstart.qualityExcellent';
    if (crf <= 26) return 'quickstart.qualityBalanced';
    if (crf <= 30) return 'quickstart.qualitySaveSpace';
    if (crf <= 34) return 'quickstart.qualitySaveMost';
    return 'quickstart.qualityLowest';
  }

  nextStep(): void {
    if (this.currentStep() === QuickStartStep.Folders && this.paths().length === 0) return;
    if (this.currentStep() === QuickStartStep.Preset && !this.selectedPreset()) return;
    if (this.currentStep() < QuickStartStep.Confirm) {
      this.currentStep.update((step) => step + 1);
    }
  }

  previousStep(): void {
    if (this.currentStep() > QuickStartStep.Folders && this.currentStep() <= QuickStartStep.Confirm) {
      this.currentStep.update((step) => step - 1);
    }
  }

  isPhaseDone(step: QuickStartPhase): boolean {
    if (this.phase() === 'done') return true;
    return this.phaseOrder.indexOf(step) < this.phaseOrder.indexOf(this.phase());
  }

  isPhaseActive(step: QuickStartPhase): boolean {
    // An error means this phase stopped running, so it should not still show as active/spinning.
    return this.phase() === step && !this.error();
  }

  start(): void {
    const preset = this.selectedPreset();
    if (!preset) return;

    this.error.set(null);

    if (this.folderStates().length === 0) {
      this.folderStates.set(
        this.paths().map((path) => ({ path, libraryId: null, jobsCreated: false }))
      );
    }

    const policyId = this.createdPolicyId();
    if (policyId) {
      this.runLibraries(policyId);
      return;
    }

    this.phase.set('creating-policy');
    this.policyService
      .createPolicy(this.buildPolicyRequest(preset))
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (createdPolicy) => {
          this.createdPolicyId.set(createdPolicy.id);
          this.runLibraries(createdPolicy.id);
        },
        error: () => {
          this.error.set('quickstart.errorCreatingPolicy');
        },
      });
  }

  private buildPolicyRequest(preset: PresetInfoModel): CreatePolicyRequest {
    return {
      name: preset.name,
      preset: preset.preset,
      targetCodec: preset.codec,
      targetQuality: preset.crf,
      targetContainer: 'mkv',
      skipReencoding: true,
      allowSameCodec: false,
      minSavingsPercent: 0,
      deviceProfiles: { appleTV: true, chromecast: true, roku: true, web: true },
      advancedSettings: { audioHandling: AudioHandling.COPY },
    };
  }

  private runLibraries(policyId: string): void {
    this.phase.set('creating-libraries');
    const pending = this.folderStates().filter((entry) => !entry.jobsCreated);

    from(pending)
      .pipe(
        concatMap((entry) => this.processFolder(entry, policyId)),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe({
        next: (result) => {
          this.jobsCreated.update((count) => count + result.jobsCreated);
          const remaining = 3 - this.sampleJobs().length;
          if (remaining > 0) {
            const labels = result.jobs.slice(0, remaining).map((job) => job.fileLabel);
            this.sampleJobs.update((jobs) => [...jobs, ...labels]);
          }
        },
        error: () => {
          this.error.set('quickstart.errorCreatingLibraries');
        },
        complete: () => {
          this.store.dispatch(LibrariesActions.loadLibraries());
          this.store.dispatch(PoliciesActions.loadPolicies());
          this.phase.set('done');
          this.currentStep.set(QuickStartStep.Done);
        },
      });
  }

  private processFolder(entry: FolderState, policyId: string): Observable<CreateJobsFromScanResult> {
    // Resume from an existing library on retry instead of re-creating it: the backend
    // rejects a second createLibrary() for the same path with a 409 Conflict.
    const libraryId$: Observable<string> = entry.libraryId
      ? of(entry.libraryId)
      : this.librariesService
          .createLibrary({
            name: basename(entry.path),
            path: entry.path,
            mediaType: MediaType.MIXED,
          })
          .pipe(
            map((library) => library.id),
            tap((libraryId) => this.setFolderLibraryId(entry.path, libraryId))
          );

    return libraryId$.pipe(
      // Creating a policy does not link it to any library, the link is set
      // explicitly here so the library's default policy is this one.
      switchMap((libraryId) =>
        this.librariesService
          .updateLibrary(libraryId, { defaultPolicyId: policyId })
          .pipe(map(() => libraryId))
      ),
      tap((libraryId) => {
        this.librariesService
          .scanLibrary(libraryId)
          .pipe(takeUntilDestroyed(this.destroyRef))
          .subscribe({
            // The scan is best-effort here; createJobsFromScan below does not depend
            // on it having finished, so a scan failure is not fatal to this folder.
            error: () => undefined,
          });
        this.phase.set('queueing');
      }),
      switchMap((libraryId) => this.librariesService.createJobsFromScan(libraryId, { policyId })),
      tap(() => this.setFolderJobsCreated(entry.path))
    );
  }

  private setFolderLibraryId(path: string, libraryId: string): void {
    this.folderStates.update((entries) =>
      entries.map((entry) => (entry.path === path ? { ...entry, libraryId } : entry))
    );
  }

  private setFolderJobsCreated(path: string): void {
    this.folderStates.update((entries) =>
      entries.map((entry) => (entry.path === path ? { ...entry, jobsCreated: true } : entry))
    );
  }

  reset(): void {
    this.currentStep.set(QuickStartStep.Folders);
    this.paths.set([]);
    this.currentFolderPath.set('');
    this.showFolderBrowser.set(false);
    this.selectedPreset.set(null);
    this.phase.set('idle');
    this.error.set(null);
    this.createdPolicyId.set(null);
    this.folderStates.set([]);
    this.jobsCreated.set(0);
    this.sampleJobs.set([]);
  }
}
