import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const readWorkspaceFile = async (...parts: string[]) =>
  readFile(path.join(process.cwd(), ...parts), 'utf8');

describe('release flow guardrails', () => {
  it('serializes deploy and migration workflows through one production lock', async () => {
    const [deployWorkflow, migrateWorkflow] = await Promise.all([
      readWorkspaceFile('.github', 'workflows', 'deploy-aws-ec2.yml'),
      readWorkspaceFile('.github', 'workflows', 'migrate-aws-ec2.yml'),
    ]);

    expect(deployWorkflow).toContain('group: production-operations');
    expect(migrateWorkflow).toContain('group: production-operations');
  });

  it('restricts manual deploys to main or release tags', async () => {
    const deployWorkflow = await readWorkspaceFile('.github', 'workflows', 'deploy-aws-ec2.yml');

    expect(deployWorkflow).toContain('target_ref:');
    expect(deployWorkflow).toContain('main)');
    expect(deployWorkflow).toContain('release-*)');
    expect(deployWorkflow).toContain('refs/tags/${TARGET_REF_INPUT}');
    expect(deployWorkflow).toContain('Unsupported deploy target');
  });

  it('restricts manual migrations to main or release tags', async () => {
    const migrateWorkflow = await readWorkspaceFile('.github', 'workflows', 'migrate-aws-ec2.yml');

    expect(migrateWorkflow).toContain('target_ref:');
    expect(migrateWorkflow).toContain('main)');
    expect(migrateWorkflow).toContain('release-*)');
    expect(migrateWorkflow).toContain('refs/tags/${TARGET_REF_INPUT}');
    expect(migrateWorkflow).toContain('Unsupported migration target');
  });

  it('keeps release scripts wired to readiness and failed-release tracking', async () => {
    const [ciWorkflow, releaseCommon, deployScript] = await Promise.all([
      readWorkspaceFile('.github', 'workflows', 'ci.yml'),
      readWorkspaceFile('scripts', 'release-common.sh'),
      readWorkspaceFile('scripts', 'deploy-prod.sh'),
    ]);

    expect(ciWorkflow).toContain('bash -n scripts/*.sh');
    expect(releaseCommon).toContain('FAILED_LINK=');
    expect(releaseCommon).toContain('API_READY_URL=');
    expect(releaseCommon).toContain('wait_for_application_ready');
    expect(deployScript).toContain('clear_link_target "$FAILED_LINK"');
    expect(deployScript).toContain('rollback_to_release "$current_before_switch" "$previous_before_switch" "$release_dir"');
  });
});
