import { provideHttpClient } from '@angular/common/http';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TranslocoTestingModule } from '@ngneat/transloco';
import { provideMockStore } from '@ngrx/store/testing';
import { of } from 'rxjs';
import { QueueClient } from '../../core/clients/queue.client';
import { QueueComponent } from './queue.page';

describe('QueueComponent', () => {
  let component: QueueComponent;
  let fixture: ComponentFixture<QueueComponent>;
  let _queueClient: jest.Mocked<QueueClient>;

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
      imports: [QueueComponent, TranslocoTestingModule.forRoot({})],
      schemas: [NO_ERRORS_SCHEMA],
      providers: [
        provideHttpClient(),
        provideMockStore(),
        provideRouter([]),
        { provide: QueueClient, useValue: queueClientMock },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(QueueComponent);
    component = fixture.componentInstance;
    _queueClient = TestBed.inject(QueueClient) as jest.Mocked<QueueClient>;
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
