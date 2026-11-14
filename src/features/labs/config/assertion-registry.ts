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

  // ─── Module 6, 9 & 12 Assertions ────────────────────────────────────────────────
  // ─── Module 6 · Lab 8: Lab 1: The Ephemeral Environment (Core Container Lifecycle) ───
  "lab08-checkpoint-1-pull": [
    {
      hint: "Pull the pinned image with: docker pull nginx:1.25-alpine",
      check: 'shell',
      command: "docker images | grep -q 'nginx.*1.25-alpine'",
      expectExitCode: 0,
    },
  ],
  "lab08-checkpoint-2-detached": [
    {
      hint: "Create a container named nginx-bg from nginx:1.25-alpine using docker run -d --name nginx-bg nginx:1.25-alpine.",
      check: 'shell',
      command: "docker ps -a --format '{{.Names}} {{.Image}}' | grep -qE '^nginx-bg .*nginx:1.25-alpine'",
      expectExitCode: 0,
    },
  ],
  "lab08-checkpoint-3-lifecycle-audit": [
    {
      hint: "Export container state to /workspace/container_lifecycle.txt with docker ps -a > /workspace/container_lifecycle.txt.",
      check: 'shell',
      command: "test -s /workspace/container_lifecycle.txt && grep -q 'nginx-bg' /workspace/container_lifecycle.txt",
      expectExitCode: 0,
    },
  ],
  "lab08-checkpoint-4-cleanup-remediate": [
    {
      hint: "Remove rogue-miner (docker rm -f rogue-miner) and start web-prod (docker run -d --name web-prod nginx:1.25-alpine).",
      check: 'shell',
      command: "! docker ps -a --format '{{.Names}}' | grep -qx 'rogue-miner' && docker ps --format '{{.Names}} {{.Status}}' | grep -qE '^web-prod Up'",
      expectExitCode: 0,
    },
  ],
  // ─── Module 6 · Lab 9: Lab 2: Network Bridging and Environment Injection ───
  "lab09-checkpoint-1-web-bridge": [
    {
      hint: "Run: docker run -d --name web-bridge -p 8080:80 nginx:1.25-alpine",
      check: 'shell',
      command: "docker ps --format '{{.Names}} {{.Status}}' | grep -qE '^web-bridge Up' && docker inspect web-bridge | grep -q '8080:80'",
      expectExitCode: 0,
    },
  ],
  "lab09-checkpoint-2-curl-verify": [
    {
      hint: "Run: curl -s http://localhost:8080 > /workspace/bridge_response.html",
      check: 'shell',
      command: "test -s /workspace/bridge_response.html && grep -qi 'Welcome to nginx' /workspace/bridge_response.html",
      expectExitCode: 0,
    },
  ],
  "lab09-checkpoint-3-mysql-secure": [
    {
      hint: "Launch mysql-secure on 3306:3306 with -e MYSQL_ROOT_PASSWORD=SithLord2026.",
      check: 'shell',
      command: "docker ps --format '{{.Names}} {{.Status}}' | grep -qE '^mysql-secure Up' && docker inspect mysql-secure | grep -q 'SithLord2026'",
      expectExitCode: 0,
    },
  ],
  "lab09-checkpoint-4-fix-broken-db": [
    {
      hint: "Remove mysql-broken and launch mysql-prod with MYSQL_ROOT_PASSWORD=SithLord2026.",
      check: 'shell',
      command: "! docker ps -a --format '{{.Names}}' | grep -qx 'mysql-broken' && docker ps --format '{{.Names}} {{.Status}}' | grep -qE '^mysql-prod Up' && docker inspect mysql-prod | grep -q 'SithLord2026'",
      expectExitCode: 0,
    },
  ],
  // ─── Module 6 · Lab 10: Lab 3: Diagnostics and Telemetry (Logs & Exec) ───
  "lab10-checkpoint-1-logs-capture": [
    {
      hint: "Save docker logs --tail 50 web-bridge to /workspace/web_bridge_logs.txt.",
      check: 'shell',
      command: "test -s /workspace/web_bridge_logs.txt && grep -qi 'nginx' /workspace/web_bridge_logs.txt",
      expectExitCode: 0,
    },
  ],
  "lab10-checkpoint-2-nginx-conf-extract": [
    {
      hint: "Extract /etc/nginx/conf.d/default.conf from web-bridge into /workspace/default.conf.",
      check: 'shell',
      command: "test -s /workspace/default.conf && grep -q 'listen' /workspace/default.conf && grep -q 'server_name' /workspace/default.conf",
      expectExitCode: 0,
    },
  ],
  "lab10-checkpoint-3-telemetry-audit": [
    {
      hint: "Run: docker inspect web-bridge > /workspace/telemetry_audit.txt",
      check: 'shell',
      command: "test -s /workspace/telemetry_audit.txt && grep -q 'web-bridge' /workspace/telemetry_audit.txt",
      expectExitCode: 0,
    },
  ],
  "lab10-checkpoint-4-remediate-crash": [
    {
      hint: "Inspect app-crash logs, then start app-healthy with -e APP_PORT=8080 -e DB_HOST=localhost.",
      check: 'shell',
      command: "docker ps --format '{{.Names}} {{.Status}}' | grep -qE '^app-healthy Up' && docker inspect app-healthy | grep -q 'APP_PORT' && docker inspect app-healthy | grep -q 'DB_HOST'",
      expectExitCode: 0,
    },
  ],
  // ─── Module 6 · Lab 11: Lab 4: The Immutable Blueprint (Dockerfile) ───
  "lab11-checkpoint-1-dockerfile-base": [
    {
      hint: "Ensure /workspace/Dockerfile specifies FROM node:20-alpine, ENV NODE_ENV=production, and WORKDIR /app.",
      check: 'shell',
      command: "test -s /workspace/Dockerfile && grep -qE '^FROM[[:space:]]+node:20-alpine' /workspace/Dockerfile && grep -q 'WORKDIR /app' /workspace/Dockerfile && grep -q 'NODE_ENV=production' /workspace/Dockerfile",
      expectExitCode: 0,
    },
  ],
  "lab11-checkpoint-2-dockerfile-layers": [
    {
      hint: "Copy package*.json before full source, run npm install --omit=dev, EXPOSE 3000, and use CMD [\"node\", \"server.js\"].",
      check: 'shell',
      command: "grep -q 'COPY package' /workspace/Dockerfile && grep -q 'npm install' /workspace/Dockerfile && grep -q 'EXPOSE 3000' /workspace/Dockerfile && grep -q 'server.js' /workspace/Dockerfile",
      expectExitCode: 0,
    },
  ],
  "lab11-checkpoint-3-image-built": [
    {
      hint: "Build the image using: docker build -t devopsmentor/node-app:1.0 /workspace",
      check: 'shell',
      command: "docker images | grep -qE 'devopsmentor/node-app[[:space:]]+1.0'",
      expectExitCode: 0,
    },
  ],
  "lab11-checkpoint-4-container-running": [
    {
      hint: "Start node-app-prod on -p 3000:3000 from devopsmentor/node-app:1.0.",
      check: 'shell',
      command: "docker ps --format '{{.Names}} {{.Status}}' | grep -qE '^node-app-prod Up' && curl -s http://localhost:3000 | grep -q 'ok'",
      expectExitCode: 0,
    },
  ],
  // ─── Module 6 · Lab 12: Lab 5: Data Persistence and State (Docker Volumes) ───
  "lab12-checkpoint-1-volume-create": [
    {
      hint: "Run: docker volume create nexus-data",
      check: 'shell',
      command: "docker volume ls -q | grep -qx 'nexus-data'",
      expectExitCode: 0,
    },
  ],
  "lab12-checkpoint-2-persist-record": [
    {
      hint: "Write critical_record to /data/note.txt inside the container mounting nexus-data.",
      check: 'shell',
      command: "grep -q 'critical_record' /var/lib/devopsmentor-docker/volumes/nexus-data/note.txt 2>/dev/null",
      expectExitCode: 0,
    },
  ],
  "lab12-checkpoint-3-survivability": [
    {
      hint: "Remove db-durable and start db-durable-2 mounting nexus-data:/data.",
      check: 'shell',
      command: "! docker ps -a --format '{{.Names}}' | grep -qx 'db-durable' && docker ps --format '{{.Names}} {{.Status}}' | grep -qE '^db-durable-2 Up' && docker inspect db-durable-2 | grep -q 'nexus-data'",
      expectExitCode: 0,
    },
  ],
  "lab12-checkpoint-4-backup-verify": [
    {
      hint: "Run: docker exec db-durable-2 cat /data/note.txt > /workspace/volume_verified.txt",
      check: 'shell',
      command: "test -s /workspace/volume_verified.txt && grep -q 'critical_record' /workspace/volume_verified.txt",
      expectExitCode: 0,
    },
  ],
  // ─── Module 6 · Lab 13: Lab 6: Multi-Container Orchestration (Docker Compose) ───
  "lab13-checkpoint-1-compose-manifest": [
    {
      hint: "Ensure /workspace/docker-compose.yml exposes 8080:80, 5000:5000, MYSQL_ROOT_PASSWORD=SithLord2026, and nexus-data volume.",
      check: 'shell',
      command: "test -s /workspace/docker-compose.yml && grep -q '8080:80' /workspace/docker-compose.yml && grep -q '5000:5000' /workspace/docker-compose.yml && grep -q 'SithLord2026' /workspace/docker-compose.yml && grep -q 'nexus-data' /workspace/docker-compose.yml",
      expectExitCode: 0,
    },
  ],
  "lab13-checkpoint-2-compose-up": [
    {
      hint: "Run cd /workspace && docker compose up -d and verify frontend, backend, database are Up.",
      check: 'shell',
      command: "cd /workspace && docker compose ps | grep -q 'frontend' && docker compose ps | grep -q 'backend' && docker compose ps | grep -q 'database'",
      expectExitCode: 0,
    },
  ],
  "lab13-checkpoint-3-service-dns": [
    {
      hint: "Run: cd /workspace && docker compose exec backend ping -c 2 database > /workspace/dns_ping.txt",
      check: 'shell',
      command: "test -s /workspace/dns_ping.txt && grep -q '2 packets transmitted, 2 packets received' /workspace/dns_ping.txt",
      expectExitCode: 0,
    },
  ],
  "lab13-checkpoint-4-compose-health": [
    {
      hint: "Ensure frontend maps 8080:80 and responds to curl -s http://localhost:8080.",
      check: 'shell',
      command: "curl -s http://localhost:8080 | grep -qi 'Welcome to nginx'",
      expectExitCode: 0,
    },
  ],
  // ─── Module 6 · Lab 14: Lab 7: The Private Registry Gateway (Pushing Images) ───
  "lab14-checkpoint-1-daemon-json": [
    {
      hint: "Add {\"insecure-registries\": [\"registry.internal.local:8082\"]} to /etc/docker/daemon.json.",
      check: 'shell',
      command: "test -s /etc/docker/daemon.json && jq -e '.[\"insecure-registries\"][] | select(. == \"registry.internal.local:8082\")' /etc/docker/daemon.json >/dev/null",
      expectExitCode: 0,
    },
  ],
  "lab14-checkpoint-2-registry-login": [
    {
      hint: "Run: docker login registry.internal.local:8082 -u admin",
      check: 'shell',
      command: "test -s /root/.docker/config.json && grep -q 'registry.internal.local:8082' /root/.docker/config.json",
      expectExitCode: 0,
    },
  ],
  "lab14-checkpoint-3-image-tagged": [
    {
      hint: "Tag with: docker tag devopsmentor/node-app:1.0 registry.internal.local:8082/devopsmentor/node-app:1.0",
      check: 'shell',
      command: "docker images | grep -q 'registry.internal.local:8082/devopsmentor/node-app'",
      expectExitCode: 0,
    },
  ],
  "lab14-checkpoint-4-image-pushed": [
    {
      hint: "Push with: docker push registry.internal.local:8082/devopsmentor/node-app:1.0",
      check: 'shell',
      command: "grep -q 'registry.internal.local:8082/devopsmentor/node-app:1.0' /var/lib/devopsmentor-docker/state.json && python3 -c \"import json; d=json.load(open('/var/lib/devopsmentor-docker/state.json')); assert 'registry.internal.local:8082/devopsmentor/node-app:1.0' in d.get('registry',{})\"",
      expectExitCode: 0,
    },
  ],
  // ─── Module 6 · Lab 15: Lab 8: Infrastructure as a Container (Deploying Sonatype Nexus) ───
  "lab15-checkpoint-1-nexus-volume": [
    {
      hint: "Run: docker volume create nexus-repo-data",
      check: 'shell',
      command: "docker volume ls -q | grep -qx 'nexus-repo-data'",
      expectExitCode: 0,
    },
  ],
  "lab15-checkpoint-2-nexus-container": [
    {
      hint: "Launch nexus with -p 8081:8081 -v nexus-repo-data:/nexus-data sonatype/nexus3:latest.",
      check: 'shell',
      command: "docker ps --format '{{.Names}} {{.Status}}' | grep -qE '^nexus Up' && docker inspect nexus | grep -q '8081:8081' && docker inspect nexus | grep -q 'nexus-repo-data'",
      expectExitCode: 0,
    },
  ],
  "lab15-checkpoint-3-nexus-startup-logs": [
    {
      hint: "Save docker logs nexus into /workspace/nexus_boot.log.",
      check: 'shell',
      command: "test -s /workspace/nexus_boot.log && grep -q 'Started Sonatype Nexus' /workspace/nexus_boot.log",
      expectExitCode: 0,
    },
  ],
  "lab15-checkpoint-4-nexus-http-ready": [
    {
      hint: "Run: curl -sI http://localhost:8081 > /workspace/nexus_headers.txt",
      check: 'shell',
      command: "test -s /workspace/nexus_headers.txt && grep -q '200 OK' /workspace/nexus_headers.txt && curl -sI http://localhost:8081 | grep -q '200 OK'",
      expectExitCode: 0,
    },
  ],
  // ─── Module 9 · Lab 16: Lab 1: Control Plane Initialization and Imperative Mechanics ───
  "lab16-checkpoint-1-minikube-ready": [
    {
      hint: "Initialize the cluster with: minikube start --driver=docker",
      check: 'shell',
      command: "kubectl get nodes | grep -q 'minikube.*Ready'",
      expectExitCode: 0,
    },
  ],
  "lab16-checkpoint-2-control-plane-audit": [
    {
      hint: "Save kubectl cluster-info and kubectl get nodes -o wide into /workspace/cluster_status.txt.",
      check: 'shell',
      command: "test -s /workspace/cluster_status.txt && grep -q 'minikube' /workspace/cluster_status.txt && grep -q 'Kubernetes control plane' /workspace/cluster_status.txt",
      expectExitCode: 0,
    },
  ],
  "lab16-checkpoint-3-py-probe-pod": [
    {
      hint: "Run kubectl run py-probe and save kubectl logs py-probe into /workspace/py_probe.log.",
      check: 'shell',
      command: "test -s /workspace/py_probe.log && grep -q '3\\.' /workspace/py_probe.log",
      expectExitCode: 0,
    },
  ],
  "lab16-checkpoint-4-cleanup-broken-pod": [
    {
      hint: "Delete py-probe with kubectl delete pod py-probe and verify kube-apiserver-minikube is Running.",
      check: 'shell',
      command: "! kubectl get pod py-probe >/dev/null 2>&1 && kubectl get pods -n kube-system | grep -q 'kube-apiserver-minikube.*Running'",
      expectExitCode: 0,
    },
  ],
  // ─── Module 9 · Lab 17: Lab 2: Declarative Topologies and Service Discovery ───
  "lab17-checkpoint-1-fastapi-deployment": [
    {
      hint: "Apply /workspace/deployment.yaml with replicas: 3 and image tiangolo/uvicorn-gunicorn-fastapi:python3.11.",
      check: 'shell',
      command: "kubectl get deployment fastapi-deployment -o json | jq -e '.replicas == 3' >/dev/null && ! kubectl get deployment fastapi-deployment -o json | jq -r '.image' | grep -q 'broken'",
      expectExitCode: 0,
    },
  ],
  "lab17-checkpoint-2-clusterip-service": [
    {
      hint: "Apply /workspace/service-clusterip.yaml creating fastapi-clusterip targeting app: fastapi.",
      check: 'shell',
      command: "kubectl get svc fastapi-clusterip >/dev/null 2>&1 && kubectl get endpoints fastapi-clusterip | grep -q '10.244.'",
      expectExitCode: 0,
    },
  ],
  "lab17-checkpoint-3-nodeport-service": [
    {
      hint: "Apply /workspace/service-nodeport.yaml creating fastapi-nodeport with nodePort: 30080.",
      check: 'shell',
      command: "kubectl get svc fastapi-nodeport | grep -q 'NodePort' && kubectl get svc fastapi-nodeport | grep -q '30080'",
      expectExitCode: 0,
    },
  ],
  "lab17-checkpoint-4-rollout-recovery": [
    {
      hint: "Test rollout undo and confirm kubectl rollout status deployment/fastapi-deployment succeeds.",
      check: 'shell',
      command: "kubectl rollout status deployment/fastapi-deployment >/dev/null 2>&1 && kubectl rollout history deployment/fastapi-deployment | grep -q 'REVISION'",
      expectExitCode: 0,
    },
  ],
  // ─── Module 9 · Lab 18: Lab 3: State Decoupling, Secrets, and Volume Persistency ───
  "lab18-checkpoint-1-secret-configmap": [
    {
      hint: "Apply secret.yaml (redis-secret) and configmap.yaml (app-config).",
      check: 'shell',
      command: "kubectl get secret redis-secret >/dev/null 2>&1 && kubectl get configmap app-config >/dev/null 2>&1",
      expectExitCode: 0,
    },
  ],
  "lab18-checkpoint-2-pv-pvc-bound": [
    {
      hint: "Apply /workspace/pv-pvc.yaml and verify kubectl get pv,pvc shows Bound.",
      check: 'shell',
      command: "kubectl get pv redis-pv | grep -q 'Bound' && kubectl get pvc redis-pvc | grep -q 'Bound'",
      expectExitCode: 0,
    },
  ],
  "lab18-checkpoint-3-redis-deployment": [
    {
      hint: "Apply /workspace/redis-deployment.yaml mounting redis-pvc at /data.",
      check: 'shell',
      command: "kubectl get deploy redis-deployment >/dev/null 2>&1 && kubectl get pods | grep -q 'redis-deployment.*Running'",
      expectExitCode: 0,
    },
  ],
  "lab18-checkpoint-4-redis-persistence": [
    {
      hint: "Use kubectl exec <pod> -- redis-cli SET test_key \"persistence_verified\", delete pod, and confirm persistence.",
      check: 'shell',
      command: "test -f /var/lib/devopsmentor-k8s/pvc/redis-pvc/redis_kv.json && grep -q 'persistence_verified' /var/lib/devopsmentor-k8s/pvc/redis-pvc/redis_kv.json",
      expectExitCode: 0,
    },
  ],
  // ─── Module 9 · Lab 19: Lab 4: Multi-Tenancy Isolation and Ingress Routing ───
  "lab19-checkpoint-1-namespaces": [
    {
      hint: "Create staging and production Namespaces via /workspace/namespace.yaml.",
      check: 'shell',
      command: "kubectl get ns staging >/dev/null 2>&1 && kubectl get ns production >/dev/null 2>&1",
      expectExitCode: 0,
    },
  ],
  "lab19-checkpoint-2-staging-workload": [
    {
      hint: "Deploy fastapi-deployment and fastapi-clusterip inside the staging namespace.",
      check: 'shell',
      command: "kubectl get deploy fastapi-deployment -n staging >/dev/null 2>&1 && kubectl get svc fastapi-clusterip -n staging >/dev/null 2>&1",
      expectExitCode: 0,
    },
  ],
  "lab19-checkpoint-3-ingress-addon": [
    {
      hint: "Run minikube addons enable ingress and apply /workspace/ingress.yaml in staging.",
      check: 'shell',
      command: "minikube addons list | grep -q 'ingress.*enabled' && kubectl get ingress fastapi-ingress -n staging | grep -q 'api.devopsmentor.local'",
      expectExitCode: 0,
    },
  ],
  "lab19-checkpoint-4-ingress-route-test": [
    {
      hint: "Save curl -H \"Host: api.devopsmentor.local\" http://$(minikube ip)/api into /workspace/ingress_verify.txt.",
      check: 'shell',
      command: "test -s /workspace/ingress_verify.txt && grep -qi 'fastapi' /workspace/ingress_verify.txt",
      expectExitCode: 0,
    },
  ],
  // ─── Module 9 · Lab 20: Lab 5: API Security and Role-Based Access Control (RBAC) ───
  "lab20-checkpoint-1-service-account": [
    {
      hint: "Run: kubectl create serviceaccount developer-sa -n staging",
      check: 'shell',
      command: "kubectl get sa developer-sa -n staging >/dev/null 2>&1",
      expectExitCode: 0,
    },
  ],
  "lab20-checkpoint-2-role-binding": [
    {
      hint: "Bind developer-role (get/list/watch pods, deployments) to developer-sa in staging.",
      check: 'shell',
      command: "kubectl auth can-i list pods --as=system:serviceaccount:staging:developer-sa -n staging | grep -q 'yes' && ! kubectl auth can-i delete pods --as=system:serviceaccount:staging:developer-sa -n staging >/dev/null 2>&1",
      expectExitCode: 0,
    },
  ],
  "lab20-checkpoint-3-cluster-role-binding": [
    {
      hint: "Apply node-auditor-role ClusterRole & developer-node-auditor ClusterRoleBinding.",
      check: 'shell',
      command: "kubectl auth can-i list nodes --as=system:serviceaccount:staging:developer-sa | grep -q 'yes'",
      expectExitCode: 0,
    },
  ],
  "lab20-checkpoint-4-rbac-audit-token": [
    {
      hint: "Run: kubectl create token developer-sa -n staging > /workspace/developer_token.jwt",
      check: 'shell',
      command: "test -s /workspace/developer_token.jwt && grep -q '\\.' /workspace/developer_token.jwt",
      expectExitCode: 0,
    },
  ],
  // ─── Module 9 · Lab 21: Lab 6: Production Hardening and Pod Lifecycle Probes ───
  "lab21-checkpoint-1-resource-quotas": [
    {
      hint: "Set requests (250m/256Mi) and limits (500m/512Mi) on fastapi-deployment in staging.",
      check: 'shell',
      command: "kubectl get deploy fastapi-deployment -n staging -o yaml | grep -q '250m' && kubectl get deploy fastapi-deployment -n staging -o yaml | grep -q '512Mi'",
      expectExitCode: 0,
    },
  ],
  "lab21-checkpoint-2-health-probes": [
    {
      hint: "Configure httpGet readinessProbe and livenessProbe on path /healthz port 80.",
      check: 'shell',
      command: "kubectl get deploy fastapi-deployment -n staging -o yaml | grep -q '/healthz'",
      expectExitCode: 0,
    },
  ],
  "lab21-checkpoint-3-graceful-shutdown": [
    {
      hint: "Set terminationGracePeriodSeconds: 30 and preStop sleep 5 in fastapi-deployment.",
      check: 'shell',
      command: "kubectl get deploy fastapi-deployment -n staging -o yaml | grep -q 'terminationGracePeriodSeconds: 30' && kubectl get deploy fastapi-deployment -n staging -o yaml | grep -q 'sleep 5'",
      expectExitCode: 0,
    },
  ],
  "lab21-checkpoint-4-metrics-top": [
    {
      hint: "Run minikube addons enable metrics-server and save kubectl top pods -n staging to /workspace/pod_metrics.txt.",
      check: 'shell',
      command: "minikube addons list | grep -q 'metrics-server.*enabled' && test -s /workspace/pod_metrics.txt && grep -q 'CPU' /workspace/pod_metrics.txt",
      expectExitCode: 0,
    },
  ],
  // ─── Module 9 · Lab 22: Lab 7: Custom Helm Chart Blueprinting ───
  "lab22-checkpoint-1-chart-scaffold": [
    {
      hint: "Create /workspace/microservice-chart with tiangolo/uvicorn-gunicorn-fastapi in values.yaml.",
      check: 'shell',
      command: "test -s /workspace/microservice-chart/Chart.yaml && grep -q 'uvicorn-gunicorn-fastapi' /workspace/microservice-chart/values.yaml",
      expectExitCode: 0,
    },
  ],
  "lab22-checkpoint-2-template-env-loop": [
    {
      hint: "Use range .Values.env in templates/deployment.yaml and run helm lint /workspace/microservice-chart.",
      check: 'shell',
      command: "grep -q 'range .Values.env' /workspace/microservice-chart/templates/deployment.yaml && helm lint /workspace/microservice-chart >/dev/null 2>&1",
      expectExitCode: 0,
    },
  ],
  "lab22-checkpoint-3-helm-install": [
    {
      hint: "Install release with helm install fast-api-release /workspace/microservice-chart -n staging --create-namespace.",
      check: 'shell',
      command: "helm list -n staging | grep -q 'fast-api-release'",
      expectExitCode: 0,
    },
  ],
  "lab22-checkpoint-4-helm-upgrade": [
    {
      hint: "Run helm upgrade fast-api-release /workspace/microservice-chart -n staging --set replicaCount=3.",
      check: 'shell',
      command: "helm history fast-api-release -n staging | grep -q '^2' && kubectl get deploy -n staging -o json | grep -q '\"replicas\": 3'",
      expectExitCode: 0,
    },
  ],
  // ─── Module 9 · Lab 23: Lab 8: Declarative Multi-Service Orchestration via Helmfile ───
  "lab23-checkpoint-1-values-matrix": [
    {
      hint: "Create api-staging.yaml, redis-staging.yaml, api-production.yaml, redis-production.yaml under /workspace/values/.",
      check: 'shell',
      command: "test -s /workspace/values/api-staging.yaml && test -s /workspace/values/redis-staging.yaml && test -s /workspace/values/api-production.yaml && test -s /workspace/values/redis-production.yaml",
      expectExitCode: 0,
    },
  ],
  "lab23-checkpoint-2-helmfile-manifest": [
    {
      hint: "Define fastapi-staging, redis-staging, fastapi-production, and redis-production in /workspace/helmfile.yaml.",
      check: 'shell',
      command: "test -s /workspace/helmfile.yaml && grep -q 'fastapi-staging' /workspace/helmfile.yaml && grep -q 'redis-production' /workspace/helmfile.yaml",
      expectExitCode: 0,
    },
  ],
  "lab23-checkpoint-3-helmfile-sync": [
    {
      hint: "Run cd /workspace && helmfile sync and confirm all 4 releases appear in helm list -A.",
      check: 'shell',
      command: "helm list -A | grep -q 'fastapi-staging' && helm list -A | grep -q 'redis-staging' && helm list -A | grep -q 'fastapi-production' && helm list -A | grep -q 'redis-production'",
      expectExitCode: 0,
    },
  ],
  "lab23-checkpoint-4-helm-rollback": [
    {
      hint: "Verify fastapi-staging rollback history and save helmfile status into /workspace/helmfile_status.txt.",
      check: 'shell',
      command: "helm history fastapi-staging -n staging | grep -qi 'Rollback' && test -s /workspace/helmfile_status.txt",
      expectExitCode: 0,
    },
  ],
  // ─── Module 12 · Lab 24: Lab 1: The Execution Environment (Types, Casting & Env Vars) ───
  "lab24-checkpoint-1-strict-port": [
    {
      hint: "Write /workspace/strict_port_check.py casting \"8080\" to int() and printing 8081.",
      check: 'shell',
      command: "python3 /workspace/strict_port_check.py | grep -q '8081'",
      expectExitCode: 0,
    },
  ],
  "lab24-checkpoint-2-env-credentials": [
    {
      hint: "Ensure /workspace/env_credential_check.py uses os.environ.get(\"DEPLOY_REGION\", \"us-east-1\").",
      check: 'shell',
      command: "python3 /workspace/env_credential_check.py | grep -q 'us-east-1'",
      expectExitCode: 0,
    },
  ],
  "lab24-checkpoint-3-secret-masking": [
    {
      hint: "Mask api_key as f\"{api_key[:4]}****\" in /workspace/env_credential_check.py.",
      check: 'shell',
      command: "DEVOPSMENTOR_API_KEY='dm_live_98a76b54c321' python3 /workspace/env_credential_check.py | grep -q 'dm_l\\*\\*\\*\\*'",
      expectExitCode: 0,
    },
  ],
  "lab24-checkpoint-4-fix-type-bug": [
    {
      hint: "Fix the TypeError in /workspace/port_validator.py so python3 /workspace/port_validator.py prints 8081.",
      check: 'shell',
      command: "python3 /workspace/port_validator.py | grep -q '8081'",
      expectExitCode: 0,
    },
  ],
  // ─── Module 12 · Lab 25: Lab 2: Deterministic Control Flow (Threshold Gates) ───
  "lab25-checkpoint-1-cpu-gate": [
    {
      hint: "Write /workspace/cpu_gate.py evaluating CPU_THRESHOLD = 80.0.",
      check: 'shell',
      command: "python3 /workspace/cpu_gate.py | grep -q 'CRITICAL'",
      expectExitCode: 0,
    },
  ],
  "lab25-checkpoint-2-multi-metric": [
    {
      hint: "Use if, elif, and \"and\" boolean conjunction inside /workspace/multi_metric_gate.py.",
      check: 'shell',
      command: "test -s /workspace/multi_metric_gate.py && grep -q 'and' /workspace/multi_metric_gate.py && grep -q 'elif' /workspace/multi_metric_gate.py",
      expectExitCode: 0,
    },
  ],
  "lab25-checkpoint-3-pass-branch": [
    {
      hint: "Set disk_free_gb = 12.5 in /workspace/multi_metric_gate.py so [PASS] is printed.",
      check: 'shell',
      command: "python3 /workspace/multi_metric_gate.py | grep -q '\\[PASS\\] All pre-deployment checks succeeded'",
      expectExitCode: 0,
    },
  ],
  "lab25-checkpoint-4-fix-gate-logic": [
    {
      hint: "Change \"or\" to \"and\" in /workspace/rollout_guard.py so CPU 92.5 aborts rollout.",
      check: 'shell',
      command: "python3 /workspace/rollout_guard.py | grep -q '\\[ABORT\\]'",
      expectExitCode: 0,
    },
  ],
  // ─── Module 12 · Lab 26: Lab 3: Structural Aggregation (Lists, Sets, Dicts & Comprehensions) ───
  "lab26-checkpoint-1-dedupe-ips": [
    {
      hint: "Deduplicate IPs in /workspace/dedupe_ips.py using set().",
      check: 'shell',
      command: "python3 /workspace/dedupe_ips.py | grep -q 'Unique servers (4)'",
      expectExitCode: 0,
    },
  ],
  "lab26-checkpoint-2-hostname-roles": [
    {
      hint: "Update db-prod-01 role to \"replica-db\" in /workspace/hostname_roles.py.",
      check: 'shell',
      command: "python3 /workspace/hostname_roles.py | grep -q 'replica-db'",
      expectExitCode: 0,
    },
  ],
  "lab26-checkpoint-3-env-topology": [
    {
      hint: "Append \"10.0.1.12\" to production web_tiers in /workspace/environment_topology.py.",
      check: 'shell',
      command: "python3 /workspace/environment_topology.py | grep -q '10.0.1.12'",
      expectExitCode: 0,
    },
  ],
  "lab26-checkpoint-4-filter-outdated": [
    {
      hint: "Filter versions != \"2.6.0\" in /workspace/filter_outdated_servers.py.",
      check: 'shell',
      command: "python3 /workspace/filter_outdated_servers.py | grep -q 'web-02' && ! python3 /workspace/filter_outdated_servers.py | grep -q 'web-01'",
      expectExitCode: 0,
    },
  ],
  // ─── Module 12 · Lab 27: Lab 4: Iteration and Functional Abstraction ───
  "lab27-checkpoint-1-provision-loop": [
    {
      hint: "Define provision_server() in /workspace/provision_servers.py and iterate target_ips including 10.0.1.12.",
      check: 'shell',
      command: "python3 /workspace/provision_servers.py | grep -q '10.0.1.12'",
      expectExitCode: 0,
    },
  ],
  "lab27-checkpoint-2-health-poll": [
    {
      hint: "Write /workspace/health_poll.py polling until \"Service passed health check\".",
      check: 'shell',
      command: "python3 /workspace/health_poll.py | grep -q 'Service passed health check'",
      expectExitCode: 0,
    },
  ],
  "lab27-checkpoint-3-typed-provision": [
    {
      hint: "Write /workspace/provision_typed.py with (ip: str) -> bool printing 3/3 servers healthy.",
      check: 'shell',
      command: "grep -q 'ip: str' /workspace/provision_typed.py && python3 /workspace/provision_typed.py | grep -q '3/3 servers healthy'",
      expectExitCode: 0,
    },
  ],
  "lab27-checkpoint-4-fix-infinite-loop": [
    {
      hint: "Add attempt += 1 inside the loop in /workspace/retry_worker.py.",
      check: 'shell',
      command: "python3 /workspace/retry_worker.py | grep -q 'Worker completed cleanly'",
      expectExitCode: 0,
    },
  ],
  // ─── Module 12 · Lab 28: Lab 5: Anticipating Catastrophe (Exception Handling & Custom Errors) ───
  "lab28-checkpoint-1-resilient-cast": [
    {
      hint: "Catch ValueError in /workspace/resilient_capacity_input.py and print Invalid numeric input.",
      check: 'shell',
      command: "python3 /workspace/resilient_capacity_input.py | grep -q 'Invalid numeric input'",
      expectExitCode: 0,
    },
  ],
  "lab28-checkpoint-2-custom-exception": [
    {
      hint: "Define class DeploymentError(Exception) and def request_capacity in /workspace/deployment_error.py.",
      check: 'shell',
      command: "grep -q 'class DeploymentError(Exception)' /workspace/deployment_error.py && grep -q 'def request_capacity' /workspace/deployment_error.py",
      expectExitCode: 0,
    },
  ],
  "lab28-checkpoint-3-guard-clauses": [
    {
      hint: "Verify deployment_error.py prints Deployment aborted for 25 and handles 4 replicas cleanly.",
      check: 'shell',
      command: "python3 /workspace/deployment_error.py | grep -q 'Deployment aborted' && python3 /workspace/deployment_error.py | grep -q '4 replicas'",
      expectExitCode: 0,
    },
  ],
  "lab28-checkpoint-4-fix-unhandled-crash": [
    {
      hint: "Handle missing replicas key in /workspace/config_loader.py so it prints replicas=1.",
      check: 'shell',
      command: "python3 /workspace/config_loader.py | grep -q 'replicas=1'",
      expectExitCode: 0,
    },
  ],
  // ─── Module 12 · Lab 29: Lab 6: The Operating System Interface (os, subprocess & File I/O) ───
  "lab29-checkpoint-1-makedirs": [
    {
      hint: "Write /workspace/create_deploy_dirs.py calling os.makedirs(\"/opt/devopsmentor/releases/v1.4.2\", exist_ok=True).",
      check: 'shell',
      command: "python3 /workspace/create_deploy_dirs.py >/dev/null && test -d /opt/devopsmentor/releases/v1.4.2",
      expectExitCode: 0,
    },
  ],
  "lab29-checkpoint-2-subprocess-df": [
    {
      hint: "Run subprocess.run([\"df\", \"-h\"], capture_output=True, text=True, check=True) in /workspace/disk_usage_check.py.",
      check: 'shell',
      command: "python3 /workspace/disk_usage_check.py | grep -q 'Filesystem'",
      expectExitCode: 0,
    },
  ],
  "lab29-checkpoint-3-log-context-mgr": [
    {
      hint: "Write /workspace/log_disk_usage.py saving DISK USAGE SNAPSHOT into /workspace/disk_usage.log.",
      check: 'shell',
      command: "python3 /workspace/log_disk_usage.py >/dev/null && grep -q 'DISK USAGE SNAPSHOT' /workspace/disk_usage.log",
      expectExitCode: 0,
    },
  ],
  "lab29-checkpoint-4-cleanup-broken-script": [
    {
      hint: "Add capture_output=True, text=True to subprocess.run inside /workspace/audit_runner.py.",
      check: 'shell',
      command: "python3 /workspace/audit_runner.py | grep -q 'AUDIT_OK'",
      expectExitCode: 0,
    },
  ],
  // ─── Module 12 · Lab 30: Lab 7: Data Serialization and Payloads (JSON) ───
  "lab30-checkpoint-1-json-loads": [
    {
      hint: "Write /workspace/ingest_config.py using json.loads() and printing Replicas: 2.",
      check: 'shell',
      command: "python3 /workspace/ingest_config.py | grep -q 'Replicas: 2'",
      expectExitCode: 0,
    },
  ],
  "lab30-checkpoint-2-json-dumps": [
    {
      hint: "Include \"deployed_by\": \"devopsmentor-ci\" via json.dumps(..., indent=4).",
      check: 'shell',
      command: "python3 /workspace/mutate_and_serialize.py | grep -q 'devopsmentor-ci'",
      expectExitCode: 0,
    },
  ],
  "lab30-checkpoint-3-file-roundtrip": [
    {
      hint: "Run /workspace/config_file_roundtrip.py to update /workspace/config.json replicas to 3.",
      check: 'shell',
      command: "python3 /workspace/config_file_roundtrip.py >/dev/null && grep -q '\"replicas\": 3' /workspace/config.json",
      expectExitCode: 0,
    },
  ],
  "lab30-checkpoint-4-fix-corrupt-json": [
    {
      hint: "Fix single quotes & trailing comma in /workspace/broken_payload.json.",
      check: 'shell',
      command: "python3 -m json.tool /workspace/broken_payload.json >/dev/null 2>&1",
      expectExitCode: 0,
    },
  ],
  // ─── Module 12 · Lab 31: Lab 8: Architectural Modularity (Modules, Imports & Packages) ───
  "lab31-checkpoint-1-network-utils": [
    {
      hint: "Create /workspace/network_utils.py with def build_connection_string(host, port, database).",
      check: 'shell',
      command: "test -s /workspace/network_utils.py && grep -q 'def build_connection_string' /workspace/network_utils.py",
      expectExitCode: 0,
    },
  ],
  "lab31-checkpoint-2-main-import": [
    {
      hint: "Create /workspace/main.py outputting postgresql://db-prod-01.internal:5432/devopsmentor_prod.",
      check: 'shell',
      command: "python3 /workspace/main.py | grep -q 'postgresql://db-prod-01.internal:5432/devopsmentor_prod'",
      expectExitCode: 0,
    },
  ],
  "lab31-checkpoint-3-requests-verify": [
    {
      hint: "Write /workspace/verify_requests_install.py printing Requests library version.",
      check: 'shell',
      command: "python3 /workspace/verify_requests_install.py | grep -q 'Requests library version'",
      expectExitCode: 0,
    },
  ],
  "lab31-checkpoint-4-fix-circular-import": [
    {
      hint: "Run python3 /workspace/service_runner.py after network_utils.py exists.",
      check: 'shell',
      command: "python3 /workspace/service_runner.py | grep -q 'RUNNER_OK'",
      expectExitCode: 0,
    },
  ],
  // ─── Module 12 · Lab 32: Lab 9: Object Oriented Infrastructure (Classes, Inheritance & __str__) ───
  "lab32-checkpoint-1-server-class": [
    {
      hint: "Write /workspace/server.py instantiating web-prod-01.",
      check: 'shell',
      command: "python3 /workspace/server.py | grep -q 'web-prod-01'",
      expectExitCode: 0,
    },
  ],
  "lab32-checkpoint-2-lifecycle-methods": [
    {
      hint: "Implement boot() and shutdown() methods in /workspace/server_lifecycle.py.",
      check: 'shell',
      command: "python3 /workspace/server_lifecycle.py | grep -q 'Booted' && python3 /workspace/server_lifecycle.py | grep -q 'offline'",
      expectExitCode: 0,
    },
  ],
  "lab32-checkpoint-3-inheritance-db": [
    {
      hint: "Subclass Server with super().__init__ in /workspace/database_server.py.",
      check: 'shell',
      command: "python3 /workspace/database_server.py | grep -q 'Backup completed'",
      expectExitCode: 0,
    },
  ],
  "lab32-checkpoint-4-dunder-str": [
    {
      hint: "Return <Server hostname=web-prod-01 ...> from __str__ in /workspace/server_str.py.",
      check: 'shell',
      command: "python3 /workspace/server_str.py | grep -q '<Server hostname=web-prod-01'",
      expectExitCode: 0,
    },
  ],
  // ─── Module 12 · Lab 33: Lab 10: Advanced Execution Control (Decorators & Retry Loops) ───
  "lab33-checkpoint-1-basic-wrapper": [
    {
      hint: "Write /workspace/basic_wrapper.py with @logging_wrapper printing Starting execution.",
      check: 'shell',
      command: "python3 /workspace/basic_wrapper.py | grep -q 'Starting execution'",
      expectExitCode: 0,
    },
  ],
  "lab33-checkpoint-2-timer-decorator": [
    {
      hint: "Write /workspace/timer_decorator.py using functools.wraps and time.perf_counter.",
      check: 'shell',
      command: "python3 /workspace/timer_decorator.py | grep -q 'Duration:'",
      expectExitCode: 0,
    },
  ],
  "lab33-checkpoint-3-retry-decorator": [
    {
      hint: "Implement @retry(max_attempts=3) in /workspace/retry_decorator.py printing Pipeline succeeded.",
      check: 'shell',
      command: "python3 /workspace/retry_decorator.py | grep -q 'Pipeline succeeded'",
      expectExitCode: 0,
    },
  ],
  "lab33-checkpoint-4-fix-wrapper-return": [
    {
      hint: "Add return before func(*args, **kwargs) in /workspace/broken_decorator.py.",
      check: 'shell',
      command: "python3 /workspace/broken_decorator.py | grep -q 'DEPLOY_VERSION=2.6.0'",
      expectExitCode: 0,
    },
  ],
  // ─── Module 12 · Lab 34: Lab 11: The Remote API Gateway (REST Clients & Requests) ───
  "lab34-checkpoint-1-get-status": [
    {
      hint: "Write /workspace/parse_status.py fetching https://api.devopsmentor.io/v1/status.",
      check: 'shell',
      command: "python3 /workspace/parse_status.py | grep -q 'operational'",
      expectExitCode: 0,
    },
  ],
  "lab34-checkpoint-2-post-trigger": [
    {
      hint: "Send authenticated POST in /workspace/trigger_pipeline.py returning run_884201f.",
      check: 'shell',
      command: "python3 /workspace/trigger_pipeline.py | grep -q 'run_884201f'",
      expectExitCode: 0,
    },
  ],
  "lab34-checkpoint-3-raise-for-status": [
    {
      hint: "Catch requests.exceptions.HTTPError on /v1/pipelines/nonexistent in /workspace/safe_pipeline_check.py.",
      check: 'shell',
      command: "python3 /workspace/safe_pipeline_check.py | grep -q '404'",
      expectExitCode: 0,
    },
  ],
  "lab34-checkpoint-4-save-api-audit": [
    {
      hint: "Save API telemetry containing run_884201f into /workspace/api_gateway_audit.json.",
      check: 'shell',
      command: "test -s /workspace/api_gateway_audit.json && grep -q 'run_884201f' /workspace/api_gateway_audit.json",
      expectExitCode: 0,
    },
  ],
  // ─── Module 12 · Lab 35: Lab 12: Infrastructure as a Service (Building a Flask Webhook API) ───
  "lab35-checkpoint-1-flask-verify": [
    {
      hint: "Write /workspace/verify_flask_install.py printing Flask version.",
      check: 'shell',
      command: "python3 /workspace/verify_flask_install.py | grep -q 'Flask version'",
      expectExitCode: 0,
    },
  ],
  "lab35-checkpoint-2-flask-app-code": [
    {
      hint: "Implement GET /health and POST /deploy inside /workspace/app.py.",
      check: 'shell',
      command: "test -s /workspace/app.py && grep -q '/health' /workspace/app.py && grep -q '/deploy' /workspace/app.py",
      expectExitCode: 0,
    },
  ],
  "lab35-checkpoint-3-flask-daemon-up": [
    {
      hint: "Launch python3 /workspace/app.py on port 5000 and verify GET /health returns devopsmentor-webhook.",
      check: 'shell',
      command: "curl -s http://127.0.0.1:5000/health | grep -q 'devopsmentor-webhook'",
      expectExitCode: 0,
    },
  ],
  "lab35-checkpoint-4-webhook-post-test": [
    {
      hint: "POST {\"target\":\"production\"} to http://127.0.0.1:5000/deploy > /workspace/webhook_response.json.",
      check: 'shell',
      command: "test -s /workspace/webhook_response.json && grep -Eq '\"received\": *true' /workspace/webhook_response.json",
      expectExitCode: 0,
    },
  ],
};

/** Unknown group ids produce an honest FAIL (misconfiguration signal). */
export function resolveAssertionGroup(groupId: string): AssertionDefinition[] | null {
  return ASSERTION_GROUPS[groupId] ?? null;
}
