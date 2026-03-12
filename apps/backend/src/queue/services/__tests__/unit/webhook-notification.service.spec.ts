import { HttpService } from '@nestjs/axios';
import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../../../prisma/prisma.service';
import { createMockPrismaService } from '../../../../testing/mock-providers';
import { WebhookEventType, WebhookNotificationService } from '../../webhook-notification.service';

describe('WebhookNotificationService', () => {
  let service: WebhookNotificationService;
  let prisma: ReturnType<typeof createMockPrismaService>;
  let httpService: { post: jest.Mock };

  beforeEach(async () => {
    prisma = createMockPrismaService();
    httpService = { post: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WebhookNotificationService,
        { provide: PrismaService, useValue: prisma },
        { provide: HttpService, useValue: httpService },
      ],
    }).compile();

    service = module.get<WebhookNotificationService>(WebhookNotificationService);

    jest.spyOn((service as any).logger, 'log').mockImplementation();
    jest.spyOn((service as any).logger, 'warn').mockImplementation();
    jest.spyOn((service as any).logger, 'debug').mockImplementation();
    jest.spyOn((service as any).logger, 'error').mockImplementation();

    // Reset rate limiter between tests
    (service as any).lastNotificationTime = 0;
  });

  afterEach(() => {
    jest.clearAllMocks();
    jest.restoreAllMocks();
  });

  const mockWebhookSettings = (
    enabled: boolean,
    url: string | null = 'https://hooks.example.com/webhook',
    secret: string | null = null,
    events: string[] | null = null
  ) => {
    prisma.settings.findFirst.mockResolvedValue({
      webhookUrl: url,
      webhookSecret: secret,
      webhookEvents: events,
    });
  };

  describe('sendJobNotification', () => {
    it('should skip when webhooks are disabled', async () => {
      // webhookEnabled is hardcoded to false in getWebhookSettings
      mockWebhookSettings(false);

      await service.sendJobNotification(WebhookEventType.JOB_COMPLETED, { id: 'job-1' });

      expect(httpService.post).not.toHaveBeenCalled();
    });

    it('should skip when no webhook URL configured', async () => {
      mockWebhookSettings(true, null);

      await service.sendJobNotification(WebhookEventType.JOB_COMPLETED, { id: 'job-1' });

      expect(httpService.post).not.toHaveBeenCalled();
    });

    it('should not throw on errors', async () => {
      prisma.settings.findFirst.mockRejectedValue(new Error('DB error'));

      await expect(
        service.sendJobNotification(WebhookEventType.JOB_COMPLETED, { id: 'job-1' })
      ).resolves.not.toThrow();
    });
  });

  describe('sendHealthAlert', () => {
    it('should skip when webhooks are disabled', async () => {
      mockWebhookSettings(false);

      await service.sendHealthAlert('CPU_HIGH', 'CPU usage critical');

      expect(httpService.post).not.toHaveBeenCalled();
    });

    it('should not throw on errors', async () => {
      prisma.settings.findFirst.mockRejectedValue(new Error('Error'));

      await expect(service.sendHealthAlert('DISK_FULL', 'Disk space low')).resolves.not.toThrow();
    });
  });

  describe('sendBatchCompleteNotification', () => {
    it('should skip when webhooks are disabled', async () => {
      mockWebhookSettings(false);

      await service.sendBatchCompleteNotification(10, 8, 2, BigInt(1000000));

      expect(httpService.post).not.toHaveBeenCalled();
    });

    it('should not throw on errors', async () => {
      prisma.settings.findFirst.mockRejectedValue(new Error('Error'));

      await expect(
        service.sendBatchCompleteNotification(5, 5, 0, BigInt(500000))
      ).resolves.not.toThrow();
    });
  });

  describe('dead-letter queue', () => {
    it('should start with empty DLQ', () => {
      const stats = service.getDeadLetterQueueStats();

      expect(stats.size).toBe(0);
      expect(stats.oldestAge).toBeNull();
    });

    it('should add failed webhooks to DLQ via addToDeadLetterQueue', () => {
      const payload = {
        event: WebhookEventType.JOB_COMPLETED,
        timestamp: new Date().toISOString(),
        data: { jobId: 'job-1' },
      };

      (service as any).addToDeadLetterQueue(payload, 'https://example.com', null, 'Timeout');

      const stats = service.getDeadLetterQueueStats();

      expect(stats.size).toBe(1);
      expect(stats.oldestAge).toBeGreaterThanOrEqual(0);
    });

    it('should dedup existing DLQ entries', () => {
      const payload = {
        event: WebhookEventType.JOB_COMPLETED,
        timestamp: '2026-01-01T00:00:00Z',
        data: { jobId: 'job-1' },
      };

      (service as any).addToDeadLetterQueue(payload, 'https://example.com', null, 'Error 1');
      (service as any).addToDeadLetterQueue(payload, 'https://example.com', null, 'Error 2');

      const stats = service.getDeadLetterQueueStats();

      expect(stats.size).toBe(1); // Deduped
    });

    it('should enforce max DLQ size', () => {
      for (let i = 0; i < 110; i++) {
        const payload = {
          event: WebhookEventType.JOB_COMPLETED,
          timestamp: `2026-01-01T00:00:${String(i).padStart(2, '0')}Z`,
          data: { jobId: `job-${i}` },
        };
        (service as any).addToDeadLetterQueue(payload, 'https://example.com', null, `Error ${i}`);
      }

      const stats = service.getDeadLetterQueueStats();

      expect(stats.size).toBeLessThanOrEqual(100);
    });
  });

  describe('processDeadLetterQueue', () => {
    it('should skip when DLQ is empty', async () => {
      await service.processDeadLetterQueue();

      expect(httpService.post).not.toHaveBeenCalled();
    });

    it('should skip when already processing', async () => {
      (service as any).isProcessingDLQ = true;

      await service.processDeadLetterQueue();

      expect(httpService.post).not.toHaveBeenCalled();

      (service as any).isProcessingDLQ = false; // Reset
    });

    it('should remove expired webhooks', async () => {
      const oldDate = new Date(Date.now() - 25 * 60 * 60 * 1000); // 25 hours ago

      (service as any).deadLetterQueue = [
        {
          payload: {
            event: WebhookEventType.JOB_COMPLETED,
            timestamp: oldDate.toISOString(),
            data: {},
          },
          url: 'https://example.com',
          secret: null,
          attempts: 3,
          lastAttempt: oldDate,
          firstFailure: oldDate,
          lastError: 'Timeout',
        },
      ];

      await service.processDeadLetterQueue();

      expect(service.getDeadLetterQueueStats().size).toBe(0);
    });

    it('should remove items exceeding max retries', async () => {
      (service as any).deadLetterQueue = [
        {
          payload: {
            event: WebhookEventType.JOB_FAILED,
            timestamp: new Date().toISOString(),
            data: {},
          },
          url: 'https://example.com',
          secret: null,
          attempts: 11, // > MAX_DLQ_RETRIES (10)
          lastAttempt: new Date(),
          firstFailure: new Date(),
          lastError: 'Persistent failure',
        },
      ];

      await service.processDeadLetterQueue();

      expect(service.getDeadLetterQueueStats().size).toBe(0);
    });

    it('should reset isProcessingDLQ on completion', async () => {
      await service.processDeadLetterQueue();

      expect((service as any).isProcessingDLQ).toBe(false);
    });
  });

  describe('onModuleDestroy', () => {
    it('should log warning if DLQ has items', () => {
      (service as any).deadLetterQueue = [
        {
          payload: { event: WebhookEventType.JOB_COMPLETED, timestamp: '', data: {} },
          url: 'https://example.com',
          secret: null,
          attempts: 1,
          lastAttempt: new Date(),
          firstFailure: new Date(),
          lastError: 'Error',
        },
      ];

      service.onModuleDestroy();

      expect((service as any).logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('1 undelivered webhooks')
      );
    });

    it('should not log when DLQ is empty', () => {
      service.onModuleDestroy();

      expect((service as any).logger.warn).not.toHaveBeenCalled();
    });
  });
});
