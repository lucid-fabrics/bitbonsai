import { HttpService } from '@nestjs/axios';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { type Job, JobStage } from '@prisma/client';
import * as fs from 'fs';
import { of, throwError } from 'rxjs';
import { NodeConfigService } from '../../../core/services/node-config.service';
import { EncodingPreviewService } from '../../../encoding/encoding-preview.service';
import { JobPreviewController } from '../../controllers/job-preview.controller';
import { QueueService } from '../../queue.service';

jest.mock('fs', () => ({
  ...jest.requireActual('fs'),
  existsSync: jest.fn(),
  createReadStream: jest.fn(),
}));

const existsSyncMock = fs.existsSync as jest.Mock;
const createReadStreamMock = fs.createReadStream as jest.Mock;

const makeJob = (overrides: Partial<Job> = {}): Job =>
  ({
    id: 'job-1',
    stage: JobStage.ENCODING,
    filePath: '/previews/video.mkv',
    progress: 50,
    previewImagePaths: null,
    ...overrides,
  }) as unknown as Job;

function makeRes() {
  const res: Record<string, jest.Mock> = {
    status: jest.fn().mockReturnThis(),
    send: jest.fn().mockReturnThis(),
    setHeader: jest.fn().mockReturnThis(),
    pipe: jest.fn(),
  };
  // allow chaining res.status(x).send()
  res.status.mockImplementation(() => res);
  return res as unknown as import('express').Response;
}

