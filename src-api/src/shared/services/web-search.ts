export interface AgentSearchResult {
  title: string;
  url: string;
  snippet?: string;
}

interface SearchProvider {
  name: string;
  url: (query: string) => string;
  parse: (html: string) => AgentSearchResult[];
}

type FetchLike = typeof fetch;

function cleanHtml(value: string): string {
  return value
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function parseDuckDuckGo(html: string): AgentSearchResult[] {
  const links: AgentSearchResult[] = [];
  const resultRegex =
    /<a rel="nofollow" class="result__a" href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
  const snippetRegex =
    /<a class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi;

  let match: RegExpExecArray | null;
  while ((match = resultRegex.exec(html)) !== null) {
    const url = match[1];
    const title = cleanHtml(match[2]);
    if (url && title && !url.includes('duckduckgo.com')) {
      links.push({ title, url });
    }
  }

  const snippets: string[] = [];
  while ((match = snippetRegex.exec(html)) !== null) {
    snippets.push(cleanHtml(match[1]));
  }

  return links.map((link, index) => ({
    ...link,
    snippet: snippets[index],
  }));
}

function parseBing(html: string): AgentSearchResult[] {
  const results: AgentSearchResult[] = [];
  const itemRegex = /<li class="b_algo"[\s\S]*?<\/li>/gi;
  let itemMatch: RegExpExecArray | null;

  while ((itemMatch = itemRegex.exec(html)) !== null) {
    const item = itemMatch[0];
    const linkMatch = item.match(
      /<h2[^>]*>\s*<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i
    );
    if (!linkMatch) continue;

    const snippetMatch = item.match(/<p[^>]*>([\s\S]*?)<\/p>/i);
    const url = linkMatch[1];
    const title = cleanHtml(linkMatch[2]);
    if (!url || !title) continue;

    results.push({
      title,
      url,
      snippet: snippetMatch ? cleanHtml(snippetMatch[1]) : undefined,
    });
  }

  return results;
}

const SEARCH_PROVIDERS: SearchProvider[] = [
  {
    name: 'DuckDuckGo',
    url: (query) => `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`,
    parse: parseDuckDuckGo,
  },
  {
    name: 'Bing',
    url: (query) => `https://www.bing.com/search?q=${encodeURIComponent(query)}`,
    parse: parseBing,
  },
];

export async function searchWebForAgent(
  query: string,
  numResults = 5,
  fetchImpl: FetchLike = fetch
): Promise<string> {
  const errors: string[] = [];

  for (const provider of SEARCH_PROVIDERS) {
    try {
      const response = await fetchImpl(provider.url(query), {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; AgentSDK/1.0)',
        },
        signal: AbortSignal.timeout(15000),
      });

      if (!response.ok) {
        errors.push(`${provider.name}: HTTP ${response.status}`);
        continue;
      }

      const html = await response.text();
      const results = provider.parse(html).slice(0, Math.max(1, numResults));
      if (results.length === 0) {
        errors.push(`${provider.name}: no parseable results`);
        continue;
      }

      return results
        .map((result, index) => {
          const lines = [`${index + 1}. ${result.title}`, `   ${result.url}`];
          if (result.snippet) lines.push(`   ${result.snippet}`);
          return lines.join('\n');
        })
        .join('\n\n');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(`${provider.name}: ${message}`);
    }
  }

  return `Search error: all providers failed for "${query}". ${errors.join('; ')}`;
}
