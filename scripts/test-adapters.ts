#!/usr/bin/env tsx
// Test script for adapter modules
// Run with: npx tsx scripts/test-adapter.ts [adapter-name]

import { fetchAndParse as fetchArxiv, fetchAndParseCs, fetchAndParseStat } from '../src/adapters/arxiv';
import { fetchAndParse as fetchMit, fetchAndParseResearch, fetchAndParseData, fetchAndParseAI } from '../src/adapters/mit-research';
import { fetchAndParse as fetchAws, fetchAwsBigData, fetchAwsMachineLearning, fetchAwsStartups, fetchAwsDeveloper, fetchAwsDatabase } from '../src/adapters/aws';
import { fetchAndParse as fetchMicrosoft, fetchMicrosoft365Insider, fetchMicrosoftExcel } from '../src/adapters/microsoft';
import { fetchAndParse as fetchOpenAI, fetchOpenAINews } from '../src/adapters/openai';
import { fetchAndParse as fetchTechCrunch } from '../src/adapters/techCrunch';
import { fetchAndParse as fetchVentureBeat } from '../src/adapters/ventureBeat';
import { fetchAndParse as fetchMitSloan } from '../src/adapters/mit-sloan';
import { fetchAndParse as fetchTldr } from '../src/adapters/tldr';
import { fetchAndParse as fetchHuggingface } from '../src/adapters/huggingface';
import { fetchAndParse as fetchGoogleResearch } from '../src/adapters/google-research';
import { fetchAndParse as fetchAnthropic } from '../src/adapters/anthropic';
import type { ParsedItem } from '../src/types/adapter';

const adapters = {
  // Unified adapters
  arxiv: {
    name: 'arXiv (All Feeds)',
    fetchAndParse: () => fetchArxiv()
  },
  mit: {
    name: 'MIT News (All Feeds)',
    fetchAndParse: () => fetchMit()
  },
  aws: {
    name: 'AWS Blogs (All Feeds)',
    fetchAndParse: () => fetchAws()
  },
  microsoft: {
    name: 'Microsoft Blogs (All Feeds)',
    fetchAndParse: () => fetchMicrosoft()
  },
  openai: {
    name: 'OpenAI News',
    fetchAndParse: () => fetchOpenAI()
  },
  techcrunch: {
    name: 'TechCrunch',
    fetchAndParse: () => fetchTechCrunch()
  },
  venturebeat: {
    name: 'VentureBeat',
    fetchAndParse: () => fetchVentureBeat()
  },
  mitsloan: {
    name: 'MIT Sloan Management Review',
    fetchAndParse: () => fetchMitSloan()
  },
  tldr: {
    name: 'TLDR.tech',
    fetchAndParse: () => fetchTldr()
  },
  huggingface: {
    name: 'HuggingFace Papers',
    fetchAndParse: () => fetchHuggingface()
  },
  googleresearch: {
    name: 'Google Research Blog',
    fetchAndParse: () => fetchGoogleResearch()
  },
  anthropic: {
    name: 'Anthropic News',
    fetchAndParse: () => fetchAnthropic()
  },
  
  // Individual arXiv feeds
  arxivCs: {
    name: 'arXiv Computer Science',
    fetchAndParse: fetchAndParseCs
  },
  arxivStat: {
    name: 'arXiv Statistics', 
    fetchAndParse: fetchAndParseStat
  },
  
  // Individual MIT feeds
  mitResearch: {
    name: 'MIT News - Research',
    fetchAndParse: fetchAndParseResearch
  },
  mitData: {
    name: 'MIT News - Data',
    fetchAndParse: fetchAndParseData
  },
  mitAI: {
    name: 'MIT News - AI',
    fetchAndParse: fetchAndParseAI
  },
  
  // Individual AWS feeds
  awsBigData: {
    name: 'AWS Big Data Blog',
    fetchAndParse: fetchAwsBigData
  },
  awsMachineLearning: {
    name: 'AWS Machine Learning Blog',
    fetchAndParse: fetchAwsMachineLearning
  },
  awsStartups: {
    name: 'AWS Startups Blog',
    fetchAndParse: fetchAwsStartups
  },
  awsDeveloper: {
    name: 'AWS Developer Blog',
    fetchAndParse: fetchAwsDeveloper
  },
  awsDatabase: {
    name: 'AWS Database Blog',
    fetchAndParse: fetchAwsDatabase
  },
  
  // Individual Microsoft feeds
  microsoft365Insider: {
    name: 'Microsoft 365 Insider Blog',
    fetchAndParse: fetchMicrosoft365Insider
  },
  microsoftExcel: {
    name: 'Microsoft Excel Blog',
    fetchAndParse: fetchMicrosoftExcel
  },
  
  // Individual OpenAI feeds
  openaiNews: {
    name: 'OpenAI News',
    fetchAndParse: fetchOpenAINews
  }
} as const;

