/**
 * MCP Config Loader
 *
 * Loads MCP server configuration from ~/.uniins-claw/mcp.json
 */

import fs from 'fs/promises';
import { homedir } from 'os';
import path from 'path';

import {
  getClaudeSettingsPath,
  getWorkanyMcpConfigPath,
} from '@/config/constants';

// MCP Server Config Types (matching SDK types)
export interface McpStdioServerConfig {
  type?: 'stdio';
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

export interface McpHttpServerConfig {
  type: 'http';
  url: string;
  headers?: Record<string, string>;
}

export interface McpSSEServerConfig {
  type: 'sse';
  url: string;
  headers?: Record<string, string>;
}

export type McpServerConfig = McpStdioServerConfig | McpHttpServerConfig | McpSSEServerConfig;

// uniins-claw MCP Config file format
interface _UniinsClawMcpConfig {
  mcpServers: Record<
    string,
    {
      // Type field (optional, defaults to 'sse' for URL-based, 'stdio' for command-based)
      type?: 'stdio' | 'http' | 'sse';
      // Stdio config
      command?: string;
      args?: string[];
      env?: Record<string, string>;
      // HTTP/SSE config
      url?: string;
      headers?: Record<string, string>;
      // UI metadata ignored by the runtime loader
      icon?: string;
    }
  >;
}

/**
 * Get the MCP config path
 */
export function getMcpConfigPath(): string {
  return getWorkanyMcpConfigPath();
}

/**
 * Load MCP servers from a single config file
 */
async function loadMcpServersFromFile(
  configPath: string,
  sourceName: string
): Promise<Record<string, McpServerConfig>> {
  try {
    await fs.access(configPath);
    const content = await fs.readFile(configPath, 'utf-8');
    const config = JSON.parse(content);

    // Support both formats: { mcpServers: {...} } and direct { serverName: {...} }
    const mcpServers = config.mcpServers || config;

    if (!mcpServers || typeof mcpServers !== 'object') {
      return {};
    }

    const servers: Record<string, McpServerConfig> = {};

    for (const [name, serverConfig] of Object.entries(mcpServers)) {
      const cfg = serverConfig as Record<string, unknown>;
      if (cfg.url) {
        // Determine type: use explicit type if provided, otherwise default to 'http'
        // User can specify 'sse' in config if the server uses SSE protocol
        const urlType = (cfg.type as string) || 'http';
        if (urlType === 'sse') {
          servers[name] = {
            type: 'sse',
            url: cfg.url as string,
            headers: cfg.headers as Record<string, string>,
          };
          console.log(`[MCP] Loaded SSE server from ${sourceName}: ${name}`);
        } else {
          // Default to HTTP for URL-based MCP servers
          servers[name] = {
            type: 'http',
            url: cfg.url as string,
            headers: cfg.headers as Record<string, string>,
          };
          console.log(`[MCP] Loaded HTTP server from ${sourceName}: ${name}`);
        }
      } else if (cfg.command) {
        servers[name] = {
          type: 'stdio',
          command: cfg.command as string,
          args: cfg.args as string[],
          env: cfg.env as Record<string, string>,
        };
        console.log(`[MCP] Loaded stdio server from ${sourceName}: ${name}`);
      }
    }

    return servers;
  } catch {
    return {};
  }
}

/**
 * MCP configuration interface
 */
export interface McpConfig {
  enabled: boolean;
  userDirEnabled?: boolean;
  appDirEnabled?: boolean;
  mcpConfigPath?: string;
  includeServers?: string[];
}

function expandHomePath(inputPath: string): string {
  if (inputPath === '~') return homedir();
  if (inputPath.startsWith('~/') || inputPath.startsWith('~\\')) {
    return path.join(homedir(), inputPath.slice(2));
  }
  return inputPath;
}

function normalizeComparablePath(inputPath: string): string {
  return path.resolve(expandHomePath(inputPath)).replace(/[\\/]+$/, '').toLowerCase();
}

function getConfiguredMcpConfigPaths(
  mcpConfig?: McpConfig
): Array<{ path: string; sourceName: string }> {
  const userConfigPath = getClaudeSettingsPath();
  const appConfigPath = getWorkanyMcpConfigPath();
  const paths: Array<{ path: string; sourceName: string }> = [];
  const seen = new Set<string>();

  const addPath = (configPath: string, sourceName: string) => {
    const expandedPath = expandHomePath(configPath);
    const comparable = normalizeComparablePath(expandedPath);
    if (seen.has(comparable)) return;
    seen.add(comparable);
    paths.push({ path: expandedPath, sourceName });
  };

  if (!mcpConfig) {
    addPath(appConfigPath, 'uniins-claw');
    return paths;
  }

  if (mcpConfig.userDirEnabled !== false) {
    addPath(userConfigPath, 'claude');
  }
  if (mcpConfig.appDirEnabled !== false) {
    addPath(appConfigPath, 'uniins-claw');
  }
  if (mcpConfig.mcpConfigPath) {
    addPath(mcpConfig.mcpConfigPath, 'custom');
  }

  return paths;
}

/**
 * Load MCP servers configuration from ~/.uniins-claw/mcp.json
 *
 * @param mcpConfig Optional config to control loading
 * @returns Record of server name to config
 */
export async function loadMcpServers(
  mcpConfig?: McpConfig
): Promise<Record<string, McpServerConfig>> {
  // If MCP is globally disabled, return empty
  if (mcpConfig && !mcpConfig.enabled) {
    console.log('[MCP] MCP disabled, skipping server load');
    return {};
  }

  const servers: Record<string, McpServerConfig> = {};
  const configPaths = getConfiguredMcpConfigPaths(mcpConfig);

  for (const configInfo of configPaths) {
    const fileServers = await loadMcpServersFromFile(
      configInfo.path,
      configInfo.sourceName
    );
    Object.assign(servers, fileServers);
  }

  if (mcpConfig?.includeServers && mcpConfig.includeServers.length > 0) {
    const allowedServers = new Set(mcpConfig.includeServers);
    for (const serverName of Object.keys(servers)) {
      if (!allowedServers.has(serverName)) {
        delete servers[serverName];
      }
    }
  }

  const serverCount = Object.keys(servers).length;
  if (serverCount > 0) {
    console.log(`[MCP] Loaded ${serverCount} MCP server(s)`);
  } else {
    console.log('[MCP] No MCP servers found');
  }

  return servers;
}
