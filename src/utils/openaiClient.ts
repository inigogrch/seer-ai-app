/**
 * OpenAI client utility
 * Provides a singleton instance of the OpenAI client with lazy loading
 */

import OpenAI from 'openai';

/**
 * OpenAI Client Singleton
 * Manages a single instance of the OpenAI client with lazy initialization
 */
class OpenAIClient {
  private static instance: OpenAI | null = null;

  /**
   * Get the singleton OpenAI client instance
   * Creates the instance on first access
   */
  static get(): OpenAI {
    if (!this.instance) {
      const apiKey = process.env.OPENAI_API_KEY;
      if (!apiKey) {
        throw new Error('OPENAI_API_KEY environment variable is missing or empty');
      }
      this.instance = new OpenAI({
        apiKey: apiKey,
      });
    }
    return this.instance;
  }

  /**
   * Reset the singleton instance (useful for testing)
   */
  static reset(): void {
    this.instance = null;
  }

  /**
   * Check if the instance has been created
   */
  static isInitialized(): boolean {
    return this.instance !== null;
  }
}

// Export the lazy-loaded singleton instance
export const openai = {
  get embeddings() {
    return OpenAIClient.get().embeddings;
  },
  get chat() {
    return OpenAIClient.get().chat;
  },
  get completions() {
    return OpenAIClient.get().completions;
  },
  get images() {
    return OpenAIClient.get().images;
  },
  get audio() {
    return OpenAIClient.get().audio;
  },
  get files() {
    return OpenAIClient.get().files;
  },
  get models() {
    return OpenAIClient.get().models;
  },
  get moderations() {
    return OpenAIClient.get().moderations;
  }
};

// Export the client class for testing utilities
export { OpenAIClient }; 