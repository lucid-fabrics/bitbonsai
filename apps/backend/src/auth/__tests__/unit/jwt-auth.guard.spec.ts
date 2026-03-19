import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test, type TestingModule } from '@nestjs/testing';
import { SettingsRepository } from '../../../common/repositories/settings.repository';
import { JwtAuthGuard } from '../../guards/jwt-auth.guard';

describe('JwtAuthGuard', () => {
  let guard: JwtAuthGuard;
  let reflector: Reflector;
  let settingsRepository: jest.Mocked<SettingsRepository>;

  const mockExecutionContext = (
    ip = '192.168.1.100',
    url = '/api/test',
    method = 'GET'
  ): ExecutionContext => {
    const request = { ip, url, method, headers: {} };
    return {
      switchToHttp: () => ({
        getRequest: () => request,
        getResponse: () => ({}),
      }),
      getHandler: () => jest.fn(),
      getClass: () => jest.fn(),
      getArgs: () => [],
      getArgByIndex: () => null,
      switchToRpc: () => ({ getContext: jest.fn(), getData: jest.fn() }),
      switchToWs: () => ({ getClient: jest.fn(), getData: jest.fn(), getPattern: jest.fn() }),
      getType: () => 'http',
    } as unknown as ExecutionContext;
  };

  beforeEach(async () => {
    settingsRepository = {
      findFirst: jest.fn(),
    } as unknown as jest.Mocked<SettingsRepository>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        JwtAuthGuard,
        Reflector,
        { provide: SettingsRepository, useValue: settingsRepository },
      ],
    }).compile();

    guard = module.get<JwtAuthGuard>(JwtAuthGuard);
    reflector = module.get<Reflector>(Reflector);

    // Suppress logger output
    jest.spyOn((guard as any).logger, 'debug').mockImplementation();
    jest.spyOn((guard as any).logger, 'log').mockImplementation();
  });

  afterEach(() => {
    jest.clearAllMocks();
    jest.restoreAllMocks();
  });

  it('should be defined', () => {
    expect(guard).toBeDefined();
  });

  it('should allow access for @Public() decorated routes', async () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(true);
    const context = mockExecutionContext();

    const result = await guard.canActivate(context);

    expect(result).toBe(true);
  });

  it('should allow local network IPs when local bypass is enabled', async () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);
    settingsRepository.findFirst.mockResolvedValue({ allowLocalNetworkWithoutAuth: true });
    const context = mockExecutionContext('192.168.1.100');

    const result = await guard.canActivate(context);

    expect(result).toBe(true);
  });

  it('should allow local network IPs for 10.x.x.x when bypass is enabled', async () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);
    settingsRepository.findFirst.mockResolvedValue({ allowLocalNetworkWithoutAuth: true });
    const context = mockExecutionContext('10.0.0.5');

    const result = await guard.canActivate(context);

    expect(result).toBe(true);
  });

  it('should not bypass for public IPs even when local bypass is enabled', async () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);
    settingsRepository.findFirst.mockResolvedValue({ allowLocalNetworkWithoutAuth: true });
    const context = mockExecutionContext('8.8.8.8');

    // Override super.canActivate to avoid passport errors in tests
    jest
      .spyOn(Object.getPrototypeOf(Object.getPrototypeOf(guard)), 'canActivate')
      .mockReturnValue(Promise.resolve(true));

    await guard.canActivate(context);

    // Should have called super.canActivate (JWT validation)
    expect(Object.getPrototypeOf(Object.getPrototypeOf(guard)).canActivate).toHaveBeenCalled();
  });

  it('should require JWT when local bypass is disabled', async () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);
    settingsRepository.findFirst.mockResolvedValue({ allowLocalNetworkWithoutAuth: false });
    const context = mockExecutionContext('192.168.1.100');

    // Override super.canActivate
    jest
      .spyOn(Object.getPrototypeOf(Object.getPrototypeOf(guard)), 'canActivate')
      .mockReturnValue(Promise.resolve(true));

    await guard.canActivate(context);

    expect(Object.getPrototypeOf(Object.getPrototypeOf(guard)).canActivate).toHaveBeenCalled();
  });

  it('should require JWT when no settings exist', async () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);
    settingsRepository.findFirst.mockResolvedValue(null);
    const context = mockExecutionContext('192.168.1.100');

    jest
      .spyOn(Object.getPrototypeOf(Object.getPrototypeOf(guard)), 'canActivate')
      .mockReturnValue(Promise.resolve(true));

    await guard.canActivate(context);

    expect(Object.getPrototypeOf(Object.getPrototypeOf(guard)).canActivate).toHaveBeenCalled();
  });
});
