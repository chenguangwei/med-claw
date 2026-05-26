import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import test from 'node:test';

import { ConfigLoader } from '../src/config/loader.js';

test('ConfigLoader persists synced provider settings to a config file', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'uniins-config-'));
  const configPath = path.join(tempDir, 'config.json');

  try {
    const writer = new ConfigLoader();
    writer.updateFromSettings({
      agentProvider: 'codeany',
      agentConfig: {
        apiKey: 'test-api-key',
        baseUrl: 'https://api.deepseek.com',
        model: 'deepseek-v4-flash',
      },
    });

    await writer.saveToFile(configPath);

    const reader = new ConfigLoader();
    await reader.loadFromFile(configPath);

    assert.deepEqual(reader.getProviders().agent, {
      category: 'agent',
      type: 'codeany',
      config: {
        apiKey: 'test-api-key',
        baseUrl: 'https://api.deepseek.com',
        model: 'deepseek-v4-flash',
      },
    });
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});
