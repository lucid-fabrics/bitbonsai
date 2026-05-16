import { Test, type TestingModule } from '@nestjs/testing';
import * as nodemailer from 'nodemailer';
import { SettingsRepository } from '../../common/repositories/settings.repository';
import { EmailNotificationService } from './email.service';

jest.mock('nodemailer');

const mockSendMail = jest.fn().mockResolvedValue({ messageId: 'test-id' });
const mockVerify = jest.fn().mockResolvedValue(true);
const mockCreateTransport = nodemailer.createTransport as jest.Mock;

describe('EmailNotificationService', () => {
  let service: EmailNotificationService;
  let prisma: any;

  const validSmtpSettings = {
    smtpHost: 'smtp.example.com',
    smtpPort: 587,
    smtpSecure: false,
    smtpUser: 'user@example.com',
    smtpPass: 'secret',
    emailFrom: 'from@example.com',
    emailTo: 'to@example.com',
  };

  beforeEach(async () => {
    mockCreateTransport.mockReturnValue({
      sendMail: mockSendMail,
      verify: mockVerify,
    });

    const settingsRepoMock = {
      findFirst: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EmailNotificationService,
        { provide: SettingsRepository, useValue: settingsRepoMock },
      ],
    }).compile();

    service = module.get<EmailNotificationService>(EmailNotificationService);
    prisma = module.get(SettingsRepository);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('sendJobCompleted', () => {
    it('should send email when SMTP is configured', async () => {
      prisma.findFirst.mockResolvedValue(validSmtpSettings as never);

      await service.sendJobCompleted({
        fileLabel: 'movie.mkv',
        savedPercent: 35.5,
        savedBytes: BigInt(1073741824),
        duration: 120,
      });

      expect(mockSendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          from: 'from@example.com',
          to: 'to@example.com',
          subject: 'Encoding Complete: movie.mkv',
        })
      );
    });

    it('should do nothing when SMTP is not configured', async () => {
      prisma.findFirst.mockResolvedValue(null);

      await service.sendJobCompleted({ fileLabel: 'movie.mkv' });

      expect(mockSendMail).not.toHaveBeenCalled();
    });

    it('should do nothing when smtpHost is missing', async () => {
      prisma.findFirst.mockResolvedValue({
        smtpUser: 'user@example.com',
        emailTo: 'to@example.com',
      } as never);

      await service.sendJobCompleted({ fileLabel: 'movie.mkv' });

      expect(mockSendMail).not.toHaveBeenCalled();
    });

    it('should include space saved and duration in the email body', async () => {
      prisma.findFirst.mockResolvedValue(validSmtpSettings as never);

      await service.sendJobCompleted({
        fileLabel: 'movie.mkv',
        savedPercent: 40.0,
        duration: 185,
      });

      const call = mockSendMail.mock.calls[0][0] as { html: string };
      expect(call.html).toContain('40.0%');
      expect(call.html).toContain('3m 5s');
    });
  });

  describe('sendJobFailed', () => {
    it('should send failure email with subject containing the filename', async () => {
      prisma.findFirst.mockResolvedValue(validSmtpSettings as never);

      await service.sendJobFailed({
        fileLabel: 'corrupt.mkv',
        error: 'FFmpeg exited with code 1',
        retryCount: 2,
      });

      expect(mockSendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          subject: '⚠️ Encoding Failed: corrupt.mkv',
        })
      );
    });

    it('should do nothing when SMTP is not configured', async () => {
      prisma.findFirst.mockResolvedValue(null);

      await service.sendJobFailed({ fileLabel: 'movie.mkv' });

      expect(mockSendMail).not.toHaveBeenCalled();
    });

    it('should handle missing error gracefully', async () => {
      prisma.findFirst.mockResolvedValue(validSmtpSettings as never);

      await expect(
        service.sendJobFailed({ fileLabel: 'movie.mkv', error: null })
      ).resolves.not.toThrow();
    });
  });

  describe('sendDailyDigest', () => {
    it('should send daily digest email', async () => {
      prisma.findFirst.mockResolvedValue(validSmtpSettings as never);

      await service.sendDailyDigest({
        date: '2025-01-15',
        completed: 20,
        failed: 2,
        totalSavedGB: 8.5,
        topFiles: [{ name: 'big-movie.mkv', savedPercent: 45.0 }],
      });

      expect(mockSendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          subject: expect.stringContaining('20 encoded'),
        })
      );
    });

    it('should include success rate in the email body', async () => {
      prisma.findFirst.mockResolvedValue(validSmtpSettings as never);

      await service.sendDailyDigest({
        date: '2025-01-15',
        completed: 10,
        failed: 0,
        totalSavedGB: 5.0,
        topFiles: [],
      });

      const call = mockSendMail.mock.calls[0][0] as { html: string };
      expect(call.html).toContain('100.0%');
    });
  });

  describe('sendHealthAlert', () => {
    it('should send critical alert with correct subject', async () => {
      prisma.findFirst.mockResolvedValue(validSmtpSettings as never);

      await service.sendHealthAlert({
        type: 'node_offline',
        message: 'Node went offline unexpectedly',
        severity: 'critical',
      });

      expect(mockSendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          subject: '🚨 CRITICAL: node_offline',
        })
      );
    });

    it('should send warning alert with correct subject', async () => {
      prisma.findFirst.mockResolvedValue(validSmtpSettings as never);

      await service.sendHealthAlert({
        type: 'high_load',
        message: 'System load is elevated',
        severity: 'warning',
      });

      expect(mockSendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          subject: '⚠️ Warning: high_load',
        })
      );
    });
  });

  describe('testEmail', () => {
    it('should return success:true when SMTP verification and send succeed', async () => {
      const config = {
        host: 'smtp.example.com',
        port: 587,
        secure: false,
        auth: { user: 'user@example.com', pass: 'secret' },
        from: 'from@example.com',
        to: 'to@example.com',
      };

      const result = await service.testEmail(config);

      expect(result.success).toBe(true);
      expect(mockVerify).toHaveBeenCalled();
      expect(mockSendMail).toHaveBeenCalledWith(
        expect.objectContaining({ subject: '🧪 BitBonsai Email Test' })
      );
    });

    it('should return success:false with error message when verification fails', async () => {
      mockVerify.mockRejectedValueOnce(new Error('Authentication failed'));

      const config = {
        host: 'smtp.bad.com',
        port: 587,
        secure: false,
        auth: { user: 'bad', pass: 'wrong' },
        from: 'x@x.com',
        to: 'y@y.com',
      };

      const result = await service.testEmail(config);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Authentication failed');
    });
  });
});
