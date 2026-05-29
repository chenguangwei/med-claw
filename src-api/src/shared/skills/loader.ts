/**
 * Skills Loader
 *
 * Loads skill definitions from ~/.claude/skills (Claude Code user directory)
 * Skills are directories containing a SKILL.md file with frontmatter metadata.
 *
 * Note: Skills are loaded by Claude SDK via settingSources: ['user']
 * This module is used for listing skills in the settings UI.
 */

import { existsSync } from 'fs';
import fs from 'fs/promises';
import { homedir } from 'os';
import { basename, dirname, join } from 'path';
import {
  getSkill,
  initBundledSkills,
  registerSkill,
  unregisterSkill,
} from '@codeany/open-agent-sdk';
import type { SkillDefinition } from '@codeany/open-agent-sdk';

import { getClaudeSkillsDir, getWorkanySkillsDir } from '@/config/constants';

/**
 * Skill metadata from SKILL.md frontmatter
 */
export interface SkillMetadata {
  name: string;
  description: string;
  license?: string;
  author?: string;
  version?: string;
  argumentHint?: string;
  whenToUse?: string;
  allowedTools?: string[];
  userInvocable?: boolean;
}

/**
 * Loaded skill information
 */
export interface LoadedSkill {
  name: string;
  path: string;
  metadata: SkillMetadata;
  content: string; // Full SKILL.md content
}

/**
 * Skills configuration interface
 */
export interface SkillsConfig {
  enabled: boolean;
  userDirEnabled?: boolean;
  appDirEnabled?: boolean;
  skillsPath?: string;
}

const registeredFileSkillNames = new Set<string>();
const replacedSdkSkills = new Map<string, SkillDefinition>();

function stripYamlQuotes(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function readTopLevelYamlValue(
  frontmatter: string,
  key: string
): string | undefined {
  const lines = frontmatter.split(/\r?\n/);
  const keyPattern = new RegExp(`^${escapeRegExp(key)}:\\s*(.*)$`);

  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(keyPattern);
    if (!match) continue;

    const inlineValue = match[1].trim();
    if (inlineValue && inlineValue !== '|' && inlineValue !== '>') {
      return stripYamlQuotes(inlineValue);
    }

    const blockLines: string[] = [];
    for (let j = i + 1; j < lines.length; j++) {
      const line = lines[j];
      if (/^[A-Za-z0-9_-]+:\s*/.test(line)) break;
      blockLines.push(line.replace(/^\s+/, ''));
    }

    return stripYamlQuotes(blockLines.join('\n').trim());
  }

  return undefined;
}

function readFirstYamlValue(
  frontmatter: string,
  keys: string[]
): string | undefined {
  for (const key of keys) {
    const value = readTopLevelYamlValue(frontmatter, key);
    if (value !== undefined) return value;
  }
  return undefined;
}

function parseYamlList(
  frontmatter: string,
  keys: string[]
): string[] | undefined {
  const value = readFirstYamlValue(frontmatter, keys);
  if (!value) return undefined;

  const normalized =
    value.startsWith('[') && value.endsWith(']') ? value.slice(1, -1) : value;

  const items = normalized
    .split(/\n|,/)
    .map((item) => stripYamlQuotes(item.replace(/^-\s*/, '').trim()))
    .filter(Boolean);

  return items.length > 0 ? items : undefined;
}

function parseYamlBoolean(
  frontmatter: string,
  keys: string[]
): boolean | undefined {
  const value = readFirstYamlValue(frontmatter, keys);
  if (value === undefined) return undefined;
  if (/^(true|yes|1)$/i.test(value)) return true;
  if (/^(false|no|0)$/i.test(value)) return false;
  return undefined;
}

/**
 * Parse SKILL.md frontmatter to extract metadata
 */
