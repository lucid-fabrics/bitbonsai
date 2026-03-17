import { ContainerBo } from './container.bo';

describe('ContainerBo', () => {
  describe('FORMATS', () => {
    it('should define all container formats', () => {
      expect(ContainerBo.FORMATS).toHaveLength(4);

      const values = ContainerBo.FORMATS.map((f) => f.value);
      expect(values).toContain('mkv');
      expect(values).toContain('mp4');
      expect(values).toContain('webm');
      expect(values).toContain(null);
    });

    it('should have complete metadata for each format', () => {
      ContainerBo.FORMATS.forEach((format) => {
        expect(format.value).toBeDefined();
        expect(format.label).toBeDefined();
        expect(format.description).toBeDefined();
        expect(format.icon).toBeDefined();
        expect(format.extension).toBeDefined();
      });
    });
  });

  describe('getFormat', () => {
    it('should return format for valid value', () => {
      const mkv = ContainerBo.getFormat('mkv');
      expect(mkv).toBeDefined();
      expect(mkv?.value).toBe('mkv');
      expect(mkv?.label).toBe('MKV');
    });

    it('should return format for null value', () => {
      const keepOriginal = ContainerBo.getFormat(null);
      expect(keepOriginal).toBeDefined();
      expect(keepOriginal?.value).toBe(null);
      expect(keepOriginal?.label).toBe('Keep Original');
    });

    it('should return undefined for invalid value', () => {
      const invalid = ContainerBo.getFormat('invalid');
      expect(invalid).toBeUndefined();
    });
  });

  describe('getLabel', () => {
    it('should return correct label for mkv', () => {
      expect(ContainerBo.getLabel('mkv')).toBe('MKV');
    });

    it('should return correct label for mp4', () => {
      expect(ContainerBo.getLabel('mp4')).toBe('MP4');
    });

    it('should return correct label for webm', () => {
      expect(ContainerBo.getLabel('webm')).toBe('WebM');
    });

    it('should return correct label for null', () => {
      expect(ContainerBo.getLabel(null)).toBe('Keep Original');
    });

    it('should return Unknown for invalid value', () => {
      expect(ContainerBo.getLabel('invalid')).toBe('Unknown');
    });
  });

  describe('getDescription', () => {
    it('should return description for valid format', () => {
      const description = ContainerBo.getDescription('mkv');
      expect(description).toContain('Matroska');
      expect(description).toContain('Universal compatibility');
    });

    it('should return empty string for invalid format', () => {
      expect(ContainerBo.getDescription('invalid')).toBe('');
    });
  });

  describe('getIcon', () => {
    it('should return icon for valid format', () => {
      expect(ContainerBo.getIcon('mkv')).toBe('videocam');
      expect(ContainerBo.getIcon('mp4')).toBe('play-circle');
      expect(ContainerBo.getIcon('webm')).toBe('globe');
      expect(ContainerBo.getIcon(null)).toBe('lock-closed');
    });

    it('should return help-circle for invalid format', () => {
      expect(ContainerBo.getIcon('invalid')).toBe('help-circle');
    });
  });

  describe('isValid', () => {
    it('should return true for valid formats', () => {
      expect(ContainerBo.isValid('mkv')).toBe(true);
      expect(ContainerBo.isValid('mp4')).toBe(true);
      expect(ContainerBo.isValid('webm')).toBe(true);
      expect(ContainerBo.isValid(null)).toBe(true);
    });

    it('should return false for invalid formats', () => {
      expect(ContainerBo.isValid('avi')).toBe(false);
      expect(ContainerBo.isValid('mov')).toBe(false);
      expect(ContainerBo.isValid('invalid')).toBe(false);
    });
  });

  describe('getValidValues', () => {
    it('should return array of all valid values', () => {
      const values = ContainerBo.getValidValues();
      expect(values).toHaveLength(4);
      expect(values).toContain('mkv');
      expect(values).toContain('mp4');
      expect(values).toContain('webm');
      expect(values).toContain(null);
    });
  });

  describe('getFormatOptions', () => {
    it('should return options for dropdown', () => {
      const options = ContainerBo.getFormatOptions();
      expect(options).toHaveLength(4);

      options.forEach((option) => {
        expect(option).toHaveProperty('value');
        expect(option).toHaveProperty('label');
        expect(option).toHaveProperty('description');
      });
    });
  });

  describe('needsContainerChange', () => {
    it('should return false when target is null (keep original)', () => {
      expect(ContainerBo.needsContainerChange('mkv', null)).toBe(false);
      expect(ContainerBo.needsContainerChange('mp4', null)).toBe(false);
      expect(ContainerBo.needsContainerChange(null, null)).toBe(false);
    });

    it('should return false when source matches target', () => {
      expect(ContainerBo.needsContainerChange('mkv', 'mkv')).toBe(false);
      expect(ContainerBo.needsContainerChange('mp4', 'mp4')).toBe(false);
      expect(ContainerBo.needsContainerChange('webm', 'webm')).toBe(false);
    });

    it('should return true when source differs from target', () => {
      expect(ContainerBo.needsContainerChange('mkv', 'mp4')).toBe(true);
      expect(ContainerBo.needsContainerChange('mp4', 'mkv')).toBe(true);
      expect(ContainerBo.needsContainerChange('webm', 'mkv')).toBe(true);
    });

    it('should handle matroska as mkv', () => {
      expect(ContainerBo.needsContainerChange('matroska', 'mkv')).toBe(false);
      expect(ContainerBo.needsContainerChange('mkv', 'matroska')).toBe(false);
      expect(ContainerBo.needsContainerChange('matroska', 'mp4')).toBe(true);
    });

    it('should be case insensitive', () => {
      expect(ContainerBo.needsContainerChange('MKV', 'mkv')).toBe(false);
      expect(ContainerBo.needsContainerChange('Mp4', 'MP4')).toBe(false);
    });

    it('should handle whitespace', () => {
      expect(ContainerBo.needsContainerChange(' mkv ', 'mkv')).toBe(false);
      expect(ContainerBo.needsContainerChange('mkv', ' mkv ')).toBe(false);
    });
  });

  describe('getRemuxExplanation', () => {
    it('should explain fast remux when codec matches and container changes', () => {
      const explanation = ContainerBo.getRemuxExplanation('h264', 'h264', 'mp4', 'mkv');
      expect(explanation).toContain('Fast remux');
      expect(explanation).toContain('MP4');
      expect(explanation).toContain('MKV');
      expect(explanation).toContain('seconds');
      expect(explanation).toContain('no re-encoding');
    });

    it('should explain skip when codec and container both match', () => {
      const explanation = ContainerBo.getRemuxExplanation('hevc', 'hevc', 'mkv', 'mkv');
      expect(explanation).toContain('already matches target');
      expect(explanation).toContain('skipped');
    });

    it('should explain full transcode when codec differs', () => {
      const explanation = ContainerBo.getRemuxExplanation('h264', 'hevc', 'mp4', 'mkv');
      expect(explanation).toContain('Full transcode');
      expect(explanation).toContain('h264');
      expect(explanation).toContain('hevc');
      expect(explanation).toContain('hours');
      expect(explanation).toContain('quality settings apply');
    });

    it('should handle case insensitivity in codec comparison', () => {
      const explanation1 = ContainerBo.getRemuxExplanation('H264', 'h264', 'mp4', 'mkv');
      expect(explanation1).toContain('Fast remux');

      const explanation2 = ContainerBo.getRemuxExplanation('HEVC', 'hevc', 'mkv', 'mkv');
      expect(explanation2).toContain('already matches target');
    });

    it('should explain skip when target container is null', () => {
      const explanation = ContainerBo.getRemuxExplanation('hevc', 'hevc', 'mkv', null);
      expect(explanation).toContain('already matches target');
      expect(explanation).toContain('skipped');
    });
  });
});
