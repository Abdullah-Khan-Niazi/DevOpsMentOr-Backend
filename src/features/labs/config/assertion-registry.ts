export type AssertionCheck = 'shell' | 'http';

export interface AssertionDefinition {
  /** User-safe check description (also used as the FAIL hint). */
  hint: string;
  check: AssertionCheck;
  /** Shell executor: command + expected exit code and/or stdout fragment. */
  command?: string;
  expectExitCode?: number;
  stdoutContains?: string;
  /** HTTP prober: path + expected status. */
  httpPath?: string;
  expectHttpStatus?: number;
}

/**
 * Server-side assertion registry (F6 §07 strategy #1). `pro_labs.flag_values`
 * maps `checkpointId -> assertionGroupId`; this registry resolves each group
 * to its checks, executed against the learner's instance via the container
 * adapter (`executeCommand` / `probeHttp`). Groups are keyed by string id so
 * admins can reference them from `flag_values` without code changes.
 */
export const ASSERTION_GROUPS: Record<string, AssertionDefinition[]> = {
  'docker-containers': [
    {
      hint: 'The challenge containers are not running on your instance yet.',
      check: 'shell',
      command: 'docker ps --format "{{.Names}} {{.Status}}"',
      expectExitCode: 0,
      stdoutContains: 'Up',
    },
  ],
  'k8s-pods': [
    {
      hint: 'Your Kubernetes pods are not all in the Ready state.',
      check: 'shell',
      command: 'kubectl get pods --no-headers',
      expectExitCode: 0,
      stdoutContains: 'Running',
    },
  ],
  'terraform-apply': [
    {
      hint: 'Your infrastructure has not been applied yet.',
      check: 'shell',
      command: 'terraform state list',
      expectExitCode: 0,
      stdoutContains: 'aws_instance',
    },
  ],
  'ansible-playbook': [
    {
      hint: 'The Ansible playbook has not been run successfully.',
      check: 'shell',
      command: 'ansible-playbook site.yml --syntax-check',
      expectExitCode: 0,
    },
  ],
  'nginx-health': [
    {
      hint: 'The nginx health endpoint is not responding as expected.',
      check: 'http',
      httpPath: '/health',
      expectHttpStatus: 200,
    },
  ],
  'web-service': [
    {
      hint: 'Your web service is not responding on the expected path.',
      check: 'http',
      httpPath: '/',
      expectHttpStatus: 200,
    },
  ],
  'git-clean': [
    {
      hint: 'Your Git working tree is not clean.',
      check: 'shell',
      command: 'git status --porcelain',
      expectExitCode: 0,
      stdoutContains: '',
    },
  ],
};

/** Unknown group ids produce an honest FAIL (misconfiguration signal). */
export function resolveAssertionGroup(groupId: string): AssertionDefinition[] | null {
  return ASSERTION_GROUPS[groupId] ?? null;
}