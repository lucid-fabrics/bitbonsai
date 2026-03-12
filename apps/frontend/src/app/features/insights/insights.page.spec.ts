import { ChangeDetectorRef, NO_ERRORS_SCHEMA } from '@angular/core';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslocoTestingModule } from '@ngneat/transloco';
import { of } from 'rxjs';
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

  describe('component initialization', () => {
    it('should load all data on init', () => {
      component.ngOnInit();
      expect(insightsService.getSavingsTrend).toHaveBeenCalled();
      expect(insightsService.getCodecDistribution).toHaveBeenCalled();
      expect(insightsService.getNodePerformance).toHaveBeenCalled();
      expect(insightsService.getStats).toHaveBeenCalled();
    });
  });

  describe('template rendering', () => {
    it('should render component template', () => {
      const compiled = fixture.nativeElement as HTMLElement;
      expect(compiled).toBeDefined();
    });
  });

  describe('user interactions', () => {
    it('should update time range when selectTimeRange is called', () => {
      component.selectTimeRange(7);
      expect(component.selectedTimeRange).toBe(7);
      expect(insightsService.getSavingsTrend).toHaveBeenCalledWith(7);
    });

    it('should format storage size correctly', () => {
      expect(component.formatStorageSize(500)).toBe('500.00 GB');
      expect(component.formatStorageSize(1500)).toBe('1.50 TB');
    });
  });
});
