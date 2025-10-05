import { AudioHandling, DeviceProfile, PolicyPreset, TargetCodec } from '../models/policy.model';
import { PolicyBo } from './policy.bo';

describe('PolicyBo', () => {
  describe('constructor and mapping', () => {
    it('should create instance from model', () => {
      const mockModel = {
        id: 'policy-1',
        name: 'Test Policy',
        preset: PolicyPreset.BALANCED_HEVC,
        target_codec: TargetCodec.HEVC,
        crf: 23,
        library_id: 'lib-1',
        device_profiles: [DeviceProfile.APPLE_TV, DeviceProfile.WEB],
        ffmpeg_flags: '-preset slow',
        audio_handling: AudioHandling.COPY,
        completed_jobs: 42,
        created_at: '2025-01-01T12:00:00Z',
        updated_at: '2025-01-02T14:30:00Z',
      };

      const bo = new PolicyBo(mockModel);

      expect(bo.id).toBe('policy-1');
      expect(bo.name).toBe('Test Policy');
      expect(bo.preset).toBe(PolicyPreset.BALANCED_HEVC);
      expect(bo.targetCodec).toBe(TargetCodec.HEVC);
      expect(bo.targetQuality).toBe(23);
      expect(bo.libraryId).toBe('lib-1');
      expect(bo.deviceProfiles).toEqual([DeviceProfile.APPLE_TV, DeviceProfile.WEB]);
      expect(bo.ffmpegFlags).toBe('-preset slow');
      expect(bo.audioHandling).toBe(AudioHandling.COPY);
      expect(bo.completedJobs).toBe(42);
      expect(bo.createdAt).toEqual(new Date('2025-01-01T12:00:00Z'));
      expect(bo.updatedAt).toEqual(new Date('2025-01-02T14:30:00Z'));
    });

    it('should handle missing optional fields', () => {
      const mockModel = {
        id: 'policy-2',
        name: 'Minimal Policy',
        preset: PolicyPreset.FAST_HEVC,
        target_codec: TargetCodec.HEVC,
        crf: 28,
        device_profiles: [],
        completed_jobs: 0,
        created_at: '2025-01-01T00:00:00Z',
        updated_at: '2025-01-01T00:00:00Z',
      };

      const bo = new PolicyBo(mockModel);

      expect(bo.id).toBe('policy-2');
      expect(bo.name).toBe('Minimal Policy');
      expect(bo.libraryId).toBeUndefined();
      expect(bo.ffmpegFlags).toBeUndefined();
      expect(bo.audioHandling).toBeUndefined();
      expect(bo.deviceProfiles).toEqual([]);
    });

    it('should handle null/undefined device_profiles gracefully', () => {
      const mockModel = {
        id: 'policy-3',
        name: 'Test Policy',
        preset: PolicyPreset.CUSTOM,
        target_codec: TargetCodec.AV1,
        crf: 30,
        completed_jobs: 5,
        created_at: '2025-01-01T00:00:00Z',
        updated_at: '2025-01-01T00:00:00Z',
      };

      expect(() => new PolicyBo(mockModel as never)).not.toThrow();
      const bo = new PolicyBo(mockModel as never);
      expect(bo.deviceProfiles).toEqual([]);
    });
  });

  describe('business logic methods', () => {
    it('should identify custom preset', () => {
      const customModel = {
        id: '1',
        name: 'Custom',
        preset: PolicyPreset.CUSTOM,
        target_codec: TargetCodec.HEVC,
        crf: 23,
        device_profiles: [],
        completed_jobs: 0,
        created_at: '2025-01-01T00:00:00Z',
        updated_at: '2025-01-01T00:00:00Z',
      };

      const bo = new PolicyBo(customModel);

      expect(bo.isCustomPreset).toBe(true);
    });

    it('should identify non-custom preset', () => {
      const balancedModel = {
        id: '2',
        name: 'Balanced',
        preset: PolicyPreset.BALANCED_HEVC,
        target_codec: TargetCodec.HEVC,
        crf: 23,
        device_profiles: [],
        completed_jobs: 0,
        created_at: '2025-01-01T00:00:00Z',
        updated_at: '2025-01-01T00:00:00Z',
      };

      const bo = new PolicyBo(balancedModel);

      expect(bo.isCustomPreset).toBe(false);
    });

    it('should detect library restriction when library_id is present', () => {
      const mockModel = {
        id: '1',
        name: 'Restricted',
        preset: PolicyPreset.BALANCED_HEVC,
        target_codec: TargetCodec.HEVC,
        crf: 23,
        library_id: 'lib-123',
        device_profiles: [],
        completed_jobs: 0,
        created_at: '2025-01-01T00:00:00Z',
        updated_at: '2025-01-01T00:00:00Z',
      };

      const bo = new PolicyBo(mockModel);

      expect(bo.hasLibraryRestriction).toBe(true);
    });

    it('should detect no library restriction when library_id is missing', () => {
      const mockModel = {
        id: '2',
        name: 'Unrestricted',
        preset: PolicyPreset.BALANCED_HEVC,
        target_codec: TargetCodec.HEVC,
        crf: 23,
        device_profiles: [],
        completed_jobs: 0,
        created_at: '2025-01-01T00:00:00Z',
        updated_at: '2025-01-01T00:00:00Z',
      };

      const bo = new PolicyBo(mockModel);

      expect(bo.hasLibraryRestriction).toBe(false);
    });

    it('should format created date', () => {
      const mockModel = {
        id: '1',
        name: 'Test',
        preset: PolicyPreset.BALANCED_HEVC,
        target_codec: TargetCodec.HEVC,
        crf: 23,
        device_profiles: [],
        completed_jobs: 0,
        created_at: '2025-01-15T12:30:00Z',
        updated_at: '2025-01-15T12:30:00Z',
      };

      const bo = new PolicyBo(mockModel);

      expect(bo.formattedCreatedAt).toBeDefined();
      expect(typeof bo.formattedCreatedAt).toBe('string');
    });
  });
});
