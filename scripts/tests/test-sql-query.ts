#!/usr/bin/env tsx

/**
 * Test the exact SQL query that fetchActiveSourceSlugs uses
 */

// Load environment variables from .env.local or .env
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.join(process.cwd(), '.env.local') });
dotenv.config({ path: path.join(process.cwd(), '.env') });

import { createClient } from '@supabase/supabase-js';
import { loadEnvironmentConfig } from '../../src/config/environment';

async function testSQLQuery() {
  console.log('🔍 Testing SQL Query for fetchActiveSourceSlugs\n');
  
  try {
    const config = loadEnvironmentConfig();
    console.log('📋 Using configuration:');
    console.log(`   • Supabase URL: ${config.supabase.url.substring(0, 40)}...`);
    console.log(`   • Table: ${config.ingestion.feedSourcesTable}`);
    console.log();

    // Test with different credential types
    const tests = [
      {
        name: 'Anon Key',
        key: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
        keyType: 'anon'
      },
      {
        name: 'Service Role Key', 
        key: process.env.SUPABASE_SERVICE_ROLE_KEY,
        keyType: 'service_role'
      }
    ];

    for (const test of tests) {
      if (!test.key) {
        console.log(`⏭️  Skipping ${test.name} (not configured)\n`);
        continue;
      }

      console.log(`🧪 Testing with ${test.name}...`);
      const supabase = createClient(config.supabase.url, test.key);

      try {
        // Test 1: Check table access
        console.log('   Step 1: Testing basic table access...');
        const { data: countData, error: countError } = await supabase
          .from(config.ingestion.feedSourcesTable)
          .select('id', { count: 'exact', head: true });

        if (countError) {
          console.log(`   ❌ Table access failed: ${countError.message}`);
          console.log();
          continue;
        }

        console.log(`   ✅ Table accessible, total rows: ${countData?.length || 'unknown'}`);

        // Test 2: Test the exact query from fetchActiveSourceSlugs
        console.log('   Step 2: Testing exact fetchActiveSourceSlugs query...');
        const { data, error, count } = await supabase
          .from(config.ingestion.feedSourcesTable)
          .select('id, slug, name, adapter_name', { count: 'exact' })
          .eq('is_active', true)
          .order('priority', { ascending: false });

        if (error) {
          console.log(`   ❌ Query failed: ${error.message}`);
          console.log(`   Details: ${JSON.stringify(error, null, 2)}`);
        } else {
          console.log(`   ✅ Query successful!`);
          console.log(`   📊 Results: ${data?.length || 0} sources found`);
          console.log(`   🔢 Count: ${count}`);
          
          if (data && data.length > 0) {
            console.log('   📋 First 3 sources:');
            data.slice(0, 3).forEach((source, index) => {
              console.log(`      ${index + 1}. ${source.name} (${source.slug}) - ${source.adapter_name}`);
            });
          }
        }

        // Test 3: Test simple count query
        console.log('   Step 3: Testing simple count...');
        const { count: simpleCount, error: simpleError } = await supabase
          .from(config.ingestion.feedSourcesTable)
          .select('*', { count: 'exact', head: true })
          .eq('is_active', true);

        if (simpleError) {
          console.log(`   ❌ Count query failed: ${simpleError.message}`);
        } else {
          console.log(`   ✅ Count query successful: ${simpleCount} active sources`);
        }

        console.log();

      } catch (testError) {
        console.log(`   💥 Test failed: ${testError}`);
        console.log();
      }
    }

    // Final recommendation
    console.log('💡 Recommendations:');
    console.log('   1. If SERVICE_ROLE_KEY works but ANON_KEY fails:');
    console.log('      → Row Level Security (RLS) is blocking anon access');
    console.log('      → Use SERVICE_ROLE_KEY for ingestion');
    console.log('   2. If both fail:');
    console.log('      → Check database connection and permissions');
    console.log('   3. If both work:');
    console.log('      → There might be a timing or environment issue');

  } catch (error) {
    console.error('💥 Test setup failed:', error);
    process.exit(1);
  }
}

testSQLQuery()
  .then(() => {
    console.log('\n✅ SQL query test completed!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Test failed:', error);
    process.exit(1);
  }); 