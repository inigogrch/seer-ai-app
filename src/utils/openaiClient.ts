/**
 * OpenAI client utility
 * Provides a singleton instance of the OpenAI client
 */

import OpenAI from 'openai';

// Create and export the OpenAI client instance
export const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

/**
 * Get the OpenAI client instance
 * @deprecated Use the exported `openai` instance directly
 */
export function getOpenAIClient(): OpenAI {
  return openai;
} 