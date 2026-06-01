import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import test from 'node:test';

import { ConfigLoader, getConfigLoader } from '../src/config/loader.js';
import { ProviderManagerImpl } from '../src/shared/provider/manager.js';

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
        apiType: 'openai-completions',
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
        apiType: 'openai-completions',
      },
    });
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test('ProviderManager initializes from the loaded config file', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'uniins-config-'));
  const configPath = path.join(tempDir, 'config.json');
  const manager = new ProviderManagerImpl();

  try {
    await fs.writeFile(
      configPath,
      `${JSON.stringify(
        {
          providers: {
            agent: {
              category: 'agent',
              type: 'codeany',
              config: {
                apiKey: 'persisted-api-key',
                baseUrl: 'https://api.deepseek.com',
                model: 'deepseek-v4-flash',
                apiType: 'openai-completions',
              },
            },
          },
        },
        null,
        2
      )}\n`,
      'utf8'
    );

    await getConfigLoader().loadFromFile(configPath);
    await manager.initialize();

    assert.deepEqual(manager.getConfig().agent, {
      category: 'agent',
      type: 'codeany',
      config: {
        apiKey: 'persisted-api-key',
        baseUrl: 'https://api.deepseek.com',
        model: 'deepseek-v4-flash',
        apiType: 'openai-completions',
      },
    });
  } finally {
    await manager.shutdown();
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});
