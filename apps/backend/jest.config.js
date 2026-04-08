module.exports = {
  displayName: 'backend',
  preset: '../../jest.preset.js',
  testEnvironment: 'node',
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
  transform: {
    '^.+\\.[tj]s$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json' }],
  },
  moduleFileExtensions: ['ts', 'js', 'html'],
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
      branches: 43,
      functions: 52,
      lines: 48,
      statements: 49,
    },
  },
  coverageReporters: ['text', 'text-summary', 'html', 'lcov'],
};
