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
