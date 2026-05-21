import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { FaIconLibrary } from '@fortawesome/angular-fontawesome';
import { TranslocoTestingModule } from '@ngneat/transloco';
import { MockStore, provideMockStore } from '@ngrx/store/testing';
import { OverviewClient } from '../../core/clients/overview.client';
import { configureFontAwesome } from '../../core/config/font-awesome.config';
import type { OverviewModel } from './models/overview.model';
import { OverviewComponent } from './overview.page';

describe('OverviewComponent', () => {
  let component: OverviewComponent;
  let fixture: ComponentFixture<OverviewComponent>;
  let _store: MockStore;
  let _overviewClient: jest.Mocked<OverviewClient>;
  let httpMock: HttpTestingController;

  const mockOverview: OverviewModel = {
    system_health: {
      active_nodes: { current: 3, total: 5 },
      queue_status: { encoding_count: 2, pending_count: 10 },
      storage_saved: { total_tb: 5.2, percentage: 45 },
      success_rate: { percentage: 92 },
    },
    queue_summary: { queued: 10, encoding: 2, completed: 100, failed: 3 },
    recent_activity: [],
    top_libraries: [],
    last_updated: '2025-01-01T00:00:00Z',
  };

  const mockOverviewClient = {
    getOverview: jest.fn(),
  };

  const initialState = {};

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [OverviewComponent, TranslocoTestingModule.forRoot({})],
      schemas: [NO_ERRORS_SCHEMA],
      providers: [
        provideMockStore({ initialState }),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: OverviewClient, useValue: mockOverviewClient },
      ],
    }).compileComponents();

    const library = TestBed.inject(FaIconLibrary);
    configureFontAwesome(library);

    fixture = TestBed.createComponent(OverviewComponent);
    component = fixture.componentInstance;
    _store = TestBed.inject(MockStore);
    _overviewClient = TestBed.inject(OverviewClient) as jest.Mocked<OverviewClient>;
    httpMock = TestBed.inject(HttpTestingController);

    jest.clearAllMocks();
  });

  afterEach(() => {
    httpMock.verify();
    component.ngOnDestroy();
  });

  describe('Component Initialization', () => {
    it('should create', () => {
      expect(component).toBeTruthy();
    });

    it('should initialize observables', (done) => {
      // Set initial state to match expectations
      _store.setState({
        overview: {
          data: null,
          loading: true,
          error: null,
        },
      });

      // Test observables
      component.overviewData$.subscribe((data) => {
        expect(data).toBeNull();
      });

      component.isLoading$.subscribe((loading) => {
        expect(loading).toBe(true);
      });

      component.error$.subscribe((error) => {
        expect(error).toBeNull();
        done();
      });
    });
  });

  describe('Computed Observables', () => {
    it('should calculate hasData', (done) => {
      // First test with no data
      _store.setState({
        overview: {
          data: null,
          loading: false,
          error: null,
        },
      });

      component.hasData$.subscribe((hasData) => {
        expect(hasData).toBe(false);
      });

      // Then test with data
      _store.setState({
        overview: {
          data: mockOverview,
          loading: false,
          error: null,
        },
      });

      component.hasData$.subscribe((hasData) => {
        expect(hasData).toBe(true);
        done();
      });
    });

    it('should calculate totalQueueItems', (done) => {
      _store.setState({
        overview: {
          data: mockOverview,
          loading: false,
          error: null,
        },
      });

      component.totalQueueItems$.subscribe((total) => {
        expect(total).toBe(115); // 10+2+100+3
        done();
      });
    });

    it('should return 0 for totalQueueItems when no data', (done) => {
      _store.setState({
        overview: {
          data: null,
          loading: false,
          error: null,
        },
      });

      component.totalQueueItems$.subscribe((total) => {
        expect(total).toBe(0);
        done();
      });
    });
  });

  describe('formatBytes', () => {
    it('should format GB values', () => {
      expect(component.formatBytes(5.234)).toBe('5.23 GB');
      expect(component.formatBytes(0.5)).toBe('0.50 GB');
    });
  });

  describe('formatDuration', () => {
    it('should format seconds to human-readable duration', () => {
      expect(component.formatDuration(125)).toBe('2m');
      expect(component.formatDuration(60)).toBe('1m');
      expect(component.formatDuration(45)).toBe('45s');
    });
  });

  describe('formatTime', () => {
    it('should format recent time as "Just now"', () => {
      const now = new Date().toISOString();
      expect(component.formatTime(now)).toBe('Just now');
    });

    it('should format minutes ago', () => {
      const fiveMinutesAgo = new Date(Date.now() - 5 * 60000).toISOString();
      expect(component.formatTime(fiveMinutesAgo)).toBe('5m ago');
    });

    it('should format hours ago', () => {
      const twoHoursAgo = new Date(Date.now() - 2 * 3600000).toISOString();
      expect(component.formatTime(twoHoursAgo)).toBe('2h ago');
    });

    it('should format days ago', () => {
      const threeDaysAgo = new Date(Date.now() - 3 * 86400000).toISOString();
      expect(component.formatTime(threeDaysAgo)).toBe('3d ago');
    });
  });

  describe('getProgressPercentage', () => {
    it('should calculate percentage correctly', () => {
      expect(component.getProgressPercentage(50, 100)).toBe(50);
      expect(component.getProgressPercentage(25, 100)).toBe(25);
    });

    it('should return 0 when total is 0', () => {
      expect(component.getProgressPercentage(10, 0)).toBe(0);
    });

    it('should round to nearest integer', () => {
      expect(component.getProgressPercentage(1, 3)).toBe(33);
    });
  });
});