describe('JobPreviewController', () => {
  let controller: JobPreviewController;

  const mockQueueService = {
    findOne: jest.fn(),
    update: jest.fn(),
    updateJobPreview: jest.fn(),
  };

  const mockNodeConfig = {
    getMainApiUrl: jest.fn(),
  };

  const mockHttpService = {
    get: jest.fn(),
  };

  const mockPreviewService = {
    captureManualPreview: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [JobPreviewController],
      providers: [
        { provide: QueueService, useValue: mockQueueService },
        { provide: NodeConfigService, useValue: mockNodeConfig },
        { provide: HttpService, useValue: mockHttpService },
        { provide: EncodingPreviewService, useValue: mockPreviewService },
      ],
    }).compile();

    controller = module.get(JobPreviewController);

    // Defaults
    mockNodeConfig.getMainApiUrl.mockReturnValue(null);
    existsSyncMock.mockReturnValue(true);
    process.env.PREVIEW_DIR = '/previews';
  });

  // ── getPreviewImage ───────────────────────────────────────────────────────

  describe('getPreviewImage', () => {
    it('proxies request to MAIN node and forwards image', async () => {
      mockNodeConfig.getMainApiUrl.mockReturnValue('http://main:3100');
      mockHttpService.get.mockReturnValue(
        of({ status: 200, headers: { 'content-type': 'image/jpeg' }, data: Buffer.from('img') })
      );

      const res = makeRes();
      await controller.getPreviewImage('job-1', '1', res);

      expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'image/jpeg');
      expect(res.send).toHaveBeenCalled();
    });

    it('proxies 204 from MAIN node as 204', async () => {
      mockNodeConfig.getMainApiUrl.mockReturnValue('http://main:3100');
      mockHttpService.get.mockReturnValue(of({ status: 204, headers: {}, data: null }));

      const res = makeRes();
      await controller.getPreviewImage('job-1', '1', res);

      expect(res.status).toHaveBeenCalledWith(204);
      expect(res.send).toHaveBeenCalled();
    });

    it('returns 204 when MAIN node proxy fails', async () => {
      mockNodeConfig.getMainApiUrl.mockReturnValue('http://main:3100');
      mockHttpService.get.mockReturnValue(throwError(() => new Error('Network error')));

      const res = makeRes();
      await controller.getPreviewImage('job-1', '1', res);

      expect(res.status).toHaveBeenCalledWith(204);
    });

    it('handles MAIN node 204 error response', async () => {
      mockNodeConfig.getMainApiUrl.mockReturnValue('http://main:3100');
      mockHttpService.get.mockReturnValue(throwError(() => ({ response: { status: 204 } })));

      const res = makeRes();
      await controller.getPreviewImage('job-1', '1', res);

      expect(res.status).toHaveBeenCalledWith(204);
    });

    it('throws NotFoundException for invalid index (0)', async () => {
      mockQueueService.findOne.mockResolvedValue(makeJob());
      const res = makeRes();
      await expect(controller.getPreviewImage('job-1', '0', res)).rejects.toThrow(
        NotFoundException
      );
    });

    it('throws NotFoundException for invalid index (10)', async () => {
      mockQueueService.findOne.mockResolvedValue(makeJob());
      const res = makeRes();
      await expect(controller.getPreviewImage('job-1', '10', res)).rejects.toThrow(
        NotFoundException
      );
    });

    it('throws NotFoundException for non-numeric index', async () => {
      mockQueueService.findOne.mockResolvedValue(makeJob());
      const res = makeRes();
      await expect(controller.getPreviewImage('job-1', 'abc', res)).rejects.toThrow(
        NotFoundException
      );
    });

    it('returns 204 when previewImagePaths is null', async () => {
      mockQueueService.findOne.mockResolvedValue(makeJob({ previewImagePaths: null }));
      const res = makeRes();
      await controller.getPreviewImage('job-1', '1', res);
      expect(res.status).toHaveBeenCalledWith(204);
    });

    it('returns 204 when requested preview index does not exist', async () => {
      mockQueueService.findOne.mockResolvedValue(
        makeJob({ previewImagePaths: JSON.stringify(['/previews/job-1/preview_1.jpg']) })
      );
      const res = makeRes();
      await controller.getPreviewImage('job-1', '5', res);
      expect(res.status).toHaveBeenCalledWith(204);
    });

    it('returns 204 and blocks path traversal attempt', async () => {
      const evilPath = '/etc/passwd';
      mockQueueService.findOne.mockResolvedValue(
        makeJob({ previewImagePaths: JSON.stringify([evilPath]) })
      );
      existsSyncMock.mockReturnValue(true);
      process.env.PREVIEW_DIR = '/previews';

      const res = makeRes();
      await controller.getPreviewImage('job-1', '1', res);

      expect(res.status).toHaveBeenCalledWith(204);
    });

    it('streams preview image when path is valid', async () => {
      const previewPath = '/previews/job-1/preview_1.jpg';
      mockQueueService.findOne.mockResolvedValue(
        makeJob({ previewImagePaths: JSON.stringify([previewPath]) })
      );
      existsSyncMock.mockReturnValue(true);
      process.env.PREVIEW_DIR = '/previews';

      const fakeStream = { on: jest.fn().mockReturnThis(), pipe: jest.fn() };
      createReadStreamMock.mockReturnValue(fakeStream);

      const res = makeRes();
      await controller.getPreviewImage('job-1', '1', res);

      expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'image/jpeg');
      expect(fakeStream.pipe).toHaveBeenCalledWith(res);
    });

    it('handles malformed previewImagePaths JSON gracefully', async () => {
      mockQueueService.findOne.mockResolvedValue(makeJob({ previewImagePaths: '{bad json' }));
      const res = makeRes();
      await controller.getPreviewImage('job-1', '1', res);
      expect(res.status).toHaveBeenCalledWith(204);
    });
  });

  // ── capturePreview ────────────────────────────────────────────────────────

  describe('capturePreview', () => {
    it('throws BadRequestException when job is not in ENCODING stage', async () => {
      mockQueueService.findOne.mockResolvedValue(makeJob({ stage: JobStage.QUEUED }));
      await expect(controller.capturePreview('job-1')).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when filePath does not exist', async () => {
      mockQueueService.findOne.mockResolvedValue(makeJob({ stage: JobStage.ENCODING }));
      existsSyncMock.mockReturnValue(false);
      await expect(controller.capturePreview('job-1')).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when progress is null', async () => {
      mockQueueService.findOne.mockResolvedValue(
        makeJob({ stage: JobStage.ENCODING, progress: null as unknown as number })
      );
      existsSyncMock.mockReturnValue(true);
      await expect(controller.capturePreview('job-1')).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when previewService throws', async () => {
      mockQueueService.findOne.mockResolvedValue(makeJob());
      existsSyncMock.mockReturnValue(true);
      mockPreviewService.captureManualPreview.mockRejectedValue(new Error('ffmpeg failed'));
      await expect(controller.capturePreview('job-1')).rejects.toThrow(BadRequestException);
    });

    it('appends new preview path and calls queueService.update', async () => {
      const existing = '/previews/job-1/preview_1.jpg';
      mockQueueService.findOne.mockResolvedValue(
        makeJob({ previewImagePaths: JSON.stringify([existing]) })
      );
      existsSyncMock.mockReturnValue(true);
      mockPreviewService.captureManualPreview.mockResolvedValue('/previews/job-1/manual_1.jpg');
      mockQueueService.update.mockResolvedValue(makeJob());

      await controller.capturePreview('job-1');

      const updateCall = mockQueueService.update.mock.calls[0];
      const updatedPaths = JSON.parse(updateCall[1].previewImagePaths);
      expect(updatedPaths).toContain(existing);
      expect(updatedPaths).toContain('/previews/job-1/manual_1.jpg');
    });

    it('creates new paths array when previewImagePaths is null', async () => {
      mockQueueService.findOne.mockResolvedValue(makeJob({ previewImagePaths: null }));
      existsSyncMock.mockReturnValue(true);
      mockPreviewService.captureManualPreview.mockResolvedValue('/previews/job-1/manual_1.jpg');
      mockQueueService.update.mockResolvedValue(makeJob());

      await controller.capturePreview('job-1');

      const updateCall = mockQueueService.update.mock.calls[0];
      const updatedPaths = JSON.parse(updateCall[1].previewImagePaths);
      expect(updatedPaths).toEqual(['/previews/job-1/manual_1.jpg']);
    });
  });
});
