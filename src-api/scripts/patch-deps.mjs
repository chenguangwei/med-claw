#!/usr/bin/env node
/**
 * Post-install patches for @shipany/open-agent-sdk dependency issues.
 *
 * 1. Patch @modelcontextprotocol/sdk: add missing `discoverOAuthServerInfo` shim
 * 2. Patch unicorn-magic: add missing "." export entry for tsx CJS compatibility
 * 3. Patch @codeany/open-agent-sdk: continue after tool calls even if an
 *    OpenAI-compatible provider reports finish_reason=stop/end_turn, and
 *    preserve tool execution error markers in streamed events, and round-trip
 *    DeepSeek reasoning_content across tool-call turns. Provider errors are
 *    included in result events for diagnostics.
 */
import { execSync } from 'child_process';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const workspaceRoot = join(__dirname, '..', '..');
const pnpmDir = join(workspaceRoot, 'node_modules', '.pnpm');

// ============================================================================
// Patch 1: @modelcontextprotocol/sdk — add discoverOAuthServerInfo shim
// ============================================================================

function patchMcpSdk() {
  let authFiles = [];
  try {
    const output = execSync(
      `find "${pnpmDir}" -name "auth.js" -path "*/sdk/dist/esm/client/*" -type f 2>/dev/null`,
      { encoding: 'utf-8' }
    ).trim();
    if (output) authFiles = output.split('\n').filter(Boolean);
  } catch {
    /* ignore */
  }

  const shimCode = `

// === Shim added by patch-deps.mjs ===
export async function discoverOAuthServerInfo(serverUrl, opts) {
  if (typeof discoverAuthorizationServerMetadata === 'function') {
    const authorizationServerMetadata = await discoverAuthorizationServerMetadata(serverUrl, opts);
    return { authorizationServerMetadata };
  }
  return { authorizationServerMetadata: null };
}
`;

  let patched = 0;
  for (const authFile of authFiles) {
    const content = readFileSync(authFile, 'utf-8');
    if (content.includes('discoverOAuthServerInfo')) continue;
    if (!content.includes('discoverAuthorizationServerMetadata')) continue;
    writeFileSync(authFile, content + shimCode);
    patched++;
  }
  console.log(
    `[patch-deps] MCP SDK: patched ${patched} of ${authFiles.length} auth.js file(s)`
  );
}

// ============================================================================
// Patch 2: unicorn-magic — add "." export for tsx CJS resolver compatibility
// ============================================================================

function patchUnicornMagic() {
  let pkgFiles = [];
  try {
    const output = execSync(
      `find "${pnpmDir}" -path "*/unicorn-magic/package.json" -type f 2>/dev/null`,
      { encoding: 'utf-8' }
    ).trim();
    if (output) pkgFiles = output.split('\n').filter(Boolean);
  } catch {
    /* ignore */
  }

  let patched = 0;
  for (const pkgFile of pkgFiles) {
    try {
      const pkg = JSON.parse(readFileSync(pkgFile, 'utf-8'));
      // unicorn-magic uses condition keys (node, default) instead of subpath keys (".")
      // Node.js exports can't mix both. Wrap into a "." subpath entry.
      if (
        pkg.exports &&
        !pkg.exports['.'] &&
        (pkg.exports.node || pkg.exports.default)
      ) {
        const originalExports = { ...pkg.exports };
        pkg.exports = { '.': originalExports };
        writeFileSync(pkgFile, JSON.stringify(pkg, null, '\t') + '\n');
        patched++;
      }
    } catch {
      /* skip invalid package.json */
    }
  }
  console.log(
    `[patch-deps] unicorn-magic: patched ${patched} of ${pkgFiles.length} package.json file(s)`
  );
}

// ============================================================================
// Patch 3: @codeany/open-agent-sdk — continue loop after tool calls
// ============================================================================

function replaceInFile(filePath, replacements) {
  if (!existsSync(filePath)) return false;

  let content = readFileSync(filePath, 'utf-8');
  let changed = false;

  for (const [search, replacement] of replacements) {
    if (content.includes(replacement)) continue;
    if (!content.includes(search)) continue;
    content = content.replace(search, replacement);
    changed = true;
  }

  if (changed) {
    writeFileSync(filePath, content);
  }
  return changed;
}

