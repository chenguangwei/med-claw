import assert from 'node:assert/strict';
import test from 'node:test';

import { searchWebForAgent } from '../src/shared/services/web-search.js';

test('searchWebForAgent falls back to Bing when DuckDuckGo fetch fails', async () => {
  const calls: string[] = [];
  const fetchImpl = async (url: string | URL | Request) => {
    const href = String(url);
    calls.push(href);

    if (href.includes('duckduckgo.com')) {
      throw new TypeError('fetch failed');
    }

    return new Response(
      [
        '<html><body>',
        '<li class="b_algo"><h2><a href="https://example.com/top">小红书热点</a></h2>',
        '<p>今日小红书热门内容摘要。</p></li>',
        '</body></html>',
      ].join(''),
      { status: 200 }
    );
  };

  const result = await searchWebForAgent('小红书热搜榜 今日热点', 5, fetchImpl as typeof fetch);

  assert.equal(calls.length, 2);
  assert.match(calls[0], /duckduckgo/);
  assert.match(calls[1], /bing/);
  assert.match(result, /小红书热点/);
  assert.match(result, /https:\/\/example.com\/top/);
  assert.doesNotMatch(result, /Search error/);
});
