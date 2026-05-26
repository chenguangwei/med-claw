import { execFile } from 'child_process';
import * as fs from 'fs/promises';
import { tmpdir } from 'os';
import * as path from 'path';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

export interface GitHubSkillSource {
  owner: string;
  repo: string;
  ref?: string;
  skillPath?: string;
  skillName: string;
}

export interface ImportSkillOptions {
  url: string;
  targetDir: string;
  skillName?: string;
}

export interface ImportSkillResult {
  success: true;
  skillName: string;
  path: string;
  sourceUrl: string;
  validation: {
    hasSkillFile: boolean;
    trustedSource: boolean;
  };
}

function sanitizeSkillName(name: string): string {
  return name
    .trim()
    .replace(/[/\\]/g, '-')
    .replace(/[^\w.-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function parseGitHubSkillSource(url: string): GitHubSkillSource {
  const parsed = new URL(url);
  if (parsed.hostname !== 'github.com' && parsed.hostname !== 'www.github.com') {
    throw new Error('Only GitHub skill sources are supported right now');
  }

  const parts = parsed.pathname.split('/').filter(Boolean);
  if (parts.length < 2) {
    throw new Error('GitHub URL must include owner and repo');
  }

  const [owner, repoWithSuffix] = parts;
  const repo = repoWithSuffix.replace(/\.git$/, '');
  let ref: string | undefined;
  let skillPath: string | undefined;

  const treeIndex = parts.indexOf('tree');
  if (treeIndex >= 0) {
    ref = parts[treeIndex + 1];
    const remainingPath = parts.slice(treeIndex + 2);
    skillPath = remainingPath.length > 0 ? remainingPath.join('/') : undefined;
  }

  const rawName = skillPath ? path.basename(skillPath) : repo;
  const skillName = sanitizeSkillName(rawName);
  if (!skillName) {
    throw new Error('Could not determine skill name from source URL');
  }

  return { owner, repo, ref, skillPath, skillName };
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function copyDir(src: string, dest: string): Promise<void> {
  await fs.mkdir(dest, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });

  for (const entry of entries) {
    if (
      entry.name === '.git' ||
      entry.name === 'node_modules' ||
      entry.name === '.DS_Store'
    ) {
      continue;
    }

    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      await copyDir(srcPath, destPath);
    } else if (entry.isFile()) {
      await fs.copyFile(srcPath, destPath);
    }
  }
}

async function findSkillSourceDir(repoDir: string, source: GitHubSkillSource) {
  const candidates = [
    source.skillPath ? path.join(repoDir, source.skillPath) : undefined,
    path.join(repoDir, source.skillName),
    path.join(repoDir, 'skills', source.skillName),
    path.join(repoDir, '.claude', 'skills', source.skillName),
    repoDir,
  ].filter((candidate): candidate is string => Boolean(candidate));

  for (const candidate of candidates) {
    if (await pathExists(path.join(candidate, 'SKILL.md'))) {
      return candidate;
    }
  }

  throw new Error('No SKILL.md found in the selected GitHub source');
}

export async function importGitHubSkill(
  options: ImportSkillOptions
): Promise<ImportSkillResult> {
  const source = parseGitHubSkillSource(options.url);
  const skillName = sanitizeSkillName(options.skillName || source.skillName);
  if (!skillName) {
    throw new Error('Skill name is required');
  }

  await fs.mkdir(options.targetDir, { recursive: true });
  const destDir = path.join(options.targetDir, skillName);
  if (await pathExists(destDir)) {
    throw new Error(`TARGET_EXISTS|${destDir}`);
  }

  const tempRoot = await fs.mkdtemp(path.join(tmpdir(), 'uniins-claw-skill-'));
  const repoDir = path.join(tempRoot, source.repo);
  const repoUrl = `https://github.com/${source.owner}/${source.repo}.git`;
  const cloneArgs = ['clone', '--depth', '1'];
  if (source.ref) {
    cloneArgs.push('--branch', source.ref);
  }
  cloneArgs.push(repoUrl, repoDir);

  try {
    await execFileAsync('git', cloneArgs, { timeout: 120000 });
    const sourceDir = await findSkillSourceDir(repoDir, source);
    await copyDir(sourceDir, destDir);
    return {
      success: true,
      skillName,
      path: destDir,
      sourceUrl: options.url,
      validation: {
        hasSkillFile: await pathExists(path.join(destDir, 'SKILL.md')),
        trustedSource: source.owner === 'anthropics' || source.owner === 'openai',
      },
    };
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
}
