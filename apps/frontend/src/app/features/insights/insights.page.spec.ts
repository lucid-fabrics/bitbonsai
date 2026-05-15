import { ChangeDetectorRef, NO_ERRORS_SCHEMA } from '@angular/core';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslocoTestingModule } from '@ngneat/transloco';
import { of, throwError } from 'rxjs';
import { InsightsStatsBO } from './bos/insights-stats.bo';
import { SavingsTrendBO } from './bos/savings-trend.bo';
import { InsightsComponent } from './insights.page';
import { InsightsService } from './services/insights.service';

describe('InsightsComponent', () => {
  let component: InsightsComponent;
  let fixture: ComponentFixture<InsightsComponent>;
  let insightsService: jest.Mocked<InsightsService>;
  let _cdr: jest.Mocked<ChangeDetectorRef>;

  const mockSavingsTrend = [
    SavingsTrendBO.fromDto({ date: '2025-01-01', savedGB: 100 }),
    SavingsTrendBO.fromDto({ date: '2025-01-02', savedGB: 200 }),
  ];

  const mockStats = new InsightsStatsBO(100, 500, 95, 50);

  beforeEach(async () => {
    const insightsServiceMock = {
      getSavingsTrend: jest.fn().mockReturnValue(of(mockSavingsTrend)),
      getCodecDistribution: jest.fn().mockReturnValue(of([])),
      getNodePerformance: jest.fn().mockReturnValue(of([])),
      getStats: jest.fn().mockReturnValue(of(mockStats)),
    } as unknown as jest.Mocked<InsightsService>;

    const cdrMock = {
      markForCheck: jest.fn(),
      detectChanges: jest.fn(),
    } as unknown as jest.Mocked<ChangeDetectorRef>;

    await TestBed.configureTestingModule({
      imports: [InsightsComponent, TranslocoTestingModule.forRoot({})],
      schemas: [NO_ERRORS_SCHEMA],
      providers: [
        { provide: InsightsService, useValue: insightsServiceMock },
        { provide: ChangeDetectorRef, useValue: cdrMock },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(InsightsComponent);
    component = fixture.componentInstance;
    insightsService = TestBed.inject(InsightsService) as jest.Mocked<InsightsService>;
    _cdr = TestBed.inject(ChangeDetectorRef) as jest.Mocked<ChangeDetectorRef>;
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  describe('initial state', () => {
    it('should have selectedTimeRange of 30 by default', () => {
      expect(component.selectedTimeRange).toBe(30);
    });

    it('should have loading set to true before init', () => {
      expect(component.loading).toBe(true);
    });
  });

  describe('component initialization', () => {
    it('should load all data on ngOnInit', () => {
      component.ngOnInit();
      expect(insightsService.getSavingsTrend).toHaveBeenCalledWith(30);
      expect(insightsService.getCodecDistribution).toHaveBeenCalled();
      expect(insightsService.getNodePerformance).toHaveBeenCalled();
      expect(insightsService.getStats).toHaveBeenCalled();
    });
  });

  describe('selectTimeRange', () => {
    it('should update selectedTimeRange when called with 7', () => {
      component.selectTimeRange(7);
      expect(component.selectedTimeRange).toBe(7);
    });

    it('should update selectedTimeRange when called with 90', () => {
      component.selectTimeRange(90);
      expect(component.selectedTimeRange).toBe(90);
    });

    it('should re-fetch savings trend with the new time range', () => {
      component.selectTimeRange(7);
      expect(insightsService.getSavingsTrend).toHaveBeenCalledWith(7);
    });

    it('should NOT re-fetch codec distribution or node performance on time range change', () => {
      insightsService.getCodecDistribution.mockClear();
      insightsService.getNodePerformance.mockClear();

      component.selectTimeRange(7);

      expect(insightsService.getCodecDistribution).not.toHaveBeenCalled();
      expect(insightsService.getNodePerformance).not.toHaveBeenCalled();
    });
  });

  describe('formatStorageSize', () => {
    it('should format GB values below 1000 with 2 decimal places', () => {
      expect(component.formatStorageSize(500)).toBe('500.00 GB');
      expect(component.formatStorageSize(0.5)).toBe('0.50 GB');
      expect(component.formatStorageSize(999.99)).toBe('999.99 GB');
    });

    it('should convert values >= 1000 GB to TB', () => {
      expect(component.formatStorageSize(1000)).toBe('1.00 TB');
      expect(component.formatStorageSize(1500)).toBe('1.50 TB');
      expect(component.formatStorageSize(2048)).toBe('2.05 TB');
    });

    it('should handle zero', () => {
      expect(component.formatStorageSize(0)).toBe('0.00 GB');
    });

    it('should handle null gracefully', () => {
      expect(component.formatStorageSize(null as unknown as number)).toBe('0.00 GB');
    });

    it('should handle undefined gracefully', () => {
      expect(component.formatStorageSize(undefined as unknown as number)).toBe('0.00 GB');
    });

    it('should handle NaN gracefully', () => {
      expect(component.formatStorageSize(NaN)).toBe('0.00 GB');
    });
  });

  describe('error handling', () => {
    it('should set empty savings trend data on error', async () => {
      insightsService.getSavingsTrend.mockReturnValue(throwError(() => new Error('API error')));
      insightsService.getCodecDistribution.mockReturnValue(of([]));
      insightsService.getNodePerformance.mockReturnValue(of([]));
      insightsService.getStats.mockReturnValue(of(mockStats));

      component.ngOnInit();
      await fixture.whenStable();

      expect(component.savingsTrendData.datasets[0].data).toEqual([]);
    });

    it('should keep default stats on getStats error', async () => {
      insightsService.getStats.mockReturnValue(throwError(() => new Error('Stats unavailable')));

      const defaultStats = component.stats;
      component.ngOnInit();
      await fixture.whenStable();

      expect(component.stats).toEqual(defaultStats);
    });
  });

  describe('template rendering', () => {
    it('should render the component root element', () => {
      const compiled = fixture.nativeElement as HTMLElement;
      expect(compiled).toBeDefined();
    });
  });
});
