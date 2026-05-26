export interface HubSkillManifestEntry {
  slug: string;
  name: string;
  summary?: string;
  source_url?: string;
  stars?: number;
  category?: string;
  tags?: string[];
}

export type HubTrustState = 'trusted' | 'partial' | 'invalid';

export interface HubValidationResult {
  validSkills: HubSkillManifestEntry[];
  rejectedCount: number;
  trustState: HubTrustState;
  errors: string[];
}

const GITHUB_SKILL_URL_PATTERN =
  /^https:\/\/github\.com\/[^/\s]+\/[^/\s]+\/tree\/[^/\s]+\/.+/i;

export function validateHubSkills(input: unknown): HubValidationResult {
  const rawSkills =
    input && typeof input === 'object' && Array.isArray((input as { skills?: unknown }).skills)
      ? (input as { skills: unknown[] }).skills
      : [];
  const errors: string[] = [];
  const validSkills: HubSkillManifestEntry[] = [];

  rawSkills.forEach((entry, index) => {
    if (!entry || typeof entry !== 'object') {
      errors.push(`skills[${index}] must be an object`);
      return;
    }

    const skill = entry as Partial<HubSkillManifestEntry>;
    const slug = String(skill.slug || '').trim();
    const name = String(skill.name || '').trim();
    const sourceUrl = String(skill.source_url || '').trim();

    if (!slug || !name || !GITHUB_SKILL_URL_PATTERN.test(sourceUrl)) {
      errors.push(`skills[${index}] is missing slug, name, or GitHub source_url`);
      return;
    }

    validSkills.push({
      slug,
      name,
      summary: typeof skill.summary === 'string' ? skill.summary : undefined,
      source_url: sourceUrl,
      stars: typeof skill.stars === 'number' ? skill.stars : undefined,
      category: typeof skill.category === 'string' ? skill.category : undefined,
      tags: Array.isArray(skill.tags)
        ? skill.tags.filter((tag): tag is string => typeof tag === 'string')
        : undefined,
    });
  });

  const rejectedCount = rawSkills.length - validSkills.length;
  return {
    validSkills,
    rejectedCount,
    trustState:
      validSkills.length === 0
        ? 'invalid'
        : rejectedCount === 0
          ? 'trusted'
          : 'partial',
    errors,
  };
}
