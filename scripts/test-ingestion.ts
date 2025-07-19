#!/usr/bin/env tsx

/**
 * Test script for the IngestionAgent
 * This script tests the real ingestion process with your database
 */

// Load environment variables from .env.local or .env
import dotenv from 'dotenv';
import path from 'path';

// Try to load .env.local first, then .env
dotenv.config({ path: path.join(process.cwd(), '.env.local') });
dotenv.config({ path: path.join(process.cwd(), '.env') });

import { runIngestion } from '../src/agents/runIngestion';
import { fetchActiveSourceSlugsExecute, getCacheStatsExecute } from '../src/agents/tools/ingestion-helpers';
import { loadEnvironmentConfig } from '../src/config/environment';

async function testIngestion() {
  console.log('🚀 Starting Ingestion Agent Test\n');
  
  try {
    // Test 1: Check environment configuration
    console.log('📋 Step 1: Checking environment configuration...');
    const config = loadEnvironmentConfig();
    console.log(`   ✅ Supabase URL: ${config.supabase.url.substring(0, 30)}...`);
    console.log(`   ✅ OpenAI API configured: ${config.openai.apiKey ? 'Yes' : 'No'}`);
    console.log(`   ✅ Cache enabled: ${config.cache.enabled}`);
    console.log(`   ✅ Concurrency limit: ${config.ingestion.concurrencyLimit}`);
    console.log(`   ✅ Batch size: ${config.ingestion.batchSize}\n`);

    // Test 2: Check database connectivity and active sources
    console.log('📊 Step 2: Checking database connectivity and sources...');
    const sourcesResult = await fetchActiveSourceSlugsExecute();
    
    if (!sourcesResult.success) {
      throw new Error(`Failed to fetch sources: ${sourcesResult.error}`);
    }
    
    console.log(`   ✅ Database connected successfully`);
    console.log(`   ✅ Found ${sourcesResult.count} active sources:`);
    sourcesResult.sources.forEach((source, index) => {
      console.log(`      ${index + 1}. ${source.name} (${source.slug}) - Adapter: ${source.adapter_name}`);
    });
    console.log();

    // Test 3: Check cache status
    if (config.cache.enabled) {
      console.log('💾 Step 3: Checking embedding cache status...');
      const cacheStats = await getCacheStatsExecute();
      if (cacheStats.success) {
        console.log(`   ✅ Cache entries: ${cacheStats.stats?.totalEntries || 0}`);
        console.log(`   ✅ Active entries: ${cacheStats.stats?.activeEntries || 0}`);
        console.log(`   ✅ Hit rate: ${cacheStats.stats?.hitRate || '0%'}`);
      } else {
        console.log(`   ⚠️  Cache check failed: ${cacheStats.error}`);
      }
      console.log();
    }

    // Test 4: Run the actual ingestion process
    console.log('🔄 Step 4: Running ingestion process...');
    console.log('   This may take a few minutes depending on the number of sources and items...\n');
    
    const startTime = Date.now();
    const result = await runIngestion();
    const duration = Date.now() - startTime;

    // Test 5: Report results
    console.log('📈 Step 5: Ingestion Results');
    console.log('=' .repeat(50));
    
    if (result.success) {
      console.log(`✅ Status: SUCCESS`);
      console.log(`📊 Statistics:`);
      console.log(`   • Sources processed: ${result.stats?.sourcesProcessed || 0}`);
      console.log(`   • Total items found: ${result.stats?.totalItems || 0}`);
      console.log(`   • Successful ingests: ${result.stats?.successfulIngests || 0}`);
      console.log(`   • Failed ingests: ${result.stats?.failedIngests || 0}`);
      console.log(`   • Success rate: ${result.stats?.totalItems ? Math.round((result.stats.successfulIngests / result.stats.totalItems) * 100) : 0}%`);
      console.log(`   • Duration: ${Math.round(duration / 1000)}s`);
      
      if (result.stats?.successfulIngests > 0) {
        console.log(`\n🎉 Successfully ingested ${result.stats.successfulIngests} stories!`);
      } else {
        console.log(`\n⚠️  No stories were ingested. Check your sources and adapters.`);
      }
    } else {
      console.log(`❌ Status: FAILED`);
      console.log(`💥 Error: ${result.error}`);
      console.log(`📊 Partial statistics:`);
      console.log(`   • Sources processed: ${result.stats?.sourcesProcessed || 0}`);
      console.log(`   • Total items found: ${result.stats?.totalItems || 0}`);
      console.log(`   • Successful ingests: ${result.stats?.successfulIngests || 0}`);
      console.log(`   • Failed ingests: ${result.stats?.failedIngests || 0}`);
    }

    // Test 6: Final cache stats (if enabled)
    if (config.cache.enabled) {
      console.log('\n💾 Final Cache Status:');
      const finalCacheStats = await getCacheStatsExecute();
      if (finalCacheStats.success) {
        console.log(`   • Total entries: ${finalCacheStats.stats?.totalEntries || 0}`);
        console.log(`   • Cache hit rate: ${finalCacheStats.stats?.hitRate || '0%'}`);
      }
    }

  } catch (error) {
    console.error('💥 Test failed with error:', error);
    process.exit(1);
  }
}

// Run the test
testIngestion()
  .then(() => {
    console.log('\n✅ Ingestion test completed successfully!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Ingestion test failed:', error);
    process.exit(1);
  }); 