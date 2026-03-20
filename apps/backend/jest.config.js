module.exports = {
  displayName: 'backend',
  workerIdleMemoryLimit: '512MB',
  preset: '../../jest.preset.js',
  testEnvironment: 'node',
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
  transform: {
    '^.+\\.[tj]s$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json' }],
  },
  moduleFileExtensions: ['ts', 'js', 'html'],
  moduleNameMapper: {
    '^@bitbonsai/version$': '<rootDir>/__mocks__/@bitbonsai/version.js',
    '.*/@bitbonsai/version$': '<rootDir>/__mocks__/@bitbonsai/version.js',
  },
  testPathIgnorePatterns: [
    '/node_modules/',
    '/__tests__/integration/',
    '/__tests__/e2e/',
    '\\.e2e\\.spec\\.ts$',
  ],
  coverageDirectory: '../../coverage/apps/backend',
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.spec.ts',
    '!src/**/*.e2e.spec.ts',
    '!src/**/*.integration.spec.ts',
    '!src/main.ts',
    '!src/**/__tests__/**',
  ],
  coverageThreshold: {
    global: {
      statements: 80,
      branches: 65,
      functions: 80,
      lines: 80,
    },
  },
  coverageReporters: ['text', 'text-summary', 'html', 'lcov'],
};
