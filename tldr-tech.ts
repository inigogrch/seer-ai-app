import { SourceConfig, ParsedItem } from '../../lib/adapters/types'
import { fetchXml } from '../../lib/adapters/utils/fetchXml'
import { parseRss } from '../../lib/adapters/utils/parseRss'
import crypto from 'crypto'

// TLDR.tech configuration
const TLDR_TECH_CONFIG: Omit<SourceConfig, 'id'> = {
  name: 'TLDR.tech',
  type: 'rss', 
  endpoint_url: 'https://tldr.tech/api/rss/tech',
  fetch_freq_min: 720 // 12 hours (newsletter frequency)
}

interface TLDRStory {
  title: string
  url: string
  summary: string
  category: string
  readTime: string
  publishedAt: Date
}

async function fetchDailyDigestUrls(): Promise<{ url: string; publishedAt: Date; title: string }[]> {
  console.log('[TLDR.tech] Fetching daily digest URLs from RSS feed')
  
  try {
    const xmlContent = await fetchXml(TLDR_TECH_CONFIG.endpoint_url)
    const rssData = await parseRss(xmlContent)
    
    console.log(`[TLDR.tech] Found ${rssData.items.length} daily digests`)
    
    return rssData.items.map((item: any) => ({
      url: item.link || '',
      publishedAt: new Date(item.pubDate || item.date || Date.now()),
      title: item.title || ''
    }))
    
  } catch (error) {
    console.error('[TLDR.tech] Error fetching RSS feed:', error)
    throw error
  }
}

