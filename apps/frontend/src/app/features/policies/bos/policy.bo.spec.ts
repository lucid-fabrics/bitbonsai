import {
  AudioHandling,
  DeviceProfile,
  type HardwareAcceleration,
  PolicyPreset,
  TargetCodec,
} from '../models/policy.model';
import { PolicyBo } from './policy.bo';

describe('PolicyBo', () => {
  describe('constructor and mapping', () => {
    describe('snake_case (TypeScript interface) properties', () => {
      it('should create instance from snake_case model with all fields', () => {
        const mockModel = {
          id: '550e8400-e29b-41d4-a716-446655440000',
          name: 'Test Policy',
          preset: PolicyPreset.BALANCED_HEVC,
          target_codec: TargetCodec.HEVC,
          crf: 23,
          library_id: '660e8400-e29b-41d4-a716-446655440001',
          device_profiles: {
            appleTV: true,
            roku: false,
            web: true,
            chromecast: false,
          },
          ffmpeg_flags: '-preset slow',
          audio_handling: AudioHandling.COPY,
          hardware_acceleration: 'NVIDIA' as HardwareAcceleration,
          completed_jobs: 42,
          created_at: '2025-01-01T12:00:00Z',
          updated_at: '2025-01-02T14:30:00Z',
        };

        const bo = new PolicyBo(mockModel);

        expect(bo.id).toBe('550e8400-e29b-41d4-a716-446655440000');
        expect(bo.name).toBe('Test Policy');
        expect(bo.preset).toBe(PolicyPreset.BALANCED_HEVC);
        expect(bo.targetCodec).toBe(TargetCodec.HEVC);
        expect(bo.targetQuality).toBe(23);
        expect(bo.libraryId).toBe('660e8400-e29b-41d4-a716-446655440001');
        expect(bo.deviceProfiles).toEqual([DeviceProfile.APPLE_TV, DeviceProfile.WEB]);
        expect(bo.ffmpegFlags).toBe('-preset slow');
        expect(bo.audioHandling).toBe(AudioHandling.COPY);
        expect(bo.hardwareAcceleration).toBe('NVIDIA');
        expect(bo.completedJobs).toBe(42);
        expect(bo.createdAt).toEqual(new Date('2025-01-01T12:00:00Z'));
        expect(bo.updatedAt).toEqual(new Date('2025-01-02T14:30:00Z'));
      });

      it('should handle minimal snake_case model with required fields only', () => {
        const mockModel = {
          id: '770e8400-e29b-41d4-a716-446655440002',
          name: 'Minimal Policy',
          preset: PolicyPreset.FAST_HEVC,
          target_codec: TargetCodec.HEVC,
          crf: 28,
          device_profiles: {
            appleTV: false,
            roku: false,
            web: false,
            chromecast: false,
          },
          completed_jobs: 0,
          created_at: '2025-01-01T00:00:00Z',
          updated_at: '2025-01-01T00:00:00Z',
        };

        const bo = new PolicyBo(mockModel);

        expect(bo.id).toBe('770e8400-e29b-41d4-a716-446655440002');
        expect(bo.name).toBe('Minimal Policy');
        expect(bo.libraryId).toBeUndefined();
        expect(bo.ffmpegFlags).toBeUndefined();
        expect(bo.audioHandling).toBeUndefined();
        expect(bo.hardwareAcceleration).toBeUndefined();
        expect(bo.deviceProfiles).toEqual([]);
      });
    });

    describe('camelCase (API response) properties', () => {
      it('should create instance from camelCase API response with all fields', () => {
        const mockApiResponse = {
          id: '880e8400-e29b-41d4-a716-446655440003',
          name: 'API Policy',
          preset: PolicyPreset.QUALITY_AV1,
          targetCodec: TargetCodec.AV1,
          targetQuality: 25,
          libraryId: '990e8400-e29b-41d4-a716-446655440004',
          deviceProfiles: {
            appleTV: true,
            roku: true,
            web: true,
            chromecast: true,
          },
          ffmpegFlags: '-preset veryslow',
          audioHandling: AudioHandling.TRANSCODE_AAC,
          hardwareAcceleration: 'INTEL_QSV' as HardwareAcceleration,
          completedJobs: 100,
          createdAt: '2025-02-01T10:00:00Z',
          updatedAt: '2025-02-15T16:45:00Z',
        };

        const bo = new PolicyBo(mockApiResponse as never);

        expect(bo.id).toBe('880e8400-e29b-41d4-a716-446655440003');
        expect(bo.name).toBe('API Policy');
        expect(bo.preset).toBe(PolicyPreset.QUALITY_AV1);
        expect(bo.targetCodec).toBe(TargetCodec.AV1);
        expect(bo.targetQuality).toBe(25);
        expect(bo.libraryId).toBe('990e8400-e29b-41d4-a716-446655440004');
        expect(bo.deviceProfiles).toEqual([
          DeviceProfile.APPLE_TV,
          DeviceProfile.ROKU,
          DeviceProfile.WEB,
          DeviceProfile.CHROMECAST,
        ]);
        expect(bo.ffmpegFlags).toBe('-preset veryslow');
        expect(bo.audioHandling).toBe(AudioHandling.TRANSCODE_AAC);
        expect(bo.hardwareAcceleration).toBe('INTEL_QSV');
        expect(bo.completedJobs).toBe(100);
        expect(bo.createdAt).toEqual(new Date('2025-02-01T10:00:00Z'));
        expect(bo.updatedAt).toEqual(new Date('2025-02-15T16:45:00Z'));
      });

      it('should handle minimal camelCase API response with required fields only', () => {
        const mockApiResponse = {
          id: 'aa0e8400-e29b-41d4-a716-446655440005',
          name: 'Minimal API Policy',
          preset: PolicyPreset.COPY_IF_COMPLIANT,
          targetCodec: TargetCodec.H264,
          targetQuality: 18,
          deviceProfiles: {
            appleTV: false,
            roku: false,
            web: false,
            chromecast: false,
          },
          completedJobs: 5,
          createdAt: '2025-03-01T00:00:00Z',
          updatedAt: '2025-03-01T00:00:00Z',
        };

        const bo = new PolicyBo(mockApiResponse as never);

        expect(bo.id).toBe('aa0e8400-e29b-41d4-a716-446655440005');
        expect(bo.name).toBe('Minimal API Policy');
        expect(bo.preset).toBe(PolicyPreset.COPY_IF_COMPLIANT);
        expect(bo.targetCodec).toBe(TargetCodec.H264);
        expect(bo.targetQuality).toBe(18);
        expect(bo.libraryId).toBeUndefined();
        expect(bo.ffmpegFlags).toBeUndefined();
        expect(bo.audioHandling).toBeUndefined();
        expect(bo.hardwareAcceleration).toBeUndefined();
        expect(bo.deviceProfiles).toEqual([]);
      });

      it('should prioritize camelCase over snake_case when both present', () => {
        const mixedModel = {
          id: 'bb0e8400-e29b-41d4-a716-446655440006',
          name: 'Mixed Case Policy',
          preset: PolicyPreset.BALANCED_HEVC,
          // Both camelCase and snake_case present - camelCase should win
          targetCodec: TargetCodec.HEVC,
          target_codec: TargetCodec.AV1,
          targetQuality: 22,
          crf: 30,
          libraryId: 'cc0e8400-e29b-41d4-a716-446655440007',
          library_id: 'dd0e8400-e29b-41d4-a716-446655440008',
          deviceProfiles: {
            appleTV: true,
            roku: true,
            web: false,
            chromecast: false,
          },
          device_profiles: {
            appleTV: false,
            roku: false,
            web: true,
            chromecast: true,
          },
          ffmpegFlags: '-preset medium',
          ffmpeg_flags: '-preset ultrafast',
          audioHandling: AudioHandling.TRANSCODE_AC3,
          audio_handling: AudioHandling.COPY,
          hardwareAcceleration: 'AMD' as HardwareAcceleration,
          hardware_acceleration: 'APPLE_M' as HardwareAcceleration,
          completedJobs: 50,
          completed_jobs: 75,
          createdAt: '2025-04-01T12:00:00Z',
          created_at: '2025-04-15T12:00:00Z',
          updatedAt: '2025-05-01T12:00:00Z',
          updated_at: '2025-05-15T12:00:00Z',
        };

        const bo = new PolicyBo(mixedModel as never);

        // Should use camelCase values
        expect(bo.targetCodec).toBe(TargetCodec.HEVC);
        expect(bo.targetQuality).toBe(22);
        expect(bo.libraryId).toBe('cc0e8400-e29b-41d4-a716-446655440007');
        expect(bo.deviceProfiles).toEqual([DeviceProfile.APPLE_TV, DeviceProfile.ROKU]);
        expect(bo.ffmpegFlags).toBe('-preset medium');
        expect(bo.audioHandling).toBe(AudioHandling.TRANSCODE_AC3);
        expect(bo.hardwareAcceleration).toBe('AMD');
        expect(bo.completedJobs).toBe(50);
        expect(bo.createdAt).toEqual(new Date('2025-04-01T12:00:00Z'));
        expect(bo.updatedAt).toEqual(new Date('2025-05-01T12:00:00Z'));
      });
    });

    describe('deviceProfiles conversion', () => {
      it('should convert all device profiles when all true', () => {
        const mockModel = {
          id: 'ee0e8400-e29b-41d4-a716-446655440009',
          name: 'All Devices',
          preset: PolicyPreset.BALANCED_HEVC,
          target_codec: TargetCodec.HEVC,
          crf: 23,
          device_profiles: {
            appleTV: true,
            roku: true,
            web: true,
            chromecast: true,
          },
          completed_jobs: 0,
          created_at: '2025-01-01T00:00:00Z',
          updated_at: '2025-01-01T00:00:00Z',
        };

        const bo = new PolicyBo(mockModel);

        expect(bo.deviceProfiles).toHaveLength(4);
        expect(bo.deviceProfiles).toContain(DeviceProfile.APPLE_TV);
        expect(bo.deviceProfiles).toContain(DeviceProfile.ROKU);
        expect(bo.deviceProfiles).toContain(DeviceProfile.WEB);
        expect(bo.deviceProfiles).toContain(DeviceProfile.CHROMECAST);
      });

      it('should convert only appleTV when true', () => {
        const mockModel = {
          id: 'ff0e8400-e29b-41d4-a716-446655440010',
          name: 'Apple TV Only',
          preset: PolicyPreset.BALANCED_HEVC,
          target_codec: TargetCodec.HEVC,
          crf: 23,
          device_profiles: {
            appleTV: true,
            roku: false,
            web: false,
            chromecast: false,
          },
          completed_jobs: 0,
          created_at: '2025-01-01T00:00:00Z',
          updated_at: '2025-01-01T00:00:00Z',
        };

        const bo = new PolicyBo(mockModel);

        expect(bo.deviceProfiles).toEqual([DeviceProfile.APPLE_TV]);
      });

      it('should convert only roku when true', () => {
        const mockModel = {
          id: '110e8400-e29b-41d4-a716-446655440011',
          name: 'Roku Only',
          preset: PolicyPreset.BALANCED_HEVC,
          targetCodec: TargetCodec.HEVC,
          targetQuality: 23,
          deviceProfiles: {
            appleTV: false,
            roku: true,
            web: false,
            chromecast: false,
          },
          completedJobs: 0,
          createdAt: '2025-01-01T00:00:00Z',
          updatedAt: '2025-01-01T00:00:00Z',
        };

        const bo = new PolicyBo(mockModel as never);

        expect(bo.deviceProfiles).toEqual([DeviceProfile.ROKU]);
      });

      it('should convert only web when true', () => {
        const mockModel = {
          id: '220e8400-e29b-41d4-a716-446655440012',
          name: 'Web Only',
          preset: PolicyPreset.BALANCED_HEVC,
          targetCodec: TargetCodec.HEVC,
          targetQuality: 23,
          deviceProfiles: {
            appleTV: false,
            roku: false,
            web: true,
            chromecast: false,
          },
          completedJobs: 0,
          createdAt: '2025-01-01T00:00:00Z',
          updatedAt: '2025-01-01T00:00:00Z',
        };

        const bo = new PolicyBo(mockModel as never);

        expect(bo.deviceProfiles).toEqual([DeviceProfile.WEB]);
      });

      it('should convert only chromecast when true', () => {
        const mockModel = {
          id: '330e8400-e29b-41d4-a716-446655440013',
          name: 'Chromecast Only',
          preset: PolicyPreset.BALANCED_HEVC,
          targetCodec: TargetCodec.HEVC,
          targetQuality: 23,
          deviceProfiles: {
            appleTV: false,
            roku: false,
            web: false,
            chromecast: true,
          },
          completedJobs: 0,
          createdAt: '2025-01-01T00:00:00Z',
          updatedAt: '2025-01-01T00:00:00Z',
        };

        const bo = new PolicyBo(mockModel as never);

        expect(bo.deviceProfiles).toEqual([DeviceProfile.CHROMECAST]);
      });

      it('should return empty array when all device profiles false', () => {
        const mockModel = {
          id: '440e8400-e29b-41d4-a716-446655440014',
          name: 'No Devices',
          preset: PolicyPreset.BALANCED_HEVC,
          target_codec: TargetCodec.HEVC,
          crf: 23,
          device_profiles: {
            appleTV: false,
            roku: false,
            web: false,
            chromecast: false,
          },
          completed_jobs: 0,
          created_at: '2025-01-01T00:00:00Z',
          updated_at: '2025-01-01T00:00:00Z',
        };

        const bo = new PolicyBo(mockModel);

        expect(bo.deviceProfiles).toEqual([]);
      });

      it('should return empty array when device_profiles is undefined', () => {
        const mockModel = {
          id: '550e8400-e29b-41d4-a716-446655440015',
          name: 'Undefined Devices',
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

      it('should convert mixed device profiles correctly', () => {
        const mockModel = {
          id: '660e8400-e29b-41d4-a716-446655440016',
          name: 'Mixed Devices',
          preset: PolicyPreset.BALANCED_HEVC,
          targetCodec: TargetCodec.HEVC,
          targetQuality: 23,
          deviceProfiles: {
            appleTV: true,
            roku: false,
            web: true,
            chromecast: false,
          },
          completedJobs: 0,
          createdAt: '2025-01-01T00:00:00Z',
          updatedAt: '2025-01-01T00:00:00Z',
        };

        const bo = new PolicyBo(mockModel as never);

        expect(bo.deviceProfiles).toHaveLength(2);
        expect(bo.deviceProfiles).toContain(DeviceProfile.APPLE_TV);
        expect(bo.deviceProfiles).toContain(DeviceProfile.WEB);
        expect(bo.deviceProfiles).not.toContain(DeviceProfile.ROKU);
        expect(bo.deviceProfiles).not.toContain(DeviceProfile.CHROMECAST);
      });
    });

    describe('edge cases and error scenarios', () => {
      it('should handle missing optional fields gracefully', () => {
        const mockModel = {
          id: '770e8400-e29b-41d4-a716-446655440017',
          name: 'Minimal with Nulls',
          preset: PolicyPreset.FAST_HEVC,
          target_codec: TargetCodec.HEVC,
          crf: 28,
          device_profiles: {
            appleTV: false,
            roku: false,
            web: false,
            chromecast: false,
          },
          completed_jobs: 0,
          created_at: '2025-01-01T00:00:00Z',
          updated_at: '2025-01-01T00:00:00Z',
        };

        const bo = new PolicyBo(mockModel);

        expect(bo.libraryId).toBeUndefined();
        expect(bo.ffmpegFlags).toBeUndefined();
        expect(bo.audioHandling).toBeUndefined();
        expect(bo.hardwareAcceleration).toBeUndefined();
      });

      it('should handle date strings in ISO format', () => {
        const mockModel = {
          id: '880e8400-e29b-41d4-a716-446655440018',
          name: 'Date Test',
          preset: PolicyPreset.BALANCED_HEVC,
          target_codec: TargetCodec.HEVC,
          crf: 23,
          device_profiles: {
            appleTV: false,
            roku: false,
            web: false,
            chromecast: false,
          },
          completed_jobs: 0,
          created_at: '2025-06-15T14:30:45.123Z',
          updated_at: '2025-06-20T09:15:30.456Z',
        };

        const bo = new PolicyBo(mockModel);

        expect(bo.createdAt).toBeInstanceOf(Date);
        expect(bo.updatedAt).toBeInstanceOf(Date);
        expect(bo.createdAt.toISOString()).toBe('2025-06-15T14:30:45.123Z');
        expect(bo.updatedAt.toISOString()).toBe('2025-06-20T09:15:30.456Z');
      });

      it('should handle all codec types', () => {
        const codecs = [TargetCodec.HEVC, TargetCodec.AV1, TargetCodec.VP9, TargetCodec.H264];

        codecs.forEach((codec, index) => {
          const mockModel = {
            id: `990e8400-e29b-41d4-a716-44665544001${index}`,
            name: `Policy ${codec}`,
            preset: PolicyPreset.CUSTOM,
            target_codec: codec,
            crf: 23,
            device_profiles: {
              appleTV: false,
              roku: false,
              web: false,
              chromecast: false,
            },
            completed_jobs: 0,
            created_at: '2025-01-01T00:00:00Z',
            updated_at: '2025-01-01T00:00:00Z',
          };

          const bo = new PolicyBo(mockModel);
          expect(bo.targetCodec).toBe(codec);
        });
      });

      it('should handle all audio handling types', () => {
        const audioTypes = [
          AudioHandling.COPY,
          AudioHandling.TRANSCODE_AAC,
          AudioHandling.TRANSCODE_AC3,
        ];

        audioTypes.forEach((audio, index) => {
          const mockModel = {
            id: `aa0e8400-e29b-41d4-a716-44665544002${index}`,
            name: `Policy ${audio}`,
            preset: PolicyPreset.CUSTOM,
            target_codec: TargetCodec.HEVC,
            crf: 23,
            device_profiles: {
              appleTV: false,
              roku: false,
              web: false,
              chromecast: false,
            },
            audio_handling: audio,
            completed_jobs: 0,
            created_at: '2025-01-01T00:00:00Z',
            updated_at: '2025-01-01T00:00:00Z',
          };

          const bo = new PolicyBo(mockModel);
          expect(bo.audioHandling).toBe(audio);
        });
      });

      it('should handle zero completed jobs', () => {
        const mockModel = {
          id: 'bb0e8400-e29b-41d4-a716-446655440023',
          name: 'Zero Jobs',
          preset: PolicyPreset.BALANCED_HEVC,
          target_codec: TargetCodec.HEVC,
          crf: 23,
          device_profiles: {
            appleTV: false,
            roku: false,
            web: false,
            chromecast: false,
          },
          completed_jobs: 0,
          created_at: '2025-01-01T00:00:00Z',
          updated_at: '2025-01-01T00:00:00Z',
        };

        const bo = new PolicyBo(mockModel);
        expect(bo.completedJobs).toBe(0);
      });

      it('should handle large completed jobs count', () => {
        const mockModel = {
          id: 'cc0e8400-e29b-41d4-a716-446655440024',
          name: 'Many Jobs',
          preset: PolicyPreset.BALANCED_HEVC,
          targetCodec: TargetCodec.HEVC,
          targetQuality: 23,
          deviceProfiles: {
            appleTV: false,
            roku: false,
            web: false,
            chromecast: false,
          },
          completedJobs: 999999,
          createdAt: '2025-01-01T00:00:00Z',
          updatedAt: '2025-01-01T00:00:00Z',
        };

        const bo = new PolicyBo(mockModel as never);
        expect(bo.completedJobs).toBe(999999);
      });
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