function parseSkillFrontmatter(content: string): SkillMetadata | null {
  // Match YAML frontmatter between --- markers
  const frontmatterMatch = content.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!frontmatterMatch) {
    return null;
  }

  const frontmatter = frontmatterMatch[1];
  const metadata: SkillMetadata = {
    name: readTopLevelYamlValue(frontmatter, 'name') || '',
    description: readTopLevelYamlValue(frontmatter, 'description') || '',
    license: readTopLevelYamlValue(frontmatter, 'license'),
    author: readTopLevelYamlValue(frontmatter, 'author'),
    version: readTopLevelYamlValue(frontmatter, 'version'),
    argumentHint: readFirstYamlValue(frontmatter, [
      'argument-hint',
      'argument_hint',
    ]),
    whenToUse: readFirstYamlValue(frontmatter, [
      'when-to-use',
      'when_to_use',
      'whenToUse',
    ]),
    allowedTools: parseYamlList(frontmatter, [
      'allowed-tools',
      'allowed_tools',
    ]),
    userInvocable: parseYamlBoolean(frontmatter, [
      'user-invocable',
      'user_invocable',
    ]),
  };

  return metadata.name ? metadata : null;
}

/**
 * Load a single skill from a directory
 */
async function loadSkillFromDir(skillDir: string): Promise<LoadedSkill | null> {
  try {
    // Check for SKILL.md (case-insensitive)
    const files = await fs.readdir(skillDir);
    const skillFile = files.find((f) => f.toLowerCase() === 'skill.md');

    if (!skillFile) {
      return null;
    }

    const skillPath = join(skillDir, skillFile);
    const content = await fs.readFile(skillPath, 'utf-8');
    const metadata = parseSkillFrontmatter(content);

    if (!metadata) {
      console.log(`[Skills] No valid frontmatter in: ${skillPath}`);
      return null;
    }

    // Use directory name as skill name if not specified in metadata
    if (!metadata.name) {
      metadata.name = basename(skillDir);
    }

    return {
      name: metadata.name,
      path: skillDir,
      metadata,
      content,
    };
  } catch {
    // Directory might not be accessible or readable
    return null;
  }
}

/**
 * Get the skills directory path
 */
export function getSkillsPath(): string {
  return getClaudeSkillsDir();
}

/**
 * Load skills from ~/.claude/skills/
 *
 * @param skillsConfig Optional configuration
 * @returns Array of loaded skills
 */
export async function loadSkills(
  skillsConfig?: SkillsConfig
): Promise<LoadedSkill[]> {
  // If skills are globally disabled, return empty
  if (skillsConfig && !skillsConfig.enabled) {
    console.log('[Skills] Skills disabled, skipping load');
    return [];
  }

  const skills: LoadedSkill[] = [];
  const skillsDir = getClaudeSkillsDir();

  try {
    await fs.access(skillsDir);
    const entries = await fs.readdir(skillsDir, { withFileTypes: true });

    for (const entry of entries) {
      // Skip hidden directories and files
      if (entry.name.startsWith('.')) {
        continue;
      }

      if (entry.isDirectory()) {
        const skillDir = join(skillsDir, entry.name);
        const skill = await loadSkillFromDir(skillDir);
        if (skill) {
          skills.push(skill);
          console.log(`[Skills] Loaded skill: ${skill.name}`);
        }
      }
    }
  } catch {
    // Directory doesn't exist or not accessible
    console.log(`[Skills] Directory not accessible: ${skillsDir}`);
  }

  const skillCount = skills.length;
  if (skillCount > 0) {
    console.log(`[Skills] Loaded ${skillCount} skill(s)`);
  } else {
    console.log('[Skills] No skills found');
  }

  return skills;
}

function expandHomePath(inputPath: string): string {
  if (inputPath === '~') return homedir();
  if (inputPath.startsWith('~/') || inputPath.startsWith('~\\')) {
    return join(homedir(), inputPath.slice(2));
  }
  return inputPath;
}

function normalizeComparablePath(inputPath: string): string {
  return expandHomePath(inputPath)
    .replace(/[\\/]+$/, '')
    .toLowerCase();
}

