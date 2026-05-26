import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import { getAllSkillsDirs } from '@/config/constants';

export interface SkillEditorInput {
  name: string;
  description?: string;
  content?: string;
}

export interface CreateSkillInput extends SkillEditorInput {
  targetDir: string;
  folderName?: string;
}

export interface UpdateSkillInput extends SkillEditorInput {
  skillPath: string;
}

export interface ReadSkillResult {
  name: string;
  description: string;
  content: string;
  skillPath: string;
  folderName: string;
}

function normalizeResolvedPath(value: string): string {
  return path.resolve(value);
}

function isPathInside(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function getAllowedSkillRoots(): string[] {
  return getAllSkillsDirs().map((dir) => normalizeResolvedPath(dir.path));
}

function getErrorCode(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code?: unknown }).code)
    : undefined;
}

function assertAllowedRoot(targetDir: string): string {
  const resolvedTarget = normalizeResolvedPath(targetDir);
  const allowedRoot = getAllowedSkillRoots().find((root) => root === resolvedTarget);
  if (!allowedRoot) {
    throw new Error('Target directory must be a configured skills directory');
  }
  return allowedRoot;
}

function assertAllowedSkillPath(skillPath: string): string {
  const resolvedSkillPath = normalizeResolvedPath(skillPath);
  const root = getAllowedSkillRoots().find(
    (allowedRoot) =>
      resolvedSkillPath !== allowedRoot && isPathInside(allowedRoot, resolvedSkillPath)
  );
  if (!root) {
    throw new Error('Skill path must be inside a configured skills directory');
  }
  return resolvedSkillPath;
}

export function createSkillFolderName(name: string, fallback = 'custom-skill'): string {
  const normalized = name
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}._-]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return normalized || fallback;
}

function escapeYamlString(value: string): string {
  return JSON.stringify(value);
}

function defaultSkillContent(name: string, description: string): string {
  const lines = [
    '---',
    `name: ${escapeYamlString(name)}`,
    `description: ${escapeYamlString(description || 'Describe when this skill should be used.')}`,
    '---',
    '',
    '# Instructions',
    '',
    'Write the concrete steps, constraints, and examples this skill should provide to the agent.',
    '',
  ];
  return lines.join('\n');
}

function upsertFrontmatterValue(frontmatter: string, key: string, value: string): string {
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const line = `${key}: ${escapeYamlString(value)}`;
  const pattern = new RegExp(`^${escapedKey}:.*$`, 'm');
  if (pattern.test(frontmatter)) return frontmatter.replace(pattern, line);
  return `${frontmatter.trimEnd()}\n${line}`;
}

function applySkillMetadata(content: string, name: string, description: string): string {
  const frontmatterMatch = content.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!frontmatterMatch) return content;
  const nextFrontmatter = upsertFrontmatterValue(
    upsertFrontmatterValue(frontmatterMatch[1], 'name', name),
    'description',
    description || 'Describe when this skill should be used.'
  );
  return content.replace(frontmatterMatch[0], `---\n${nextFrontmatter}\n---`);
}

export function buildSkillContent(input: SkillEditorInput): string {
  const name = input.name.trim();
  const description = (input.description || '').trim();
  const content = (input.content || '').trim();
  if (!name) throw new Error('Skill name is required');
  if (content) return `${applySkillMetadata(content, name, description).trim()}\n`;
  return defaultSkillContent(name, description);
}

export async function readSkill(skillPath: string): Promise<ReadSkillResult> {
  const resolvedSkillPath = assertAllowedSkillPath(skillPath);
  const skillFile = path.join(resolvedSkillPath, 'SKILL.md');
  const stat = await fs.stat(resolvedSkillPath);
  if (!stat.isDirectory()) throw new Error('Skill path is not a directory');
  const content = await fs.readFile(skillFile, 'utf8');
  const frontmatter = content.match(/^---\s*\n([\s\S]*?)\n---/);
  const nameMatch = frontmatter?.[1].match(/^name:\s*(.+)$/m);
  const descriptionMatch = frontmatter?.[1].match(/^description:\s*(.+)$/m);
  return {
    name: nameMatch?.[1]?.replace(/^["']|["']$/g, '').trim() || path.basename(resolvedSkillPath),
    description: descriptionMatch?.[1]?.replace(/^["']|["']$/g, '').trim() || '',
    content,
    skillPath: resolvedSkillPath,
    folderName: path.basename(resolvedSkillPath),
  };
}

export async function createSkill(input: CreateSkillInput): Promise<ReadSkillResult> {
  const targetRoot = assertAllowedRoot(input.targetDir);
  const name = input.name.trim();
  if (!name) throw new Error('Skill name is required');
  const folderName = createSkillFolderName(input.folderName || name);
  const skillPath = path.join(targetRoot, folderName);

  try {
    await fs.mkdir(targetRoot, { recursive: true });
    await fs.mkdir(skillPath, { recursive: false });
  } catch (error) {
    if (getErrorCode(error) === 'EEXIST') {
      throw new Error('Skill folder already exists');
    }
    throw error;
  }

  await fs.writeFile(path.join(skillPath, 'SKILL.md'), buildSkillContent(input), 'utf8');
  return readSkill(skillPath);
}

export async function updateSkill(input: UpdateSkillInput): Promise<ReadSkillResult> {
  const resolvedSkillPath = assertAllowedSkillPath(input.skillPath);
  await readSkill(resolvedSkillPath);
  await fs.writeFile(path.join(resolvedSkillPath, 'SKILL.md'), buildSkillContent(input), 'utf8');
  return readSkill(resolvedSkillPath);
}

export async function deleteSkill(skillPath: string): Promise<void> {
  const resolvedSkillPath = assertAllowedSkillPath(skillPath);
  await readSkill(resolvedSkillPath);
  await fs.rm(resolvedSkillPath, { recursive: true, force: false });
}
