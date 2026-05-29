import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import test from 'node:test';

async function withTempHome<T>(fn: (homeDir: string) => Promise<T>) {
  const originalHome = process.env.HOME;
  const originalUserProfile = process.env.USERPROFILE;
  const homeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'uniins-mcp-'));

  process.env.HOME = homeDir;
  process.env.USERPROFILE = homeDir;

  try {
    return await fn(homeDir);
  } finally {
    if (originalHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = originalHome;
    }

    if (originalUserProfile === undefined) {
      delete process.env.USERPROFILE;
    } else {
      process.env.USERPROFILE = originalUserProfile;
    }

    await fs.rm(homeDir, { recursive: true, force: true });
  }
}

test('loadMcpServers merges enabled app, user, and custom config sources', async () => {
  await withTempHome(async (homeDir) => {
    const { loadMcpServers } = await import('../src/shared/mcp/loader.js');
    const appConfigPath = path.join(homeDir, '.uniins-claw', 'mcp.json');
    const userConfigPath = path.join(homeDir, '.claude', 'settings.json');
    const customConfigPath = path.join(homeDir, 'custom-mcp.json');

    await fs.mkdir(path.dirname(appConfigPath), { recursive: true });
    await fs.mkdir(path.dirname(userConfigPath), { recursive: true });

    await fs.writeFile(
      appConfigPath,
      JSON.stringify({
        mcpServers: {
          appServer: {
            command: 'node',
            args: ['app.js'],
            env: { APP_TOKEN: 'app-token' },
          },
        },
      })
    );
    await fs.writeFile(
      userConfigPath,
      JSON.stringify({
        mcpServers: {
          userServer: {
            command: 'node',
            args: ['user.js'],
          },
        },
      })
    );
    await fs.writeFile(
      customConfigPath,
      JSON.stringify({
        mcpServers: {
          customServer: {
            type: 'sse',
            url: 'https://example.test/sse',
          },
        },
      })
    );

    const servers = await loadMcpServers({
      enabled: true,
      userDirEnabled: true,
      appDirEnabled: true,
      mcpConfigPath: customConfigPath,
    });

    assert.deepEqual(Object.keys(servers).sort(), [
      'appServer',
      'customServer',
      'userServer',
    ]);
    assert.deepEqual(servers.appServer, {
      type: 'stdio',
      command: 'node',
      args: ['app.js'],
      env: { APP_TOKEN: 'app-token' },
    });
    assert.deepEqual(servers.customServer, {
      type: 'sse',
      url: 'https://example.test/sse',
      headers: undefined,
    });
  });
});

test('loadMcpServers respects directory toggles and includeServers whitelist', async () => {
  await withTempHome(async (homeDir) => {
    const { loadMcpServers } = await import('../src/shared/mcp/loader.js');
    const appConfigPath = path.join(homeDir, '.uniins-claw', 'mcp.json');
    const userConfigPath = path.join(homeDir, '.claude', 'settings.json');

    await fs.mkdir(path.dirname(appConfigPath), { recursive: true });
    await fs.mkdir(path.dirname(userConfigPath), { recursive: true });
    await fs.writeFile(
      appConfigPath,
      JSON.stringify({ mcpServers: { appServer: { command: 'node' } } })
    );
    await fs.writeFile(
      userConfigPath,
      JSON.stringify({ mcpServers: { userServer: { command: 'node' } } })
    );

    const servers = await loadMcpServers({
      enabled: true,
      userDirEnabled: true,
      appDirEnabled: false,
      includeServers: ['userServer'],
    });

    assert.deepEqual(Object.keys(servers), ['userServer']);
  });
});

test('loadMcpServers returns no servers when explicitly disabled', async () => {
  await withTempHome(async (homeDir) => {
    const { loadMcpServers } = await import('../src/shared/mcp/loader.js');
    const appConfigPath = path.join(homeDir, '.uniins-claw', 'mcp.json');

    await fs.mkdir(path.dirname(appConfigPath), { recursive: true });
    await fs.writeFile(
      appConfigPath,
      JSON.stringify({ mcpServers: { appServer: { command: 'node' } } })
    );

    const servers = await loadMcpServers({
      enabled: false,
      userDirEnabled: false,
      appDirEnabled: false,
    });

    assert.deepEqual(servers, {});
  });
});

test('mcp all-configs endpoint includes custom path and respects source toggles', async () => {
  await withTempHome(async (homeDir) => {
    const { mcpRoutes } = await import('../src/app/api/mcp.js');
    const appConfigPath = path.join(homeDir, '.uniins-claw', 'mcp.json');
    const userConfigPath = path.join(homeDir, '.claude', 'settings.json');
    const customConfigPath = path.join(homeDir, 'custom-mcp.json');

    await fs.mkdir(path.dirname(appConfigPath), { recursive: true });
    await fs.mkdir(path.dirname(userConfigPath), { recursive: true });
    await fs.writeFile(
      appConfigPath,
      JSON.stringify({ mcpServers: { appServer: { command: 'node' } } })
    );
    await fs.writeFile(
      userConfigPath,
      JSON.stringify({ mcpServers: { userServer: { command: 'node' } } })
    );
    await fs.writeFile(
      customConfigPath,
      JSON.stringify({ mcpServers: { customServer: { command: 'node' } } })
    );

    const response = await mcpRoutes.request(
      `/all-configs?appDirEnabled=false&userDirEnabled=false&mcpConfigPath=${encodeURIComponent(
        customConfigPath
      )}`
    );
    const body = await response.json();

    assert.equal(body.success, true);
    assert.deepEqual(
      body.configs.map(
        (config: { name: string; servers: Record<string, unknown> }) => ({
          name: config.name,
          serverNames: Object.keys(config.servers),
        })
      ),
      [{ name: 'custom', serverNames: ['customServer'] }]
    );
  });
});
