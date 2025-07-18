/**
 * Jest setup file for global test configuration
 * Runs before each test file
 */

// Global test timeout
jest.setTimeout(30000);

// Mock environment variables for testing
Object.assign(process.env, {
  NODE_ENV: 'test',
  OPENAI_API_KEY: 'test-key',
  SUPABASE_URL: 'http://localhost:54321',
  SUPABASE_KEY: 'test-key',
  EMBEDDING_CACHE_ENABLED: 'false', // Disable cache in tests by default
  LOG_LEVEL: 'error' // Reduce log noise in tests
});

// Mock console methods to reduce noise in tests
const originalConsole = { ...console };

beforeEach(() => {
  // Reset console mocks before each test
  console.log = jest.fn();
  console.info = jest.fn();
  console.warn = jest.fn();
  console.error = jest.fn();
  console.debug = jest.fn();
});

afterEach(() => {
  // Clean up after each test
  jest.clearAllMocks();
  jest.clearAllTimers();
});

afterAll(() => {
  // Restore original console methods
  console.log = originalConsole.log;
  console.info = originalConsole.info;
  console.warn = originalConsole.warn;
  console.error = originalConsole.error;
  console.debug = originalConsole.debug;
});

// Global fetch mock setup
global.fetch = jest.fn();

// Mock abort controller for timeout tests
global.AbortController = jest.fn().mockImplementation(() => ({
  abort: jest.fn(),
  signal: {
    aborted: false,
    addEventListener: jest.fn(),
    removeEventListener: jest.fn()
  }
}));

// Utility function to create mock responses
export const createMockResponse = (data: any, ok = true, status = 200) => ({
  ok,
  status,
  text: () => Promise.resolve(typeof data === 'string' ? data : JSON.stringify(data)),
  json: () => Promise.resolve(data)
});

// Utility function to create mock Supabase client with flexible chaining
export const createMockSupabaseClient = () => {
  // Create chainable query builder mock
  const createQueryBuilder = (defaultData: any = null): any => {
    const queryBuilder: any = {
      select: jest.fn(() => queryBuilder),
      eq: jest.fn(() => queryBuilder),
      gt: jest.fn(() => queryBuilder),
      in: jest.fn(() => queryBuilder),
      order: jest.fn(() => queryBuilder),
      single: jest.fn(() => Promise.resolve({ data: defaultData, error: null })),
      then: jest.fn((resolve: any) => resolve({ data: defaultData, error: null }))
    };
    return queryBuilder;
  };

  return {
    from: jest.fn(() => ({
      select: jest.fn(() => createQueryBuilder()),
      insert: jest.fn(() => Promise.resolve({ data: null, error: null })),
      upsert: jest.fn(() => ({
        select: jest.fn(() => ({
          single: jest.fn(() => Promise.resolve({
            data: { id: 1, title: 'Test Story' },
            error: null
          }))
        }))
      }))
    })),
    rpc: jest.fn(() => Promise.resolve({ data: 0, error: null }))
  };
};

// Utility function to create mock OpenAI response
export const createMockOpenAIResponse = (embeddings: number[][] = [[0.1, 0.2, 0.3]]) => ({
  data: embeddings.map((embedding, index) => ({ 
    object: 'embedding' as const,
    embedding, 
    index 
  })),
  model: 'text-embedding-3-small',
  object: 'list' as const,
  usage: {
    prompt_tokens: 10,
    total_tokens: 20
  }
}); 