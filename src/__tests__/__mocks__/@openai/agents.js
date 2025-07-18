/**
 * Mock for @openai/agents package to avoid ES module issues in Jest
 */

export const tool = jest.fn((config) => ({
  ...config,
  execute: config.execute || jest.fn()
}));

export const Agent = jest.fn();
export const run = jest.fn();

export default {
  tool,
  Agent,
  run
}; 