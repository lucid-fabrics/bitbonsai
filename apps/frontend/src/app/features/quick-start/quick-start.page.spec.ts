import { NO_ERRORS_SCHEMA } from '@angular/core';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideRouter } from '@angular/router';
import { FaIconLibrary } from '@fortawesome/angular-fontawesome';
import { TranslocoTestingModule } from '@ngneat/transloco';
import { MockStore, provideMockStore } from '@ngrx/store/testing';
import { of, throwError } from 'rxjs';
import { configureFontAwesome } from '../../core/config/font-awesome.config';
import { LibrariesActions } from '../libraries/+state/libraries.actions';
import type { CreateJobsFromScanResult, Library } from '../libraries/models/library.model';
import { MediaType } from '../libraries/models/library.model';
import { LibrariesService } from '../libraries/services/libraries.service';
import { PoliciesActions } from '../policies/+state/policies.actions';
import { PolicyBo } from '../policies/bos/policy.bo';
import { PolicyPreset, TargetCodec, type PresetInfoModel } from '../policies/models/policy.model';
import { PolicyService } from '../policies/services/policy.service';
import { QuickStartComponent, QuickStartStep } from './quick-start.page';

describe('QuickStartComponent', () => {
  let component: QuickStartComponent;
  let fixture: ComponentFixture<QuickStartComponent>;
  let store: MockStore;
  let librariesService: jest.Mocked<LibrariesService>;
  let policyService: jest.Mocked<PolicyService>;

  const mockPreset: PresetInfoModel = {
    preset: PolicyPreset.BALANCED_HEVC,
    name: 'Balanced HEVC',
    description: 'Balanced quality and speed',
    codec: TargetCodec.HEVC,
    crf: 23,
    use_case: 'General purpose',
    icon: 'balance-scale',
    recommended: true,
  };

  const mockLibrary: Library = {
    id: 'lib-1',
    name: 'Movies',
    path: '/mnt/media/Movies',
    mediaType: MediaType.MIXED,
    enabled: true,
    watchEnabled: false,
    lastScanAt: null,
    totalFiles: 0,
    totalSizeBytes: '0',
    node: { id: 'node-1', name: 'Main', status: 'ONLINE' },
    defaultPolicyId: null,
    defaultPolicy: null,
    policies: [],
    _count: { jobs: 0 },
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  };

  const initialState = {
    policies: {
      policies: [],
      presets: [mockPreset],
      isLoading: false,
      error: null,
    },
  };

  beforeEach(async () => {
    librariesService = {
      createLibrary: jest.fn(),
      updateLibrary: jest.fn(),
      createJobsFromScan: jest.fn(),
      scanLibrary: jest.fn(),
    } as unknown as jest.Mocked<LibrariesService>;

    policyService = {
      createPolicy: jest.fn(),
    } as unknown as jest.Mocked<PolicyService>;

    await TestBed.configureTestingModule({
      imports: [QuickStartComponent, TranslocoTestingModule.forRoot({})],
      schemas: [NO_ERRORS_SCHEMA],
      providers: [
        provideNoopAnimations(),
        provideRouter([]),
        provideMockStore({ initialState }),
        { provide: LibrariesService, useValue: librariesService },
        { provide: PolicyService, useValue: policyService },
      ],
    }).compileComponents();

    const library = TestBed.inject(FaIconLibrary);
    configureFontAwesome(library);

    fixture = TestBed.createComponent(QuickStartComponent);
    component = fixture.componentInstance;
    store = TestBed.inject(MockStore);
  });

  it('should create', () => {
    fixture.detectChanges();
    expect(component).toBeTruthy();
  });

  it('dispatches loadPresets on init and auto-selects the recommended preset', () => {
    const dispatchSpy = jest.spyOn(store, 'dispatch');
    fixture.detectChanges();

    expect(dispatchSpy).toHaveBeenCalledWith(PoliciesActions.loadPresets());
    expect(component.selectedPreset()).toEqual(mockPreset);
  });

  describe('step navigation', () => {
    it('keeps Next disabled on the Folders step until a folder is added', () => {
      fixture.detectChanges();

      component.nextStep();
      expect(component.currentStep()).toBe(QuickStartStep.Folders);

      component.currentFolderPath.set('/mnt/media/Movies');
      component.addFolder();
      expect(component.paths()).toEqual(['/mnt/media/Movies']);

      component.nextStep();
      expect(component.currentStep()).toBe(QuickStartStep.Preset);
    });

    it('does not add a duplicate or empty folder path', () => {
      fixture.detectChanges();

      component.currentFolderPath.set('/mnt/media/Movies');
      component.addFolder();
      component.currentFolderPath.set('/mnt/media/Movies');
      component.addFolder();
      component.currentFolderPath.set('');
      component.addFolder();

      expect(component.paths()).toEqual(['/mnt/media/Movies']);
    });
  });

  describe('start()', () => {
    const jobsResult: CreateJobsFromScanResult = {
      jobsCreated: 2,
      jobs: [
        { id: 'job-1', filePath: '/mnt/media/Movies/a.mkv', fileLabel: 'a.mkv', stage: 'QUEUED' },
        { id: 'job-2', filePath: '/mnt/media/Movies/b.mkv', fileLabel: 'b.mkv', stage: 'QUEUED' },
      ],
    };

    beforeEach(() => {
      fixture.detectChanges();
      component.currentFolderPath.set('/mnt/media/Movies');
      component.addFolder();
    });

    it('creates the policy, links the library, queues jobs, and reaches the Done step', () => {
      const dispatchSpy = jest.spyOn(store, 'dispatch');
      policyService.createPolicy.mockReturnValue(of({ id: 'policy-1' } as PolicyBo));
      librariesService.createLibrary.mockReturnValue(of(mockLibrary));
      librariesService.updateLibrary.mockReturnValue(of(mockLibrary));
      librariesService.scanLibrary.mockReturnValue(of(mockLibrary));
      librariesService.createJobsFromScan.mockReturnValue(of(jobsResult));

      component.start();

      expect(librariesService.createLibrary).toHaveBeenCalledWith({
        name: 'Movies',
        path: '/mnt/media/Movies',
        mediaType: MediaType.MIXED,
      });
      expect(librariesService.updateLibrary).toHaveBeenCalledWith('lib-1', {
        defaultPolicyId: 'policy-1',
      });
      expect(dispatchSpy).toHaveBeenCalledWith(LibrariesActions.loadLibraries());
      expect(component.phase()).toBe('done');
      expect(component.currentStep()).toBe(QuickStartStep.Done);
      expect(component.jobsCreated()).toBe(2);
      expect(component.sampleJobs()).toEqual(['a.mkv', 'b.mkv']);
    });

    it('sets a friendly error when policy creation fails', () => {
      policyService.createPolicy.mockReturnValue(throwError(() => new Error('boom')));

      component.start();

      expect(component.error()).toBe('quickstart.errorCreatingPolicy');
      expect(component.phase()).toBe('creating-policy');
    });

    it('retries a failed folder from its existing library instead of recreating it', () => {
      policyService.createPolicy.mockReturnValue(of({ id: 'policy-1' } as PolicyBo));
      librariesService.createLibrary.mockReturnValue(of(mockLibrary));
      librariesService.updateLibrary.mockReturnValue(of(mockLibrary));
      librariesService.scanLibrary.mockReturnValue(of(mockLibrary));
      librariesService.createJobsFromScan.mockReturnValueOnce(throwError(() => new Error('boom')));

      component.start();

      expect(component.error()).toBe('quickstart.errorCreatingLibraries');
      expect(component.jobsCreated()).toBe(0);
      expect(librariesService.createLibrary).toHaveBeenCalledTimes(1);

      librariesService.createJobsFromScan.mockReturnValue(of(jobsResult));
      component.start();

      // The folder must resume from its already-created library (no duplicate
      // createLibrary call, which the backend would reject with a 409) and its
      // job-creation step must actually be retried (not silently skipped).
      expect(librariesService.createLibrary).toHaveBeenCalledTimes(1);
      expect(component.phase()).toBe('done');
      expect(component.jobsCreated()).toBe(2);
    });
  });
});
