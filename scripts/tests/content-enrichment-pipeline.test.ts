/**
 * Content Enrichment Pipeline Integration Tests
 * 
 * Demonstrates fetchURLContent + extractMainContent working together
 * to produce clean, full article text from realistic HTML samples
 */

import { extractMainContentExecute } from '../ingestion/tools/ingestion-helpers';

describe('Content Enrichment Pipeline', () => {

  describe('VentureBeat-style Article Processing', () => {
    it('should extract clean full text from VentureBeat-style HTML', async () => {
      // Realistic VentureBeat HTML structure (simplified but representative)
      const ventureBeatHtml = `
        <!DOCTYPE html>
        <html>
          <head>
            <title>OpenAI Launches Sora AI Video Generator | VentureBeat</title>
            <meta name="description" content="OpenAI has unveiled Sora, its new text-to-video AI model">
          </head>
          <body>
            <header class="site-header">
              <nav>
                <a href="/ai">AI</a>
                <a href="/tech">Tech</a>
                <a href="/subscribe">Subscribe</a>
              </nav>
            </header>
            
            <main class="content">
              <article class="post-content">
                <header class="article-header">
                  <h1>OpenAI Launches Sora AI Video Generator</h1>
                  <div class="byline">
                    <span class="author">By Kyle Wiggers</span>
                    <time datetime="2024-02-15">February 15, 2024</time>
                  </div>
                </header>
                
                <div class="article-body">
                  <p class="lead">OpenAI today announced Sora, a new generative AI model that can create realistic videos from text descriptions. The model represents a significant leap forward in AI-generated content capabilities.</p>
                  
                  <p>Sora can generate videos up to a minute long while maintaining visual quality and adherence to the user's prompt. The model understands not only what the user has asked for in the prompt, but also how those things exist in the physical world.</p>
                  
                  <h2>Technical Capabilities</h2>
                  <p>The model has a deep understanding of language, enabling it to accurately interpret prompts and generate compelling characters that express vibrant emotions. Sora can also create multiple shots within a single generated video that accurately persist characters and visual style.</p>
                  
                  <blockquote>
                    <p>"Sora is able to generate complex scenes with multiple characters, specific types of motion, and accurate details of the subject and background," OpenAI explained in a blog post.</p>
                  </blockquote>
                  
                  <h2>Current Limitations</h2>
                  <p>The current model has weaknesses. It may struggle with accurately simulating the physics of a complex scene, and may not understand specific instances of cause and effect. For example, a person might take a bite out of a cookie, but afterward, the cookie may not have a bite mark.</p>
                  
                  <p>OpenAI is taking several important safety steps ahead of making Sora available in OpenAI's products. The company is working with red teamers — domain experts in areas like misinformation, hateful content, and bias — who will be adversarially testing the model.</p>
                </div>
              </article>
            </main>
            
            <aside class="sidebar">
              <div class="newsletter-signup">
                <h3>Subscribe to VentureBeat</h3>
                <p>Get the latest AI news delivered to your inbox</p>
                <button>Subscribe Now</button>
              </div>
              <div class="related-articles">
                <h3>Related Articles</h3>
                <ul>
                  <li><a href="/ai/google-ai">Google's Latest AI Update</a></li>
                  <li><a href="/ai/microsoft">Microsoft AI Advances</a></li>
                </ul>
              </div>
            </aside>
            
            <footer class="site-footer">
              <p>&copy; 2024 VentureBeat. All rights reserved.</p>
              <nav>
                <a href="/privacy">Privacy Policy</a>
                <a href="/terms">Terms of Service</a>
              </nav>
            </footer>
          </body>
        </html>
      `;

      // Test content extraction
      const result = await extractMainContentExecute({ 
        html: ventureBeatHtml, 
        url: 'https://venturebeat.com/ai/openai-launches-sora-ai-video-generator/' 
      });

      expect(result.success).toBe(true);
      expect(result.content).toBeDefined();
      expect(result.content.length).toBeGreaterThan(500);

      // Validate core content is extracted
      expect(result.content).toContain('OpenAI today announced Sora');
      expect(result.content).toContain('Technical Capabilities');
      expect(result.content).toContain('Current Limitations');
      expect(result.content).toContain('complex scenes with multiple characters');

      // Validate title extraction
      expect(result.title).toBeDefined();
      expect(result.title).toContain('Sora AI Video Generator');

      // Should NOT contain navigation/boilerplate
      expect(result.content).not.toContain('Subscribe to VentureBeat');
      expect(result.content).not.toContain('Related Articles');
      expect(result.content).not.toContain('Privacy Policy');
      expect(result.content).not.toContain('All rights reserved');

      console.log(`✅ VentureBeat extraction: ${result.content.length} characters`);
      console.log(`📰 Title: "${result.title}"`);
      console.log(`👤 Byline: "${result.byline || 'Not detected'}"`);
      
      // Show clean content structure
      const lines = result.content.split('\n').filter(line => line.trim());
      expect(lines.length).toBeGreaterThan(5); // Should have multiple paragraphs
      
      console.log(`📄 Content preview (first 300 chars):\n${result.content.substring(0, 300)}...`);
    });
  });

  describe('OpenAI Blog-style Article Processing', () => {
    it('should extract clean full text from OpenAI blog-style HTML', async () => {
      // Realistic OpenAI blog HTML structure
      const openAIHtml = `
        <!DOCTYPE html>
        <html>
          <head>
            <title>Introducing GPT-4o mini</title>
            <meta name="description" content="GPT-4o mini is our most cost-efficient small model">
          </head>
          <body>
            <header class="site-header">
              <nav class="main-nav">
                <a href="/api">API</a>
                <a href="/chatgpt">ChatGPT</a>
                <a href="/dall-e">DALL·E</a>
                <a href="/sora">Sora</a>
              </nav>
            </header>
            
            <main class="page-content">
              <article class="blog-post">
                <header class="post-header">
                  <h1>Introducing GPT-4o mini</h1>
                  <div class="meta">
                    <time datetime="2024-07-18">July 18, 2024</time>
                  </div>
                </header>
                
                <div class="post-content">
                  <p>GPT-4o mini is our most cost-efficient small model. It is multimodal (accepting both text and image inputs), has higher intelligence than GPT-3.5 Turbo, and has the same high-speed performance.</p>
                  
                  <p>GPT-4o mini achieves an 82% score on MMLU and presently ranks higher than GPT-4 on chat preferences common benchmarks. As a small model, it is significantly more cost-efficient than other recent frontier models, and more than 60% cheaper than GPT-3.5 Turbo.</p>
                  
                  <h2>Performance</h2>
                  <p>GPT-4o mini outperforms GPT-3.5 Turbo and other small models on academic benchmarks across both textual intelligence and multimodal reasoning, and supports the same range of languages as GPT-4o.</p>
                  
                  <div class="benchmark-table">
                    <h3>Benchmark Results</h3>
                    <table>
                      <tr><th>Model</th><th>MMLU</th><th>HumanEval</th></tr>
                      <tr><td>GPT-4o mini</td><td>82.0%</td><td>87.2%</td></tr>
                      <tr><td>GPT-3.5 Turbo</td><td>70.0%</td><td>48.1%</td></tr>
                    </table>
                  </div>
                  
                  <h2>Safety</h2>
                  <p>GPT-4o mini has been evaluated according to our Preparedness Framework and is trained to be helpful, harmless, and honest. We use the same safety mitigations for GPT-4o mini as we do for GPT-4o, including filtering training data and using reinforcement learning from human feedback.</p>
                  
                  <h2>Availability</h2>
                  <p>GPT-4o mini is available in the API for developers building applications. It supports both text and vision capabilities with a 128K context window and knowledge cutoff of October 2023.</p>
                  
                  <blockquote class="highlight">
                    <p>We're excited to see what developers build with this new model that balances capability and cost.</p>
                  </blockquote>
                </div>
              </article>
            </main>
            
            <aside class="sidebar">
              <div class="cta-box">
                <h3>Get started with OpenAI API</h3>
                <a href="/signup" class="btn">Sign up</a>
              </div>
            </aside>
            
            <footer>
              <div class="footer-links">
                <a href="/terms">Terms & policies</a>
                <a href="/privacy">Privacy policy</a>
              </div>
            </footer>
          </body>
        </html>
      `;

      const result = await extractMainContentExecute({ 
        html: openAIHtml, 
        url: 'https://openai.com/blog/introducing-gpt-4o-mini' 
      });

      expect(result.success).toBe(true);
      expect(result.content).toBeDefined();
      expect(result.content.length).toBeGreaterThan(400);

      // Validate OpenAI-specific content
      expect(result.content).toContain('GPT-4o mini');
      expect(result.content).toContain('cost-efficient small model');
      expect(result.content).toContain('Performance');
      expect(result.content).toContain('Safety');
      expect(result.content).toContain('Availability');

      // Should preserve structured content
      expect(result.content).toContain('82% score on MMLU');
      expect(result.content).toContain('Benchmark Results');

      // Should exclude OpenAI site navigation and CTAs
      expect(result.content).not.toContain('ChatGPT');
      expect(result.content).not.toContain('Sign up');
      expect(result.content).not.toContain('Terms & policies');

      console.log(`✅ OpenAI extraction: ${result.content.length} characters`);
      console.log(`📰 Title: "${result.title}"`);
      
      // Validate markdown conversion quality
      expect(result.content).toMatch(/^#|##/m); // Should have markdown headers
      
      console.log(`📄 Content preview (first 400 chars):\n${result.content.substring(0, 400)}...`);
    });
  });

  describe('Complete Enrichment Workflow Simulation', () => {
    it('should demonstrate end-to-end adapter → enrichment → embedding pipeline', async () => {
      console.log('\n🔄 Simulating complete content enrichment workflow\n');
      
      // Step 1: Simulate what an adapter provides (metadata-only item)
      const sparseAdapterItem = {
        external_id: 'openai-gpt4o-mini',
        title: 'Introducing GPT-4o mini',
        url: 'https://openai.com/blog/introducing-gpt-4o-mini',
        author: 'OpenAI Team',
        published_at: '2024-07-18T10:00:00Z',
        content: '', // ❌ No content from adapter
        source_slug: 'openai-news'
      };

      console.log(`📥 Adapter provided: "${sparseAdapterItem.title}"`);
      console.log(`📏 Adapter content: ${sparseAdapterItem.content.length} chars (empty!)`);

      // Step 2: Check if enrichment needed (our new logic)
      const needsEnrichment = !sparseAdapterItem.content || sparseAdapterItem.content.length < 200;
      console.log(`🔍 Needs enrichment: ${needsEnrichment}`);

      expect(needsEnrichment).toBe(true);

      // Step 3: Simulate HTML fetching (would be fetchURLContentExecute in real workflow)
      const mockFetchedHtml = `
        <html>
          <head><title>Introducing GPT-4o mini</title></head>
          <body>
            <nav><a href="/api">API</a></nav>
            <article>
              <h1>Introducing GPT-4o mini</h1>
              <p>GPT-4o mini is our most cost-efficient small model. It is multimodal, accepting both text and image inputs.</p>
              <p>The model achieves an 82% score on MMLU and presently ranks higher than GPT-4 on chat preferences common benchmarks.</p>
              <h2>Key Features</h2>
              <ul>
                <li>Higher intelligence than GPT-3.5 Turbo</li>
                <li>60% cheaper than GPT-3.5 Turbo</li>
                <li>Support for text and vision capabilities</li>
                <li>128K context window</li>
              </ul>
              <p>We're excited to see what developers build with this new model that balances capability and cost.</p>
            </article>
            <footer>Copyright OpenAI</footer>
          </body>
        </html>
      `;

      console.log(`🌐 Simulated fetch: ${mockFetchedHtml.length} chars of HTML`);

      // Step 4: Extract clean content
      const extractResult = await extractMainContentExecute({ 
        html: mockFetchedHtml, 
        url: sparseAdapterItem.url 
      });

      expect(extractResult.success).toBe(true);
      expect(extractResult.content.length).toBeGreaterThan(200);

      console.log(`🧹 Extracted clean content: ${extractResult.content.length} chars`);

      // Step 5: Create enriched item
      const enrichedItem = {
        ...sparseAdapterItem,
        content: extractResult.content,
        title: extractResult.title || sparseAdapterItem.title
      };

      // Step 6: Prepare for embedding
      const embeddingText = `${enrichedItem.title}\n\n${enrichedItem.content}`;

      // Validate enrichment results
      expect(enrichedItem.content.length).toBeGreaterThan(200);
      expect(enrichedItem.content).toContain('cost-efficient small model');
      expect(enrichedItem.content).toContain('Key Features');
      expect(enrichedItem.content).not.toContain('Copyright OpenAI'); // Excluded footer

      console.log(`\n📈 ENRICHMENT RESULTS:`);
      console.log(`📏 Content: ${sparseAdapterItem.content.length} → ${enrichedItem.content.length} chars`);
      console.log(`📰 Title: "${enrichedItem.title}"`);
      console.log(`🔤 Embedding text: ${embeddingText.length} total chars`);
      console.log(`✨ Ready for embedding generation and storage!`);

      // Show content quality metrics
      const wordCount = enrichedItem.content.split(/\s+/).length;
      const sentences = enrichedItem.content.split(/[.!?]+/).length;
      console.log(`📊 Content metrics: ${wordCount} words, ~${sentences} sentences`);

      console.log(`\n📄 Final clean content:\n${enrichedItem.content}\n`);

      // This enriched item would now go to:
      // 1. createEmbeddingExecute({ texts: [embeddingText] })
      // 2. upsertSupabaseExecute({ story: enrichedItem })
    });
  });

  describe('Content Quality Validation', () => {
    it('should produce clean markdown-formatted content', async () => {
      const complexHtml = `
        <html>
          <body>
            <div class="ads">Advertisement</div>
            <article>
              <h1>AI Research Breakthrough</h1>
              <p><strong>Important:</strong> This is a significant development in <em>artificial intelligence</em>.</p>
              
              <h2>Technical Details</h2>
              <p>The research team at <a href="https://example.com">Example University</a> has developed:</p>
              <ul>
                <li>Novel attention mechanisms</li>
                <li>Improved training techniques</li>
                <li>Better evaluation metrics</li>
              </ul>
              
              <blockquote>
                "This represents a major step forward," said Dr. Smith, lead researcher.
              </blockquote>
              
              <h3>Code Example</h3>
              <pre><code>
def attention_mechanism(query, key, value):
    scores = torch.matmul(query, key.transpose(-2, -1))
    return torch.softmax(scores, dim=-1)
              </code></pre>
              
              <p>The implications for future AI development are substantial.</p>
            </article>
            <div class="social-share">Share this article</div>
          </body>
        </html>
      `;

      const result = await extractMainContentExecute({ 
        html: complexHtml, 
        url: 'https://example.com/ai-breakthrough' 
      });

      expect(result.success).toBe(true);
      
      // Should preserve structure as markdown
      expect(result.content).toContain('# AI Research Breakthrough');
      expect(result.content).toContain('## Technical Details');
      expect(result.content).toContain('### Code Example');
      
      // Should preserve formatting
      expect(result.content).toContain('**Important:**');
      expect(result.content).toContain('_artificial intelligence_');
      
      // Should preserve lists (Turndown uses * for bullet lists)
      expect(result.content).toContain('*   Novel attention mechanisms');
      expect(result.content).toContain('*   Improved training techniques');
      
      // Should preserve code blocks
      expect(result.content).toContain('```');
      expect(result.content).toContain('def attention_mechanism');
      
      // Should preserve quotes
      expect(result.content).toContain('> "This represents a major step forward," said Dr. Smith, lead researcher.');
      
      // Should exclude ads and social elements
      expect(result.content).not.toContain('Advertisement');
      expect(result.content).not.toContain('Share this article');

      console.log(`✅ Markdown quality validated: ${result.content.length} chars`);
      console.log(`\n📄 Formatted content:\n${result.content}`);
    });
  });
}); 