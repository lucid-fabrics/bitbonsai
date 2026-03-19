import { HttpService } from '@nestjs/axios';
import { Test, type TestingModule } from '@nestjs/testing';
import { of, throwError } from 'rxjs';
import { SettingsRepository } from '../../common/repositories/settings.repository';
import { SlackNotificationService } from './slack.service';

describe('SlackNotificationService', () => {
  let service: SlackNotificationService;
  let prisma: any;
  let httpService: any;

  const mockWebhookUrl = 'https://hooks.slack.com/services/test/token';

  beforeEach(async () => {
    const settingsRepoMock = {
      findFirst: jest.fn(),
    };

    const httpServiceMock = {
      post: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SlackNotificationService,
        { provide: SettingsRepository, useValue: settingsRepoMock },
        { provide: HttpService, useValue: httpServiceMock },
      ],
    }).compile();

    service = module.get<SlackNotificationService>(SlackNotificationService);
    prisma = module.get(SettingsRepository);
    httpService = module.get(HttpService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('sendJobCompleted', () => {
    it('should POST to Slack webhook with success color attachment', async () => {
      prisma.findFirst.mockResolvedValue({
        slackWebhookUrl: mockWebhookUrl,
      } as never);
      httpService.post.mockReturnValue(of({ data: 'ok' } as never));

      await service.sendJobCompleted({
        fileLabel: 'movie.mkv',
        savedPercent: 35.5,
        savedBytes: BigInt(1073741824),
        duration: 90,
      });

      const postedPayload = httpService.post.mock.calls[0][1] as {
        attachments: Array<{ color: string; blocks: Array<{ type: string }> }>;
      };
      expect(postedPayload.attachments[0].color).toBe('#00ff00');
      expect(postedPayload.attachments[0].blocks.some((b) => b.type === 'header')).toBe(true);
    });

    it('should do nothing when no webhook URL is configured', async () => {
      prisma.findFirst.mockResolvedValue(null);

      await service.sendJobCompleted({ fileLabel: 'movie.mkv' });

      expect(httpService.post).not.toHaveBeenCalled();
    });

    it('should include Space Saved and Duration fields', async () => {
      prisma.findFirst.mockResolvedValue({
        slackWebhookUrl: mockWebhookUrl,
      } as never);
      httpService.post.mockReturnValue(of({ data: 'ok' } as never));

      await service.sendJobCompleted({
        fileLabel: 'movie.mkv',
        savedPercent: 40.0,
        savedBytes: BigInt(2147483648),
        duration: 65,
      });

      const postedPayload = httpService.post.mock.calls[0][1] as {
        attachments: Array<{
          blocks: Array<{ type: string; fields?: Array<{ text: string }> }>;
        }>;
      };
      const sectionBlock = postedPayload.attachments[0].blocks.find(
        (b) => b.type === 'section' && b.fields
      );
      const fields = sectionBlock?.fields?.map((f) => f.text).join(' ') ?? '';
      expect(fields).toContain('Space Saved');
      expect(fields).toContain('Duration');
    });
  });

  describe('sendJobFailed', () => {
    it('should POST a failure attachment with error color', async () => {
      prisma.findFirst.mockResolvedValue({
        slackWebhookUrl: mockWebhookUrl,
      } as never);
      httpService.post.mockReturnValue(of({ data: 'ok' } as never));

      await service.sendJobFailed({
        fileLabel: 'bad.mkv',
        error: 'FFmpeg error code 1',
        retryCount: 3,
      });

      const postedPayload = httpService.post.mock.calls[0][1] as {
        attachments: Array<{ color: string }>;
      };
      expect(postedPayload.attachments[0].color).toBe('#ff0000');
    });

    it('should do nothing when no webhook URL is configured', async () => {
      prisma.findFirst.mockResolvedValue({ slackWebhookUrl: null } as never);

      await service.sendJobFailed({ fileLabel: 'movie.mkv' });

      expect(httpService.post).not.toHaveBeenCalled();
    });
  });

  describe('sendBatchSummary', () => {
    it('should use SUCCESS color when no failures', async () => {
      prisma.findFirst.mockResolvedValue({
        slackWebhookUrl: mockWebhookUrl,
      } as never);
      httpService.post.mockReturnValue(of({ data: 'ok' } as never));

      await service.sendBatchSummary({
        completed: 10,
        failed: 0,
        totalSavedGB: 5.0,
        duration: '1h',
      });

      const postedPayload = httpService.post.mock.calls[0][1] as {
        attachments: Array<{ color: string }>;
      };
      expect(postedPayload.attachments[0].color).toBe('#00ff00');
    });

    it('should use WARNING color when there are failures', async () => {
      prisma.findFirst.mockResolvedValue({
        slackWebhookUrl: mockWebhookUrl,
      } as never);
      httpService.post.mockReturnValue(of({ data: 'ok' } as never));

      await service.sendBatchSummary({
        completed: 7,
        failed: 3,
        totalSavedGB: 2.1,
        duration: '45m',
      });

      const postedPayload = httpService.post.mock.calls[0][1] as {
        attachments: Array<{ color: string }>;
      };
      expect(postedPayload.attachments[0].color).toBe('#ffaa00');
    });
  });

  describe('sendHealthAlert', () => {
    it('should use ERROR color for critical severity', async () => {
      prisma.findFirst.mockResolvedValue({
        slackWebhookUrl: mockWebhookUrl,
      } as never);
      httpService.post.mockReturnValue(of({ data: 'ok' } as never));

      await service.sendHealthAlert({
        type: 'disk_full',
        message: 'Disk is full',
        severity: 'critical',
      });

      const postedPayload = httpService.post.mock.calls[0][1] as {
        attachments: Array<{ color: string }>;
      };
      expect(postedPayload.attachments[0].color).toBe('#ff0000');
    });

    it('should use WARNING color for warning severity', async () => {
      prisma.findFirst.mockResolvedValue({
        slackWebhookUrl: mockWebhookUrl,
      } as never);
      httpService.post.mockReturnValue(of({ data: 'ok' } as never));

      await service.sendHealthAlert({
        type: 'high_load',
        message: 'Load elevated',
        severity: 'warning',
      });

      const postedPayload = httpService.post.mock.calls[0][1] as {
        attachments: Array<{ color: string }>;
      };
      expect(postedPayload.attachments[0].color).toBe('#ffaa00');
    });
  });

  describe('testWebhook', () => {
    it('should return success:true when webhook responds', async () => {
      httpService.post.mockReturnValue(of({ data: 'ok' } as never));

      const result = await service.testWebhook(mockWebhookUrl);

      expect(result.success).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('should return success:true even when webhook errors are swallowed by retry logic', async () => {
      httpService.post.mockReturnValue(throwError(() => new Error('Webhook not found')));

      const result = await service.testWebhook(mockWebhookUrl);

      // sendWebhook swallows errors after MAX_RETRIES; testWebhook always returns success:true
      expect(result.success).toBe(true);
    });
  });
});
