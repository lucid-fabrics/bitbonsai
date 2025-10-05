import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { FaIconLibrary } from '@fortawesome/angular-fontawesome';
import {
  faChartLine,
  faDatabase,
  faExclamationCircle,
  faList,
  faSync,
  faTimes,
} from '@fortawesome/pro-solid-svg-icons';
import { MockStore, provideMockStore } from '@ngrx/store/testing';
import { of } from 'rxjs';
import { MediaStatsActions } from './+state/dashboard.actions';
import { MediaStatsSelectors } from './+state/dashboard.selectors';
import { DashboardComponent } from './dashboard.page';
import { MediaStatsClient } from './services/media-stats.client';

describe('DashboardComponent', () => {
  let component: DashboardComponent;
  let fixture: ComponentFixture<DashboardComponent>;
  let store: MockStore;
  let mediaStatsClient: jest.Mocked<MediaStatsClient>;

  const mockMediaStats = {
    total_size_gb: 100,
    total_files: 50,
    average_bitrate_mbps: 5.5,
    codec_distribution: {
      hevc: 30,
      h264: 15,
      av1: 3,
      other: 2,
    },
    folders: [],
    scan_timestamp: '2025-01-01T00:00:00Z',
  };

  const initialState = {
    mediaStats: {
      stats: null,
      isLoading: false,
      error: null,
    },
  };

  beforeEach(async () => {
    const mediaStatsClientMock = {
      getAll: jest.fn(),
      getFolderFiles: jest.fn(),
      triggerScan: jest.fn(),
    } as unknown as jest.Mocked<MediaStatsClient>;

    await TestBed.configureTestingModule({
      imports: [DashboardComponent],
      providers: [
        provideMockStore({ initialState }),
        { provide: MediaStatsClient, useValue: mediaStatsClientMock },
      ],
    }).compileComponents();

    // Setup FontAwesome icons
    const library = TestBed.inject(FaIconLibrary);
    library.addIcons(faChartLine, faSync, faList, faTimes, faExclamationCircle, faDatabase);

    fixture = TestBed.createComponent(DashboardComponent);
    component = fixture.componentInstance;
    store = TestBed.inject(MockStore);
    mediaStatsClient = TestBed.inject(MediaStatsClient) as jest.Mocked<MediaStatsClient>;

    // Setup selectors
    store.overrideSelector(MediaStatsSelectors.selectMediaStats, null);
    store.overrideSelector(MediaStatsSelectors.selectIsLoading, false);
    store.overrideSelector(MediaStatsSelectors.selectError, null);

    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  describe('component initialization', () => {
    it('should dispatch load action on init', () => {
      const dispatchSpy = jest.spyOn(store, 'dispatch');
      component.ngOnInit();
      expect(dispatchSpy).toHaveBeenCalledWith(MediaStatsActions.loadMediaStats());
    });
  });

  describe('template rendering', () => {
    it('should render component template', () => {
      const compiled = fixture.nativeElement as HTMLElement;
      expect(compiled).toBeDefined();
    });
  });

  describe('user interactions', () => {
    it('should trigger scan when triggerScan is called', () => {
      const dispatchSpy = jest.spyOn(store, 'dispatch');
      component.triggerScan();
      expect(dispatchSpy).toHaveBeenCalledWith(MediaStatsActions.triggerScan());
    });

    it('should open dialog and load files when viewFilesToEncode is called', () => {
      const mockFiles = {
        files: [{ name: 'file1.mp4', codec: 'h264', size_bytes: 1000, bitrate_mbps: 5 }],
      };
      mediaStatsClient.getFolderFiles.mockReturnValue(of(mockFiles));

      component.viewFilesToEncode({ name: 'Movies' });

      expect(component.dialogOpen).toBe(true);
      expect(component.dialogFolderName).toBe('Movies');
      expect(component.dialogCodec).toBe('h264');
      expect(mediaStatsClient.getFolderFiles).toHaveBeenCalledWith('Movies', 'h264');
    });

    it('should close dialog when closeDialog is called', () => {
      component.dialogOpen = true;
      component.dialogFiles = []; // mock files

      component.closeDialog();

      expect(component.dialogOpen).toBe(false);
      expect(component.dialogFiles).toEqual([]);
    });
  });

  describe('getBadgeExplanation', () => {
    it('should return explanation for Complete badge', () => {
      const explanation = component.getBadgeExplanation('Complete');
      expect(explanation).toContain('All files');
    });

    it('should return explanation for In Progress badge', () => {
      const explanation = component.getBadgeExplanation('In Progress');
      expect(explanation).toContain('Some files');
    });

    it('should return explanation for Not Started badge', () => {
      const explanation = component.getBadgeExplanation('Not Started');
      expect(explanation).toContain('No files');
    });
  });
});
