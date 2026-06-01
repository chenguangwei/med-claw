import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import test from 'node:test';

async function writeSkill(rootDir: string, folderName: string) {
  const skillDir = path.join(rootDir, folderName);
  await fs.mkdir(skillDir, { recursive: true });
  await fs.writeFile(
    path.join(skillDir, 'SKILL.md'),
    [
      '---',
      `name: ${folderName}`,
      `description: ${folderName} skill`,
      '---',
      '',
      `Use ${folderName}.`,
    ].join('\n')
  );
}

async function withClearedPath<T>(callback: () => Promise<T>): Promise<T> {
  const previousPath = process.env.PATH;
  process.env.PATH = '';
  try {
    return await callback();
  } finally {
    if (previousPath === undefined) {
      delete process.env.PATH;
    } else {
      process.env.PATH = previousPath;
    }
  }
}

test('resolveSkillSourceDirs detects all skills in a repository skill collection', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'uniins-importer-'));
  try {
    const repoDir = path.join(tempDir, 'repo');
    await writeSkill(path.join(repoDir, 'skills'), 'write');
    await writeSkill(path.join(repoDir, 'skills'), 'design');

    const importer = await import('../src/shared/skills/importer.js');
    const resolveSkillSourceDirs = (
      importer as typeof importer & {
        resolveSkillSourceDirs?: typeof import('../src/shared/skills/importer.js')['resolveSkillSourceDirs'];
      }
    ).resolveSkillSourceDirs;

    assert.equal(typeof resolveSkillSourceDirs, 'function');

    const dirs = await resolveSkillSourceDirs(
      repoDir,
      importer.parseGitHubSkillSource('https://github.com/tw93/waza')
    );

    assert.deepEqual(
      dirs.map((dir) => path.relative(repoDir, dir.sourceDir)).sort(),
      ['skills/design', 'skills/write']
    );
    assert.deepEqual(
      dirs.map((dir) => dir.skillName).sort(),
      ['design', 'write']
    );
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test('importGitHubSkill imports from GitHub archive without requiring git on PATH', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'uniins-importer-'));
  const originalFetch = globalThis.fetch;

  try {
    const targetDir = path.join(tempDir, 'target');
    const archiveRepoDir = path.join(tempDir, 'archive-repo', 'skills');
    await writeSkill(archiveRepoDir, 'algorithmic-art');

    const JSZip = (await import('jszip')).default;
    const zip = new JSZip();
    const skillFile = await fs.readFile(
      path.join(archiveRepoDir, 'algorithmic-art', 'SKILL.md'),
      'utf-8'
    );
    zip.file('anthropics-skills-main/skills/algorithmic-art/SKILL.md', skillFile);
    const archiveBytes = await zip.generateAsync({ type: 'uint8array' });

    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = String(input);
      assert.equal(
        url,
        'https://api.github.com/repos/anthropics/skills/zipball/main'
      );
      return new Response(archiveBytes, {
        status: 200,
        headers: { 'content-type': 'application/zip' },
      });
    }) as typeof fetch;

    const importer = await import('../src/shared/skills/importer.js');
    const result = await withClearedPath(() =>
      importer.importGitHubSkill({
        url: 'https://github.com/anthropics/skills/tree/main/skills/algorithmic-art',
        targetDir,
      })
    );

    assert.equal(result.success, true);
    assert.equal(result.skillName, 'algorithmic-art');
    assert.equal(result.validation.hasSkillFile, true);
    assert.equal(result.importedSkills.length, 1);
    await fs.access(path.join(targetDir, 'algorithmic-art', 'SKILL.md'));
  } finally {
    globalThis.fetch = originalFetch;
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});
