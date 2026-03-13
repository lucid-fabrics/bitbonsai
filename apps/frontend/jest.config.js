module.exports = {
  displayName: 'frontend',
  preset: '../../jest.preset.js',
  setupFilesAfterEnv: ['<rootDir>/src/test-setup.ts'],
  coverageDirectory: '../../coverage/apps/frontend',
  transform: {
    '^.+\\.(ts|mjs|js|html)$': [
      'jest-preset-angular',
      {
        tsconfig: '<rootDir>/tsconfig.spec.json',
        stringifyContentPathRegex: '\\.(html|svg)$',
      },
    ],
  },
  transformIgnorePatterns: [
    'node_modules/(?!.*\\.mjs$|lodash-es|ng2-charts|flat|@ngneat/transloco)',
  ],
  snapshotSerializers: [
    'jest-preset-angular/build/serializers/no-ng-attributes',
    'jest-preset-angular/build/serializers/ng-snapshot',
    'jest-preset-angular/build/serializers/html-comment',
  ],
  testPathIgnorePatterns: ['/node_modules/', '/e2e/'],
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.spec.ts',
    '!src/main.ts',
    '!src/test-setup.ts',
    '!src/environments/**',
  ],
  coverageThreshold: {
    global: {
      branches: 10,
      functions: 15,
      lines: 20,
      statements: 20,
    },
  },
  coverageReporters: ['text', 'text-summary', 'html', 'lcov'],
};
