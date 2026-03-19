module.exports = {
  displayName: 'backend-e2e',
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
  testMatch: ['**/__tests__/e2e/**/*.e2e-spec.ts'],
  testPathIgnorePatterns: ['/node_modules/'],
};
