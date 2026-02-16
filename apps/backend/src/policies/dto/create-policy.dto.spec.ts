import { plainToClass } from 'class-transformer';
import { validate } from 'class-validator';
import { CreatePolicyDto, PolicyPreset, TargetCodec } from './create-policy.dto';

describe('CreatePolicyDto', () => {
  const validPolicyData = {
    name: 'Test Policy',
    preset: PolicyPreset.BALANCED_HEVC,
    targetCodec: TargetCodec.HEVC,
    targetQuality: 23,
    targetContainer: 'mkv',
    skipReencoding: true,
  };

  describe('targetContainer validation', () => {
    it('should accept valid container formats', async () => {
      const validContainers = ['mkv', 'mp4', 'webm', null];

      for (const container of validContainers) {
        const dto = plainToClass(CreatePolicyDto, {
          ...validPolicyData,
          targetContainer: container,
        });

        const errors = await validate(dto);
        const containerErrors = errors.filter((e) => e.property === 'targetContainer');

        expect(containerErrors).toHaveLength(0);
      }
    });

    it('should reject invalid container formats', async () => {
      const invalidContainers = ['avi', 'mov', 'flv', 'wmv', 'invalid'];

      for (const container of invalidContainers) {
        const dto = plainToClass(CreatePolicyDto, {
          ...validPolicyData,
          targetContainer: container,
        });

        const errors = await validate(dto);
        const containerErrors = errors.filter((e) => e.property === 'targetContainer');

        expect(containerErrors.length).toBeGreaterThan(0);
        expect(containerErrors[0].constraints).toHaveProperty('isIn');
        expect(containerErrors[0].constraints?.isIn).toContain('mkv, mp4, webm, or null');
      }
    });

    it('should be optional', async () => {
      const dto = plainToClass(CreatePolicyDto, {
        ...validPolicyData,
        targetContainer: undefined,
      });

      const errors = await validate(dto);
      const containerErrors = errors.filter((e) => e.property === 'targetContainer');

      expect(containerErrors).toHaveLength(0);
    });
  });

  describe('skipReencoding validation', () => {
    it('should accept boolean true', async () => {
      const dto = plainToClass(CreatePolicyDto, {
        ...validPolicyData,
        skipReencoding: true,
      });

      const errors = await validate(dto);
      const skipErrors = errors.filter((e) => e.property === 'skipReencoding');

      expect(skipErrors).toHaveLength(0);
    });

    it('should accept boolean false', async () => {
      const dto = plainToClass(CreatePolicyDto, {
        ...validPolicyData,
        skipReencoding: false,
      });

      const errors = await validate(dto);
      const skipErrors = errors.filter((e) => e.property === 'skipReencoding');

      expect(skipErrors).toHaveLength(0);
    });

    it('should be optional', async () => {
      const dto = plainToClass(CreatePolicyDto, {
        ...validPolicyData,
        skipReencoding: undefined,
      });

      const errors = await validate(dto);
      const skipErrors = errors.filter((e) => e.property === 'skipReencoding');

      expect(skipErrors).toHaveLength(0);
    });

    it('should reject non-boolean values', async () => {
      const invalidValues = ['true', 'false', 1, 0, 'yes', 'no'];

      for (const value of invalidValues) {
        const dto = plainToClass(CreatePolicyDto, {
          ...validPolicyData,
          skipReencoding: value,
        });

        const errors = await validate(dto);
        const skipErrors = errors.filter((e) => e.property === 'skipReencoding');

        expect(skipErrors.length).toBeGreaterThan(0);
      }
    });
  });

  describe('required fields validation', () => {
    it('should reject missing name', async () => {
      const dto = plainToClass(CreatePolicyDto, {
        ...validPolicyData,
        name: undefined,
      });

      const errors = await validate(dto);
      const nameErrors = errors.filter((e) => e.property === 'name');

      expect(nameErrors.length).toBeGreaterThan(0);
    });

    it('should reject empty name', async () => {
      const dto = plainToClass(CreatePolicyDto, {
        ...validPolicyData,
        name: '',
      });

      const errors = await validate(dto);
      const nameErrors = errors.filter((e) => e.property === 'name');

      expect(nameErrors.length).toBeGreaterThan(0);
    });

    it('should reject missing preset', async () => {
      const dto = plainToClass(CreatePolicyDto, {
        ...validPolicyData,
        preset: undefined,
      });

      const errors = await validate(dto);
      const presetErrors = errors.filter((e) => e.property === 'preset');

      expect(presetErrors.length).toBeGreaterThan(0);
    });

    it('should accept missing targetCodec (now optional)', async () => {
      const dto = plainToClass(CreatePolicyDto, {
        ...validPolicyData,
        targetCodec: undefined,
      });

      const errors = await validate(dto);
      const codecErrors = errors.filter((e) => e.property === 'targetCodec');

      expect(codecErrors.length).toBe(0);
    });

    it('should accept missing targetQuality (now optional)', async () => {
      const dto = plainToClass(CreatePolicyDto, {
        ...validPolicyData,
        targetQuality: undefined,
      });

      const errors = await validate(dto);
      const qualityErrors = errors.filter((e) => e.property === 'targetQuality');

      expect(qualityErrors.length).toBe(0);
    });
  });

  describe('targetQuality validation', () => {
    it('should accept quality within range 0-51', async () => {
      const validQualities = [0, 18, 23, 28, 51];

      for (const quality of validQualities) {
        const dto = plainToClass(CreatePolicyDto, {
          ...validPolicyData,
          targetQuality: quality,
        });

        const errors = await validate(dto);
        const qualityErrors = errors.filter((e) => e.property === 'targetQuality');

        expect(qualityErrors).toHaveLength(0);
      }
    });

    it('should reject quality below 0', async () => {
      const dto = plainToClass(CreatePolicyDto, {
        ...validPolicyData,
        targetQuality: -1,
      });

      const errors = await validate(dto);
      const qualityErrors = errors.filter((e) => e.property === 'targetQuality');

      expect(qualityErrors.length).toBeGreaterThan(0);
    });

    it('should reject quality above 51', async () => {
      const dto = plainToClass(CreatePolicyDto, {
        ...validPolicyData,
        targetQuality: 52,
      });

      const errors = await validate(dto);
      const qualityErrors = errors.filter((e) => e.property === 'targetQuality');

      expect(qualityErrors.length).toBeGreaterThan(0);
    });
  });

  describe('complete valid policy', () => {
    it('should pass validation with all fields', async () => {
      const dto = plainToClass(CreatePolicyDto, {
        name: 'Complete Policy',
        preset: PolicyPreset.CUSTOM,
        targetCodec: TargetCodec.HEVC,
        targetQuality: 23,
        targetContainer: 'mkv',
        skipReencoding: true,
        libraryId: 'lib-123',
        deviceProfiles: {
          appleTv: true,
          roku: true,
          web: true,
          chromecast: true,
          ps5: true,
          xbox: true,
        },
        advancedSettings: {
          ffmpegFlags: ['-preset', 'medium'],
          hwaccel: 'auto',
          audioCodec: 'copy',
          subtitleHandling: 'copy',
        },
        atomicReplace: true,
        verifyOutput: true,
        skipSeeding: true,
      });

      const errors = await validate(dto);
      expect(errors).toHaveLength(0);
    });

    it('should pass validation with minimal fields', async () => {
      const dto = plainToClass(CreatePolicyDto, {
        name: 'Minimal Policy',
        preset: PolicyPreset.BALANCED_HEVC,
        targetCodec: TargetCodec.HEVC,
        targetQuality: 23,
      });

      const errors = await validate(dto);
      expect(errors).toHaveLength(0);
    });
  });
});
