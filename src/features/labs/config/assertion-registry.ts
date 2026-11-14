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
  // ─── Module 1 · Lab 1: Introduction to OS & Linux Basics ───────────────────
  'lab01-checkpoint-1-ps': [
    {
      hint: 'Ensure the process table is accessible and system daemons are running with ps aux.',
      check: 'shell',
      command: 'ps aux | grep -v grep | wc -l',
      expectExitCode: 0,
    },
  ],
  'lab01-checkpoint-2-mem': [
    {
      hint: 'Create /workspace/system_audit/memory_report.txt containing the output of free -m.',
      check: 'shell',
      command:
        "test -s /workspace/system_audit/memory_report.txt && grep -qi 'mem:' /workspace/system_audit/memory_report.txt",
      expectExitCode: 0,
    },
  ],
  'lab01-checkpoint-3-rogue': [
    {
      hint: 'The rogue process (/usr/local/bin/rogue-worker.sh) is still running. Terminate it with kill or pkill -9 -f rogue-worker.sh.',
      check: 'shell',
      command:
        "! ps -eo stat,args | awk '$1 !~ /^Z/ && /rogue-worker\\.sh/ && !/awk/ { found=1 } END { exit !found }'",
      expectExitCode: 0,
    },
  ],
  'lab01-checkpoint-4-service': [
    {
      hint: 'Ensure /opt/services/metrics-collector.sh is executable (chmod 755), /opt/services/config.env has STATUS=active, and the service is running in the background.',
      check: 'shell',
      command:
        "test -x /opt/services/metrics-collector.sh && grep -q 'STATUS=active' /opt/services/config.env && ps -eo stat,args | awk '$1 !~ /^Z/ && /metrics-collector\\.sh/ && !/awk/ { found=1 } END { exit !found }' && grep -q 'Metrics Collector Active' /var/log/metrics-collector.log",
      expectExitCode: 0,
    },
  ],

  // ─── Module 1 · Lab 2: Linux Filesystem Hierarchy (FHS) ────────────────────
  'lab02-checkpoint-1-fhs-report': [
    {
      hint: 'Create /workspace/fhs_audit/mount_report.txt containing the output of df -hT and lsblk.',
      check: 'shell',
      command:
        "test -s /workspace/fhs_audit/mount_report.txt && grep -q '/' /workspace/fhs_audit/mount_report.txt",
      expectExitCode: 0,
    },
  ],
  'lab02-checkpoint-2-log-cleanup': [
    {
      hint: 'Remove /var/log/app/corrupted_dump.bin and save df -h /var/log output into /var/backups/disk_status.txt.',
      check: 'shell',
      command:
        "test ! -f /var/log/app/corrupted_dump.bin && test -s /var/backups/disk_status.txt && grep -q 'Filesystem' /var/backups/disk_status.txt",
      expectExitCode: 0,
    },
  ],
  'lab02-checkpoint-3-symlinks': [
    {
      hint: 'Remove dangling /etc/webapp/legacy.conf and link /etc/webapp/active.conf -> /opt/webapp/releases/v2.1/app.conf.',
      check: 'shell',
      command:
        'test -L /etc/webapp/active.conf && test "$(readlink -f /etc/webapp/active.conf)" = "/opt/webapp/releases/v2.1/app.conf" && test ! -e /etc/webapp/legacy.conf',
      expectExitCode: 0,
    },
  ],
  'lab02-checkpoint-4-storage-service': [
    {
      hint: 'Create /srv/storage/uploads and /srv/storage/archive, symlink /var/www/html/uploads -> /srv/storage/uploads, and chmod 755 /opt/webapp/storage-check.sh.',
      check: 'shell',
      command:
        'test -d /srv/storage/uploads && test -d /srv/storage/archive && test -L /var/www/html/uploads && test "$(readlink -f /var/www/html/uploads)" = "/srv/storage/uploads" && test -x /opt/webapp/storage-check.sh && /opt/webapp/storage-check.sh | grep -q "STORAGE_OK"',
      expectExitCode: 0,
    },
  ],

  // ─── Module 1 · Lab 3: Basic CLI Commands & File Operations ────────────────
  'lab03-checkpoint-1-scaffold': [
    {
      hint: 'Create /workspace/release_v1/{bin,conf,logs} and touch /workspace/release_v1/.build_manifest.',
      check: 'shell',
      command:
        'test -d /workspace/release_v1/bin && test -d /workspace/release_v1/conf && test -d /workspace/release_v1/logs && test -f /workspace/release_v1/.build_manifest',
      expectExitCode: 0,
    },
  ],
  'lab03-checkpoint-2-organize': [
    {
      hint: 'Move deploy.sh and healthcheck.sh into bin/, copy app.conf and db.conf into conf/, and delete /workspace/staging_mess/debug.tmp.',
      check: 'shell',
      command:
        'test -f /workspace/release_v1/bin/deploy.sh && test -f /workspace/release_v1/conf/app.conf && test -f /workspace/release_v1/conf/db.conf && test ! -e /workspace/staging_mess/debug.tmp',
      expectExitCode: 0,
    },
  ],
  'lab03-checkpoint-3-find-exec': [
    {
      hint: 'Delete all *.bak files inside /workspace/release_v1 and make scripts in /workspace/release_v1/bin/ executable (chmod 755).',
      check: 'shell',
      command:
        "test $(find /workspace/release_v1 -name '*.bak' | wc -l) -eq 0 && test -x /workspace/release_v1/bin/deploy.sh && test -x /workspace/release_v1/bin/healthcheck.sh",
      expectExitCode: 0,
    },
  ],
  'lab03-checkpoint-4-archive': [
    {
      hint: 'Create /workspace/backups/release_v1.tar.gz containing the release_v1 contents.',
      check: 'shell',
      command:
        "test -s /workspace/backups/release_v1.tar.gz && tar -tzf /workspace/backups/release_v1.tar.gz | grep -q 'bin/deploy.sh' && tar -tzf /workspace/backups/release_v1.tar.gz | grep -q 'conf/app.conf'",
      expectExitCode: 0,
    },
  ],

  // ─── Module 1 · Lab 4: Package Management & Text Editors (Vim/Nano) ────────
  'lab04-checkpoint-1-apt-repo': [
    {
      hint: 'Remove or comment out broken-mirror.invalid in /etc/apt/sources.list.d/broken-mirror.list.',
      check: 'shell',
      command:
        "! grep -rq 'broken-mirror.invalid' /etc/apt/sources.list /etc/apt/sources.list.d/ 2>/dev/null",
      expectExitCode: 0,
    },
  ],
  'lab04-checkpoint-2-packages': [
    {
      hint: 'Ensure both jq and tree packages are installed (apt-get update && apt-get install -y jq tree).',
      check: 'shell',
      command: 'dpkg -s jq >/dev/null 2>&1 && dpkg -s tree >/dev/null 2>&1',
      expectExitCode: 0,
    },
  ],
  'lab04-checkpoint-3-vim-cleanup': [
    {
      hint: 'Remove /etc/nginx/.nginx.conf.swp and fix worker_processes auto; in /etc/nginx/nginx.conf.',
      check: 'shell',
      command:
        "test ! -e /etc/nginx/.nginx.conf.swp && ! grep -q 'WORKERS_BROKEN' /etc/nginx/nginx.conf",
      expectExitCode: 0,
    },
  ],
  'lab04-checkpoint-4-service-config': [
    {
      hint: 'Fix /etc/nginx/sites-available/devops-portal.conf (listen 8080; and root /var/www/devops-portal;), symlink into sites-enabled, and verify nginx -t passes.',
      check: 'shell',
      command:
        "grep -q 'listen 8080;' /etc/nginx/sites-available/devops-portal.conf && grep -q 'root /var/www/devops-portal;' /etc/nginx/sites-available/devops-portal.conf && test -L /etc/nginx/sites-enabled/devops-portal.conf && nginx -t >/dev/null 2>&1",
      expectExitCode: 0,
    },
  ],

  // ─── Module 1 · Lab 5: Users, Groups, and Permissions ──────────────────────
  'lab05-checkpoint-1-users-groups': [
    {
      hint: 'Create group devops-team and user deployer with /bin/bash shell and membership in devops-team.',
      check: 'shell',
      command:
        "getent group devops-team >/dev/null && id -nG deployer 2>/dev/null | grep -qw devops-team && getent passwd deployer | grep -q '/bin/bash'",
      expectExitCode: 0,
    },
  ],
  'lab05-checkpoint-2-shared-dir': [
    {
      hint: 'Ensure /srv/deployment is owned by deployer:devops-team with permissions 2775 (SetGID).',
      check: 'shell',
      command:
        'test -d /srv/deployment && test "$(stat -c \'%U:%G\' /srv/deployment)" = "deployer:devops-team" && test "$(stat -c \'%a\' /srv/deployment)" = "2775"',
      expectExitCode: 0,
    },
  ],
  'lab05-checkpoint-3-sudoers': [
    {
      hint: 'Create /etc/sudoers.d/deployer with mode 0440 granting deployer NOPASSWD for /usr/local/bin/deploy-service.sh.',
      check: 'shell',
      command:
        'test -f /etc/sudoers.d/deployer && test "$(stat -c \'%a\' /etc/sudoers.d/deployer)" = "440" && visudo -cf /etc/sudoers.d/deployer >/dev/null 2>&1 && grep -q \'/usr/local/bin/deploy-service.sh\' /etc/sudoers.d/deployer',
      expectExitCode: 0,
    },
  ],
  'lab05-checkpoint-4-key-audit': [
    {
      hint: 'Harden /home/deployer/.ssh (700), /home/deployer/.ssh/id_ed25519 (600, owned by deployer:deployer), and /opt/runner/run.sh (750).',
      check: 'shell',
      command:
        'test "$(stat -c \'%a\' /home/deployer/.ssh)" = "700" && test "$(stat -c \'%a\' /home/deployer/.ssh/id_ed25519)" = "600" && test "$(stat -c \'%U:%G\' /home/deployer/.ssh/id_ed25519)" = "deployer:deployer" && test "$(stat -c \'%a\' /opt/runner/run.sh)" = "750"',
      expectExitCode: 0,
    },
  ],

  // ─── Module 1 · Lab 6: Pipes, Redirection & Shell Scripting ────────────────
  'lab06-checkpoint-1-error-extract': [
    {
      hint: 'Extract all ERROR lines from /var/log/devops/access.log into /workspace/log_analysis/errors_only.log.',
      check: 'shell',
      command:
        "test -s /workspace/log_analysis/errors_only.log && test $(wc -l < /workspace/log_analysis/errors_only.log) -eq 7 && ! grep -qv 'ERROR' /workspace/log_analysis/errors_only.log",
      expectExitCode: 0,
    },
  ],
  'lab06-checkpoint-2-top-ips': [
    {
      hint: 'Write the top 3 IP addresses sorted by request count descending into /workspace/log_analysis/top_ips.txt.',
      check: 'shell',
      command:
        "test -s /workspace/log_analysis/top_ips.txt && head -n 1 /workspace/log_analysis/top_ips.txt | grep -q '192.168.10.45' && test $(wc -l < /workspace/log_analysis/top_ips.txt) -eq 3",
      expectExitCode: 0,
    },
  ],
  'lab06-checkpoint-3-redirect-streams': [
    {
      hint: 'Run /opt/scripts/stream-test.sh redirecting stdout to /workspace/log_analysis/diag_stdout.log and stderr to /workspace/log_analysis/diag_stderr.log.',
      check: 'shell',
      command:
        "test -s /workspace/log_analysis/diag_stdout.log && test -s /workspace/log_analysis/diag_stderr.log && grep -q 'DIAG_OK' /workspace/log_analysis/diag_stdout.log && grep -q 'DIAG_ERR' /workspace/log_analysis/diag_stderr.log",
      expectExitCode: 0,
    },
  ],
  'lab06-checkpoint-4-health-script': [
    {
      hint: 'Fix and chmod 755 /usr/local/bin/log-summary.sh so it outputs TOTAL_ERRORS=7 and TOP_IP=192.168.10.45 and writes /var/log/log-summary.report.',
      check: 'shell',
      command:
        "test -x /usr/local/bin/log-summary.sh && /usr/local/bin/log-summary.sh | grep -q 'TOTAL_ERRORS=7' && /usr/local/bin/log-summary.sh | grep -q 'TOP_IP=192.168.10.45' && test -s /var/log/log-summary.report",
      expectExitCode: 0,
    },
  ],

  // ─── Module 1 · Lab 7: Networking Basics, SSH & System Security ────────────
  'lab07-checkpoint-1-hosts-dns': [
    {
      hint: 'Map 127.0.0.1 internal-api.devops.local in /etc/hosts.',
      check: 'shell',
      command:
        "grep -Eq '^127\\.0\\.0\\.1[[:space:]]+.*internal-api\\.devops\\.local' /etc/hosts && getent hosts internal-api.devops.local | grep -q '127.0.0.1'",
      expectExitCode: 0,
    },
  ],
  'lab07-checkpoint-2-port-audit': [
    {
      hint: 'Terminate rogue-listener.py on port 4444 and ensure api-server.py is running on port 9090.',
      check: 'shell',
      command:
        "! ps -eo stat,args | awk '$1 !~ /^Z/ && /rogue-listener\\.py/ && !/awk/ { found=1 } END { exit !found }' && ps -eo stat,args | awk '$1 !~ /^Z/ && /api-server\\.py/ && !/awk/ { found=1 } END { exit !found }' && curl -s http://internal-api.devops.local:9090/health | grep -q 'API_HEALTHY'",
      expectExitCode: 0,
    },
  ],
  'lab07-checkpoint-3-ssh-hardening': [
    {
      hint: 'Set PermitRootLogin no and PasswordAuthentication no in /etc/ssh/sshd_config and ensure sshd -t succeeds.',
      check: 'shell',
      command:
        "grep -Eq '^[[:space:]]*PermitRootLogin[[:space:]]+no' /etc/ssh/sshd_config && grep -Eq '^[[:space:]]*PasswordAuthentication[[:space:]]+no' /etc/ssh/sshd_config && sshd -t",
      expectExitCode: 0,
    },
  ],
  'lab07-checkpoint-4-firewall-rules': [
    {
      hint: 'Update /etc/network/firewall.conf (ALLOW 22/tcp, ALLOW 9090/tcp, DENY 4444/tcp), chmod 755 /etc/network/firewall-rules.sh, and execute it.',
      check: 'shell',
      command:
        "test -x /etc/network/firewall-rules.sh && grep -q 'ALLOW 22/tcp' /etc/network/firewall.conf && grep -q 'ALLOW 9090/tcp' /etc/network/firewall.conf && grep -q 'DENY 4444/tcp' /etc/network/firewall.conf && /etc/network/firewall-rules.sh | grep -q 'FIREWALL_ACTIVE'",
      expectExitCode: 0,
    },
  ],

  // ─── Legacy / Generic Platform Assertion Groups ────────────────────────────
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
  'linux-process-audit': [
    {
      hint: 'Process table could not be read or PID 1 is not healthy.',
      check: 'shell',
      command: 'ps aux | head -n 10',
      expectExitCode: 0,
      stdoutContains: 'USER',
    },
  ],
  'linux-memory-report': [
    {
      hint: 'Memory report /workspace/system_audit/memory_report.txt missing or empty. Run "free -m > /workspace/system_audit/memory_report.txt".',
      check: 'shell',
      command: 'grep -i "mem" /workspace/system_audit/memory_report.txt 2>/dev/null',
      expectExitCode: 0,
      stdoutContains: 'Mem:',
    },
  ],
  'linux-kill-rogue': [
    {
      hint: 'Rogue worker process is still alive. Terminate it with: kill -9 $(pgrep -f rogue-worker.sh)',
      check: 'shell',
      command: 'ps -eo stat,args | grep -v "defunct" | grep "[r]ogue-worker.sh" || echo "CLEAN"',
      expectExitCode: 0,
      stdoutContains: 'CLEAN',
    },
  ],
  'linux-break-fix-service': [
    {
      hint: 'Metrics collector is not active, not configured, or missing heartbeats. Fix config.env (STATUS=active), chmod +x, and launch in background.',
      check: 'shell',
      command: 'grep "STATUS=active" /opt/services/config.env 2>/dev/null && ps -eo stat,args | grep -v "defunct" | grep "[m]etrics-collector.sh" && grep -i "HEARTBEAT" /var/log/metrics-collector.log 2>/dev/null',
      expectExitCode: 0,
    },
  ],
};

/** Unknown group ids produce an honest FAIL (misconfiguration signal). */
export function resolveAssertionGroup(groupId: string): AssertionDefinition[] | null {
  return ASSERTION_GROUPS[groupId] ?? null;
}
