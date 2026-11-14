import dotenv from 'dotenv';
import { and, eq, inArray } from 'drizzle-orm';
import {
  academyCourses,
  activityLogs,
  categories,
  db,
  difficultyLevels,
  disconnectDatabase,
  labs,
  lessons,
  modules,
  permissions,
  proLabs,
  pwnboxInstances,
  rolePermissions,
  roles,
  trackContent,
  tracks,
  vpnAssignments,
  vpnServers,
} from '../src/app/database';
import { PERMISSIONS, ROLES } from '../src/shared/constants';

dotenv.config();

interface LabSeedItem {
  labId: number;
  moduleNumber: number;
  lessonOrder: number;
  labName: string;
  slug: string;
  description: string;
  difficultyName: string;
  estimatedHours: number;
  flagValues: Record<string, string>;
}

const ALL_MODULES = [
  {
    "moduleOrder": 1,
    "title": "Module 1: Operating System & Linux Basics",
    "description": "Foundational Linux systems engineering: kernel & process lifecycle, FHS storage layout, CLI file operations, package management & Vim, users/groups/permissions, pipes & Bash scripting, and networking/SSH security.",
    "estimatedMinutes": 315
  },
  {
    "moduleOrder": 2,
    "title": "Module 2: Computer Networking & DNS",
    "description": "TCP/IP routing, subnetting, HTTP/TLS internals, DNS resolution, and troubleshooting.",
    "estimatedMinutes": 180
  },
  {
    "moduleOrder": 3,
    "title": "Module 3: Git & Distributed Version Control",
    "description": "Branching workflows, rebasing, merge conflict resolution, and Git hooks.",
    "estimatedMinutes": 180
  },
  {
    "moduleOrder": 4,
    "title": "Module 4: Build Tools & Artifact Repositories",
    "description": "Build lifecycles, package managers, semantic versioning, and Sonatype Nexus storage.",
    "estimatedMinutes": 180
  },
  {
    "moduleOrder": 5,
    "title": "Module 5: Cloud Infrastructure & IaaS Basics",
    "description": "Virtual machines, cloud storage, VPC networking, and cloud security groups.",
    "estimatedMinutes": 180
  },
  {
    "moduleOrder": 6,
    "title": "Module 6: Containers with Docker",
    "description": "Master ephemeral container lifecycles, port bridging and environment injection, container diagnostics, immutable Dockerfile authoring, stateful Docker volumes, multi-tier Compose orchestration, private registries, and Nexus deployment.",
    "estimatedMinutes": 360
  },
  {
    "moduleOrder": 7,
    "title": "Module 7: CI/CD Pipelines with Jenkins",
    "description": "Declarative Jenkinsfiles, automated test gates, build agents, and artifact promotion.",
    "estimatedMinutes": 240
  },
  {
    "moduleOrder": 8,
    "title": "Module 8: AWS Cloud Services & Architecture",
    "description": "EC2, IAM, S3, RDS, VPC, CloudWatch, and resilient multi-AZ architectures.",
    "estimatedMinutes": 300
  },
  {
    "moduleOrder": 9,
    "title": "Module 9: Core Kubernetes Container Orchestration",
    "description": "Initialize Kubernetes control planes, build Deployments and ClusterIP/NodePort Services, decouple state with ConfigMaps/Secrets/PVCs, configure Ingress routing and RBAC, harden health probes, package Helm charts, and orchestrate multi-environment releases via Helmfile.",
    "estimatedMinutes": 480
  },
  {
    "moduleOrder": 10,
    "title": "Module 10: Managed Kubernetes (Amazon EKS)",
    "description": "Production EKS provisioning, IAM IRSA, cluster autoscaling, and AWS Load Balancer Controller.",
    "estimatedMinutes": 240
  },
  {
    "moduleOrder": 11,
    "title": "Module 11: Infrastructure as Code with Terraform",
    "description": "Declarative HCL modules, remote state backends, workspaces, and drift remediation.",
    "estimatedMinutes": 240
  },
  {
    "moduleOrder": 12,
    "title": "Module 12: Programming with Python for DevOps",
    "description": "Automate DevOps engineering workflows with strict typing and environment secrets, control-flow validation gates, collections and comprehensions, resilient exception handling, OS/subprocess automation, JSON serialization, modular libraries, OOP infrastructure modeling, decorators, REST API integration, and Flask webhook microservices.",
    "estimatedMinutes": 480
  },
  {
    "moduleOrder": 13,
    "title": "Module 13: Configuration Management with Ansible",
    "description": "Agentless SSH inventories, idempotent playbooks, roles, and Ansible Vault.",
    "estimatedMinutes": 240
  },
  {
    "moduleOrder": 14,
    "title": "Module 14: Observability with Prometheus & Grafana",
    "description": "Metrics scraping, PromQL alerting rules, dashboards, and log aggregation.",
    "estimatedMinutes": 240
  },
  {
    "moduleOrder": 15,
    "title": "Module 15: GitOps with ArgoCD & DevSecOps",
    "description": "Continuous reconciliation with ArgoCD, supply-chain scanning, and policy-as-code.",
    "estimatedMinutes": 240
  }
];

