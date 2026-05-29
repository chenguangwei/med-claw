import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { Hono } from 'hono';

import { getAllMcpConfigPaths } from '../../config/constants';

const mcp = new Hono();

// MCP config file path: ~/.uniins-claw/mcp.json
const getMcpConfigPath = (): string => {
  const homeDir = os.homedir();
  return path.join(homeDir, '.uniins-claw', 'mcp.json');
};

// Ensure directory exists
const ensureDir = async (filePath: string): Promise<void> => {
  const dir = path.dirname(filePath);
  try {
    await fs.mkdir(dir, { recursive: true });
  } catch {
    // Directory might already exist
  }
};

// MCP Server Config Types
interface MCPServerStdio {
  type?: 'stdio';
  command: string;
  args?: string[];
  env?: Record<string, string>;
  icon?: string;
}

interface MCPServerHttp {
  type?: 'http' | 'sse';
  url: string;
  headers?: Record<string, string>;
  icon?: string;
}

type MCPServerConfig = MCPServerStdio | MCPServerHttp;

interface MCPConfig {
  mcpServers: Record<string, MCPServerConfig>;
}

function expandHomePath(inputPath: string): string {
  if (inputPath === '~') return os.homedir();
  if (inputPath.startsWith('~/') || inputPath.startsWith('~\\')) {
    return path.join(os.homedir(), inputPath.slice(2));
  }
  return inputPath;
}

function normalizeComparablePath(inputPath: string): string {
  return path.resolve(expandHomePath(inputPath)).replace(/[\\/]+$/, '').toLowerCase();
}

// GET /mcp/config - Read MCP config
mcp.get('/config', async (c) => {
  const configPath = getMcpConfigPath();

  try {
    // Check if file exists
    try {
      await fs.access(configPath);
    } catch {
      // File doesn't exist, return empty config
      return c.json({
        success: true,
        data: { mcpServers: {} },
        path: configPath,
      });
    }

    // Read and parse config
    const content = await fs.readFile(configPath, 'utf-8');
    const config: MCPConfig = JSON.parse(content);

    return c.json({
      success: true,
      data: config,
      path: configPath,
    });
  } catch (err) {
    console.error('[MCP] Failed to read config:', err);
    return c.json(
      {
        success: false,
        error: 'Failed to read MCP config',
        path: configPath,
      },
      500
    );
  }
});

// POST /mcp/config - Write MCP config
mcp.post('/config', async (c) => {
  const configPath = getMcpConfigPath();

  try {
    const body = await c.req.json<MCPConfig>();

    // Validate structure
    if (!body || typeof body.mcpServers !== 'object') {
      return c.json(
        {
          success: false,
          error: 'Invalid config format: mcpServers object required',
        },
        400
      );
    }

    // Ensure directory exists
    await ensureDir(configPath);

    // Write config
    const configJson = JSON.stringify(body, null, 2);
    await fs.writeFile(configPath, configJson, 'utf-8');

    console.log('[MCP] Config saved to:', configPath);

    return c.json({
      success: true,
      message: 'MCP config saved',
      path: configPath,
    });
  } catch (err) {
    console.error('[MCP] Failed to write config:', err);
    return c.json(
      {
        success: false,
        error: 'Failed to write MCP config',
      },
      500
    );
  }
});

// GET /mcp/path - Get MCP config file path
mcp.get('/path', (c) => {
  return c.json({
    success: true,
    path: getMcpConfigPath(),
  });
});

// GET /mcp/all-configs - Read MCP configs from enabled built-in sources and optional custom path
mcp.get('/all-configs', async (c) => {
  const includeApp = c.req.query('appDirEnabled') !== 'false';
  const includeUser = c.req.query('userDirEnabled') !== 'false';
  const customConfigPath = c.req.query('mcpConfigPath');
  const seen = new Set<string>();
  const configPaths: { name: string; path: string }[] = [];

  const addPath = (configInfo: { name: string; path: string }) => {
    const expandedPath = expandHomePath(configInfo.path);
    const comparable = normalizeComparablePath(expandedPath);
    if (seen.has(comparable)) return;
    seen.add(comparable);
    configPaths.push({ name: configInfo.name, path: expandedPath });
  };

  for (const configInfo of getAllMcpConfigPaths()) {
    if (configInfo.name === 'uniins-claw' && includeApp) {
      addPath(configInfo);
    } else if (configInfo.name === 'claude' && includeUser) {
      addPath(configInfo);
    }
  }

  if (customConfigPath) {
    addPath({ name: 'custom', path: customConfigPath });
  }
  const results: {
    name: string;
    path: string;
    exists: boolean;
    servers: Record<string, MCPServerConfig>;
  }[] = [];

  for (const configInfo of configPaths) {
    try {
      await fs.access(configInfo.path);

      const content = await fs.readFile(configInfo.path, 'utf-8');
      const config = JSON.parse(content);

      // Claude settings.json has a different structure
      if (configInfo.name === 'claude') {
        // Claude settings has mcpServers at root level
        results.push({
          name: configInfo.name,
          path: configInfo.path,
          exists: true,
          servers: config.mcpServers || {},
        });
      } else {
        // uniins-claw mcp.json structure
        results.push({
          name: configInfo.name,
          path: configInfo.path,
          exists: true,
          servers: config.mcpServers || {},
        });
      }
    } catch {
      // File doesn't exist or can't be read
      results.push({
        name: configInfo.name,
        path: configInfo.path,
        exists: false,
        servers: {},
      });
    }
  }

  return c.json({
    success: true,
    configs: results,
  });
});

export { mcp as mcpRoutes };
