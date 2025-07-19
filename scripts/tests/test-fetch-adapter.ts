#!/usr/bin/env tsx

/**
 * Comprehensive test for fetchAdapterData
 * Tests adapter integration, schema validation, and error handling
 */

// Load environment variables from .env.local or .env
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.join(process.cwd(), '.env.local') });
dotenv.config({ path: path.join(process.cwd(), '.env') });

import { fetchAdapterDataExecute, fetchActiveSourceSlugsExecute } from '../ingestion/tools/ingestion-helpers';
import { loadEnvironmentConfig } from '../../src/config/environment';
import { ParsedItem } from '../../src/types/adapter';

// Schema validation helper
function validateParsedItem(item: any, sourceName: string): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  
  // Required fields according to ParsedItem interface
  if (!item.external_id || typeof item.external_id !== 'string') {
    errors.push(`Missing or invalid external_id: ${JSON.stringify(item.external_id)}`);
  }
  
  if (!item.source_slug || typeof item.source_slug !== 'string') {
    errors.push(`Missing or invalid source_slug: ${JSON.stringify(item.source_slug)}`);
  }
  
  if (!item.title || typeof item.title !== 'string') {
    errors.push(`Missing or invalid title: ${JSON.stringify(item.title)}`);
  }
  
  if (!item.url || typeof item.url !== 'string') {
    errors.push(`Missing or invalid url: ${JSON.stringify(item.url)}`);
  }
  
  if (typeof item.content !== 'string') {
    errors.push(`Missing or invalid content: ${JSON.stringify(item.content)}`);
  }
  
  if (!item.published_at || typeof item.published_at !== 'string') {
    errors.push(`Missing or invalid published_at: ${JSON.stringify(item.published_at)}`);
  }
  
  if (!item.original_metadata || typeof item.original_metadata !== 'object' || item.original_metadata === null) {
    errors.push(`Missing or invalid original_metadata: ${JSON.stringify(item.original_metadata)}`);
  }
  
  // URL format validation
  if (item.url && typeof item.url === 'string') {
    try {
      new URL(item.url);
    } catch {
      errors.push(`Invalid URL format: ${item.url}`);
    }
  }
  
  // Optional fields type validation
  if (item.author !== undefined && typeof item.author !== 'string') {
    errors.push(`Invalid author type: ${typeof item.author}`);
  }
  
  if (item.image_url !== undefined && typeof item.image_url !== 'string') {
    errors.push(`Invalid image_url type: ${typeof item.image_url}`);
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

// Test adapter interface detection
function analyzeAdapterInterface(adapterName: string, sourceSlug: string) {
  const interfaceTypes = {
    'techCrunch': 'no-params',
    'ventureBeat': 'no-params', 
    'tldr': 'no-params',
    'openai': 'no-params',
    'aws': 'array-slugs',
    'arxiv': 'single-slug',
    'mit-research': 'single-slug',
    'mit-sloan': 'single-slug',
    'google-research': 'single-slug',
    'huggingface': 'single-slug',
    'anthropic': 'single-slug',
    'microsoft': 'single-slug'
  };
  
  return interfaceTypes[adapterName as keyof typeof interfaceTypes] || 'unknown';
}

async function testFetchAdapterData() {
  console.log('🧪 Testing fetchAdapterData Function\n');
  
  try {
    // Step 1: Get all active sources to test
    console.log('📋 Step 1: Getting active sources...');
    const sourcesResult = await fetchActiveSourceSlugsExecute();
    
    if (!sourcesResult.success || sourcesResult.sources.length === 0) {
      throw new Error('No active sources found for testing');
    }
    
    console.log(`   ✅ Found ${sourcesResult.count} active sources to test\n`);

    // Step 2: Test each adapter type systematically
    const results = {
      successful: [] as any[],
      failed: [] as any[],
      schemaErrors: [] as any[]
    };
    
    console.log('🔍 Step 2: Testing each adapter...\n');
    
    // Group sources by adapter for better reporting
    const adapterGroups: Record<string, any[]> = {};
    for (const source of sourcesResult.sources) {
      if (!adapterGroups[source.adapter_name]) {
        adapterGroups[source.adapter_name] = [];
      }
      adapterGroups[source.adapter_name].push(source);
    }
    
    for (const [adapterName, sources] of Object.entries(adapterGroups)) {
      console.log(`🔧 Testing adapter: ${adapterName}`);
      console.log(`   Interface type: ${analyzeAdapterInterface(adapterName, sources[0].slug)}`);
      console.log(`   Sources: ${sources.map(s => s.slug).join(', ')}`);
      
      // Test one source from each adapter (to avoid rate limits)
      const testSource = sources[0];
      
      try {
        const startTime = Date.now();
        const result = await fetchAdapterDataExecute({ adapterName });
        const duration = Date.now() - startTime;
        
        if (result.success) {
          console.log(`   ✅ SUCCESS: ${result.items.length} items in ${duration}ms`);
          
          // Validate schema for each item
          const schemaResults = result.items.map((item: any) => 
            validateParsedItem(item, testSource.name)
          );
          
          const validItems = schemaResults.filter(r => r.valid).length;
          const invalidItems = schemaResults.filter(r => !r.valid);
          
          if (invalidItems.length > 0) {
            console.log(`   ⚠️  Schema validation: ${validItems}/${result.items.length} valid`);
            invalidItems.slice(0, 2).forEach((invalid, idx) => {
              console.log(`      Item ${idx + 1} errors: ${invalid.errors.slice(0, 3).join(', ')}`);
            });
            results.schemaErrors.push({
              adapter: adapterName,
              source: testSource.slug,
              validItems,
              totalItems: result.items.length,
              sampleErrors: invalidItems.slice(0, 2)
            });
          } else {
            console.log(`   ✅ Schema validation: All ${result.items.length} items valid`);
          }
          
                     // Show sample item
           if (result.items.length > 0) {
             const sample = result.items[0];
             console.log(`   📄 Sample item:`);
             console.log(`      • External ID: ${sample.external_id?.substring(0, 40)}...`);
             console.log(`      • Title: ${sample.title?.substring(0, 60)}...`);
             console.log(`      • URL: ${sample.url}`);
             console.log(`      • Content: ${sample.content?.length || 0} chars`);
             console.log(`      • Author: ${sample.author || 'None'}`);
             console.log(`      • Published: ${sample.published_at || 'None'}`);
             console.log(`      • Source slug: ${sample.source_slug}`);
             console.log(`      • Image URL: ${sample.image_url || 'None'}`);
             console.log(`      • Metadata keys: ${Object.keys(sample.original_metadata || {}).join(', ')}`);
           }
          
          results.successful.push({
            adapter: adapterName,
            source: testSource.slug,
            itemCount: result.items.length,
            duration,
            validSchema: invalidItems.length === 0
          });
          
        } else {
          console.log(`   ❌ FAILED: ${result.error}`);
          results.failed.push({
            adapter: adapterName,
            source: testSource.slug,
            error: result.error,
            duration
          });
        }
        
      } catch (error) {
        console.log(`   💥 EXCEPTION: ${error instanceof Error ? error.message : error}`);
        results.failed.push({
          adapter: adapterName,
          source: testSource.slug,
          error: error instanceof Error ? error.message : 'Unknown error',
          type: 'exception'
        });
      }
      
      console.log();
    }

    // Step 3: Test error scenarios
    console.log('🚨 Step 3: Testing error scenarios...\n');
    
    // Test 3a: Non-existent adapter
    console.log('Testing non-existent adapter...');
    try {
      const result = await fetchAdapterDataExecute({ adapterName: 'non-existent-adapter' });
      if (result.success) {
        console.log(`   ❌ Expected failure but got success`);
      } else {
        console.log(`   ✅ Correctly failed: ${result.error}`);
      }
    } catch (error) {
      console.log(`   ❌ Unexpected exception: ${error}`);
    }
    
    // Test 3b: Invalid adapter name format
    console.log('\nTesting invalid adapter name...');
    try {
      const result = await fetchAdapterDataExecute({ adapterName: 'invalid/adapter/format' });
      if (result.success) {
        console.log(`   ❌ Expected failure but got success`);
      } else {
        console.log(`   ✅ Correctly failed: ${result.error}`);
      }
    } catch (error) {
      console.log(`   ❌ Unexpected exception: ${error}`);
    }

    // Step 4: Summary report
    console.log('\n📊 Step 4: Summary Report');
    console.log('=' .repeat(60));
    
    const totalAdapters = Object.keys(adapterGroups).length;
    const successfulAdapters = results.successful.length;
    const failedAdapters = results.failed.length;
    const schemaIssues = results.schemaErrors.length;
    
    console.log(`📈 Overall Results:`);
    console.log(`   • Total adapters tested: ${totalAdapters}`);
    console.log(`   • Successful: ${successfulAdapters} (${Math.round(successfulAdapters/totalAdapters*100)}%)`);
    console.log(`   • Failed: ${failedAdapters} (${Math.round(failedAdapters/totalAdapters*100)}%)`);
    console.log(`   • Schema issues: ${schemaIssues}`);
    
    if (results.successful.length > 0) {
      console.log(`\n✅ Successful Adapters:`);
      results.successful.forEach(result => {
        console.log(`   • ${result.adapter}: ${result.itemCount} items (${result.duration}ms)${result.validSchema ? ' ✓' : ' ⚠️'}`);
      });
    }
    
    if (results.failed.length > 0) {
      console.log(`\n❌ Failed Adapters:`);
      results.failed.forEach(result => {
        console.log(`   • ${result.adapter}: ${result.error}`);
      });
    }
    
    if (results.schemaErrors.length > 0) {
      console.log(`\n⚠️ Schema Issues:`);
      results.schemaErrors.forEach(result => {
        console.log(`   • ${result.adapter}: ${result.validItems}/${result.totalItems} valid items`);
      });
    }
    
    // Performance metrics
    const successfulResults = results.successful.filter(r => r.duration);
    if (successfulResults.length > 0) {
      const avgDuration = successfulResults.reduce((sum, r) => sum + r.duration, 0) / successfulResults.length;
      const maxDuration = Math.max(...successfulResults.map(r => r.duration));
      const minDuration = Math.min(...successfulResults.map(r => r.duration));
      
      console.log(`\n⚡ Performance Metrics:`);
      console.log(`   • Average fetch time: ${Math.round(avgDuration)}ms`);
      console.log(`   • Fastest: ${minDuration}ms`);
      console.log(`   • Slowest: ${maxDuration}ms`);
    }
    
    // Final assessment
    const successRate = successfulAdapters / totalAdapters;
    if (successRate >= 0.8) {
      console.log(`\n🎉 EXCELLENT: ${Math.round(successRate * 100)}% success rate!`);
    } else if (successRate >= 0.6) {
      console.log(`\n⚠️ GOOD: ${Math.round(successRate * 100)}% success rate, some issues to investigate`);
    } else {
      console.log(`\n🚨 NEEDS ATTENTION: Only ${Math.round(successRate * 100)}% success rate`);
    }

  } catch (error) {
    console.error('💥 Test failed with error:', error);
    process.exit(1);
  }
}

// Run the test
testFetchAdapterData()
  .then(() => {
    console.log('\n✅ fetchAdapterData comprehensive test completed!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Test failed:', error);
    process.exit(1);
  }); 