const ALL_LABS: LabSeedItem[] = [
  {
    "labId": 1,
    "moduleNumber": 1,
    "lessonOrder": 1,
    "labName": "Lab 1: Introduction to OS & Linux Basics",
    "slug": "01-os-linux-basics",
    "description": "Audit active processes, generate an OS memory baseline, neutralize a rogue background worker leaking resources, and remediate a broken metrics daemon.",
    "difficultyName": "Very Easy",
    "estimatedHours": 1,
    "flagValues": {
      "checkpoint_1_ps": "lab01-checkpoint-1-ps",
      "checkpoint_2_mem": "lab01-checkpoint-2-mem",
      "checkpoint_3_rogue": "lab01-checkpoint-3-rogue",
      "checkpoint_4_service": "lab01-checkpoint-4-service"
    }
  },
  {
    "labId": 2,
    "moduleNumber": 1,
    "lessonOrder": 2,
    "labName": "Lab 2: Linux Filesystem Hierarchy (FHS)",
    "slug": "02-linux-filesystem-hierarchy",
    "description": "Explore the Linux Filesystem Hierarchy Standard (/etc, /var, /opt, /srv), generate mount reports, clean up bloated log dumps, fix broken release symlinks, and restore web storage.",
    "difficultyName": "Very Easy",
    "estimatedHours": 1,
    "flagValues": {
      "checkpoint_1_fhs_report": "lab02-checkpoint-1-fhs-report",
      "checkpoint_2_log_cleanup": "lab02-checkpoint-2-log-cleanup",
      "checkpoint_3_symlinks": "lab02-checkpoint-3-symlinks",
      "checkpoint_4_storage_service": "lab02-checkpoint-4-storage-service"
    }
  },
  {
    "labId": 3,
    "moduleNumber": 1,
    "lessonOrder": 3,
    "labName": "Lab 3: Basic CLI Commands & File Operations",
    "slug": "03-cli-fundamentals",
    "description": "Scaffold a release directory tree, organize scripts and configs from a messy staging area, purge stale backup files with find, and package a verified tar.gz archive.",
    "difficultyName": "Very Easy",
    "estimatedHours": 1,
    "flagValues": {
      "checkpoint_1_scaffold": "lab03-checkpoint-1-scaffold",
      "checkpoint_2_organize": "lab03-checkpoint-2-organize",
      "checkpoint_3_find_exec": "lab03-checkpoint-3-find-exec",
      "checkpoint_4_archive": "lab03-checkpoint-4-archive"
    }
  },
  {
    "labId": 4,
    "moduleNumber": 1,
    "lessonOrder": 4,
    "labName": "Lab 4: Package Management & Text Editors (Vim/Nano)",
    "slug": "04-package-management-vim",
    "description": "Diagnose and remove a broken APT repository mirror, verify essential CLI packages (jq and tree), clean up a crashed Vim swap file, and remediate Nginx virtual host syntax.",
    "difficultyName": "Easy",
    "estimatedHours": 1,
    "flagValues": {
      "checkpoint_1_apt_repo": "lab04-checkpoint-1-apt-repo",
      "checkpoint_2_packages": "lab04-checkpoint-2-packages",
      "checkpoint_3_vim_cleanup": "lab04-checkpoint-3-vim-cleanup",
      "checkpoint_4_service_config": "lab04-checkpoint-4-service-config"
    }
  },
  {
    "labId": 5,
    "moduleNumber": 1,
    "lessonOrder": 5,
    "labName": "Lab 5: Users, Groups, and Permissions",
    "slug": "05-users-groups-permissions",
    "description": "Provision the deployer service account and devops-team group, configure a SetGID (2775) shared deployment directory, validate least-privilege sudoers rules, and harden SSH keys.",
    "difficultyName": "Easy",
    "estimatedHours": 1,
    "flagValues": {
      "checkpoint_1_users_groups": "lab05-checkpoint-1-users-groups",
      "checkpoint_2_shared_dir": "lab05-checkpoint-2-shared-dir",
      "checkpoint_3_sudoers": "lab05-checkpoint-3-sudoers",
      "checkpoint_4_key_audit": "lab05-checkpoint-4-key-audit"
    }
  },
  {
    "labId": 6,
    "moduleNumber": 1,
    "lessonOrder": 6,
    "labName": "Lab 6: Pipes, Redirection & Shell Scripting",
    "slug": "06-pipes-redirection-shell-scripting",
    "description": "Filter production logs with grep, aggregate top client IPs using awk/sort/uniq pipelines, split stdout and stderr streams, and repair an automated Bash log-summary script.",
    "difficultyName": "Medium",
    "estimatedHours": 2,
    "flagValues": {
      "checkpoint_1_error_extract": "lab06-checkpoint-1-error-extract",
      "checkpoint_2_top_ips": "lab06-checkpoint-2-top-ips",
      "checkpoint_3_redirect_streams": "lab06-checkpoint-3-redirect-streams",
      "checkpoint_4_health_script": "lab06-checkpoint-4-health-script"
    }
  },
  {
    "labId": 7,
    "moduleNumber": 1,
    "lessonOrder": 7,
    "labName": "Lab 7: Networking Basics, SSH & System Security",
    "slug": "07-networking-ssh-security",
    "description": "Configure local hostname resolution in /etc/hosts, audit listening sockets with ss to terminate a rogue listener on port 4444, harden OpenSSH daemon settings, and enforce firewall policy.",
    "difficultyName": "Medium",
    "estimatedHours": 2,
    "flagValues": {
      "checkpoint_1_hosts_dns": "lab07-checkpoint-1-hosts-dns",
      "checkpoint_2_port_audit": "lab07-checkpoint-2-port-audit",
      "checkpoint_3_ssh_hardening": "lab07-checkpoint-3-ssh-hardening",
      "checkpoint_4_firewall_rules": "lab07-checkpoint-4-firewall-rules"
    }
  },
  {
    "labId": 8,
    "moduleNumber": 6,
    "lessonOrder": 1,
    "labName": "Lab 1: The Ephemeral Environment (Core Container Lifecycle)",
    "slug": "m06-lab01-ephemeral-environment",
    "description": "Pull OCI images, distinguish attached vs detached container execution, audit running and exited containers with docker ps -a, stop and remove containers cleanly, and eliminate a rogue workload.",
    "difficultyName": "Very Easy",
    "estimatedHours": 1,
    "flagValues": {
      "checkpoint_1_pull": "lab08-checkpoint-1-pull",
      "checkpoint_2_detached": "lab08-checkpoint-2-detached",
      "checkpoint_3_lifecycle_audit": "lab08-checkpoint-3-lifecycle-audit",
      "checkpoint_4_cleanup_remediate": "lab08-checkpoint-4-cleanup-remediate"
    }
  },
  {
    "labId": 9,
    "moduleNumber": 6,
    "lessonOrder": 2,
    "labName": "Lab 2: Network Bridging and Environment Injection",
    "slug": "m06-lab02-network-bridging-env",
    "description": "Publish isolated container ports onto host interfaces with -p 8080:80, pass runtime secrets and configuration cleanly with -e, and remediate a crashing MySQL container.",
    "difficultyName": "Easy",
    "estimatedHours": 1,
    "flagValues": {
      "checkpoint_1_web_bridge": "lab09-checkpoint-1-web-bridge",
      "checkpoint_2_curl_verify": "lab09-checkpoint-2-curl-verify",
      "checkpoint_3_mysql_secure": "lab09-checkpoint-3-mysql-secure",
      "checkpoint_4_fix_broken_db": "lab09-checkpoint-4-fix-broken-db"
    }
  },
  {
    "labId": 10,
    "moduleNumber": 6,
    "lessonOrder": 3,
    "labName": "Lab 3: Diagnostics and Telemetry (Logs & Exec)",
    "slug": "m06-lab03-diagnostics-telemetry",
    "description": "Extract container standard output streams with docker logs, inspect internal nginx configuration using docker exec, export telemetry metadata, and diagnose a crashing Node microservice.",
    "difficultyName": "Easy",
    "estimatedHours": 1,
    "flagValues": {
      "checkpoint_1_logs_capture": "lab10-checkpoint-1-logs-capture",
      "checkpoint_2_nginx_conf_extract": "lab10-checkpoint-2-nginx-conf-extract",
      "checkpoint_3_telemetry_audit": "lab10-checkpoint-3-telemetry-audit",
      "checkpoint_4_remediate_crash": "lab10-checkpoint-4-remediate-crash"
    }
  },
  {
    "labId": 11,
    "moduleNumber": 6,
    "lessonOrder": 4,
    "labName": "Lab 4: The Immutable Blueprint (Dockerfile)",
    "slug": "m06-lab04-immutable-blueprint-dockerfile",
    "description": "Author an optimized layered Dockerfile with FROM node:20-alpine, cache-friendly package*.json dependency installation, build image devopsmentor/node-app:1.0, and deploy node-app-prod.",
    "difficultyName": "Medium",
    "estimatedHours": 1,
    "flagValues": {
      "checkpoint_1_dockerfile_base": "lab11-checkpoint-1-dockerfile-base",
      "checkpoint_2_dockerfile_layers": "lab11-checkpoint-2-dockerfile-layers",
      "checkpoint_3_image_built": "lab11-checkpoint-3-image-built",
      "checkpoint_4_container_running": "lab11-checkpoint-4-container-running"
    }
  },
  {
    "labId": 12,
    "moduleNumber": 6,
    "lessonOrder": 5,
    "labName": "Lab 5: Data Persistence and State (Docker Volumes)",
    "slug": "m06-lab05-data-persistence-volumes",
    "description": "Manage persistent storage decoupled from ephemeral container lifecycles by provisioning named volume nexus-data, writing critical state, replacing containers, and verifying survival.",
    "difficultyName": "Easy",
    "estimatedHours": 1,
    "flagValues": {
      "checkpoint_1_volume_create": "lab12-checkpoint-1-volume-create",
      "checkpoint_2_persist_record": "lab12-checkpoint-2-persist-record",
      "checkpoint_3_survivability": "lab12-checkpoint-3-survivability",
      "checkpoint_4_backup_verify": "lab12-checkpoint-4-backup-verify"
    }
  },
  {
    "labId": 13,
    "moduleNumber": 6,
    "lessonOrder": 6,
    "labName": "Lab 6: Multi-Container Orchestration (Docker Compose)",
    "slug": "m06-lab06-docker-compose-orchestration",
    "description": "Repair a broken multi-tier docker-compose.yml stack, launch frontend, backend, and database tiers together on an isolated bridge network, and verify service discovery DNS.",
    "difficultyName": "Medium",
    "estimatedHours": 2,
    "flagValues": {
      "checkpoint_1_compose_manifest": "lab13-checkpoint-1-compose-manifest",
      "checkpoint_2_compose_up": "lab13-checkpoint-2-compose-up",
      "checkpoint_3_service_dns": "lab13-checkpoint-3-service-dns",
      "checkpoint_4_compose_health": "lab13-checkpoint-4-compose-health"
    }
  },
  {
    "labId": 14,
    "moduleNumber": 6,
    "lessonOrder": 7,
    "labName": "Lab 7: The Private Registry Gateway (Pushing Images)",
    "slug": "m06-lab07-private-registry-gateway",
    "description": "Configure insecure-registries in /etc/docker/daemon.json, authenticate to internal registry registry.internal.local:8082, retag application images with registry coordinates, and push.",
    "difficultyName": "Medium",
    "estimatedHours": 1,
    "flagValues": {
      "checkpoint_1_daemon_json": "lab14-checkpoint-1-daemon-json",
      "checkpoint_2_registry_login": "lab14-checkpoint-2-registry-login",
      "checkpoint_3_image_tagged": "lab14-checkpoint-3-image-tagged",
      "checkpoint_4_image_pushed": "lab14-checkpoint-4-image-pushed"
    }
  },
  {
    "labId": 15,
    "moduleNumber": 6,
    "lessonOrder": 8,
    "labName": "Lab 8: Infrastructure as a Container (Deploying Sonatype Nexus)",
    "slug": "m06-lab08-deploying-nexus",
    "description": "Provision persistent repository storage nexus-repo-data, deploy Sonatype Nexus 3 on port 8081:8081, monitor JVM startup telemetry logs, and confirm live HTTP 200 readiness.",
    "difficultyName": "Medium",
    "estimatedHours": 1,
    "flagValues": {
      "checkpoint_1_nexus_volume": "lab15-checkpoint-1-nexus-volume",
      "checkpoint_2_nexus_container": "lab15-checkpoint-2-nexus-container",
      "checkpoint_3_nexus_startup_logs": "lab15-checkpoint-3-nexus-startup-logs",
      "checkpoint_4_nexus_http_ready": "lab15-checkpoint-4-nexus-http-ready"
    }
  },
  {
    "labId": 16,
    "moduleNumber": 9,
    "lessonOrder": 1,
    "labName": "Lab 1: Control Plane Initialization and Imperative Mechanics",
    "slug": "m09-lab01-control-plane-mechanics",
    "description": "Initialize a local single-node Kubernetes cluster with minikube, audit control plane health and node telemetry, execute an imperative Python probe Pod, inspect logs, and clean up ephemeral Pods.",
    "difficultyName": "Very Easy",
    "estimatedHours": 1,
    "flagValues": {
      "checkpoint_1_minikube_ready": "lab16-checkpoint-1-minikube-ready",
      "checkpoint_2_control_plane_audit": "lab16-checkpoint-2-control-plane-audit",
      "checkpoint_3_py_probe_pod": "lab16-checkpoint-3-py-probe-pod",
      "checkpoint_4_cleanup_broken_pod": "lab16-checkpoint-4-cleanup-broken-pod"
    }
  },
  {
    "labId": 17,
    "moduleNumber": 9,
    "lessonOrder": 2,
    "labName": "Lab 2: Declarative Topologies and Service Discovery",
    "slug": "m09-lab02-declarative-topologies-services",
    "description": "Author declarative YAML manifests for a 3-replica FastAPI Deployment, expose internal DNS load balancing with ClusterIP, configure NodePort 30080 external routing, and execute a zero-downtime rollout rollback.",
    "difficultyName": "Easy",
    "estimatedHours": 2,
    "flagValues": {
      "checkpoint_1_fastapi_deployment": "lab17-checkpoint-1-fastapi-deployment",
      "checkpoint_2_clusterip_service": "lab17-checkpoint-2-clusterip-service",
      "checkpoint_3_nodeport_service": "lab17-checkpoint-3-nodeport-service",
      "checkpoint_4_rollout_recovery": "lab17-checkpoint-4-rollout-recovery"
    }
  },
  {
    "labId": 18,
    "moduleNumber": 9,
    "lessonOrder": 3,
    "labName": "Lab 3: State Decoupling, Secrets, and Volume Persistency",
    "slug": "m09-lab03-state-secrets-volumes",
    "description": "Decouple sensitive database passwords in Secrets and runtime keys in ConfigMaps, provision PersistentVolume + PersistentVolumeClaim storage, deploy stateful Redis, and verify data survives Pod deletion.",
    "difficultyName": "Medium",
    "estimatedHours": 2,
    "flagValues": {
      "checkpoint_1_secret_configmap": "lab18-checkpoint-1-secret-configmap",
      "checkpoint_2_pv_pvc_bound": "lab18-checkpoint-2-pv-pvc-bound",
      "checkpoint_3_redis_deployment": "lab18-checkpoint-3-redis-deployment",
      "checkpoint_4_redis_persistence": "lab18-checkpoint-4-redis-persistence"
    }
  },
  {
    "labId": 19,
    "moduleNumber": 9,
    "lessonOrder": 4,
    "labName": "Lab 4: Multi-Tenancy Isolation and Ingress Routing",
    "slug": "m09-lab04-namespaces-ingress-routing",
    "description": "Partition a shared Kubernetes cluster into staging and production Namespaces, enable the NGINX Ingress controller addon, configure host/path HTTP routing rules, and test Layer-7 ingress traffic.",
    "difficultyName": "Medium",
    "estimatedHours": 2,
    "flagValues": {
      "checkpoint_1_namespaces": "lab19-checkpoint-1-namespaces",
      "checkpoint_2_staging_workload": "lab19-checkpoint-2-staging-workload",
      "checkpoint_3_ingress_addon": "lab19-checkpoint-3-ingress-addon",
      "checkpoint_4_ingress_route_test": "lab19-checkpoint-4-ingress-route-test"
    }
  },
  {
    "labId": 20,
    "moduleNumber": 9,
    "lessonOrder": 5,
    "labName": "Lab 5: API Security and Role-Based Access Control (RBAC)",
    "slug": "m09-lab05-api-security-rbac",
    "description": "Enforce least-privilege access control by creating ServiceAccount developer-sa in staging, binding a namespaced read-only Role, binding a cluster-wide Node auditor ClusterRole, and auditing permissions with kubectl auth can-i.",
    "difficultyName": "Medium",
    "estimatedHours": 2,
    "flagValues": {
      "checkpoint_1_service_account": "lab20-checkpoint-1-service-account",
      "checkpoint_2_role_binding": "lab20-checkpoint-2-role-binding",
      "checkpoint_3_cluster_role_binding": "lab20-checkpoint-3-cluster-role-binding",
      "checkpoint_4_rbac_audit_token": "lab20-checkpoint-4-rbac-audit-token"
    }
  },
  {
    "labId": 21,
    "moduleNumber": 9,
    "lessonOrder": 6,
    "labName": "Lab 6: Production Hardening and Pod Lifecycle Probes",
    "slug": "m09-lab06-production-hardening-probes",
    "description": "Harden Deployment manifests with CPU/Memory requests and limits, readiness and liveness HTTP probes on /healthz, graceful termination preStop hooks, and metrics-server telemetry.",
    "difficultyName": "Medium",
    "estimatedHours": 2,
    "flagValues": {
      "checkpoint_1_resource_quotas": "lab21-checkpoint-1-resource-quotas",
      "checkpoint_2_health_probes": "lab21-checkpoint-2-health-probes",
      "checkpoint_3_graceful_shutdown": "lab21-checkpoint-3-graceful-shutdown",
      "checkpoint_4_metrics_top": "lab21-checkpoint-4-metrics-top"
    }
  },
  {
    "labId": 22,
    "moduleNumber": 9,
    "lessonOrder": 7,
    "labName": "Lab 7: Custom Helm Chart Blueprinting",
    "slug": "m09-lab07-custom-helm-chart",
    "description": "Scaffold a custom Helm v3 chart microservice-chart, parameterize Go templates with range .Values.env loops, lint and dry-run render templates, and execute stateful helm install & helm upgrade.",
    "difficultyName": "Medium",
    "estimatedHours": 2,
    "flagValues": {
      "checkpoint_1_chart_scaffold": "lab22-checkpoint-1-chart-scaffold",
      "checkpoint_2_template_env_loop": "lab22-checkpoint-2-template-env-loop",
      "checkpoint_3_helm_install": "lab22-checkpoint-3-helm-install",
      "checkpoint_4_helm_upgrade": "lab22-checkpoint-4-helm-upgrade"
    }
  },
  {
    "labId": 23,
    "moduleNumber": 9,
    "lessonOrder": 8,
    "labName": "Lab 8: Declarative Multi-Service Orchestration via Helmfile",
    "slug": "m09-lab08-helmfile-orchestration",
    "description": "Construct an environment-matrix repository layout with per-environment override files, declare multi-namespace releases in helmfile.yaml, synchronize all stacks with helmfile sync, and perform disaster rollback.",
    "difficultyName": "Hard",
    "estimatedHours": 2,
    "flagValues": {
      "checkpoint_1_values_matrix": "lab23-checkpoint-1-values-matrix",
      "checkpoint_2_helmfile_manifest": "lab23-checkpoint-2-helmfile-manifest",
      "checkpoint_3_helmfile_sync": "lab23-checkpoint-3-helmfile-sync",
      "checkpoint_4_helm_rollback": "lab23-checkpoint-4-helm-rollback"
    }
  },
  {
    "labId": 24,
    "moduleNumber": 12,
    "lessonOrder": 1,
    "labName": "Lab 1: The Execution Environment (Types, Casting & Env Vars)",
    "slug": "m12-lab01-execution-environment",
    "description": "Audit Python 3 execution environment, prevent string-to-integer TypeErrors with explicit int() casting in strict_port_check.py, read and mask environment credentials safely, and repair a broken port validator.",
    "difficultyName": "Very Easy",
    "estimatedHours": 1,
    "flagValues": {
      "checkpoint_1_strict_port": "lab24-checkpoint-1-strict-port",
      "checkpoint_2_env_credentials": "lab24-checkpoint-2-env-credentials",
      "checkpoint_3_secret_masking": "lab24-checkpoint-3-secret-masking",
      "checkpoint_4_fix_type_bug": "lab24-checkpoint-4-fix-type-bug"
    }
  },
  {
    "labId": 25,
    "moduleNumber": 12,
    "lessonOrder": 2,
    "labName": "Lab 2: Deterministic Control Flow (Threshold Gates)",
    "slug": "m12-lab02-deterministic-control-flow",
    "description": "Build Boolean pre-deployment validation gates enforcing CPU utilization thresholds (< 80.0%) and disk capacity minimums (>= 5.0 GB), and fix a broken Boolean logic bug in rollout_guard.py.",
    "difficultyName": "Very Easy",
    "estimatedHours": 1,
    "flagValues": {
      "checkpoint_1_cpu_gate": "lab25-checkpoint-1-cpu-gate",
      "checkpoint_2_multi_metric": "lab25-checkpoint-2-multi-metric",
      "checkpoint_3_pass_branch": "lab25-checkpoint-3-pass-branch",
      "checkpoint_4_fix_gate_logic": "lab25-checkpoint-4-fix-gate-logic"
    }
  },
  {
    "labId": 26,
    "moduleNumber": 12,
    "lessonOrder": 3,
    "labName": "Lab 3: Structural Aggregation (Lists, Sets, Dicts & Comprehensions)",
    "slug": "m12-lab03-structural-aggregation",
    "description": "Deduplicate IP inventories with sets, manage host-role lookup dictionaries, navigate nested environment topology structures, and filter outdated server versions with dictionary comprehensions.",
    "difficultyName": "Easy",
    "estimatedHours": 1,
    "flagValues": {
      "checkpoint_1_dedupe_ips": "lab26-checkpoint-1-dedupe-ips",
      "checkpoint_2_hostname_roles": "lab26-checkpoint-2-hostname-roles",
      "checkpoint_3_env_topology": "lab26-checkpoint-3-env-topology",
      "checkpoint_4_filter_outdated": "lab26-checkpoint-4-filter-outdated"
    }
  },
  {
    "labId": 27,
    "moduleNumber": 12,
    "lessonOrder": 4,
    "labName": "Lab 4: Iteration and Functional Abstraction",
    "slug": "m12-lab04-iteration-functional-abstraction",
    "description": "Automate server fleet loops with def functions, engineer bounded while health-polling loops with MAX_RETRIES, enforce Python type hints (ip: str) -> bool, and break out of a stalled retry worker loop.",
    "difficultyName": "Easy",
    "estimatedHours": 1,
    "flagValues": {
      "checkpoint_1_provision_loop": "lab27-checkpoint-1-provision-loop",
      "checkpoint_2_health_poll": "lab27-checkpoint-2-health-poll",
      "checkpoint_3_typed_provision": "lab27-checkpoint-3-typed-provision",
      "checkpoint_4_fix_infinite_loop": "lab27-checkpoint-4-fix-infinite-loop"
    }
  },
  {
    "labId": 28,
    "moduleNumber": 12,
    "lessonOrder": 5,
    "labName": "Lab 5: Anticipating Catastrophe (Exception Handling & Custom Errors)",
    "slug": "m12-lab05-anticipating-catastrophe",
    "description": "Defend automation scripts against malformed inputs using try/except/finally, author domain-specific DeploymentError custom exceptions with strict guard clauses, and fix an unhandled KeyError crash.",
    "difficultyName": "Easy",
    "estimatedHours": 1,
    "flagValues": {
      "checkpoint_1_resilient_cast": "lab28-checkpoint-1-resilient-cast",
      "checkpoint_2_custom_exception": "lab28-checkpoint-2-custom-exception",
      "checkpoint_3_guard_clauses": "lab28-checkpoint-3-guard-clauses",
      "checkpoint_4_fix_unhandled_crash": "lab28-checkpoint-4-fix-unhandled-crash"
    }
  },
  {
    "labId": 29,
    "moduleNumber": 12,
    "lessonOrder": 6,
    "labName": "Lab 6: The Operating System Interface (os, subprocess & File I/O)",
    "slug": "m12-lab06-os-interface",
    "description": "Provision release trees idempotently with os.makedirs(..., exist_ok=True), execute shell commands safely via subprocess.run without shell=True, append audit logs via context managers, and repair a broken audit runner.",
    "difficultyName": "Easy",
    "estimatedHours": 1,
    "flagValues": {
      "checkpoint_1_makedirs": "lab29-checkpoint-1-makedirs",
      "checkpoint_2_subprocess_df": "lab29-checkpoint-2-subprocess-df",
      "checkpoint_3_log_context_mgr": "lab29-checkpoint-3-log-context-mgr",
      "checkpoint_4_cleanup_broken_script": "lab29-checkpoint-4-cleanup-broken-script"
    }
  },
  {
    "labId": 30,
    "moduleNumber": 12,
    "lessonOrder": 7,
    "labName": "Lab 7: Data Serialization and Payloads (JSON)",
    "slug": "m12-lab07-data-serialization-json",
    "description": "Deserialize structured JSON configuration strings with json.loads(), mutate and pretty-print JSON objects with json.dumps(indent=4), perform file-backed config.json roundtrips, and repair malformed JSON.",
    "difficultyName": "Easy",
    "estimatedHours": 1,
    "flagValues": {
      "checkpoint_1_json_loads": "lab30-checkpoint-1-json-loads",
      "checkpoint_2_json_dumps": "lab30-checkpoint-2-json-dumps",
      "checkpoint_3_file_roundtrip": "lab30-checkpoint-3-file-roundtrip",
      "checkpoint_4_fix_corrupt_json": "lab30-checkpoint-4-fix-corrupt-json"
    }
  },
  {
    "labId": 31,
    "moduleNumber": 12,
    "lessonOrder": 8,
    "labName": "Lab 8: Architectural Modularity (Modules, Imports & Packages)",
    "slug": "m12-lab08-architectural-modularity",
    "description": "Refactor infrastructure utilities into reusable network_utils.py modules imported cleanly by main.py, verify external PyPI package resolution with requests, and resolve an ImportError in service_runner.py.",
    "difficultyName": "Easy",
    "estimatedHours": 1,
    "flagValues": {
      "checkpoint_1_network_utils": "lab31-checkpoint-1-network-utils",
      "checkpoint_2_main_import": "lab31-checkpoint-2-main-import",
      "checkpoint_3_requests_verify": "lab31-checkpoint-3-requests-verify",
      "checkpoint_4_fix_circular_import": "lab31-checkpoint-4-fix-circular-import"
    }
  },
  {
    "labId": 32,
    "moduleNumber": 12,
    "lessonOrder": 9,
    "labName": "Lab 9: Object Oriented Infrastructure (Classes, Inheritance & __str__)",
    "slug": "m12-lab09-object-oriented-infrastructure",
    "description": "Model fleet compute resources using Python classes, encapsulate boot/shutdown state transitions, subclass DatabaseServer(Server) with super().__init__ and backup_data(), and implement __str__.",
    "difficultyName": "Medium",
    "estimatedHours": 2,
    "flagValues": {
      "checkpoint_1_server_class": "lab32-checkpoint-1-server-class",
      "checkpoint_2_lifecycle_methods": "lab32-checkpoint-2-lifecycle-methods",
      "checkpoint_3_inheritance_db": "lab32-checkpoint-3-inheritance-db",
      "checkpoint_4_dunder_str": "lab32-checkpoint-4-dunder-str"
    }
  },
  {
    "labId": 33,
    "moduleNumber": 12,
    "lessonOrder": 10,
    "labName": "Lab 10: Advanced Execution Control (Decorators & Retry Loops)",
    "slug": "m12-lab10-advanced-execution-control",
    "description": "Construct higher-order Python function decorators for audit logging, high-precision @timed performance telemetry with functools.wraps, parameterized @retry(max_attempts=3) fault tolerance, and fix a value-swallowing decorator.",
    "difficultyName": "Medium",
    "estimatedHours": 2,
    "flagValues": {
      "checkpoint_1_basic_wrapper": "lab33-checkpoint-1-basic-wrapper",
      "checkpoint_2_timer_decorator": "lab33-checkpoint-2-timer-decorator",
      "checkpoint_3_retry_decorator": "lab33-checkpoint-3-retry-decorator",
      "checkpoint_4_fix_wrapper_return": "lab33-checkpoint-4-fix-wrapper-return"
    }
  },
  {
    "labId": 34,
    "moduleNumber": 12,
    "lessonOrder": 11,
    "labName": "Lab 11: The Remote API Gateway (REST Clients & Requests)",
    "slug": "m12-lab11-remote-api-gateway",
    "description": "Consume REST endpoints over HTTPS with Python requests, decode JSON API status responses, trigger CI/CD deployments via authenticated POST payloads, enforce strict HTTPError handling with raise_for_status(), and persist audit telemetry.",
    "difficultyName": "Medium",
    "estimatedHours": 2,
    "flagValues": {
      "checkpoint_1_get_status": "lab34-checkpoint-1-get-status",
      "checkpoint_2_post_trigger": "lab34-checkpoint-2-post-trigger",
      "checkpoint_3_raise_for_status": "lab34-checkpoint-3-raise-for-status",
      "checkpoint_4_save_api_audit": "lab34-checkpoint-4-save-api-audit"
    }
  },
  {
    "labId": 35,
    "moduleNumber": 12,
    "lessonOrder": 12,
    "labName": "Lab 12: Infrastructure as a Service (Building a Flask Webhook API)",
    "slug": "m12-lab12-infrastructure-as-a-service",
    "description": "Build a RESTful DevOps webhook microservice in Python with Flask exposing GET /health and POST /deploy JSON handlers, repair a broken route stub, launch it on port 5000, and test webhook delivery.",
    "difficultyName": "Hard",
    "estimatedHours": 2,
    "flagValues": {
      "checkpoint_1_flask_verify": "lab35-checkpoint-1-flask-verify",
      "checkpoint_2_flask_app_code": "lab35-checkpoint-2-flask-app-code",
      "checkpoint_3_flask_daemon_up": "lab35-checkpoint-3-flask-daemon-up",
      "checkpoint_4_webhook_post_test": "lab35-checkpoint-4-webhook-post-test"
    }
  }
];

