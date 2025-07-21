#!/usr/bin/env tsx
// Interface validation script for all adapters
import { ParsedItem } from '../../src/types/adapter';

// Import all adapters
import { fetchAndParse as fetchArxiv } from '../../src/adapters/arxiv';
import { fetchAndParse as fetchMit } from '../../src/adapters/mit-research';
import { fetchAndParse as fetchAws } from '../../src/adapters/aws';
import { fetchAndParse as fetchMicrosoft } from '../../src/adapters/microsoft';
import { fetchAndParse as fetchOpenAI } from '../../src/adapters/openai';
import { fetchAndParse as fetchTechCrunch } from '../../src/adapters/techCrunch';
import { fetchAndParse as fetchVentureBeat } from '../../src/adapters/ventureBeat';
import { fetchAndParse as fetchMitSloan } from '../../src/adapters/mit-sloan';
import { fetchAndParse as fetchTldr } from '../../src/adapters/tldr';
import { fetchAndParse as fetchHuggingface } from '../../src/adapters/huggingface';
import { fetchAndParse as fetchGoogleResearch } from '../../src/adapters/google-research';
import { fetchAndParse as fetchAnthropic } from '../../src/adapters/anthropic';

interface AdapterConfig {
  name: string;
  fetchAndParse: () => Promise<ParsedItem[]>;
}

const adapters: AdapterConfig[] = [
  { name: 'arXiv', fetchAndParse: fetchArxiv },
  { name: 'MIT Research', fetchAndParse: fetchMit },
  { name: 'AWS Blogs', fetchAndParse: fetchAws },
  { name: 'Microsoft Blogs', fetchAndParse: fetchMicrosoft },
  { name: 'OpenAI News', fetchAndParse: fetchOpenAI },
  { name: 'TechCrunch', fetchAndParse: fetchTechCrunch },
  { name: 'VentureBeat', fetchAndParse: fetchVentureBeat },
  { name: 'MIT Sloan', fetchAndParse: fetchMitSloan },
  { name: 'TLDR.tech', fetchAndParse: fetchTldr },
  { name: 'HuggingFace Papers', fetchAndParse: fetchHuggingface },
  { name: 'Google Research', fetchAndParse: fetchGoogleResearch },
  { name: 'Anthropic News', fetchAndParse: fetchAnthropic }
];

interface ValidationResult {
  adapterName: string;
  totalItems: number;
  interfaceCompliant: boolean;
  errors: string[];
  contentAnalysis: {
    emptyContent: number;
    hasContent: number;
    averageContentLength: number;
    hasAuthors: number;
    hasImages: number;
  };
}

function validateParsedItem(item: ParsedItem, index: number): string[] {
  const errors: string[] = [];
  
  // Check required fields exist and are correct types
  if (typeof item.external_id !== 'string') {
    errors.push(`Item ${index}: external_id must be string, got ${typeof item.external_id}`);
  }
  if (typeof item.source_slug !== 'string') {
    errors.push(`Item ${index}: source_slug must be string, got ${typeof item.source_slug}`);
  }
  if (typeof item.title !== 'string') {
    errors.push(`Item ${index}: title must be string, got ${typeof item.title}`);
  }
  if (typeof item.url !== 'string') {
    errors.push(`Item ${index}: url must be string, got ${typeof item.url}`);
  }
  if (typeof item.content !== 'string') {
    errors.push(`Item ${index}: content must be string, got ${typeof item.content}`);
  }
  if (typeof item.published_at !== 'string') {
    errors.push(`Item ${index}: published_at must be string, got ${typeof item.published_at}`);
  }
  if (!item.original_metadata || typeof item.original_metadata !== 'object') {
    errors.push(`Item ${index}: original_metadata must be object, got ${typeof item.original_metadata}`);
  }
  
  // Check optional fields are correct types if present
  if (item.author !== undefined && typeof item.author !== 'string') {
    errors.push(`Item ${index}: author must be string or undefined, got ${typeof item.author}`);
  }
  if (item.image_url !== undefined && typeof item.image_url !== 'string') {
    errors.push(`Item ${index}: image_url must be string or undefined, got ${typeof item.image_url}`);
  }
  
  // Check required fields are not empty
  if (item.external_id === '') {
    errors.push(`Item ${index}: external_id cannot be empty string`);
  }
  if (item.source_slug === '') {
    errors.push(`Item ${index}: source_slug cannot be empty string`);
  }
  if (item.title === '') {
    errors.push(`Item ${index}: title cannot be empty string`);
  }
  if (item.url === '') {
    errors.push(`Item ${index}: url cannot be empty string`);
  }
  
  // Validate ISO 8601 date format
  try {
    const date = new Date(item.published_at);
    if (isNaN(date.getTime())) {
      errors.push(`Item ${index}: published_at must be valid ISO 8601 date, got "${item.published_at}"`);
    }
  } catch {
    errors.push(`Item ${index}: published_at must be valid ISO 8601 date, got "${item.published_at}"`);
  }
  
  return errors;
}

