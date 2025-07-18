#!/usr/bin/env tsx

/**
 * Simple test to check if environment variables are loading
 */

// Load environment variables from .env.local or .env
import dotenv from 'dotenv';
import path from 'path';

console.log('🔍 Testing Environment Variable Loading\n');

// Try to load .env.local first, then .env
const localEnvPath = path.join(process.cwd(), '.env.local');
const envPath = path.join(process.cwd(), '.env');

console.log(`📁 Looking for .env.local at: ${localEnvPath}`);
const localResult = dotenv.config({ path: localEnvPath });
console.log(`   Result: ${localResult.error ? 'NOT FOUND' : 'LOADED'}`);

console.log(`📁 Looking for .env at: ${envPath}`);
const envResult = dotenv.config({ path: envPath });
console.log(`   Result: ${envResult.error ? 'NOT FOUND' : 'LOADED'}`);

console.log('\n📋 Environment Variables Found:');
console.log(`   OPENAI_API_KEY: ${process.env.OPENAI_API_KEY ? 'SET (' + process.env.OPENAI_API_KEY.substring(0, 10) + '...)' : 'NOT SET'}`);
console.log(`   NEXT_PUBLIC_SUPABASE_URL: ${process.env.NEXT_PUBLIC_SUPABASE_URL ? 'SET (' + process.env.NEXT_PUBLIC_SUPABASE_URL.substring(0, 30) + '...)' : 'NOT SET'}`);
console.log(`   NEXT_PUBLIC_SUPABASE_ANON_KEY: ${process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ? 'SET (' + process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY.substring(0, 20) + '...)' : 'NOT SET'}`);
console.log(`   SUPABASE_SERVICE_ROLE_KEY: ${process.env.SUPABASE_SERVICE_ROLE_KEY ? 'SET (' + process.env.SUPABASE_SERVICE_ROLE_KEY.substring(0, 20) + '...)' : 'NOT SET'}`);
console.log(`   NODE_ENV: ${process.env.NODE_ENV || 'NOT SET'}`);

console.log('\n🔧 Alternative variable names:');
console.log(`   SUPABASE_URL: ${process.env.SUPABASE_URL ? 'SET' : 'NOT SET'}`);
console.log(`   SUPABASE_KEY: ${process.env.SUPABASE_KEY ? 'SET' : 'NOT SET'}`);

console.log('\n✅ Environment check complete!'); 