async function testAdapter(adapterKey: keyof typeof adapters) {
  const adapter = adapters[adapterKey];
  
  console.log(`🚀 Testing ${adapter.name} Adapter`);
  console.log('=' .repeat(50));
  
  try {
    const startTime = Date.now();
    const items = await adapter.fetchAndParse();
    const endTime = Date.now();
    
    console.log(`\n📊 Results Summary:`);
    console.log(`- Total items parsed: ${items.length}`);
    console.log(`- Execution time: ${endTime - startTime}ms`);
    
    if (items.length === 0) {
      console.log('❌ No items were parsed. Check the adapter logic or RSS feed.');
      return;
    }
    
    // Show source breakdown for multi-feed adapters
    const sourceCounts = items.reduce((acc, item) => {
      acc[item.source_slug] = (acc[item.source_slug] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    
    if (Object.keys(sourceCounts).length > 1) {
      console.log(`- Source breakdown:`, sourceCounts);
    }
    
    // Show first 3 items in detail
    const itemsToShow = Math.min(3, items.length);
    console.log(`\n🔍 Detailed view of first ${itemsToShow} items:`);
    console.log('=' .repeat(50));
    
    for (let i = 0; i < itemsToShow; i++) {
      const item = items[i];
      console.log(`\n📄 Item ${i + 1}:`);
      console.log(`  external_id: ${item.external_id}`);
      console.log(`  source_slug: ${item.source_slug}`);
      console.log(`  title: ${item.title}`);
      console.log(`  url: ${item.url}`);
      console.log(`  content: ${item.content.substring(0, 200)}${item.content.length > 200 ? '...' : ''}`);
      console.log(`  published_at: ${item.published_at}`);
      console.log(`  author: ${item.author || 'N/A'}`);
      console.log(`  image_url: ${item.image_url || 'N/A'}`);
      console.log(`  original_metadata keys: ${Object.keys(item.original_metadata).join(', ')}`);
    }
    
    // Show summary statistics
    console.log(`\n📈 Field Statistics:`);
    console.log(`- Items with author: ${items.filter(i => i.author).length}`);
    console.log(`- Items with image_url: ${items.filter(i => i.image_url).length}`);
    console.log(`- Average content length: ${Math.round(items.reduce((sum, i) => sum + i.content.length, 0) / items.length)} chars`);
    console.log(`- Unique external_ids: ${new Set(items.map(i => i.external_id)).size}`);
    console.log(`- Date range: ${items.map(i => i.published_at).sort()[0]} to ${items.map(i => i.published_at).sort().pop()}`);
    
    // Show a sample of original metadata for transparency
    if (items.length > 0) {
      console.log(`\n🔧 Sample Original Metadata (Item 1):`);
      console.log(JSON.stringify(items[0].original_metadata, null, 2));
    }
    
    console.log(`\n✅ Test completed successfully!`);
    
  } catch (error) {
    console.error('❌ Test failed with error:', error);
    process.exit(1);
  }
}

async function testAllAdapters() {
  console.log('🧪 Testing All Adapters');
  console.log('=' .repeat(50));
  
  for (const [key, adapter] of Object.entries(adapters)) {
    console.log(`\n🎯 Testing ${adapter.name}...`);
    await testAdapter(key as keyof typeof adapters);
    console.log('\n' + '-'.repeat(50));
  }
  
  console.log('\n🎉 All adapter tests completed!');
}

// Parse command line arguments
const adapterArg = process.argv[2];

if (adapterArg) {
  if (adapterArg in adapters) {
    testAdapter(adapterArg as keyof typeof adapters);
  } else {
    console.error(`❌ Unknown adapter: ${adapterArg}`);
    console.log('Available adapters:', Object.keys(adapters).join(', '));
    process.exit(1);
  }
} else {
  testAllAdapters();
} 