const TRACK_DEFINITIONS = [
  {
    "moduleNumber": 1,
    "trackName": "Module 1: Operating System & Linux Basics",
    "slug": "module-1-os-linux-basics",
    "description": "Complete all 7 hands-on Linux engineering labs covering process management, FHS, CLI operations, APT & Vim, permissions, shell scripting, and SSH security."
  },
  {
    "moduleNumber": 6,
    "trackName": "Module 6: Containers with Docker",
    "slug": "module-6-containers-with-docker",
    "description": "Complete all 8 Docker engineering labs spanning ephemeral lifecycles, port bridging, telemetry, Dockerfiles, persistent volumes, Docker Compose, private registries, and Nexus deployment."
  },
  {
    "moduleNumber": 9,
    "trackName": "Module 9: Core Kubernetes Container Orchestration",
    "slug": "module-9-core-kubernetes",
    "description": "Complete all 8 Kubernetes labs covering control plane mechanics, Deployments & Services, Secrets & PVCs, Namespaces & Ingress, RBAC security, production probes, Helm charts, and Helmfile orchestration."
  },
  {
    "moduleNumber": 12,
    "trackName": "Module 12: Programming with Python for DevOps",
    "slug": "module-12-python-programming",
    "description": "Complete all 12 Python automation labs from runtime types & control flow through subprocess orchestration, OOP servers, decorators, REST API clients, and Flask webhook microservices."
  }
];

