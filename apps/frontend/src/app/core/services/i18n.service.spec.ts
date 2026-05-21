import { TestBed } from '@angular/core/testing';
import { I18nService } from './i18n.service';

describe('I18nService', () => {
  let service: I18nService;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [I18nService] });
    service = TestBed.inject(I18nService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('t()', () => {
    it('should return the key itself when no translation is found', () => {
      expect(service.t('nonexistent.key.xyz')).toBe('nonexistent.key.xyz');
    });

    it('should resolve a known nested key from en.json', () => {
      expect(service.t('app.name')).toBe('BitBonsai');
    });

    it('should resolve a deeply nested key', () => {
      expect(service.t('auth.login')).toBe('Login');
    });

    it('should return key unchanged when params provided but key is missing', () => {
      expect(service.t('missing.key', { count: 5 })).toBe('missing.key');
    });

    it('should return plain translation when no params are needed', () => {
      expect(service.t('sidebar.connectedTo')).toBe('Connected to:');
    });
  });
});
