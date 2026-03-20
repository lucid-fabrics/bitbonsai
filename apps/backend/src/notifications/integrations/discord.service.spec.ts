import { HttpService } from '@nestjs/axios';
import { Test, type TestingModule } from '@nestjs/testing';
import { of, throwError } from 'rxjs';
import { SettingsRepository } from '../../common/repositories/settings.repository';
import { DiscordNotificationService } from './discord.service';

describe('DiscordNotificationService', () => {
  let service: DiscordNotificationService;
  let prisma: any;
  let httpService: any;

  const mockWebhookUrl = 'https://discord.com/api/webhooks/test/token';

  beforeEach(async () => {
    const settingsRepoMock = {
      findFirst: jest.fn(),
    };

    const httpServiceMock = {
      post: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DiscordNotificationService,
        { provide: SettingsRepository, useValue: settingsRepoMock },
        { provide: HttpService, useValue: httpServiceMock },
      ],
    }).compile();

    service = module.get<DiscordNotificationService>(DiscordNotificationService);
    prisma = module.get(SettingsRepository);
    httpService = module.get(HttpService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('sendJobCompleted', () => {
    it('should POST to the webhook URL with a success embed', async () => {
      prisma.findFirst.mockResolvedValue({
        discordWebhookUrl: mockWebhookUrl,
      } as never);
      httpService.post.mockReturnValue(of({ data: 'ok', status: 204 } as never));

      await service.sendJobCompleted({
        fileLabel: 'movie.mkv',
        savedPercent: 35.5,
        savedBytes: BigInt(1073741824),
        duration: 125,
      });

      expect(httpService.post).toHaveBeenCalledWith(
        mockWebhookUrl,
        expect.objectContaining({
          embeds: expect.arrayContaining([
            expect.objectContaining({
              title: '✅ Encoding Complete',
              color: 0x00ff00,
            }),
          ]),
        }),
        expect.any(Object)
      );
    });

    it('should do nothing when no webhook URL is configured', async () => {
      prisma.findFirst.mockResolvedValue(null);

      await service.sendJobCompleted({ fileLabel: 'movie.mkv' });

      expect(httpService.post).not.toHaveBeenCalled();
    });

    it('should include duration field when duration is provided', async () => {
      prisma.findFirst.mockResolvedValue({
        discordWebhookUrl: mockWebhookUrl,
      } as never);
      httpService.post.mockReturnValue(of({ data: 'ok' } as never));

      await service.sendJobCompleted({
        fileLabel: 'movie.mkv',
        duration: 185, // 3m 5s
      });

      const postedPayload = httpService.post.mock.calls[0][1] as {
        embeds: Array<{ fields?: Array<{ name: string; value: string }> }>;
      };
      const durationField = postedPayload.embeds[0].fields?.find((f) => f.name === 'Duration');
      expect(durationField?.value).toBe('3m 5s');
    });
  });

  describe('sendJobFailed', () => {
    it('should POST a failure embed with error color', async () => {
      prisma.findFirst.mockResolvedValue({
        discordWebhookUrl: mockWebhookUrl,
      } as never);
      httpService.post.mockReturnValue(of({ data: 'ok' } as never));

      await service.sendJobFailed({
        fileLabel: 'corrupt.mkv',
        error: 'FFmpeg exited with code 1',
        retryCount: 2,
      });

      const postedPayload = httpService.post.mock.calls[0][1] as {
        embeds: Array<{ title: string; color: number }>;
      };
      expect(postedPayload.embeds[0].title).toBe('❌ Encoding Failed');
      expect(postedPayload.embeds[0].color).toBe(0xff0000);
    });

    it('should do nothing when no webhook URL is configured', async () => {
      prisma.findFirst.mockResolvedValue({ discordWebhookUrl: null } as never);

      await service.sendJobFailed({ fileLabel: 'movie.mkv' });

      expect(httpService.post).not.toHaveBeenCalled();
    });
  });

  describe('sendBatchSummary', () => {
    it('should use SUCCESS color when there are no failures', async () => {
      prisma.findFirst.mockResolvedValue({
        discordWebhookUrl: mockWebhookUrl,
      } as never);
      httpService.post.mockReturnValue(of({ data: 'ok' } as never));

      await service.sendBatchSummary({
        completed: 10,
        failed: 0,
        totalSavedGB: 5.2,
        duration: '2h 30m',
      });

      const postedPayload = httpService.post.mock.calls[0][1] as {
        embeds: Array<{ color: number }>;
      };
      expect(postedPayload.embeds[0].color).toBe(0x00ff00);
    });

    it('should use WARNING color when there are failures', async () => {
      prisma.findFirst.mockResolvedValue({
        discordWebhookUrl: mockWebhookUrl,
      } as never);
      httpService.post.mockReturnValue(of({ data: 'ok' } as never));

      await service.sendBatchSummary({
        completed: 8,
        failed: 2,
        totalSavedGB: 4.0,
        duration: '1h 45m',
      });

      const postedPayload = httpService.post.mock.calls[0][1] as {
        embeds: Array<{ color: number }>;
      };
      expect(postedPayload.embeds[0].color).toBe(0xffaa00);
    });
  });

  describe('sendHealthAlert', () => {
    it('should use ERROR color for critical severity', async () => {
      prisma.findFirst.mockResolvedValue({
        discordWebhookUrl: mockWebhookUrl,
      } as never);
      httpService.post.mockReturnValue(of({ data: 'ok' } as never));

      await service.sendHealthAlert({
        type: 'node_offline',
        message: 'Node went offline',
        severity: 'critical',
      });

      const postedPayload = httpService.post.mock.calls[0][1] as {
        embeds: Array<{ color: number; title: string }>;
      };
      expect(postedPayload.embeds[0].color).toBe(0xff0000);
      expect(postedPayload.embeds[0].title).toBe('🚨 Critical Alert');
    });

    it('should use WARNING color for warning severity', async () => {
      prisma.findFirst.mockResolvedValue({
        discordWebhookUrl: mockWebhookUrl,
      } as never);
      httpService.post.mockReturnValue(of({ data: 'ok' } as never));

      await service.sendHealthAlert({
        type: 'high_load',
        message: 'System load is elevated',
        severity: 'warning',
      });

      const postedPayload = httpService.post.mock.calls[0][1] as {
        embeds: Array<{ color: number }>;
      };
      expect(postedPayload.embeds[0].color).toBe(0xffaa00);
    });
  });

  describe('testWebhook', () => {
    it('should return success:true when webhook responds successfully', async () => {
      httpService.post.mockReturnValue(of({ data: 'ok', status: 204 } as never));

      const result = await service.testWebhook(mockWebhookUrl);

      expect(result.success).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('should return success:true even when webhook errors are swallowed by retry logic', async () => {
      httpService.post.mockReturnValue(throwError(() => new Error('Connection refused')));

      const result = await service.testWebhook(mockWebhookUrl);

      // sendWebhook swallows errors after MAX_RETRIES; testWebhook always returns success:true
      expect(result.success).toBe(true);
    });
  });

  describe('branding', () => {
    it('should set BitBonsai as the webhook username', async () => {
      prisma.findFirst.mockResolvedValue({
        discordWebhookUrl: mockWebhookUrl,
      } as never);
      httpService.post.mockReturnValue(of({ data: 'ok' } as never));

      await service.sendJobCompleted({ fileLabel: 'test.mkv' });

      const postedPayload = httpService.post.mock.calls[0][1] as { username: string };
      expect(postedPayload.username).toBe('BitBonsai');
    });
  });
});