async function ensureLearnerLabPermissions(): Promise<void> {
  const learnerRole = await db.query.roles.findFirst({
    where: eq(roles.roleName, ROLES.INDIVIDUAL_LEARNER),
  });
  if (!learnerRole) return;

  const labPermNames = [
    PERMISSIONS.LABS_INSTANCE_CREATE,
    PERMISSIONS.LABS_INSTANCE_READ,
    PERMISSIONS.LABS_INSTANCE_DELETE,
    PERMISSIONS.LABS_AI_MENTOR_USE,
  ];

  const permRows = await db
    .select()
    .from(permissions)
    .where(inArray(permissions.permissionName, labPermNames));

  for (const perm of permRows) {
    const existing = await db
      .select()
      .from(rolePermissions)
      .where(
        and(
          eq(rolePermissions.roleId, learnerRole.roleId),
          eq(rolePermissions.permissionId, perm.permissionId),
        ),
      )
      .limit(1);
    if (existing.length === 0) {
      await db.insert(rolePermissions).values({
        roleId: learnerRole.roleId,
        permissionId: perm.permissionId,
      });
    }
  }
  console.log('Verified lab permissions for individual_learner role.');
}

async function seedVpnPool(): Promise<void> {
  const regions: Array<{ name: string; location: string; region: 'US' | 'EU' | 'ASIA'; ip: string }> = [
    { name: 'dm-vpn-us-east-1', location: 'Virginia, US', region: 'US', ip: '10.10.1.1' },
    { name: 'dm-vpn-eu-central-1', location: 'Frankfurt, EU', region: 'EU', ip: '10.10.2.1' },
    { name: 'dm-vpn-ap-south-1', location: 'Singapore, ASIA', region: 'ASIA', ip: '10.10.3.1' },
  ];

  for (const r of regions) {
    const existing = await db
      .select()
      .from(vpnServers)
      .where(eq(vpnServers.serverName, r.name))
      .limit(1);

    if (existing.length === 0) {
      await db.insert(vpnServers).values({
        serverName: r.name,
        serverLocation: r.location,
        ipAddress: r.ip,
        port: 443,
        region: r.region,
        maxUsers: 500,
        currentUsers: 0,
        isActive: true,
        isMaintenance: false,
        status: 'online',
      });
    } else {
      await db
        .update(vpnServers)
        .set({
          isActive: true,
          isMaintenance: false,
          status: 'online',
          maxUsers: 500,
          currentUsers: 0,
        })
        .where(eq(vpnServers.vpnId, existing[0].vpnId));
    }
  }
  console.log('Seeded and reset online VPN server pool (US, EU, ASIA).');
}