function getConfiguredSkillsDirs(skillsConfig?: SkillsConfig): string[] {
  const userDir = getClaudeSkillsDir();
  const appDir = getWorkanySkillsDir();
  const dirs: string[] = [];
  const seen = new Set<string>();

  const addDir = (dir: string) => {
    const expanded = expandHomePath(dir);
    const comparable = normalizeComparablePath(expanded);
    if (seen.has(comparable)) return;
    seen.add(comparable);
    dirs.push(expanded);
  };

  if (!skillsConfig || skillsConfig.userDirEnabled !== false) {
    addDir(userDir);
  }
  if (!skillsConfig || skillsConfig.appDirEnabled !== false) {
    addDir(appDir);
  }

  if (skillsConfig?.skillsPath) {
    const customPath = expandHomePath(skillsConfig.skillsPath);
    const isDefaultDir =
      normalizeComparablePath(customPath) ===
        normalizeComparablePath(userDir) ||
      normalizeComparablePath(customPath) === normalizeComparablePath(appDir);

    if (!isDefaultDir) {
      addDir(customPath);
    }
  }

  return dirs;
}

/**
 * Get skill names for display (useful for logging and UI)
 */
export function getSkillNames(skills: LoadedSkill[]): string[] {
  return skills.map((s) => s.name);
}

/**
 * Find a specific skill by name
 */
export function findSkill(
  skills: LoadedSkill[],
  name: string
): LoadedSkill | undefined {
  return skills.find((s) => s.name.toLowerCase() === name.toLowerCase());
}

// ============================================================================
// Built-in Skills Installation
// ============================================================================

/**
 * Get the path to bundled built-in skills in the project resources
 */
function getBuiltinSkillsSourceDir(): string {
  const candidates: string[] = [];
  const runtimeDir =
    typeof __dirname === 'string' ? __dirname : dirname(process.execPath);
  const execDir = dirname(process.execPath);

  candidates.push(
    // tsx/dev or tsc output when launched from src-api
    join(process.cwd(), 'resources', 'skills'),
    // repository-root launch, including one-off production bundle checks
    join(process.cwd(), 'src-api', 'resources', 'skills'),
    // pkg snapshot / bundled CJS paths
    join(runtimeDir, '..', 'resources', 'skills'),
    join(runtimeDir, '..', '..', 'resources', 'skills'),
    join(runtimeDir, '..', '..', '..', 'resources', 'skills'),
    // external resources next to the packaged sidecar, if present
    join(execDir, 'resources', 'skills'),
    join(execDir, '..', 'resources', 'skills')
  );

  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }

  return candidates[0];
}

/**
 * Recursively copy a directory
 */
async function copyDir(src: string, dest: string): Promise<void> {
  await fs.mkdir(dest, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = join(src, entry.name);
    const destPath = join(dest, entry.name);
    if (entry.isDirectory()) {
      await copyDir(srcPath, destPath);
    } else {
      await fs.copyFile(srcPath, destPath);
    }
  }
}

/**
 * Install built-in skills from project resources to ~/.uniins-claw/skills/
 * Only copies if the destination doesn't exist or is outdated.
 */
export async function installBuiltinSkills(): Promise<void> {
  const sourceDir = getBuiltinSkillsSourceDir();
  const targetDir = getWorkanySkillsDir();

  try {
    await fs.access(sourceDir);
  } catch {
    console.log('[Skills] No built-in skills source directory found');
    return;
  }

  try {
    await fs.mkdir(targetDir, { recursive: true });

    const entries = await fs.readdir(sourceDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue;

      const srcSkillDir = join(sourceDir, entry.name);
      const destSkillDir = join(targetDir, entry.name);
      const srcSkillFile = join(srcSkillDir, 'SKILL.md');
      const destSkillFile = join(destSkillDir, 'SKILL.md');

      // Check if source has SKILL.md
      try {
        await fs.access(srcSkillFile);
      } catch {
        continue;
      }

      // Check if needs update by comparing modification times
      let needsInstall = false;
      try {
        const srcStat = await fs.stat(srcSkillFile);
        const destStat = await fs.stat(destSkillFile);
        needsInstall = srcStat.mtimeMs > destStat.mtimeMs;
      } catch {
        needsInstall = true; // Destination doesn't exist
      }

      if (needsInstall) {
        console.log(`[Skills] Installing built-in skill: ${entry.name}`);
        await copyDir(srcSkillDir, destSkillDir);
      }
    }
  } catch (err) {
    console.error('[Skills] Failed to install built-in skills:', err);
  }
}