async function scrapeStoriesFromDigest(digestUrl: string, digestDate: Date, timeout: number = 10000): Promise<TLDRStory[]> {
  console.log(`[TLDR.tech] Scraping stories from ${digestUrl}`)
  
  try {
    // Add timeout to prevent hanging
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), timeout)
    
    const response = await fetch(digestUrl, {
      headers: {
        'User-Agent': 'DataGate/1.0 (+https://datagate.app)'
      },
      signal: controller.signal
    })
    
    clearTimeout(timeoutId)
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`)
    }
    
    const html = await response.text()
    const stories: TLDRStory[] = []
    
    // Simplified regex patterns for better performance
    const articleRegex = /<article[^>]*class="mt-3"[^>]*>[\s\S]*?<\/article>/g
    const articles = html.match(articleRegex) || []
    
    let currentCategory = 'General'
    
    // Extract category headers more efficiently
    const categoryHeaderRegex = /<h3[^>]*class="text-center font-bold"[^>]*>([^<]+)<\/h3>/g
    let categoryMatch
    const categories: string[] = []
    
    while ((categoryMatch = categoryHeaderRegex.exec(html)) !== null) {
      categories.push(categoryMatch[1].replace(/&amp;/g, '&').trim())
    }
    
    // Process articles with category context
    let categoryIndex = 0
    
    for (const article of articles) {
      try {
        // Extract title and URL
        const titleMatch = article.match(/<h3[^>]*>([^<]+)<\/h3>/)
        const urlMatch = article.match(/<a[^>]*href="([^"]*)"/)
        
        if (titleMatch && urlMatch) {
          let title = titleMatch[1].trim()
          let url = urlMatch[1].trim()
          
          // Clean title
          title = title.replace(/&amp;/g, '&').replace(/&#x27;/g, "'").replace(/&#8217;/g, "'").trim()
          
          // Extract read time from title
          let readTime = ''
          const readTimeMatch = title.match(/\((\d+\s*minute\s*read)\)/)
          if (readTimeMatch) {
            readTime = readTimeMatch[1]
            title = title.replace(/\s*\(\d+\s*minute\s*read\)\s*/g, '').trim()
          }
          
          // Skip sponsor content
          if (title.toLowerCase().includes('sponsor') || 
              url.includes('utm_campaign') && url.includes('sponsor')) {
            continue
          }
          
          // Use category from context or default
          if (categoryIndex < categories.length) {
            currentCategory = categories[categoryIndex]
          }
          
          // Extract summary from article content
          let summary = ''
          const summaryMatch = article.match(/dangerouslySetInnerHTML[^>]*__html[^>]*"([^"]*)"/)
          if (summaryMatch) {
            summary = summaryMatch[1]
              .replace(/\\u003c[^>]*\\u003e/g, '')
              .replace(/\\"/g, '"')
              .replace(/&amp;/g, '&')
              .replace(/<[^>]*>/g, '')
              .trim()
          }
          
          stories.push({
            title,
            url,
            summary: summary || title, // Fallback to title if no summary
            category: currentCategory,
            readTime,
            publishedAt: digestDate
          })
        }
      } catch (err) {
        console.warn(`[TLDR.tech] Error parsing article: ${err}`)
        continue
      }
      
      // Move to next category periodically
      if (stories.length > 0 && stories.length % 5 === 0) {
        categoryIndex++
      }
    }
    
    console.log(`[TLDR.tech] Extracted ${stories.length} stories from digest`)
    return stories
    
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      console.warn(`[TLDR.tech] Timeout scraping ${digestUrl}`)
    } else {
      console.error(`[TLDR.tech] Error scraping ${digestUrl}:`, error)
    }
    return []
  }
}

export async function fetchAndParse(): Promise<ParsedItem[]> {
  console.log('[TLDR.tech] Starting optimized fetch from TLDR.tech')
  
  try {
    // Get daily digest URLs from RSS
    const digests = await fetchDailyDigestUrls()
    
    if (digests.length === 0) {
      console.log('[TLDR.tech] No digests found')
      return []
    }
    
    // Limit to last 7 days for comprehensive coverage
    const recentDigests = digests.slice(0, 7)
    console.log(`[TLDR.tech] Processing ${recentDigests.length} recent digests`)
    
    const allStories: TLDRStory[] = []
    
    // Process each digest with timeout
    for (const digest of recentDigests) {
      try {
        const stories = await scrapeStoriesFromDigest(digest.url, digest.publishedAt, 8000) // 8 second timeout
        allStories.push(...stories)
        
        // Short delay between requests
        await new Promise(resolve => setTimeout(resolve, 500))
      } catch (error) {
        console.error(`[TLDR.tech] Error processing digest ${digest.url}:`, error)
        continue
      }
    }
    
    if (allStories.length === 0) {
      console.log('[TLDR.tech] No stories extracted from digests')
      return []
    }
    
    // Convert to ParsedItem format
    const items: ParsedItem[] = allStories.map(story => {
      // Create external ID from URL
      const urlHash = crypto.createHash('md5').update(story.url).digest('hex').substring(0, 8)
      const externalId = `tldr-${urlHash}`
      
      // Build content
      const content = [
        `# ${story.title}`,
        '',
        `**Category:** ${story.category}`,
        story.readTime ? `**Read Time:** ${story.readTime}` : '',
        '',
        story.summary,
        '',
        `**Source:** [${story.title}](${story.url})`
      ].filter(Boolean).join('\n')
      
      // Generate tags based on category and content
      const tags = [
        'tldr',
        'tech-newsletter',
        'industry-news',
        story.category.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, ''),
        ...(story.readTime ? ['quick-read'] : []),
        // Add tags based on content keywords
        ...(story.title.toLowerCase().includes('ai') || story.summary.toLowerCase().includes('ai') ? ['artificial-intelligence'] : []),
        ...(story.title.toLowerCase().includes('startup') || story.summary.toLowerCase().includes('startup') ? ['startup'] : []),
        ...(story.title.toLowerCase().includes('robot') || story.summary.toLowerCase().includes('robot') ? ['robotics'] : []),
      ].filter(Boolean)
      
      return {
        title: story.title,
        url: story.url,
        content,
        publishedAt: story.publishedAt,
        summary: story.summary || story.title,
        author: undefined, // TLDR.tech aggregates content from multiple sources
        image_url: '/lib/images/tldr-logo-jpg.jpg', // TLDR.tech logo fallback
        story_category: 'news',
        tags: [...new Set(tags)], // Remove duplicates
        externalId,
        originalMetadata: {
          source_name: 'TLDR.tech',
          content_type: 'newsletter_story',
          category: story.category,
          read_time: story.readTime,
          digest_date: story.publishedAt.toISOString().split('T')[0],
          platform: 'tldr_tech'
        }
      }
    })
    
    // Sort by publish date (newest first)
    items.sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime())
    
    console.log(`[TLDR.tech] Successfully processed ${items.length} individual stories`)
    return items
    
  } catch (error) {
    console.error('[TLDR.tech] Error in optimized fetch:', error)
    throw error
  }
}

// Export config for registration in database
export { TLDR_TECH_CONFIG } 