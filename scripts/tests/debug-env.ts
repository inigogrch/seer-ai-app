#!/usr/bin/env tsx

import dotenv from 'dotenv';
import path from 'path';

console.log('🔍 Debugging Environment Variable Loading\n');

// Try loading .env.local
console.log('1. Current working directory:', process.cwd());
console.log('2. Looking for .env.local at:', path.join(process.cwd(), '.env.local'));

const envLocalPath = path.join(process.cwd(), '.env.local');
const envLocalResult = dotenv.config({ path: envLocalPath });

console.log('3. dotenv.config result for .env.local:', envLocalResult);

// Check if specific variables are loaded
console.log('\n4. Environment variables after loading:');
console.log('   OPENAI_API_KEY:', process.env.OPENAI_API_KEY ? 'EXISTS' : 'MISSING');
console.log('   SUPABASE_URL:', process.env.SUPABASE_URL ? 'EXISTS' : 'MISSING');
console.log('   NEXT_PUBLIC_SUPABASE_URL:', process.env.NEXT_PUBLIC_SUPABASE_URL ? 'EXISTS' : 'MISSING');
console.log('   SUPABASE_SERVICE_ROLE_KEY:', process.env.SUPABASE_SERVICE_ROLE_KEY ? 'EXISTS' : 'MISSING');

// Try to load config
async function testConfig() {
  try {
    const { loadEnvironmentConfig } = await import('../../src/config/environment');
    const config = loadEnvironmentConfig();
    console.log('\n5. ✅ Environment config loaded successfully!');
    console.log('   OpenAI API Key present:', !!config.openai.apiKey);
    console.log('   Supabase URL present:', !!config.supabase.url);
    console.log('   Supabase Key present:', !!config.supabase.key);
  } catch (error) {
    console.log('\n5. ❌ Environment config failed:', error.message);
  }
}

testConfig(); 