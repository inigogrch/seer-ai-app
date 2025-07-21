#!/usr/bin/env tsx

/**
 * Test script for fetchActiveSourceSlugs
 * This validates database connectivity and source data
 */

// Load environment variables from .env.local or .env
import dotenv from 'dotenv';
import path from 'path';

// Try to load .env.local first, then .env
dotenv.config({ path: path.join(process.cwd(), '.env.local') });
dotenv.config({ path: path.join(process.cwd(), '.env') });

import { fetchActiveSourceSlugsExecute } from '../ingestion/tools/ingestion-helpers';
import { loadEnvironmentConfig } from '../../src/config/environment';

async function testFetchSources() {
  console.log('🧪 Testing fetchActiveSourceSlugs Function\n');
  
  try {
    // Test 1: Check environment configuration
    console.log('📋 Step 1: Validating environment configuration...');
    const config = loadEnvironmentConfig();
    console.log(`   ✅ Supabase URL: ${config.supabase.url.substring(0, 30)}...`);
    console.log(`   ✅ Supabase Key: ${config.supabase.key.substring(0, 20)}...`);
    console.log(`   ✅ Sources table: ${config.ingestion.feedSourcesTable}`);
    console.log();

    // Test 2: Test fetchActiveSourceSlugs function
    console.log('🔍 Step 2: Testing fetchActiveSourceSlugs...');
    const startTime = Date.now();
    const result = await fetchActiveSourceSlugsExecute();
    const duration = Date.now() - startTime;

    console.log(`   ⏱️  Query took: ${duration}ms`);
    console.log();

    // Test 3: Analyze results
    console.log('📊 Step 3: Analyzing results...');
    console.log('=' .repeat(50));

    if (result.success) {
      console.log(`✅ Status: SUCCESS`);
      console.log(`📈 Found ${result.count} active sources:`);
      console.log();

      if (result.sources.length > 0) {
        console.log('📋 Source Details:');
        result.sources.forEach((source, index) => {
          console.log(`   ${index + 1}. 📰 ${source.name}`);
          console.log(`      • ID: ${source.id}`);
          console.log(`      • Slug: ${source.slug}`);
          console.log(`      • Adapter: ${source.adapter_name}`);
          console.log();
        });

                 // Test 4: Validate source data quality
         console.log('🔎 Step 4: Validating data quality...');
         const issues: string[] = [];
        
        result.sources.forEach((source, index) => {
          if (!source.id) issues.push(`Source ${index + 1}: Missing ID`);
          if (!source.slug) issues.push(`Source ${index + 1}: Missing slug`);
          if (!source.name) issues.push(`Source ${index + 1}: Missing name`);
          if (!source.adapter_name) issues.push(`Source ${index + 1}: Missing adapter_name`);
        });

        if (issues.length === 0) {
          console.log(`   ✅ All sources have required fields (id, slug, name, adapter_name)`);
        } else {
          console.log(`   ⚠️  Data quality issues found:`);
          issues.forEach(issue => console.log(`      • ${issue}`));
        }

        // Test 5: Check for duplicate slugs
        const slugs = result.sources.map(s => s.slug);
        const duplicateSlugs = slugs.filter((slug, index) => slugs.indexOf(slug) !== index);
        
        if (duplicateSlugs.length === 0) {
          console.log(`   ✅ No duplicate slugs found`);
        } else {
          console.log(`   ⚠️  Duplicate slugs found: ${duplicateSlugs.join(', ')}`);
        }

        // Test 6: Check adapter distribution
        const adapters = result.sources.reduce((acc, source) => {
          acc[source.adapter_name] = (acc[source.adapter_name] || 0) + 1;
          return acc;
        }, {} as Record<string, number>);

        console.log(`   📊 Adapter distribution:`);
        Object.entries(adapters).forEach(([adapter, count]) => {
          console.log(`      • ${adapter}: ${count} source(s)`);
        });

      } else {
        console.log(`⚠️  No active sources found in the database`);
        console.log(`   This might mean:`);
        console.log(`   • The sources table is empty`);
        console.log(`   • All sources are marked as is_active = false`);
        console.log(`   • The migration 006_seed_sources_data.sql hasn't been run`);
      }

    } else {
      console.log(`❌ Status: FAILED`);
      console.log(`💥 Error: ${result.error}`);
      console.log();
      console.log(`🔧 Troubleshooting tips:`);
      console.log(`   • Check your Supabase URL and key in .env.local`);
      console.log(`   • Verify the 'sources' table exists in your database`);
      console.log(`   • Make sure migration scripts have been run`);
    }

  } catch (error) {
    console.error('💥 Test failed with error:', error);
    
    if (error instanceof Error) {
      if (error.message.includes('Missing required environment variables')) {
        console.log('\n🔧 Environment variable issues:');
        console.log('   Make sure your .env.local contains:');
        console.log('   • OPENAI_API_KEY');
        console.log('   • NEXT_PUBLIC_SUPABASE_URL');
        console.log('   • NEXT_PUBLIC_SUPABASE_ANON_KEY (or SUPABASE_SERVICE_ROLE_KEY)');
      }
    }
    
    process.exit(1);
  }
}

// Run the test
testFetchSources()
  .then(() => {
    console.log('\n✅ fetchActiveSourceSlugs test completed!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Test failed:', error);
    process.exit(1);
  }); 