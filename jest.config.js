/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>'],
  testMatch: ['<rootDir>/test/**/*.test.ts'],
  moduleNameMapper: {
    '^@earendil-works/pi-coding-agent$': '<rootDir>/test/__mocks__/@earendil-works/pi-coding-agent.ts',
    '^@earendil-works/pi-tui$': '<rootDir>/test/__mocks__/@earendil-works/pi-tui.ts',
  },
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        tsconfig: {
          target: 'ES2020',
          module: 'commonjs',
          esModuleInterop: true,
          allowSyntheticDefaultImports: true,
          types: ['jest', 'node'],
          skipLibCheck: true,
          strict: true,
          resolveJsonModule: true,
          baseUrl: '.',
          paths: {
            '@earendil-works/pi-coding-agent': ['test/__mocks__/@earendil-works/pi-coding-agent.ts'],
            '@earendil-works/pi-tui': ['test/__mocks__/@earendil-works/pi-tui.ts'],
          },
        },
      },
    ],
  },
  moduleDirectories: ['node_modules'],
};
