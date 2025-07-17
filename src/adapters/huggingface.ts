import { ParsedItem } from '../types/adapter';

const HUGGINGFACE_URL = 'https://huggingface.co/papers';

interface HFPaper {
  title: string;
  authors: string;
  submitter: string;
  stats: string;
  url: string;
}

async function fetchHuggingFacePage(): Promise<string> {
  console.log('[HuggingFace] Fetching papers page');
  
  try {
    const response = await fetch(HUGGINGFACE_URL, {
      headers: {
        'User-Agent': 'Seer-AI/1.0 (+https://seer-ai.app)',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      }
    });
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    return await response.text();
  } catch (error) {
    console.error('[HuggingFace] Error fetching papers page:', error);
    throw error;
  }
}

function extractPapersFromHTML(html: string): HFPaper[] {
  console.log('[HuggingFace] Extracting papers from HTML');
  
  const papers: HFPaper[] = [];
  
  try {
    // Look for the DailyPapers SVELTE_HYDRATER data which contains the papers JSON
    const dataMatch = html.match(/data-target="DailyPapers"\s+data-props="([^"]*)/);
    if (!dataMatch) {
      console.log('[HuggingFace] No DailyPapers SVELTE_HYDRATER data found');
      return [];
    }
    
    // Decode the HTML entities and parse JSON
    let jsonData = dataMatch[1]
      .replace(/&quot;/g, '"')
      .replace(/&amp;/g, '&')
      .replace(/&#x27;/g, "'");
    
    const parsedData = JSON.parse(jsonData);
    
    if (!parsedData.dailyPapers || !Array.isArray(parsedData.dailyPapers)) {
      console.log('[HuggingFace] No dailyPapers found in data');
      return [];
    }
    
    console.log(`[HuggingFace] Found ${parsedData.dailyPapers.length} papers in JSON data`);
    
    // Extract papers from the JSON data
    for (const paperData of parsedData.dailyPapers) {
      try {
        const paper = paperData.paper;
        if (!paper || !paper.title) continue;
        
        const title = paper.title.replace(/\n/g, ' ').trim();
        const url = `https://huggingface.co/papers/${paper.id}`;
        
        // Extract authors
        let authors = '';
        if (paper.authors && Array.isArray(paper.authors)) {
          const authorNames = paper.authors.map((author: any) => author.name).filter(Boolean);
          if (authorNames.length > 0) {
            authors = authorNames.length > 3 
              ? `${authorNames.slice(0, 3).join(', ')} et al.`
              : authorNames.join(', ');
          }
        }
        
        // Extract submitter
        let submitter = 'Unknown';
        if (paper.submittedOnDailyBy && paper.submittedOnDailyBy.fullname) {
          submitter = paper.submittedOnDailyBy.fullname;
        }
        
        // Extract stats
        let stats = '';
        if (paper.upvotes) {
          stats += `${paper.upvotes} upvotes`;
        }
        if (paper.numComments) {
          stats += stats ? `, ${paper.numComments} comments` : `${paper.numComments} comments`;
        }
        
        papers.push({
          title,
          authors,
          submitter,
          stats,
          url
        });
        
      } catch (paperError) {
        console.warn('[HuggingFace] Error parsing individual paper:', paperError);
        continue;
      }
    }
    
    console.log(`[HuggingFace] Successfully extracted ${papers.length} papers`);
    return papers;
    
  } catch (error) {
    console.error('[HuggingFace] Error extracting papers from JSON:', error);
    return [];
  }
}

function generateTags(title: string, authors: string): string[] {
  const tags = ['huggingface', 'ai-research', 'machine-learning'];
  
  const titleLower = title.toLowerCase();
  const authorsLower = authors.toLowerCase();
  const combined = `${titleLower} ${authorsLower}`;
  
  // Add tags based on content
  const tagMappings = [
    { keywords: ['llm', 'language model', 'large language'], tag: 'llm' },
    { keywords: ['vision', 'image', 'visual'], tag: 'computer-vision' },
    { keywords: ['multimodal', 'multi-modal'], tag: 'multimodal' },
    { keywords: ['diffusion', 'stable diffusion'], tag: 'diffusion' },
    { keywords: ['transformer', 'attention'], tag: 'transformers' },
    { keywords: ['reasoning', 'chain of thought'], tag: 'reasoning' },
    { keywords: ['fine-tuning', 'finetuning'], tag: 'fine-tuning' },
    { keywords: ['robotics', 'robot'], tag: 'robotics' },
    { keywords: ['reinforcement', 'rl'], tag: 'reinforcement-learning' },
    { keywords: ['generation', 'generative'], tag: 'generative-ai' }
  ];
  
  tagMappings.forEach(mapping => {
    if (mapping.keywords.some(keyword => combined.includes(keyword))) {
      tags.push(mapping.tag);
    }
  });
  
  return [...new Set(tags)].slice(0, 6); // Limit and dedupe
}

function createExternalId(title: string, url: string): string {
  // Extract canonical arXiv ID from HuggingFace URL
  // Format: hf-2507.11764 → 2507.11764 (canonical arXiv ID)
  const urlMatch = url.match(/\/papers\/([^\/\?]+)/);
  if (urlMatch) {
    const paperId = urlMatch[1];
    
    // Check if it's an arXiv ID pattern (XXXX.XXXXX)
    const arxivMatch = paperId.match(/^(\d{4}\.\d{4,5})$/);
    if (arxivMatch) {
      return arxivMatch[1]; // Return canonical arXiv ID
    }
    
    // If not arXiv format, keep HF prefix for other paper types
    return `hf-${paperId}`;
  }
  
  // Fallback to title-based ID with HF prefix
  const titleHash = Buffer.from(title).toString('base64').substring(0, 12);
  return `hf-${titleHash}`;
}

export async function fetchAndParse(): Promise<ParsedItem[]> {
  console.log('[HuggingFace] Starting fetch from HuggingFace Papers');
  
  try {
    // Fetch the papers page
    const html = await fetchHuggingFacePage();
    
    // Extract paper information
    const papers = extractPapersFromHTML(html);
    
    if (papers.length === 0) {
      console.log('[HuggingFace] No papers extracted');
      return [];
    }
    
    // Convert to ParsedItem format
    const items: ParsedItem[] = papers.map((paper) => {
      const tags = generateTags(paper.title, paper.authors);
      const externalId = createExternalId(paper.title, paper.url);
      
      return {
        external_id: externalId,
        source_slug: 'huggingface',
        title: paper.title,
        url: paper.url,
        content: '', // Leave empty - ingestion agent will scrape full content
        published_at: new Date().toISOString(), // Use current date since papers are daily trending
        author: paper.submitter !== 'Unknown' ? paper.submitter : undefined,
        image_url: undefined, // Will be extracted by ingestion agent
        original_metadata: {
          source_name: 'HuggingFace Papers',
          content_type: 'research_paper',
          hf_authors: paper.authors,
          hf_submitter: paper.submitter,
          hf_stats: paper.stats,
          tags: tags,
          extraction_source: 'web_scrape',
          trending_date: new Date().toISOString().split('T')[0]
        }
      };
    });
    
    // Sort by title for consistent ordering
    items.sort((a, b) => a.title.localeCompare(b.title));
    
    console.log(`[HuggingFace] Successfully processed ${items.length} papers`);
    return items;
    
  } catch (error) {
    console.error('[HuggingFace] Error in fetch:', error);
    throw error;
  }
} 