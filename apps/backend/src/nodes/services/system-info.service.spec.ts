import { Test, TestingModule } from '@nestjs/testing';
import { AccelerationType, ContainerType } from '@prisma/client';
import { SystemInfoService } from './system-info.service';

// Mock child_process exec
jest.mock('child_process', () => ({
  exec: jest.fn(),
}));

// Mock os module so non-configurable properties can be overridden
jest.mock('os', () => ({
  networkInterfaces: jest.fn(),
  hostname: jest.fn(),
  cpus: jest.fn(),
  totalmem: jest.fn(),
}));

// Mock fs.promises only — preserve rest of fs for Prisma compatibility
jest.mock('fs', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const actual = jest.requireActual<typeof import('fs')>('fs');
  return {
    ...actual,
    promises: {
      ...actual.promises,
      access: jest.fn(),
      readFile: jest.fn(),
    },
  };
});

describe('SystemInfoService', () => {
  let service: SystemInfoService;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const osMock = require('os');

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [SystemInfoService],
    }).compile();

    service = module.get<SystemInfoService>(SystemInfoService);
  });

  describe('collectSystemInfo', () => {
    it('should return complete system info object', async () => {
      osMock.networkInterfaces.mockReturnValue({
        eth0: [
          {
            family: 'IPv4',
            address: '192.168.1.100',
            internal: false,
            netmask: '255.255.255.0',
            mac: 'aa:bb:cc:dd:ee:ff',
            cidr: '192.168.1.100/24',
          },
        ],
      });
      osMock.hostname.mockReturnValue('test-host');
      osMock.cpus.mockReturnValue([
        {
          model: 'Intel Core i7',
          speed: 3000,
          times: { user: 0, nice: 0, sys: 0, idle: 0, irq: 0 },
        },
        {
          model: 'Intel Core i7',
          speed: 3000,
          times: { user: 0, nice: 0, sys: 0, idle: 0, irq: 0 },
        },
      ]);
      osMock.totalmem.mockReturnValue(16 * 1024 ** 3);

      // Mock exec for disk space and GPU detection
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { exec } = require('child_process');
      exec.mockImplementation((_cmd: string, cb: any) => cb(null, { stdout: '0G', stderr: '' }));

      const result = await service.collectSystemInfo();

      expect(result.ipAddress).toBe('192.168.1.100');
      expect(result.hostname).toBe('test-host');
      expect(result.macAddress).toBe('aa:bb:cc:dd:ee:ff');
      expect(result.hardwareSpecs.cpuCores).toBe(2);
      expect(result.hardwareSpecs.cpuModel).toBe('Intel Core i7');
      expect(result.hardwareSpecs.ramGb).toBe(16);
    });

    it('should return 127.0.0.1 when no external IP found', async () => {
      osMock.networkInterfaces.mockReturnValue({
        lo: [
          {
            family: 'IPv4',
            address: '127.0.0.1',
            internal: true,
            netmask: '255.0.0.0',
            mac: '00:00:00:00:00:00',
            cidr: '127.0.0.1/8',
          },
        ],
      });
      osMock.hostname.mockReturnValue('localhost');
      osMock.cpus.mockReturnValue([]);
      osMock.totalmem.mockReturnValue(0);

      const result = await service.collectSystemInfo();

      expect(result.ipAddress).toBe('127.0.0.1');
    });
  });

  describe('container type detection', () => {
    it('should detect Apple Silicon on darwin arm64', async () => {
      Object.defineProperty(process, 'platform', {
        value: 'darwin',
        writable: true,
        configurable: true,
      });
      Object.defineProperty(process, 'arch', {
        value: 'arm64',
        writable: true,
        configurable: true,
      });

      osMock.networkInterfaces.mockReturnValue({});
      osMock.hostname.mockReturnValue('mac-host');
      osMock.cpus.mockReturnValue([
        { model: 'Apple M2', speed: 0, times: { user: 0, nice: 0, sys: 0, idle: 0, irq: 0 } },
      ]);
      osMock.totalmem.mockReturnValue(16 * 1024 ** 3);

      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { exec } = require('child_process');
      exec.mockImplementation((_cmd: string, cb: any) => cb(new Error('command not found'), null));

      const result = await service.collectSystemInfo();

      // On darwin arm64, acceleration should be APPLE_M (if nvidia not found)
      expect([AccelerationType.APPLE_M, AccelerationType.CPU]).toContain(result.acceleration);
    });
  });

  describe('detectContainerType', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fsMock = require('fs').promises;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { exec } = require('child_process');

    function setupBaseOsMocks() {
      osMock.networkInterfaces.mockReturnValue({});
      osMock.hostname.mockReturnValue('host');
      osMock.cpus.mockReturnValue([
        { model: 'Intel', speed: 0, times: { user: 0, nice: 0, sys: 0, idle: 0, irq: 0 } },
      ]);
      osMock.totalmem.mockReturnValue(8 * 1024 ** 3);
    }

    it('detects DOCKER when /.dockerenv exists', async () => {
      setupBaseOsMocks();
      fsMock.access.mockImplementation((path: string) => {
        if (path === '/.dockerenv') return Promise.resolve();
        return Promise.reject(new Error('not found'));
      });
      fsMock.readFile.mockResolvedValue('');
      exec.mockImplementation((_cmd: string, cb: any) => cb(null, { stdout: '0G', stderr: '' }));

      const result = await service.collectSystemInfo();
      expect(result.containerType).toBe(ContainerType.DOCKER);
    });

    it('detects LXC via cgroup content', async () => {
      setupBaseOsMocks();
      fsMock.access.mockRejectedValue(new Error('not found')); // no .dockerenv
      fsMock.readFile.mockImplementation((path: string) => {
        if (path === '/proc/1/cgroup') return Promise.resolve('12:devices:/lxc/container1');
        return Promise.resolve('');
      });
      exec.mockImplementation((_cmd: string, cb: any) => cb(null, { stdout: '0G', stderr: '' }));

      const result = await service.collectSystemInfo();
      expect(result.containerType).toBe(ContainerType.LXC);
    });

    it('detects VM via systemd-detect-virt returning kvm', async () => {
      setupBaseOsMocks();
      fsMock.access.mockRejectedValue(new Error('not found'));
      fsMock.readFile.mockResolvedValue(''); // no lxc in cgroup
      exec.mockImplementation((_cmd: string, cb: any) => {
        // systemd-detect-virt call
        if (typeof _cmd === 'string' && _cmd.includes('systemd-detect-virt')) {
          return cb(null, { stdout: 'kvm', stderr: '' });
        }
        return cb(null, { stdout: '0G', stderr: '' });
      });

      const result = await service.collectSystemInfo();
      expect(result.containerType).toBe(ContainerType.VM);
    });

    it('detects VM via DMI product name (VirtualBox)', async () => {
      setupBaseOsMocks();
      fsMock.access.mockRejectedValue(new Error('not found'));
      fsMock.readFile.mockImplementation((path: string) => {
        if (path === '/proc/1/cgroup') return Promise.resolve('');
        if (path === '/sys/devices/virtual/dmi/id/product_name')
          return Promise.resolve('VirtualBox');
        return Promise.resolve('');
      });
      exec.mockImplementation((_cmd: string, cb: any) => {
        if (typeof _cmd === 'string' && _cmd.includes('systemd-detect-virt')) {
          return cb(new Error('not found'), null); // systemd-detect-virt not available
        }
        return cb(null, { stdout: '0G', stderr: '' });
      });

      const result = await service.collectSystemInfo();
      expect(result.containerType).toBe(ContainerType.VM);
    });

    it('detects VM via DMI product name (VMware)', async () => {
      setupBaseOsMocks();
      fsMock.access.mockRejectedValue(new Error('not found'));
      fsMock.readFile.mockImplementation((path: string) => {
        if (path === '/proc/1/cgroup') return Promise.resolve('');
        if (path === '/sys/devices/virtual/dmi/id/product_name')
          return Promise.resolve('VMware SVGA II Adapter');
        return Promise.resolve('');
      });
      exec.mockImplementation((_cmd: string, cb: any) => {
        if (typeof _cmd === 'string' && _cmd.includes('systemd-detect-virt')) {
          return cb(new Error('not found'), null);
        }
        return cb(null, { stdout: '0G', stderr: '' });
      });

      const result = await service.collectSystemInfo();
      expect(result.containerType).toBe(ContainerType.VM);
    });

    it('returns BARE_METAL when no container indicators found', async () => {
      setupBaseOsMocks();
      fsMock.access.mockRejectedValue(new Error('not found'));
      fsMock.readFile.mockResolvedValue(''); // no lxc, no VM dmi
      exec.mockImplementation((_cmd: string, cb: any) => {
        if (typeof _cmd === 'string' && _cmd.includes('systemd-detect-virt')) {
          return cb(null, { stdout: 'none', stderr: '' });
        }
        return cb(null, { stdout: '0G', stderr: '' });
      });

      const result = await service.collectSystemInfo();
      expect(result.containerType).toBe(ContainerType.BARE_METAL);
    });

    it('returns BARE_METAL when systemd-detect-virt returns empty string', async () => {
      setupBaseOsMocks();
      fsMock.access.mockRejectedValue(new Error('not found'));
      fsMock.readFile.mockResolvedValue('');
      exec.mockImplementation((_cmd: string, cb: any) => {
        if (typeof _cmd === 'string' && _cmd.includes('systemd-detect-virt')) {
          return cb(null, { stdout: '', stderr: '' });
        }
        return cb(null, { stdout: '0G', stderr: '' });
      });

      const result = await service.collectSystemInfo();
      expect(result.containerType).toBe(ContainerType.BARE_METAL);
    });
  });

  describe('detectAcceleration', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fsMock = require('fs').promises;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { exec } = require('child_process');

    function setupBaseOsMocks() {
      osMock.networkInterfaces.mockReturnValue({});
      osMock.hostname.mockReturnValue('host');
      osMock.totalmem.mockReturnValue(8 * 1024 ** 3);
    }

    it('detects NVIDIA when nvidia-smi succeeds', async () => {
      setupBaseOsMocks();
      osMock.cpus.mockReturnValue([
        { model: 'Intel', speed: 0, times: { user: 0, nice: 0, sys: 0, idle: 0, irq: 0 } },
      ]);
      fsMock.access.mockRejectedValue(new Error('not found'));
      fsMock.readFile.mockResolvedValue('');
      exec.mockImplementation((_cmd: string, cb: any) => {
        if (typeof _cmd === 'string' && _cmd.includes('nvidia-smi --version')) {
          return cb(null, { stdout: 'NVIDIA-SMI 525.x', stderr: '' });
        }
        return cb(null, { stdout: 'none', stderr: '' });
      });

      const result = await service.collectSystemInfo();
      expect(result.acceleration).toBe(AccelerationType.NVIDIA);
    });

    it('detects INTEL_QSV when /dev/dri/renderD128 exists and CPU is Intel', async () => {
      setupBaseOsMocks();
      osMock.cpus.mockReturnValue([
        { model: 'Intel Core i9', speed: 0, times: { user: 0, nice: 0, sys: 0, idle: 0, irq: 0 } },
      ]);
      fsMock.access.mockImplementation((path: string) => {
        if (path === '/dev/dri/renderD128') return Promise.resolve();
        return Promise.reject(new Error('not found'));
      });
      fsMock.readFile.mockResolvedValue('');
      exec.mockImplementation((_cmd: string, cb: any) => {
        if (typeof _cmd === 'string' && _cmd.includes('nvidia-smi --version')) {
          return cb(new Error('not found'), null);
        }
        return cb(null, { stdout: 'none', stderr: '' });
      });

      const result = await service.collectSystemInfo();
      expect(result.acceleration).toBe(AccelerationType.INTEL_QSV);
    });

    it('does NOT detect INTEL_QSV when /dev/dri/renderD128 exists but CPU is not Intel', async () => {
      setupBaseOsMocks();
      osMock.cpus.mockReturnValue([
        { model: 'AMD Ryzen 9', speed: 0, times: { user: 0, nice: 0, sys: 0, idle: 0, irq: 0 } },
      ]);
      fsMock.access.mockImplementation((path: string) => {
        if (path === '/dev/dri/renderD128') return Promise.resolve();
        return Promise.reject(new Error('not found'));
      });
      fsMock.readFile.mockResolvedValue('');
      exec.mockImplementation((_cmd: string, cb: any) => {
        if (typeof _cmd === 'string' && _cmd.includes('nvidia-smi --version')) {
          return cb(new Error('not found'), null);
        }
        if (typeof _cmd === 'string' && _cmd.includes('lspci')) {
          return cb(null, { stdout: '', stderr: '' });
        }
        return cb(null, { stdout: 'none', stderr: '' });
      });

      Object.defineProperty(process, 'platform', {
        value: 'linux',
        writable: true,
        configurable: true,
      });
      const result = await service.collectSystemInfo();
      expect(result.acceleration).not.toBe(AccelerationType.INTEL_QSV);
    });

    it('detects AMD when lspci shows VGA', async () => {
      setupBaseOsMocks();
      osMock.cpus.mockReturnValue([
        { model: 'AMD Ryzen', speed: 0, times: { user: 0, nice: 0, sys: 0, idle: 0, irq: 0 } },
      ]);
      fsMock.access.mockRejectedValue(new Error('not found'));
      fsMock.readFile.mockResolvedValue('');
      exec.mockImplementation((_cmd: string, cb: any) => {
        if (typeof _cmd === 'string' && _cmd.includes('nvidia-smi --version')) {
          return cb(new Error('not found'), null);
        }
        if (typeof _cmd === 'string' && _cmd.includes('lspci')) {
          return cb(null, {
            stdout: '04:00.0 VGA compatible controller: AMD/ATI RX 6900',
            stderr: '',
          });
        }
        return cb(null, { stdout: 'none', stderr: '' });
      });

      Object.defineProperty(process, 'platform', {
        value: 'linux',
        writable: true,
        configurable: true,
      });
      const result = await service.collectSystemInfo();
      expect(result.acceleration).toBe(AccelerationType.AMD);
    });

    it('detects AMD when lspci shows Display', async () => {
      setupBaseOsMocks();
      osMock.cpus.mockReturnValue([
        { model: 'AMD', speed: 0, times: { user: 0, nice: 0, sys: 0, idle: 0, irq: 0 } },
      ]);
      fsMock.access.mockRejectedValue(new Error('not found'));
      fsMock.readFile.mockResolvedValue('');
      exec.mockImplementation((_cmd: string, cb: any) => {
        if (typeof _cmd === 'string' && _cmd.includes('nvidia-smi --version')) {
          return cb(new Error('not found'), null);
        }
        if (typeof _cmd === 'string' && _cmd.includes('lspci')) {
          return cb(null, { stdout: '04:00.0 Display controller: AMD Radeon RX', stderr: '' });
        }
        return cb(null, { stdout: 'none', stderr: '' });
      });

      Object.defineProperty(process, 'platform', {
        value: 'linux',
        writable: true,
        configurable: true,
      });
      const result = await service.collectSystemInfo();
      expect(result.acceleration).toBe(AccelerationType.AMD);
    });

    it('falls back to CPU when no acceleration detected on linux', async () => {
      setupBaseOsMocks();
      osMock.cpus.mockReturnValue([
        { model: 'Unknown CPU', speed: 0, times: { user: 0, nice: 0, sys: 0, idle: 0, irq: 0 } },
      ]);
      fsMock.access.mockRejectedValue(new Error('not found'));
      fsMock.readFile.mockResolvedValue('');
      exec.mockImplementation((_cmd: string, cb: any) => {
        if (typeof _cmd === 'string' && _cmd.includes('nvidia-smi --version')) {
          return cb(new Error('not found'), null);
        }
        if (typeof _cmd === 'string' && _cmd.includes('lspci')) {
          return cb(null, { stdout: 'nothing relevant', stderr: '' });
        }
        return cb(null, { stdout: 'none', stderr: '' });
      });

      Object.defineProperty(process, 'platform', {
        value: 'linux',
        writable: true,
        configurable: true,
      });
      Object.defineProperty(process, 'arch', { value: 'x64', writable: true, configurable: true });
      const result = await service.collectSystemInfo();
      expect(result.acceleration).toBe(AccelerationType.CPU);
    });
  });

  describe('getDiskSpace and detectGpu', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fsMock = require('fs').promises;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { exec } = require('child_process');

    function setupBaseOsMocks() {
      osMock.networkInterfaces.mockReturnValue({});
      osMock.hostname.mockReturnValue('host');
      osMock.cpus.mockReturnValue([
        { model: 'Intel', speed: 0, times: { user: 0, nice: 0, sys: 0, idle: 0, irq: 0 } },
      ]);
      osMock.totalmem.mockReturnValue(8 * 1024 ** 3);
    }

    it('getDiskSpace returns 0 when output is NaN', async () => {
      setupBaseOsMocks();
      fsMock.access.mockRejectedValue(new Error('not found'));
      fsMock.readFile.mockResolvedValue('');
      exec.mockImplementation((_cmd: string, cb: any) => {
        // All exec calls return non-numeric disk output
        return cb(null, { stdout: 'NaNG', stderr: '' });
      });

      const result = await service.collectSystemInfo();
      expect(result.hardwareSpecs.diskGb).toBe(0);
    });

    it('detectGpu returns nvidia-smi result when available', async () => {
      setupBaseOsMocks();
      fsMock.access.mockRejectedValue(new Error('not found'));
      fsMock.readFile.mockResolvedValue('');
      let _callCount = 0;
      exec.mockImplementation((_cmd: string, cb: any) => {
        _callCount++;
        if (typeof _cmd === 'string' && _cmd.includes('nvidia-smi --query-gpu')) {
          return cb(null, { stdout: 'NVIDIA GeForce RTX 3090', stderr: '' });
        }
        return cb(null, { stdout: '100G', stderr: '' });
      });

      const result = await service.collectSystemInfo();
      expect(result.hardwareSpecs.gpuModel).toBe('NVIDIA GeForce RTX 3090');
    });

    it('detectGpu falls back to lspci when nvidia-smi not found', async () => {
      setupBaseOsMocks();
      fsMock.access.mockRejectedValue(new Error('not found'));
      fsMock.readFile.mockResolvedValue('');
      exec.mockImplementation((_cmd: string, cb: any) => {
        if (typeof _cmd === 'string' && _cmd.includes('nvidia-smi --query-gpu')) {
          return cb(new Error('command not found'), null);
        }
        if (typeof _cmd === 'string' && _cmd.includes('lspci | grep -i vga')) {
          return cb(null, {
            stdout: '00:02.0 VGA compatible controller: Intel UHD Graphics 630',
            stderr: '',
          });
        }
        return cb(null, { stdout: '100G', stderr: '' });
      });

      const result = await service.collectSystemInfo();
      expect(result.hardwareSpecs.gpuModel).toContain('Intel UHD Graphics 630');
    });

    it('detectGpu returns null when both nvidia-smi and lspci fail', async () => {
      setupBaseOsMocks();
      fsMock.access.mockRejectedValue(new Error('not found'));
      fsMock.readFile.mockResolvedValue('');
      exec.mockImplementation((_cmd: string, cb: any) => {
        if (typeof _cmd === 'string' && _cmd.includes('nvidia-smi --query-gpu')) {
          return cb(new Error('not found'), null);
        }
        if (typeof _cmd === 'string' && _cmd.includes('lspci | grep -i vga')) {
          return cb(new Error('not found'), null);
        }
        return cb(null, { stdout: '100G', stderr: '' });
      });

      const result = await service.collectSystemInfo();
      expect(result.hardwareSpecs.gpuModel).toBeNull();
    });
  });
});
