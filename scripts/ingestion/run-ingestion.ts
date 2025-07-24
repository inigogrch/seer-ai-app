#!/usr/bin/env tsx

/**
 * Simple runner for the ingestion pipeline
 * Loads environment variables and executes the full ingestion process
 */

// Load environment variables from .env.local or .env
import dotenv from 'dotenv';
import path from 'path';

// Find project root (go up two levels from scripts/ingestion directory)
const projectRoot = path.resolve(__dirname, '../..');

// Try to load .env.local first, then .env from project root
dotenv.config({ path: path.join(projectRoot, '.env.local') });
dotenv.config({ path: path.join(projectRoot, '.env') });

// Now import and run ingestion
import { runIngestion } from './ingestion-pipeline';

async function main() {
  console.log('🚀 Starting Full Ingestion Pipeline with LLM Classification\n');
  console.log('═'.repeat(80));
  
  try {
    const result = await runIngestion();
    
    console.log('\n' + '═'.repeat(80));
    console.log('🎉 INGESTION PIPELINE COMPLETED SUCCESSFULLY!');
    console.log('═'.repeat(80));
    console.log('📊 Final Results:');
    console.log(`   • Total items processed: ${result.stats.totalItems}`);
    console.log(`   • Successfully ingested: ${result.stats.successfulIngests}`);
    console.log(`   • Failed ingests: ${result.stats.failedIngests}`);
    console.log(`   • Skipped existing items: ${result.stats.skippedItems}`);
    console.log(`   • Sources processed: ${result.stats.sourcesProcessed}`);
    console.log(`   • Duration: ${result.duration}ms`);
    
    if (result.stats.successfulIngests > 0) {
      console.log('\n🎯 Your Supabase database now contains enriched stories with:');
      console.log('   ✅ Full content extraction');
      console.log('   ✅ Semantic embeddings');
      console.log('   ✅ LLM-generated categories');
      console.log('   ✅ Intelligent tags');
    }
    
    process.exit(0);
  } catch (error) {
    console.error('\n💥 INGESTION PIPELINE FAILED');
    console.error('═'.repeat(80));
    console.error('Error:', error);
    process.exit(1);
  }
}

main(); 