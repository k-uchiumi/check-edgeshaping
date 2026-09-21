/**
 * このファイルは自動生成です。手で編集しないこと。
 * 生成元: /Users/kenichi/Desktop/Claude/クラウドフレア版/ai-bot-tracker/ai-bots-dictionary.js
 * 生成コマンド: node scripts/build-dictionary.mjs
 * 生成日時: 2026-09-21T11:39:37.074Z
 */

export type BotCategory = 'learning' | 'crawl' | 'search_rag' | 'user_trigger' | 'ads';

export interface BotDictEntry {
  /** UA文字列。プローブ送信時にHTTPヘッダーへそのまま設定する（1バイトも変えない）。 */
  ua: string;
  /** ボット名（表示用・内部用） */
  name: string;
  /** 用途分類。表示順の制御にのみ使用し、画面には出さない（指示書§4.4）。 */
  category: BotCategory;
}

export const BOT_DICTIONARY: BotDictEntry[] = [
  {
    "ua": "GPTBot",
    "name": "OpenAI GPTBot",
    "category": "learning"
  },
  {
    "ua": "OAI-SearchBot",
    "name": "OpenAI SearchBot",
    "category": "search_rag"
  },
  {
    "ua": "OAI-AdsBot",
    "name": "OpenAI Ads Bot",
    "category": "ads"
  },
  {
    "ua": "ChatGPT-User",
    "name": "OpenAI ChatGPT User",
    "category": "user_trigger"
  },
  {
    "ua": "ClaudeBot",
    "name": "Anthropic ClaudeBot",
    "category": "learning"
  },
  {
    "ua": "Claude-User",
    "name": "Anthropic Claude User",
    "category": "user_trigger"
  },
  {
    "ua": "Claude-SearchBot",
    "name": "Anthropic Claude SearchBot",
    "category": "search_rag"
  },
  {
    "ua": "Googlebot",
    "name": "Google検索Bot",
    "category": "crawl"
  },
  {
    "ua": "GoogleOther",
    "name": "Google Other Bots",
    "category": "crawl"
  },
  {
    "ua": "Google-GeminiNotebook",
    "name": "Google Gemini Notebook",
    "category": "user_trigger"
  },
  {
    "ua": "Google-Agent",
    "name": "Google Agent (Project Mariner等)",
    "category": "user_trigger"
  },
  {
    "ua": "Google-CloudVertexBot",
    "name": "Google Vertex AI Bot",
    "category": "learning"
  },
  {
    "ua": "bingbot",
    "name": "Microsoft Bing Bot",
    "category": "crawl"
  },
  {
    "ua": "meta-externalagent",
    "name": "Meta AI External Agent",
    "category": "learning"
  },
  {
    "ua": "meta-externalfetcher",
    "name": "Meta AI Fetcher",
    "category": "user_trigger"
  },
  {
    "ua": "meta-webindexer",
    "name": "Meta AI Web Indexer",
    "category": "search_rag"
  },
  {
    "ua": "Meta-ExternalAds",
    "name": "Meta Ads Crawler",
    "category": "ads"
  },
  {
    "ua": "facebookexternalhit",
    "name": "Meta FacebookExternalHit",
    "category": "crawl"
  },
  {
    "ua": "PerplexityBot",
    "name": "Perplexity AI Bot",
    "category": "search_rag"
  },
  {
    "ua": "Perplexity-User",
    "name": "Perplexity User Bot",
    "category": "user_trigger"
  },
  {
    "ua": "Applebot",
    "name": "Apple Bot",
    "category": "crawl"
  },
  {
    "ua": "Amazonbot",
    "name": "Amazon Bot",
    "category": "learning"
  },
  {
    "ua": "Amzn-SearchBot",
    "name": "Amazon Search Bot",
    "category": "search_rag"
  },
  {
    "ua": "Amzn-User",
    "name": "Amazon User Bot",
    "category": "user_trigger"
  },
  {
    "ua": "Bytespider",
    "name": "ByteDance/TikTok AI",
    "category": "learning"
  },
  {
    "ua": "CCBot",
    "name": "Common Crawl",
    "category": "learning"
  },
  {
    "ua": "AI2Bot",
    "name": "Allen Institute AI",
    "category": "learning"
  },
  {
    "ua": "DuckAssistBot",
    "name": "DuckAssist Bot",
    "category": "search_rag"
  },
  {
    "ua": "FirecrawlAgent",
    "name": "Firecrawl Agent",
    "category": "user_trigger"
  },
  {
    "ua": "Diffbot",
    "name": "Diffbot",
    "category": "crawl"
  },
  {
    "ua": "MistralAI-Index",
    "name": "Mistral AI Index Bot",
    "category": "search_rag"
  },
  {
    "ua": "MistralAI-Training",
    "name": "Mistral AI Training Bot",
    "category": "learning"
  },
  {
    "ua": "MistralAI-User",
    "name": "Mistral AI Le Chat / Vibe User",
    "category": "user_trigger"
  },
  {
    "ua": "ExaBot",
    "name": "Exa AI Search",
    "category": "search_rag"
  },
  {
    "ua": "GensparkBot",
    "name": "Genspark AI",
    "category": "search_rag"
  },
  {
    "ua": "IbouBot",
    "name": "Ibou AI Search",
    "category": "search_rag"
  },
  {
    "ua": "TerraCotta",
    "name": "Ceramic TerraCotta",
    "category": "learning"
  },
  {
    "ua": "DeepseekBot",
    "name": "DeepSeek AI Bot",
    "category": "learning"
  },
  {
    "ua": "FacebookBot",
    "name": "Meta FacebookBot",
    "category": "crawl"
  },
  {
    "ua": "BraveBot",
    "name": "Brave Search Bot",
    "category": "search_rag"
  },
  {
    "ua": "Baiduspider",
    "name": "Baidu Spider",
    "category": "crawl"
  },
  {
    "ua": "Gemini-Deep-Research",
    "name": "Google Gemini Deep Research",
    "category": "search_rag"
  },
  {
    "ua": "KimiBot",
    "name": "Kimi AI Bot",
    "category": "search_rag"
  },
  {
    "ua": "YouBot",
    "name": "You.com AI Search",
    "category": "search_rag"
  },
  {
    "ua": "Verity",
    "name": "You.com Verity",
    "category": "search_rag"
  },
  {
    "ua": "FeloBot",
    "name": "Felo AI Search",
    "category": "search_rag"
  },
  {
    "ua": "iaskbot",
    "name": "iask.ai Bot",
    "category": "search_rag"
  },
  {
    "ua": "ThinkAnyBot",
    "name": "ThinkAny AI Search",
    "category": "search_rag"
  },
  {
    "ua": "LinerBot",
    "name": "Liner AI",
    "category": "search_rag"
  },
  {
    "ua": "NvidiaBot",
    "name": "NVIDIA AI Bot",
    "category": "learning"
  },
  {
    "ua": "PetalBot",
    "name": "Huawei Petal Bot",
    "category": "search_rag"
  },
  {
    "ua": "PanguBot",
    "name": "Pangu Bot",
    "category": "learning"
  },
  {
    "ua": "cohere-ai",
    "name": "Cohere AI",
    "category": "learning"
  },
  {
    "ua": "Cohere-Command",
    "name": "Cohere Command",
    "category": "search_rag"
  },
  {
    "ua": "HuggingFace-Bot",
    "name": "HuggingFace Bot",
    "category": "learning"
  },
  {
    "ua": "UpstageBot",
    "name": "Upstage Solar AI",
    "category": "learning"
  },
  {
    "ua": "TavilyBot",
    "name": "Tavily AI",
    "category": "search_rag"
  },
  {
    "ua": "Devin",
    "name": "Devin AI Code Assistant",
    "category": "user_trigger"
  },
  {
    "ua": "Search1_bot",
    "name": "Search1 Bot",
    "category": "search_rag"
  },
  {
    "ua": "Mojo-Bot",
    "name": "Mojo Bot",
    "category": "learning"
  },
  {
    "ua": "Cotoyogi",
    "name": "Cotoyogi",
    "category": "search_rag"
  },
  {
    "ua": "Character-AI",
    "name": "Character.AI",
    "category": "user_trigger"
  },
  {
    "ua": "Groq-Bot",
    "name": "Groq AI",
    "category": "search_rag"
  },
  {
    "ua": "OmostBot",
    "name": "Omost Image Gen AI",
    "category": "learning"
  },
  {
    "ua": "StormCrawler",
    "name": "StormCrawler",
    "category": "crawl"
  },
  {
    "ua": "Webzio-Extended",
    "name": "Webz.io",
    "category": "crawl"
  },
  {
    "ua": "xAI-Bot",
    "name": "xAI Bot (Grok)",
    "category": "learning"
  },
  {
    "ua": "GrokBot",
    "name": "Grok Bot",
    "category": "search_rag"
  }
];