async function resetStaleInstancesAndCompletions(): Promise<void> {
  await db
    .update(pwnboxInstances)
    .set({ status: 'terminated', terminatedAt: new Date() })
    .where(inArray(pwnboxInstances.status, ['pending', 'running', 'stopped']));

  await db.update(vpnAssignments).set({ isActive: false });

  await db
    .delete(activityLogs)
    .where(eq(activityLogs.activityType, 'LAB_COMPLETED'));

  console.log('Cleared stale lab instances, VPN assignments, and previous completion locks.');
}

async function seedAllModulesAndLabs(): Promise<void> {
  const diffRows = await db.select().from(difficultyLevels);
  const diffMap = new Map(diffRows.map((d) => [d.name, d.difficultyId]));
  const defaultDiffId = diffMap.get('Easy') ?? diffRows[0]?.difficultyId ?? 1;

  const cloudCategory = await db.query.categories.findFirst({
    where: eq(categories.slug, 'cloud'),
  });
  const categoryId = cloudCategory?.categoryId ?? null;

  for (const item of ALL_LABS) {
    const difficultyId = diffMap.get(item.difficultyName) ?? defaultDiffId;
    const existingById = await db
      .select()
      .from(labs)
      .where(eq(labs.labId, item.labId))
      .limit(1);

    if (existingById.length > 0) {
      await db
        .update(labs)
        .set({
          labName: item.labName,
          slug: item.slug,
          description: item.description,
          difficultyId,
          categoryId,
          labType: 'pro_lab',
          isActive: true,
          isPremium: false,
          estimatedHours: item.estimatedHours,
        })
        .where(eq(labs.labId, item.labId));
    } else {
      await db.insert(labs).values({
        labId: item.labId,
        labName: item.labName,
        slug: item.slug,
        description: item.description,
        difficultyId,
        categoryId,
        labType: 'pro_lab',
        isActive: true,
        isPremium: false,
        estimatedHours: item.estimatedHours,
      });
    }

    const existingProLab = await db
      .select()
      .from(proLabs)
      .where(eq(proLabs.labId, item.labId))
      .limit(1);

    if (existingProLab.length > 0) {
      await db
        .update(proLabs)
        .set({
          networkIpRange: '172.17.0.0/16',
          totalMachines: 1,
          requiredRootCount: 4,
          flagValues: item.flagValues,
        })
        .where(eq(proLabs.labId, item.labId));
    } else {
      await db.insert(proLabs).values({
        labId: item.labId,
        networkIpRange: '172.17.0.0/16',
        totalMachines: 1,
        requiredRootCount: 4,
        flagValues: item.flagValues,
      });
    }
  }
  console.log(`Seeded all ${ALL_LABS.length} labs across Modules 1, 6, 9, and 12 (lab_id 1..35).`);

  const course = await db.query.academyCourses.findFirst({
    orderBy: (row, { asc }) => [asc(row.courseId)],
  });

  if (course) {
    const moduleMap = new Map<number, number>();
    for (const modDef of ALL_MODULES) {
      let modRow = await db.query.modules.findFirst({
        where: and(eq(modules.courseId, course.courseId), eq(modules.moduleOrder, modDef.moduleOrder)),
      });
      if (!modRow) {
        const inserted = await db.insert(modules).values({
          courseId: course.courseId,
          title: modDef.title,
          description: modDef.description,
          moduleOrder: modDef.moduleOrder,
          estimatedMinutes: modDef.estimatedMinutes,
          isPublished: true,
        });
        moduleMap.set(modDef.moduleOrder, inserted[0].insertId);
      } else {
        await db
          .update(modules)
          .set({
            title: modDef.title,
            description: modDef.description,
            estimatedMinutes: modDef.estimatedMinutes,
            isPublished: true,
          })
          .where(eq(modules.moduleId, modRow.moduleId));
        moduleMap.set(modDef.moduleOrder, modRow.moduleId);
      }
    }

    for (const item of ALL_LABS) {
      const moduleId = moduleMap.get(item.moduleNumber);
      if (!moduleId) continue;

      const existingLesson = await db.query.lessons.findFirst({
        where: and(eq(lessons.moduleId, moduleId), eq(lessons.lessonOrder, item.lessonOrder)),
      });

      if (existingLesson) {
        await db
          .update(lessons)
          .set({
            title: `${item.labName} (${item.slug})`,
            content: item.description,
            contentType: 'lab',
            isPublished: true,
          })
          .where(eq(lessons.lessonId, existingLesson.lessonId));
      } else {
        await db.insert(lessons).values({
          moduleId,
          title: `${item.labName} (${item.slug})`,
          content: item.description,
          contentType: 'lab',
          lessonOrder: item.lessonOrder,
          isPublished: true,
        });
      }
    }

    const allLessons = await db
      .select()
      .from(lessons)
      .where(eq(lessons.isPublished, true));
    await db
      .update(academyCourses)
      .set({ totalLessons: allLessons.length, isPublished: true })
      .where(eq(academyCourses.courseId, course.courseId));

    console.log(`Seeded all 15 modules and ${ALL_LABS.length} hands-on lab lessons under course "${course.title}".`);
  }

  // Seed Tracks for active modules
  for (const tdef of TRACK_DEFINITIONS) {
    const modLabs = ALL_LABS.filter((l) => l.moduleNumber === tdef.moduleNumber);
    const existingTrack = await db.query.tracks.findFirst({
      where: eq(tracks.slug, tdef.slug),
    });

    let trackId: number;
    if (existingTrack) {
      trackId = existingTrack.trackId;
      await db
        .update(tracks)
        .set({
          trackName: tdef.trackName,
          description: tdef.description,
          totalLabs: modLabs.length,
          isActive: true,
          isPremium: false,
        })
        .where(eq(tracks.trackId, trackId));
    } else {
      const inserted = await db.insert(tracks).values({
        trackName: tdef.trackName,
        slug: tdef.slug,
        description: tdef.description,
        difficultyId: defaultDiffId,
        categoryId,
        totalLabs: modLabs.length,
        isActive: true,
        isPremium: false,
      });
      trackId = inserted[0].insertId;
    }

    await db.delete(trackContent).where(eq(trackContent.trackId, trackId));
    for (let idx = 0; idx < modLabs.length; idx++) {
      await db.insert(trackContent).values({
        trackId,
        contentType: 'lab',
        contentId: modLabs[idx].labId,
        displayOrder: idx + 1,
        required: true,
      });
    }
    console.log(`Seeded track "${tdef.trackName}" with ${modLabs.length} labs.`);
  }
}

async function main(): Promise<void> {
  await ensureLearnerLabPermissions();
  await seedVpnPool();
  await resetStaleInstancesAndCompletions();
  await seedAllModulesAndLabs();
  console.log('All 15 modules and 35 hands-on labs database seeding complete!');
}

main()
  .catch((err) => {
    console.error('Error seeding modules and labs:', err);
    process.exit(1);
  })
  .finally(async () => {
    await disconnectDatabase();
  });
