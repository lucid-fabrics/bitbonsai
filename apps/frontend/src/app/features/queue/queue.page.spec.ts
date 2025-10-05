import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { QueueComponent } from './queue.page';
import { QueueClient } from './services/queue.client';

describe('QueueComponent', () => {
  let component: QueueComponent;
  let fixture: ComponentFixture<QueueComponent>;
  let queueClient: jest.Mocked<QueueClient>;

  const mockQueueData = {
    jobs: [
      {
        id: '1',
        fileName: 'test.mp4',
        status: 'ENCODING' as const,
        progress: 50,
        nodeName: 'node1',
        createdAt: '2025-01-01T00:00:00Z',
      },
    ],
    stats: {
      queued: 5,
      encoding: 3,
      completed: 100,
      failed: 2,
      totalSavedBytes: '1048576',
    },
  };

  beforeEach(async () => {
    const queueClientMock = {
      getQueue: jest.fn().mockReturnValue(of(mockQueueData)),
      cancelJob: jest.fn().mockReturnValue(of(void 0)),
      retryJob: jest.fn().mockReturnValue(of(void 0)),
    } as unknown as jest.Mocked<QueueClient>;

    await TestBed.configureTestingModule({
      imports: [QueueComponent],
      providers: [{ provide: QueueClient, useValue: queueClientMock }],
    }).compileComponents();

    fixture = TestBed.createComponent(QueueComponent);
    component = fixture.componentInstance;
    queueClient = TestBed.inject(QueueClient) as jest.Mocked<QueueClient>;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  describe('component initialization', () => {
    it('should start polling on init', () => {
      expect(component).toBeDefined();
      expect(queueClient.getQueue).toHaveBeenCalled();
    });
  });

  describe('template rendering', () => {
    it('should render component template', () => {
      const compiled = fixture.nativeElement as HTMLElement;
      expect(compiled).toBeDefined();
    });
  });

  describe('user interactions', () => {
    it('should toggle job details when toggleJobDetails is called', () => {
      expect(component.expandedJobId).toBeNull();

      component.toggleJobDetails('1');
      expect(component.expandedJobId).toBe('1');

      component.toggleJobDetails('1');
      expect(component.expandedJobId).toBeNull();
    });

    it('should open cancel dialog when openCancelDialog is called', () => {
      const event = new Event('click');
      jest.spyOn(event, 'stopPropagation');

      component.openCancelDialog('1', event);

      expect(event.stopPropagation).toHaveBeenCalled();
      expect(component.showCancelDialog).toBe(true);
      expect(component.selectedJobId).toBe('1');
    });

    it('should close cancel dialog when closeCancelDialog is called', () => {
      component.showCancelDialog = true;
      component.selectedJobId = '1';

      component.closeCancelDialog();

      expect(component.showCancelDialog).toBe(false);
      expect(component.selectedJobId).toBeNull();
    });

    it('should call queueClient.cancelJob when confirmCancel is called', () => {
      component.selectedJobId = '1';

      component.confirmCancel();

      expect(queueClient.cancelJob).toHaveBeenCalledWith('1');
    });

    it('should call queueClient.retryJob when retryJob is called', () => {
      const event = new Event('click');
      jest.spyOn(event, 'stopPropagation');

      component.retryJob('1', event);

      expect(event.stopPropagation).toHaveBeenCalled();
      expect(queueClient.retryJob).toHaveBeenCalledWith('1');
    });
  });

  describe('helper methods', () => {
    it('should return correct status class', () => {
      expect(component.getStatusClass('QUEUED')).toBe('status-queued');
      expect(component.getStatusClass('ENCODING')).toBe('status-encoding');
      expect(component.getStatusClass('COMPLETED')).toBe('status-completed');
    });

    it('should return correct status icon', () => {
      expect(component.getStatusIcon('QUEUED')).toBe('fa-clock');
      expect(component.getStatusIcon('ENCODING')).toBe('fa-spinner fa-spin');
      expect(component.getStatusIcon('COMPLETED')).toBe('fa-check-circle');
    });

    it('should format bytes correctly', () => {
      expect(component.formatBytes(0)).toBe('0 B');
      expect(component.formatBytes(1024)).toBe('1.00 KB');
      expect(component.formatBytes(1048576)).toBe('1.00 MB');
    });
  });
});
