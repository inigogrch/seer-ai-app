/** @type {import('jest').Config} */
module.exports = {
  // Use TypeScript preset
  preset: 'ts-jest',
  
  // Node environment for backend testing
  testEnvironment: 'node',
  
  // Test file patterns
  testMatch: [
    '**/__tests__/**/*.test.ts',
    '**/__tests__/**/*.test.js',
    '**/*.test.ts',
    '**/*.test.js'
  ],
  
  // TypeScript transformation
  transform: {
    '^.+\\.ts$': ['ts-jest', {
      tsconfig: 'tsconfig.json',
      useESM: true
    }]
  },
  
  // Module path mapping (align with tsconfig paths if needed)
  moduleNameMapper: {
    '@openai/agents': '<rootDir>/src/__tests__/__mocks__/@openai/agents.js'
  },
  
  // Setup files to run before tests
  setupFilesAfterEnv: ['<rootDir>/src/__tests__/setup.ts'],
  
  // Coverage configuration
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.d.ts',
    '!src/**/__tests__/**',
    '!src/**/*.test.ts'
  ],
  
  // Coverage thresholds
  coverageThreshold: {
    global: {
      branches: 70,
      functions: 70,
      lines: 70,
      statements: 70
    }
  },
  
  // Module file extensions
  moduleFileExtensions: ['ts', 'js', 'json'],
  
  // Clear mocks between tests
  clearMocks: true,
  
  // Restore mocks after each test
  restoreMocks: true,
  
  // Verbose output for debugging
  verbose: true,
  
  // Timeout for async tests (30 seconds for integration tests)
  testTimeout: 30000,
  
    // Mock node modules that are problematic in tests - allow OpenAI agents
  transformIgnorePatterns: [
    'node_modules/(?!(@openai/agents|@openai/agents-core)/)'
  ],

  // Handle ES modules and dynamic imports
  extensionsToTreatAsEsm: ['.ts'],
  
  // Error on deprecated APIs
  errorOnDeprecated: true
}; 