function patchOpenAgentSdk() {
  let packageDirs = [];
  try {
    const output = execSync(
      `find "${pnpmDir}" -path "*/@codeany+open-agent-sdk@*/node_modules/@codeany/open-agent-sdk" -type d 2>/dev/null`,
      { encoding: 'utf-8' }
    ).trim();
    if (output) packageDirs = output.split('\n').filter(Boolean);
  } catch {
    /* ignore */
  }

  let patched = 0;
  for (const packageDir of packageDirs) {
    const engineDist = join(packageDir, 'dist', 'engine.js');
    const engineSrc = join(packageDir, 'src', 'engine.ts');
    const openaiDist = join(packageDir, 'dist', 'providers', 'openai.js');
    const openaiSrc = join(packageDir, 'src', 'providers', 'openai.ts');

    if (
      replaceInFile(engineDist, [
        [
          "            if (response.stopReason === 'end_turn')\n                break;\n",
          '            // Patched by uniins-claw: a response with tool calls must continue\n            // regardless of stopReason, because some OpenAI-compatible providers\n            // return finish_reason=stop together with tool_calls.\n',
        ],
        [
          "                        output: typeof result.content === 'string'\n                            ? result.content\n                            : JSON.stringify(result.content),\n",
          "                        output: typeof result.content === 'string'\n                            ? result.content\n                            : JSON.stringify(result.content),\n                        is_error: result.is_error,\n",
        ],
        [
          "                    subtype: 'error',\n                    usage: this.totalUsage,\n                    num_turns: this.turnCount,\n                    cost: this.totalCost,\n",
          "                    subtype: 'error',\n                    is_error: true,\n                    usage: this.totalUsage,\n                    num_turns: this.turnCount,\n                    cost: this.totalCost,\n                    errors: [err instanceof Error ? err.message : String(err)],\n",
        ],
      ])
    )
      patched++;

    if (
      replaceInFile(engineSrc, [
        [
          "      if (response.stopReason === 'end_turn') break\n",
          '      // Patched by uniins-claw: a response with tool calls must continue\n      // regardless of stopReason, because some OpenAI-compatible providers\n      // return finish_reason=stop together with tool_calls.\n',
        ],
        [
          "            output:\n              typeof result.content === 'string'\n                ? result.content\n                : JSON.stringify(result.content),\n",
          "            output:\n              typeof result.content === 'string'\n                ? result.content\n                : JSON.stringify(result.content),\n            is_error: result.is_error,\n",
        ],
        [
          "          subtype: 'error',\n          usage: this.totalUsage,\n          num_turns: this.turnCount,\n          cost: this.totalCost,\n",
          "          subtype: 'error',\n          is_error: true,\n          usage: this.totalUsage,\n          num_turns: this.turnCount,\n          cost: this.totalCost,\n          errors: [err instanceof Error ? err.message : String(err)],\n",
        ],
      ])
    )
      patched++;

    if (
      replaceInFile(openaiDist, [
        [
          '        const messages = this.convertMessages(params.system, params.messages);\n',
          '        const includeReasoningContent = this.supportsReasoningContent(params.model);\n        const messages = this.convertMessages(params.system, params.messages, includeReasoningContent);\n',
        ],
        [
          '    // --------------------------------------------------------------------------\n    // Message Conversion: Internal → OpenAI\n    // --------------------------------------------------------------------------\n',
          "    supportsReasoningContent(model) {\n        return this.baseURL.includes('deepseek') || !!model?.toLowerCase().includes('deepseek');\n    }\n    // --------------------------------------------------------------------------\n    // Message Conversion: Internal → OpenAI\n    // --------------------------------------------------------------------------\n",
        ],
        [
          '    convertMessages(system, messages) {\n',
          '    convertMessages(system, messages, includeReasoningContent = false) {\n',
        ],
        [
          '                this.convertAssistantMessage(msg, result);\n',
          '                this.convertAssistantMessage(msg, result, includeReasoningContent);\n',
        ],
        [
          '    convertAssistantMessage(msg, result) {\n',
          '    convertAssistantMessage(msg, result, includeReasoningContent = false) {\n',
        ],
        [
          '        const stopReason = this.mapFinishReason(choice.finish_reason);\n',
          "        const stopReason = choice.message.tool_calls?.length ? 'tool_use' : this.mapFinishReason(choice.finish_reason);\n",
        ],
        [
          '        // Extract text and tool_use blocks\n        const textParts = [];\n        const toolCalls = [];\n',
          '        // Extract thinking, text, and tool_use blocks\n        const thinkingParts = [];\n        const textParts = [];\n        const toolCalls = [];\n',
        ],
        [
          "            if (block.type === 'text') {\n                textParts.push(block.text);\n            }\n            else if (block.type === 'tool_use') {\n",
          "            if (block.type === 'thinking') {\n                thinkingParts.push(block.thinking);\n            }\n            else if (block.type === 'text') {\n                textParts.push(block.text);\n            }\n            else if (block.type === 'tool_use') {\n",
        ],
        [
          '        if (toolCalls.length > 0) {\n            assistantMsg.tool_calls = toolCalls;\n        }\n',
          "        if (thinkingParts.length > 0) {\n            assistantMsg.reasoning_content = thinkingParts.join('\\n');\n        }\n        if (toolCalls.length > 0) {\n            assistantMsg.tool_calls = toolCalls;\n        }\n",
        ],
        [
          "        if (thinkingParts.length > 0) {\n            assistantMsg.reasoning_content = thinkingParts.join('\\n');\n        }\n",
          "        if (includeReasoningContent && thinkingParts.length > 0) {\n            assistantMsg.reasoning_content = thinkingParts.join('\\n');\n        }\n",
        ],
        [
          '        // Add text content\n        if (choice.message.content) {\n',
          "        // Preserve DeepSeek thinking content so it can be passed back on\n        // subsequent tool-result turns.\n        if (choice.message.reasoning_content) {\n            content.push({ type: 'thinking', thinking: choice.message.reasoning_content });\n        }\n        // Add text content\n        if (choice.message.content) {\n",
        ],
      ])
    )
      patched++;

    if (
      replaceInFile(openaiSrc, [
        [
          '    const messages = this.convertMessages(params.system, params.messages)\n',
          '    const includeReasoningContent = this.supportsReasoningContent(params.model)\n    const messages = this.convertMessages(params.system, params.messages, includeReasoningContent)\n',
        ],
        [
          '  // --------------------------------------------------------------------------\n  // Message Conversion: Internal → OpenAI\n  // --------------------------------------------------------------------------\n',
          "  private supportsReasoningContent(model?: string): boolean {\n    return this.baseURL.includes('deepseek') || !!model?.toLowerCase().includes('deepseek')\n  }\n\n  // --------------------------------------------------------------------------\n  // Message Conversion: Internal → OpenAI\n  // --------------------------------------------------------------------------\n",
        ],
        [
          '  private convertMessages(\n    system: string,\n    messages: NormalizedMessageParam[],\n  ): OpenAIChatMessage[] {\n',
          '  private convertMessages(\n    system: string,\n    messages: NormalizedMessageParam[],\n    includeReasoningContent = false,\n  ): OpenAIChatMessage[] {\n',
        ],
        [
          '        this.convertAssistantMessage(msg, result)\n',
          '        this.convertAssistantMessage(msg, result, includeReasoningContent)\n',
        ],
        [
          '  private convertAssistantMessage(\n    msg: NormalizedMessageParam,\n    result: OpenAIChatMessage[],\n  ): void {\n',
          '  private convertAssistantMessage(\n    msg: NormalizedMessageParam,\n    result: OpenAIChatMessage[],\n    includeReasoningContent = false,\n  ): void {\n',
        ],
        [
          '    const stopReason = this.mapFinishReason(choice.finish_reason)\n',
          "    const stopReason = choice.message.tool_calls?.length ? 'tool_use' : this.mapFinishReason(choice.finish_reason)\n",
        ],
        [
          '  tool_call_id?: string\n}\n',
          '  tool_call_id?: string\n  reasoning_content?: string\n}\n',
        ],
        [
          '      content: string | null\n      tool_calls?: OpenAIToolCall[]\n',
          '      content: string | null\n      reasoning_content?: string\n      tool_calls?: OpenAIToolCall[]\n',
        ],
        [
          '    // Extract text and tool_use blocks\n    const textParts: string[] = []\n    const toolCalls: OpenAIToolCall[] = []\n',
          '    // Extract thinking, text, and tool_use blocks\n    const thinkingParts: string[] = []\n    const textParts: string[] = []\n    const toolCalls: OpenAIToolCall[] = []\n',
        ],
        [
          "      if (block.type === 'text') {\n        textParts.push(block.text)\n      } else if (block.type === 'tool_use') {\n",
          "      if (block.type === 'thinking') {\n        thinkingParts.push(block.thinking)\n      } else if (block.type === 'text') {\n        textParts.push(block.text)\n      } else if (block.type === 'tool_use') {\n",
        ],
        [
          '    if (toolCalls.length > 0) {\n      assistantMsg.tool_calls = toolCalls\n    }\n',
          "    if (thinkingParts.length > 0) {\n      assistantMsg.reasoning_content = thinkingParts.join('\\n')\n    }\n\n    if (toolCalls.length > 0) {\n      assistantMsg.tool_calls = toolCalls\n    }\n",
        ],
        [
          "    if (thinkingParts.length > 0) {\n      assistantMsg.reasoning_content = thinkingParts.join('\\n')\n    }\n",
          "    if (includeReasoningContent && thinkingParts.length > 0) {\n      assistantMsg.reasoning_content = thinkingParts.join('\\n')\n    }\n",
        ],
        [
          '    // Add text content\n    if (choice.message.content) {\n',
          "    // Preserve DeepSeek thinking content so it can be passed back on\n    // subsequent tool-result turns.\n    if (choice.message.reasoning_content) {\n      content.push({ type: 'thinking', thinking: choice.message.reasoning_content } as any)\n    }\n\n    // Add text content\n    if (choice.message.content) {\n",
        ],
      ])
    )
      patched++;
  }

  console.log(
    `[patch-deps] open-agent-sdk: applied ${patched} patch(es) across ${packageDirs.length} package dir(s)`
  );
}

// ============================================================================
// Run all patches
// ============================================================================

patchMcpSdk();
patchUnicornMagic();
patchOpenAgentSdk();
console.log('[patch-deps] Done');