function analyzeContent(items: ParsedItem[]) {
  let emptyContent = 0;
  let hasContent = 0;
  let totalContentLength = 0;
  let hasAuthors = 0;
  let hasImages = 0;
  
  for (const item of items) {
    if (item.content === '') {
      emptyContent++;
    } else {
      hasContent++;
      totalContentLength += item.content.length;
    }
    
    if (item.author) {
      hasAuthors++;
    }
    
    if (item.image_url) {
      hasImages++;
    }
  }
  
  return {
    emptyContent,
    hasContent,
    averageContentLength: hasContent > 0 ? Math.round(totalContentLength / hasContent) : 0,
    hasAuthors,
    hasImages
  };
}

async function validateAdapter(config: AdapterConfig): Promise<ValidationResult> {
  console.log(`\n🔍 Validating ${config.name}...`);
  
  try {
    const items = await config.fetchAndParse();
    const errors: string[] = [];
    
    // Validate each item against interface
    for (let i = 0; i < Math.min(items.length, 5); i++) { // Check first 5 items
      const itemErrors = validateParsedItem(items[i], i);
      errors.push(...itemErrors);
    }
    
    const contentAnalysis = analyzeContent(items);
    
    return {
      adapterName: config.name,
      totalItems: items.length,
      interfaceCompliant: errors.length === 0,
      errors,
      contentAnalysis
    };
    
  } catch (error) {
    return {
      adapterName: config.name,
      totalItems: 0,
      interfaceCompliant: false,
      errors: [`Adapter failed: ${error}`],
      contentAnalysis: {
        emptyContent: 0,
        hasContent: 0,
        averageContentLength: 0,
        hasAuthors: 0,
        hasImages: 0
      }
    };
  }
}

async function main() {
  console.log('🚀 Starting Adapter Interface Validation & Content Analysis');
  console.log('=' .repeat(70));
  
  const results: ValidationResult[] = [];
  
  // Test each adapter
  for (const adapter of adapters) {
    const result = await validateAdapter(adapter);
    results.push(result);
  }
  
  // Generate report
  console.log('\n' + '=' .repeat(70));
  console.log('📊 ADAPTER VALIDATION REPORT');
  console.log('=' .repeat(70));
  
  console.log('\n✅ INTERFACE COMPLIANCE:');
  const compliant = results.filter(r => r.interfaceCompliant);
  const nonCompliant = results.filter(r => !r.interfaceCompliant);
  
  console.log(`  • Compliant: ${compliant.length}/${results.length} adapters`);
  compliant.forEach(r => console.log(`    ✓ ${r.adapterName} (${r.totalItems} items)`));
  
  if (nonCompliant.length > 0) {
    console.log(`  • Non-compliant: ${nonCompliant.length} adapters`);
    nonCompliant.forEach(r => {
      console.log(`    ✗ ${r.adapterName}:`);
      r.errors.forEach(error => console.log(`      - ${error}`));
    });
  }
  
  console.log('\n📝 CONTENT ANALYSIS:');
  
  // Adapters that fully populate content
  const fullContent = results.filter(r => r.contentAnalysis.emptyContent === 0 && r.totalItems > 0);
  console.log(`\n  ✅ ADAPTERS WITH FULL CONTENT (${fullContent.length}):`)
  fullContent.forEach(r => {
    console.log(`    • ${r.adapterName}: ${r.totalItems} items, avg ${r.contentAnalysis.averageContentLength} chars`);
  });
  
  // Adapters that need ingestion agent scraping
  const needsScraping = results.filter(r => r.contentAnalysis.emptyContent > 0);
  console.log(`\n  🔄 ADAPTERS REQUIRING INGESTION AGENT (${needsScraping.length}):`)
  needsScraping.forEach(r => {
    const emptyPercent = Math.round((r.contentAnalysis.emptyContent / r.totalItems) * 100);
    console.log(`    • ${r.adapterName}: ${r.contentAnalysis.emptyContent}/${r.totalItems} empty (${emptyPercent}%)`);
  });
  
  // Summary statistics
  console.log('\n📈 SUMMARY STATISTICS:');
  const totalItems = results.reduce((sum, r) => sum + r.totalItems, 0);
  const totalEmptyContent = results.reduce((sum, r) => sum + r.contentAnalysis.emptyContent, 0);
  const totalWithAuthors = results.reduce((sum, r) => sum + r.contentAnalysis.hasAuthors, 0);
  const totalWithImages = results.reduce((sum, r) => sum + r.contentAnalysis.hasImages, 0);
  
  console.log(`  • Total items across all adapters: ${totalItems}`);
  console.log(`  • Items requiring content scraping: ${totalEmptyContent} (${Math.round((totalEmptyContent/totalItems)*100)}%)`);
  console.log(`  • Items with authors: ${totalWithAuthors} (${Math.round((totalWithAuthors/totalItems)*100)}%)`);
  console.log(`  • Items with images: ${totalWithImages} (${Math.round((totalWithImages/totalItems)*100)}%)`);
  
  console.log('\n' + '=' .repeat(70));
  console.log('✅ Validation Complete!');
}

main().catch(console.error); 