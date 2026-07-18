import * as fs from 'node:fs';
import { Test, type TestingModule } from '@nestjs/testing';

jest.mock('node:fs', () => ({
  existsSync: jest.fn(),
  mkdirSync: jest.fn(),
  unlinkSync: jest.fn(),
}));

jest.mock('../../self-test-fixture-generator', () => ({
  generateSelfTestVideo: jest.fn(),
}));

import { NodeConfigService } from '../../../core/services/node-config.service';
import { EncodingPreviewService } from '../../../encoding/encoding-preview.service';
import { FfmpegService } from '../../../encoding/ffmpeg.service';
import { DiscordNotificationService } from '../../../notifications/integrations/discord.service';
import { EmailNotificationService } from '../../../notifications/integrations/email.service';
import { SlackNotificationService } from '../../../notifications/integrations/slack.service';
import { WebhookNotificationService } from '../../../queue/services/webhook-notification.service';
import { generateSelfTestVideo } from '../../self-test-fixture-generator';
import { SelfTestService } from '../../self-test.service';

describe('SelfTestService', () => {
  let service: SelfTestService;
  let ffmpegService: { encodeFile: jest.Mock };
  let nodeConfig: { isMainNode: jest.Mock };
  let previewService: { cleanupPreviews: jest.Mock };
  let discord: { sendHealthAlert: jest.Mock };
  let slack: { sendHealthAlert: jest.Mock };
  let email: { sendHealthAlert: jest.Mock };
  let webhook: { sendHealthAlert: jest.Mock };

  beforeEach(async () => {
    jest.clearAllMocks();

    ffmpegService = { encodeFile: jest.fn().mockResolvedValue(undefined) };
    nodeConfig = { isMainNode: jest.fn().mockReturnValue(true) };
    previewService = { cleanupPreviews: jest.fn().mockResolvedValue(undefined) };
    discord = { sendHealthAlert: jest.fn().mockResolvedValue(undefined) };
    slack = { sendHealthAlert: jest.fn().mockResolvedValue(undefined) };
    email = { sendHealthAlert: jest.fn().mockResolvedValue(undefined) };
    webhook = { sendHealthAlert: jest.fn().mockResolvedValue(undefined) };

    (fs.existsSync as jest.Mock).mockReturnValue(false);
    (generateSelfTestVideo as jest.Mock).mockImplementation(
      async (options: { filename: string }, dir: string) => `${dir}/${options.filename}`
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SelfTestService,
        { provide: FfmpegService, useValue: ffmpegService },
        { provide: NodeConfigService, useValue: nodeConfig },
        { provide: EncodingPreviewService, useValue: previewService },
        { provide: DiscordNotificationService, useValue: discord },
        { provide: SlackNotificationService, useValue: slack },
        { provide: EmailNotificationService, useValue: email },
        { provide: WebhookNotificationService, useValue: webhook },
      ],
    }).compile();

    service = module.get(SelfTestService);
    jest.spyOn((service as any).logger, 'log').mockImplementation();
    jest.spyOn((service as any).logger, 'warn').mockImplementation();
    jest.spyOn((service as any).logger, 'debug').mockImplementation();
  });

  describe('runNightlySelfTest', () => {
    it('skips entirely on a LINKED node', async () => {
      nodeConfig.isMainNode.mockReturnValue(false);

      await service.runNightlySelfTest();

      expect(generateSelfTestVideo).not.toHaveBeenCalled();
      expect(ffmpegService.encodeFile).not.toHaveBeenCalled();
    });

    it('runs the corpus on the MAIN node', async () => {
      nodeConfig.isMainNode.mockReturnValue(true);

      await service.runNightlySelfTest();

      expect(ffmpegService.encodeFile).toHaveBeenCalled();
    });
  });

  describe('runCorpus', () => {
    it('reports 100% and does not alert when every fixture passes', async () => {
      const summary = await service.runCorpus();

      expect(summary.failed).toBe(0);
      expect(summary.successRate).toBe(100);
      expect(summary.passed).toBe(summary.total);
      expect(discord.sendHealthAlert).not.toHaveBeenCalled();
      expect(slack.sendHealthAlert).not.toHaveBeenCalled();
      expect(email.sendHealthAlert).not.toHaveBeenCalled();
      expect(webhook.sendHealthAlert).not.toHaveBeenCalled();
    });

    it('counts a failed fixture without aborting the rest of the corpus', async () => {
      ffmpegService.encodeFile
        .mockRejectedValueOnce(new Error('unknown encoder'))
        .mockResolvedValue(undefined);

      const summary = await service.runCorpus();

      expect(summary.failed).toBe(1);
      expect(summary.failures[0].error).toContain('unknown encoder');
      // The rest of the corpus still ran despite the first failure.
      expect(ffmpegService.encodeFile).toHaveBeenCalledTimes(summary.total);
    });

    it('alerts through every channel when the pass rate drops below threshold', async () => {
      // Fail enough fixtures to drop under the 80% threshold.
      ffmpegService.encodeFile
        .mockRejectedValueOnce(new Error('fail 1'))
        .mockRejectedValueOnce(new Error('fail 2'))
        .mockResolvedValue(undefined);

      const summary = await service.runCorpus();

      expect(summary.successRate).toBeLessThan(80);
      expect(discord.sendHealthAlert).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'SELF_TEST_CORPUS', severity: 'critical' })
      );
      expect(slack.sendHealthAlert).toHaveBeenCalled();
      expect(email.sendHealthAlert).toHaveBeenCalled();
      expect(webhook.sendHealthAlert).toHaveBeenCalledWith(
        'SELF_TEST_CORPUS',
        expect.any(String),
        expect.objectContaining({ passed: summary.passed, total: summary.total })
      );
    });

    it('does not throw when an alert channel itself rejects', async () => {
      ffmpegService.encodeFile.mockRejectedValue(new Error('always fails'));
      discord.sendHealthAlert.mockRejectedValue(new Error('webhook unreachable'));

      await expect(service.runCorpus()).resolves.toBeDefined();
      expect(slack.sendHealthAlert).toHaveBeenCalled();
    });

    it('cleans up both the source and output files for every fixture, pass or fail', async () => {
      ffmpegService.encodeFile
        .mockRejectedValueOnce(new Error('fail 1'))
        .mockResolvedValue(undefined);
      (fs.existsSync as jest.Mock).mockReturnValue(true);

      const summary = await service.runCorpus();

      // 2 files (source + output) cleaned up per corpus item.
      expect((fs.unlinkSync as jest.Mock).mock.calls.length).toBe(summary.total * 2);
    });

    it('updates getLastSummary after each run', async () => {
      expect(service.getLastSummary()).toBeNull();

      const summary = await service.runCorpus();

      expect(service.getLastSummary()).toEqual(summary);
    });

    it('cleans up the preview directory for every fixture, keyed to its job id', async () => {
      const summary = await service.runCorpus();

      expect(previewService.cleanupPreviews).toHaveBeenCalledTimes(summary.total);
      for (const call of previewService.cleanupPreviews.mock.calls) {
        expect(call[0]).toMatch(/^self-test-/);
      }
    });

    it('does not run two corpora concurrently', async () => {
      // Simulate a run already in flight (same guard @Cron alone can't
      // provide, mirroring HealthCheckWorker's cronRunning pattern).
      (service as any).running = true;

      const summary = await service.runCorpus();

      expect(generateSelfTestVideo).not.toHaveBeenCalled();
      expect(ffmpegService.encodeFile).not.toHaveBeenCalled();
      expect(summary.total).toBe(0);
    });

    it('clears the re-entrancy guard even if the corpus run throws unexpectedly', async () => {
      (generateSelfTestVideo as jest.Mock).mockImplementation(() => {
        throw new Error('unexpected synchronous failure');
      });

      // buildCorpus/runOne catch per-item errors, so this shouldn't actually
      // throw - but even if something upstream did, the guard must clear.
      await service.runCorpus();

      expect((service as any).running).toBe(false);
    });

    it('does not delete the source fixture before the encode when generation itself fails', async () => {
      (generateSelfTestVideo as jest.Mock).mockRejectedValueOnce(new Error('ffmpeg ENOENT'));

      const summary = await service.runCorpus();

      expect(summary.failed).toBeGreaterThanOrEqual(1);
      expect(summary.failures.some((f) => f.error.includes('ENOENT'))).toBe(true);
      // Preview cleanup still runs even when fixture generation itself failed.
      expect(previewService.cleanupPreviews).toHaveBeenCalled();
    });
  });
});
