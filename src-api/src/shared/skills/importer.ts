import * as fs from 'fs/promises';
import { tmpdir } from 'os';
import * as path from 'path';

import JSZip from 'jszip';

const GITHUB_ARCHIVE_DOWNLOAD_TIMEOUT_MS = 120000;

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
  importedSkills: ImportedSkill[];
  validation: {
    hasSkillFile: boolean;
    trustedSource: boolean;
  };
}

export interface ImportedSkill {
  skillName: string;
  path: string;
}

export interface ResolvedSkillSourceDir {
  skillName: string;
  sourceDir: string;
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

async function hasSkillFile(skillDir: string): Promise<boolean> {
  try {
    const entries = await fs.readdir(skillDir);
    return entries.some((entry) => entry.toLowerCase() === 'skill.md');
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

function getGitHubArchiveUrl(source: GitHubSkillSource): string {
  const refPath = source.ref ? `/${encodeURIComponent(source.ref)}` : '';
  return `https://api.github.com/repos/${source.owner}/${source.repo}/zipball${refPath}`;
}

function isPathInside(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function createTimeoutSignal(timeoutMs: number) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  return {
    signal: controller.signal,
    clear: () => clearTimeout(timeout),
  };
}

async function extractGitHubArchive(archiveBytes: Uint8Array, destDir: string) {
  const zip = await JSZip.loadAsync(archiveBytes);
  const rootDir = path.resolve(destDir);
  let extractedFiles = 0;

  await Promise.all(
    Object.values(zip.files).map(async (entry) => {
      if (entry.dir) return;

      const normalizedName = entry.name.replace(/\\/g, '/');
      const parts = normalizedName.split('/').filter(Boolean);
      if (parts.length <= 1) return;

      // GitHub archives wrap repository contents in a generated top-level folder.
      const relativeParts = parts.slice(1);
      const destPath = path.resolve(rootDir, ...relativeParts);
      if (!isPathInside(rootDir, destPath)) {
        throw new Error('GitHub archive contains an unsafe file path');
      }

      const content = await entry.async('uint8array');
      await fs.mkdir(path.dirname(destPath), { recursive: true });
      await fs.writeFile(destPath, content);
      extractedFiles += 1;
    })
  );

  if (extractedFiles === 0) {
    throw new Error('GitHub archive did not contain any importable files');
  }
}

async function downloadGitHubArchive(
  source: GitHubSkillSource,
  destDir: string
): Promise<void> {
  await fs.mkdir(destDir, { recursive: true });

  const archiveUrl = getGitHubArchiveUrl(source);
  const timeout = createTimeoutSignal(GITHUB_ARCHIVE_DOWNLOAD_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(archiveUrl, {
      signal: timeout.signal,
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'uniins-claw-skill-importer',
      },
    });
  } catch (error) {
    timeout.clear();
    if (timeout.signal.aborted) {
      throw new Error('Timed out downloading GitHub skill archive after 120 seconds');
    }
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to download GitHub skill archive: ${message}`);
  }

  if (!response.ok) {
    timeout.clear();
    const detail = [response.status, response.statusText].filter(Boolean).join(' ');
    throw new Error(`Failed to download GitHub skill archive: ${detail}`);
  }

  let archiveBytes: Uint8Array;
  try {
    archiveBytes = new Uint8Array(await response.arrayBuffer());
  } catch (error) {
    if (timeout.signal.aborted) {
      throw new Error('Timed out downloading GitHub skill archive after 120 seconds');
    }
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to download GitHub skill archive: ${message}`);
  } finally {
    timeout.clear();
  }

  await extractGitHubArchive(archiveBytes, destDir);
}

async function findSkillDirsInCollection(
  collectionDir: string
): Promise<ResolvedSkillSourceDir[]> {
  let entries;
  try {
    entries = await fs.readdir(collectionDir, { withFileTypes: true });
  } catch {
    return [];
  }

  const skillDirs: ResolvedSkillSourceDir[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const sourceDir = path.join(collectionDir, entry.name);
    if (!(await hasSkillFile(sourceDir))) continue;

    const skillName = sanitizeSkillName(entry.name);
    if (!skillName) continue;

    skillDirs.push({ skillName, sourceDir });
  }

  return skillDirs.sort((left, right) =>
    left.skillName.localeCompare(right.skillName)
  );
}

function assertUniqueSkillNames(skillDirs: ResolvedSkillSourceDir[]) {
  const seen = new Set<string>();
  for (const skillDir of skillDirs) {
    const normalizedName = skillDir.skillName.toLowerCase();
    if (seen.has(normalizedName)) {
      throw new Error(`Multiple skills resolve to the same name: ${skillDir.skillName}`);
    }
    seen.add(normalizedName);
  }
}

export async function resolveSkillSourceDirs(
  repoDir: string,
  source: GitHubSkillSource
): Promise<ResolvedSkillSourceDir[]> {
  if (source.skillPath) {
    const explicitDir = path.join(repoDir, source.skillPath);
    if (await hasSkillFile(explicitDir)) {
      return [{ skillName: source.skillName, sourceDir: explicitDir }];
    }

    const collectionSkillDirs = await findSkillDirsInCollection(explicitDir);
    if (collectionSkillDirs.length > 0) {
      assertUniqueSkillNames(collectionSkillDirs);
      return collectionSkillDirs;
    }

    throw new Error('No SKILL.md found in the selected GitHub source');
  }

  const candidates = [
    path.join(repoDir, source.skillName),
    path.join(repoDir, 'skills', source.skillName),
    path.join(repoDir, '.claude', 'skills', source.skillName),
    repoDir,
  ];

  for (const candidate of candidates) {
    if (await hasSkillFile(candidate)) {
      return [
        {
          skillName: candidate === repoDir ? source.skillName : path.basename(candidate),
          sourceDir: candidate,
        },
      ];
    }
  }

  const collectionRoots = [
    path.join(repoDir, 'skills'),
    path.join(repoDir, '.claude', 'skills'),
    repoDir,
  ];
  const collectionSkillDirs: ResolvedSkillSourceDir[] = [];
  for (const collectionRoot of collectionRoots) {
    collectionSkillDirs.push(...(await findSkillDirsInCollection(collectionRoot)));
  }

  if (collectionSkillDirs.length > 0) {
    assertUniqueSkillNames(collectionSkillDirs);
    return collectionSkillDirs;
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

  const tempRoot = await fs.mkdtemp(path.join(tmpdir(), 'uniins-claw-skill-'));
  const repoDir = path.join(tempRoot, source.repo);

  try {
    await downloadGitHubArchive(source, repoDir);
    const sourceDirs = await resolveSkillSourceDirs(repoDir, source);
    if (sourceDirs.length > 1 && options.skillName) {
      throw new Error('Skill name override can only be used with a single skill source');
    }

    const imports = sourceDirs.map((sourceDir) => {
      const importSkillName =
        sourceDirs.length === 1 && options.skillName
          ? skillName
          : sanitizeSkillName(sourceDir.skillName);
      if (!importSkillName) {
        throw new Error('Skill name is required');
      }
      return {
        skillName: importSkillName,
        sourceDir: sourceDir.sourceDir,
        path: path.join(options.targetDir, importSkillName),
      };
    });

    const normalizedDestNames = new Set<string>();
    for (const skillImport of imports) {
      const normalizedName = skillImport.skillName.toLowerCase();
      if (normalizedDestNames.has(normalizedName)) {
        throw new Error(`Multiple skills resolve to the same name: ${skillImport.skillName}`);
      }
      normalizedDestNames.add(normalizedName);

      if (await pathExists(skillImport.path)) {
        throw new Error(`TARGET_EXISTS|${skillImport.path}`);
      }
    }

    for (const skillImport of imports) {
      await copyDir(skillImport.sourceDir, skillImport.path);
    }

    const importedSkills = imports.map((skillImport) => ({
      skillName: skillImport.skillName,
      path: skillImport.path,
    }));
    const primarySkill = importedSkills[0];
    return {
      success: true,
      skillName: primarySkill.skillName,
      path: importedSkills.length === 1 ? primarySkill.path : options.targetDir,
      sourceUrl: options.url,
      importedSkills,
      validation: {
        hasSkillFile: (
          await Promise.all(
            importedSkills.map((importedSkill) =>
              hasSkillFile(importedSkill.path)
            )
          )
        ).every(Boolean),
        trustedSource: source.owner === 'anthropics' || source.owner === 'openai',
      },
    };
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
}