/**
 * Load skills from all directories (both ~/.claude/skills/ and ~/.uniins-claw/skills/)
 */
export async function loadAllSkills(
  skillsConfig?: SkillsConfig
): Promise<LoadedSkill[]> {
  if (skillsConfig && !skillsConfig.enabled) {
    return [];
  }

  const skills: LoadedSkill[] = [];
  const dirs = getConfiguredSkillsDirs(skillsConfig);
  const loadedNames = new Set<string>();

  for (const skillsDir of dirs) {
    try {
      await fs.access(skillsDir);
      const entries = await fs.readdir(skillsDir, { withFileTypes: true });

      for (const entry of entries) {
        if (entry.name.startsWith('.') || !entry.isDirectory()) continue;

        const skillDir = join(skillsDir, entry.name);
        const skill = await loadSkillFromDir(skillDir);
        const normalizedName = skill?.name.toLowerCase();
        if (skill && normalizedName && !loadedNames.has(normalizedName)) {
          skills.push(skill);
          loadedNames.add(normalizedName);
          console.log(`[Skills] Loaded skill: ${skill.name} from ${skillsDir}`);
        }
      }
    } catch {
      // Directory doesn't exist
    }
  }

  if (skills.length > 0) {
    console.log(`[Skills] Total loaded: ${skills.length} skill(s)`);
  }

  return skills;
}

function createSkillPrompt(skill: LoadedSkill, args: string): string {
  const argsText = args.trim();
  const sections = [
    `# Skill: ${skill.name}`,
    `Skill directory: ${skill.path}`,
    'If the instructions reference $SKILL_DIR, use the skill directory path above.',
  ];

  if (argsText) {
    sections.push(`## Invocation Arguments\n${argsText}`);
  }

  sections.push(`## SKILL.md\n${skill.content}`);
  return sections.join('\n\n');
}

function toSdkSkillDefinition(skill: LoadedSkill): SkillDefinition {
  return {
    name: skill.name,
    description:
      skill.metadata.description || `Skill loaded from ${skill.path}`,
    whenToUse: skill.metadata.whenToUse,
    argumentHint: skill.metadata.argumentHint,
    allowedTools: skill.metadata.allowedTools,
    userInvocable: skill.metadata.userInvocable !== false,
    async getPrompt(args) {
      return [
        {
          type: 'text',
          text: createSkillPrompt(skill, args),
        },
      ];
    },
  };
}

function clearRegisteredFileSkills(): void {
  for (const skillName of registeredFileSkillNames) {
    unregisterSkill(skillName);

    const replacedSkill = replacedSdkSkills.get(skillName);
    if (replacedSkill) {
      registerSkill(replacedSkill);
    }
  }

  registeredFileSkillNames.clear();
  replacedSdkSkills.clear();
}

/**
 * Synchronize file-based skills into the SDK's global skill registry.
 *
 * The SDK registers bundled skills per agent construction, while uniins-claw skills
 * live on disk. This bridge makes ~/.claude/skills and ~/.uniins-claw/skills
 * invocable through the SDK Skill tool.
 */
export async function syncSdkSkills(
  skillsConfig?: SkillsConfig
): Promise<LoadedSkill[]> {
  clearRegisteredFileSkills();

  // Ensure SDK bundled skills are present before applying file skill overrides.
  initBundledSkills();

  if (skillsConfig && !skillsConfig.enabled) {
    console.log('[Skills] Skills disabled, SDK registry sync skipped');
    return [];
  }

  const skills = await loadAllSkills(skillsConfig);
  for (const skill of skills) {
    const existingSkill = getSkill(skill.name);
    if (existingSkill) {
      replacedSdkSkills.set(skill.name, existingSkill);
    }

    registerSkill(toSdkSkillDefinition(skill));
    registeredFileSkillNames.add(skill.name);
  }

  if (skills.length > 0) {
    console.log(`[Skills] Registered ${skills.length} file skill(s) with SDK`);
  }

  return skills;
}
