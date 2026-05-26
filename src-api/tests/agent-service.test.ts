import assert from 'node:assert/strict';
import test from 'node:test';

import { getAgent } from '../src/shared/services/agent.js';
import {
  getProviderManager,
  initProviderManager,
  shutdownProviderManager,
} from '../src/shared/provider/manager.js';

test('getAgent uses synced provider manager config when request config is omitted', async () => {
  await initProviderManager();
  const manager = getProviderManager();

  try {
    await manager.switchAgentProvider('codeany', {
      apiKey: 'test-api-key',
      baseUrl: 'https://example.test/v1',
      model: 'test-model',
    });

    const agent = await getAgent();
    const config = (agent as unknown as { config: Record<string, unknown> })
      .config;

    assert.equal(config.apiKey, 'test-api-key');
    assert.equal(config.baseUrl, 'https://example.test/v1');
    assert.equal(config.model, 'test-model');
  } finally {
    await shutdownProviderManager();
  }
});
