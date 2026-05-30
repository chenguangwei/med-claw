import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import test from 'node:test';
import { getSkill } from '@codeany/open-agent-sdk';

async function withTempHome<T>(fn: (homeDir: string) => Promise<T>) {
  const originalHome = process.env.HOME;
  const originalUserProfile = process.env.USERPROFILE;
  const homeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'uniins-skills-'));

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

async function writeSkill(
  rootDir: string,
  folderName: string,
  name: string,
  description: string
) {
  const skillDir = path.join(rootDir, folderName);
  await fs.mkdir(skillDir, { recursive: true });
  await fs.writeFile(
    path.join(skillDir, 'SKILL.md'),
    [
      '---',
      `name: ${name}`,
      `description: ${description}`,
      '---',
      '',
      `Use ${name}.`,
    ].join('\n')
  );
}

test('loadAllSkills treats an empty includeSkills list as an explicit deny-all scope', async () => {
  await withTempHome(async (homeDir) => {
    const { loadAllSkills } = await import('../src/shared/skills/loader.js');
    const appSkillsDir = path.join(homeDir, '.uniins-claw', 'skills');

    await writeSkill(appSkillsDir, 'alpha', 'alpha', 'Alpha skill');

    const skills = await loadAllSkills({
      enabled: true,
      userDirEnabled: false,
      appDirEnabled: true,
      includeSkills: [],
    });

    assert.deepEqual(skills, []);
  });
});

test('loadScopedSkillDefinitions filters file skills by includeSkills without registering them globally', async () => {
  await withTempHome(async (homeDir) => {
    const { loadScopedSkillDefinitions } =
      await import('../src/shared/skills/loader.js');
    const appSkillsDir = path.join(homeDir, '.uniins-claw', 'skills');

    await writeSkill(appSkillsDir, 'alpha', 'alpha', 'Alpha skill');
    await writeSkill(appSkillsDir, 'beta', 'beta', 'Beta skill');

    const skills = await loadScopedSkillDefinitions({
      enabled: true,
      userDirEnabled: false,
      appDirEnabled: true,
      includeSkills: ['alpha'],
    });

    assert.deepEqual(
      skills.map((skill) => skill.name),
      ['alpha']
    );
    assert.equal(getSkill('alpha'), undefined);
  });
});

test('loadScopedSkillDefinitions keeps concurrent includeSkills scopes isolated', async () => {
  await withTempHome(async (homeDir) => {
    const { loadScopedSkillDefinitions } =
      await import('../src/shared/skills/loader.js');
    const appSkillsDir = path.join(homeDir, '.uniins-claw', 'skills');

    await writeSkill(appSkillsDir, 'alpha', 'alpha', 'Alpha skill');
    await writeSkill(appSkillsDir, 'beta', 'beta', 'Beta skill');

    const [alphaSkills, betaSkills] = await Promise.all([
      loadScopedSkillDefinitions({
        enabled: true,
        userDirEnabled: false,
        appDirEnabled: true,
        includeSkills: ['alpha'],
      }),
      loadScopedSkillDefinitions({
        enabled: true,
        userDirEnabled: false,
        appDirEnabled: true,
        includeSkills: ['beta'],
      }),
    ]);

    assert.deepEqual(
      alphaSkills.map((skill) => skill.name),
      ['alpha']
    );
    assert.deepEqual(
      betaSkills.map((skill) => skill.name),
      ['beta']
    );
    assert.equal(getSkill('alpha'), undefined);
    assert.equal(getSkill('beta'), undefined);
  });
});
