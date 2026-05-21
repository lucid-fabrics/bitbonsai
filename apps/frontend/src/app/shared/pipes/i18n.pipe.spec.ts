import { I18nService } from '../../core/services/i18n.service';
import { I18nPipe } from './i18n.pipe';

describe('I18nPipe', () => {
  let pipe: I18nPipe;
  let i18nService: jest.Mocked<I18nService>;

  beforeEach(() => {
    i18nService = { t: jest.fn() } as unknown as jest.Mocked<I18nService>;
    pipe = new I18nPipe(i18nService);
  });

  it('should create the pipe', () => {
    expect(pipe).toBeTruthy();
  });

  it('should delegate to i18nService.t with key only', () => {
    i18nService.t.mockReturnValue('Login');
    const result = pipe.transform('auth.login');
    expect(result).toBe('Login');
    expect(i18nService.t).toHaveBeenCalledWith('auth.login', undefined);
  });

  it('should delegate to i18nService.t with key and params', () => {
    i18nService.t.mockReturnValue('5 nodes');
    const result = pipe.transform('nodes.count', { count: 5 });
    expect(result).toBe('5 nodes');
    expect(i18nService.t).toHaveBeenCalledWith('nodes.count', { count: 5 });
  });

  it('should return whatever i18nService.t returns for missing keys', () => {
    i18nService.t.mockReturnValue('missing.key');
    expect(pipe.transform('missing.key')).toBe('missing.key');
  });

  it('should pass string param values through', () => {
    i18nService.t.mockReturnValue('Hello, Alice');
    pipe.transform('greeting', { name: 'Alice' });
    expect(i18nService.t).toHaveBeenCalledWith('greeting', { name: 'Alice' });
  });
});
