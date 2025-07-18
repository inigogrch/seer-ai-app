-- Migration: Seed sources table with individual feeds per adapter spec

-- Insert individual feeds (one row per feed, multiple feeds per adapter)
INSERT INTO sources (name, slug, type, endpoint_url, adapter_name, fetch_freq_min, priority, is_active) VALUES

-- ArXiv feeds (adapter: arxiv)
('ArXiv Computer Science', 'arxiv_cs', 'rss', 'https://rss.arxiv.org/rss/cs', 'arxiv', 120, 90, true),
('ArXiv Statistics', 'arxiv_stat', 'rss', 'https://rss.arxiv.org/rss/stat', 'arxiv', 120, 85, true),

-- AWS Blog feeds (adapter: aws)
('AWS Big Data Blog', 'aws_big_data', 'rss', 'https://aws.amazon.com/blogs/big-data/feed/', 'aws', 180, 80, true),
('AWS Machine Learning Blog', 'aws_ml', 'rss', 'https://aws.amazon.com/blogs/machine-learning/feed/', 'aws', 180, 85, true),
('AWS Startups Blog', 'aws_startups', 'rss', 'https://aws.amazon.com/blogs/startups/feed/', 'aws', 240, 70, true),
('AWS Developer Blog', 'aws_developer', 'rss', 'https://aws.amazon.com/blogs/developer/feed/', 'aws', 240, 75, true),
('AWS Database Blog', 'aws_database', 'rss', 'https://aws.amazon.com/blogs/database/feed/', 'aws', 240, 75, true),

-- Google Research (adapter: google-research)
('Google Research Blog', 'google_research', 'web_scrape', 'https://research.google/blog/', 'google-research', 360, 85, true),

-- HuggingFace (adapter: huggingface)
('HuggingFace Papers', 'huggingface_papers', 'web_scrape', 'https://huggingface.co/papers', 'huggingface', 180, 85, true),

-- Anthropic (adapter: anthropic)
('Anthropic News', 'anthropic_news', 'web_scrape', 'https://www.anthropic.com/news', 'anthropic', 240, 90, true),

-- Microsoft feeds (adapter: microsoft)
('Microsoft 365 Insider Blog', 'microsoft365_insider', 'rss', 'https://techcommunity.microsoft.com/t5/s/gxcuf89792/rss/board?board.id=Microsoft365InsiderBlog', 'microsoft', 240, 75, true),
('Excel Blog', 'excel_blog', 'rss', 'https://techcommunity.microsoft.com/t5/s/gxcuf89792/rss/board?board.id=ExcelBlog', 'microsoft', 360, 70, true),

-- MIT News feeds (adapter: mit-research)
('MIT Research News', 'mit_research', 'rss', 'https://news.mit.edu/rss/research', 'mit-research', 240, 80, true),
('MIT Data News', 'mit_data', 'rss', 'https://news.mit.edu/topic/mitdata-rss.xml', 'mit-research', 240, 80, true),
('MIT AI News', 'mit_ai', 'rss', 'https://news.mit.edu/topic/mitartificial-intelligence2-rss.xml', 'mit-research', 240, 85, true),

-- MIT Sloan (adapter: mit-sloan)
('MIT Sloan Management Review', 'mit_sloan', 'rss', 'https://sloanreview.mit.edu/feed/', 'mit-sloan', 360, 75, true),

-- OpenAI (adapter: openai)
('OpenAI News', 'openai_news', 'rss', 'https://openai.com/news/rss.xml', 'openai', 180, 95, true),

-- TechCrunch (adapter: techCrunch)
('TechCrunch', 'techcrunch', 'rss', 'https://techcrunch.com/feed/', 'techCrunch', 60, 100, true),

-- TLDR (adapter: tldr)
('TLDR Tech Newsletter', 'tldr_tech', 'rss', 'https://tldr.tech/api/rss/tech', 'tldr', 1440, 70, true),

-- VentureBeat (adapter: ventureBeat)
('VentureBeat', 'venturebeat', 'rss', 'https://venturebeat.com/feed/', 'ventureBeat', 90, 75, true)

ON CONFLICT (name) DO UPDATE SET
    slug = EXCLUDED.slug,
    adapter_name = EXCLUDED.adapter_name,
    endpoint_url = EXCLUDED.endpoint_url,
    priority = EXCLUDED.priority,
    updated_at = NOW(); 