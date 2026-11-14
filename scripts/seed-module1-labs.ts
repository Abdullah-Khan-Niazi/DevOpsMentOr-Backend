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

interface Module1LabSeed {
  labId: number;
  labName: string;
  slug: string;
  description: string;
  difficultyName: 'Very Easy' | 'Easy' | 'Medium';
  estimatedHours: number;
  flagValues: Record<string, string>;
}

const MODULE_1_LABS: Module1LabSeed[] = [
  {
    labId: 1,
    labName: 'Lab 1: Introduction to OS & Linux Basics',
    slug: '01-os-linux-basics',
    description:
      'Audit active processes, generate an OS memory baseline, neutralize a rogue background worker leaking resources, and remediate a broken metrics daemon.',
    difficultyName: 'Very Easy',
    estimatedHours: 1,
    flagValues: {
      checkpoint_1_ps: 'lab01-checkpoint-1-ps',
      checkpoint_2_mem: 'lab01-checkpoint-2-mem',
      checkpoint_3_rogue: 'lab01-checkpoint-3-rogue',
      checkpoint_4_service: 'lab01-checkpoint-4-service',
    },
  },
  {
    labId: 2,
    labName: 'Lab 2: Linux Filesystem Hierarchy (FHS)',
    slug: '02-linux-filesystem-hierarchy',
    description:
      'Explore the Linux Filesystem Hierarchy Standard (/etc, /var, /opt, /srv), generate mount reports, clean up bloated log dumps, fix broken release symlinks, and restore web storage.',
    difficultyName: 'Very Easy',
    estimatedHours: 1,
    flagValues: {
      checkpoint_1_fhs_report: 'lab02-checkpoint-1-fhs-report',
      checkpoint_2_log_cleanup: 'lab02-checkpoint-2-log-cleanup',
      checkpoint_3_symlinks: 'lab02-checkpoint-3-symlinks',
      checkpoint_4_storage_service: 'lab02-checkpoint-4-storage-service',
    },
  },
  {
    labId: 3,
    labName: 'Lab 3: Basic CLI Commands & File Operations',
    slug: '03-cli-fundamentals',
    description:
      'Scaffold a release directory tree, organize scripts and configs from a messy staging area, purge stale backup files with find, and package a verified tar.gz archive.',
    difficultyName: 'Very Easy',
    estimatedHours: 1,
    flagValues: {
      checkpoint_1_scaffold: 'lab03-checkpoint-1-scaffold',
      checkpoint_2_organize: 'lab03-checkpoint-2-organize',
      checkpoint_3_find_exec: 'lab03-checkpoint-3-find-exec',
      checkpoint_4_archive: 'lab03-checkpoint-4-archive',
    },
  },
  {
    labId: 4,
    labName: 'Lab 4: Package Management & Text Editors (Vim/Nano)',
    slug: '04-package-management-vim',
    description:
      'Diagnose and remove a broken APT repository mirror, verify essential CLI packages (jq and tree), clean up a crashed Vim swap file, and remediate Nginx virtual host syntax.',
    difficultyName: 'Easy',
    estimatedHours: 1,
    flagValues: {
      checkpoint_1_apt_repo: 'lab04-checkpoint-1-apt-repo',
      checkpoint_2_packages: 'lab04-checkpoint-2-packages',
      checkpoint_3_vim_cleanup: 'lab04-checkpoint-3-vim-cleanup',
      checkpoint_4_service_config: 'lab04-checkpoint-4-service-config',
    },
  },
  {
    labId: 5,
    labName: 'Lab 5: Users, Groups, and Permissions',
    slug: '05-users-groups-permissions',
    description:
      'Provision the deployer service account and devops-team group, configure a SetGID (2775) shared deployment directory, validate least-privilege sudoers rules, and harden SSH keys.',
    difficultyName: 'Easy',
    estimatedHours: 1,
    flagValues: {
      checkpoint_1_users_groups: 'lab05-checkpoint-1-users-groups',
      checkpoint_2_shared_dir: 'lab05-checkpoint-2-shared-dir',
      checkpoint_3_sudoers: 'lab05-checkpoint-3-sudoers',
      checkpoint_4_key_audit: 'lab05-checkpoint-4-key-audit',
    },
  },
  {
    labId: 6,
    labName: 'Lab 6: Pipes, Redirection & Shell Scripting',
    slug: '06-pipes-redirection-shell-scripting',
    description:
      'Filter production logs with grep, aggregate top client IPs using awk/sort/uniq pipelines, split stdout and stderr streams, and repair an automated Bash log-summary script.',
    difficultyName: 'Medium',
    estimatedHours: 2,
    flagValues: {
      checkpoint_1_error_extract: 'lab06-checkpoint-1-error-extract',
      checkpoint_2_top_ips: 'lab06-checkpoint-2-top-ips',
      checkpoint_3_redirect_streams: 'lab06-checkpoint-3-redirect-streams',
      checkpoint_4_health_script: 'lab06-checkpoint-4-health-script',
    },
  },
  {
    labId: 7,
    labName: 'Lab 7: Networking Basics, SSH & System Security',
    slug: '07-networking-ssh-security',
    description:
      'Configure local hostname resolution in /etc/hosts, audit listening sockets with ss to terminate a rogue listener on port 4444, harden OpenSSH daemon settings, and enforce firewall policy.',
    difficultyName: 'Medium',
    estimatedHours: 2,
    flagValues: {
      checkpoint_1_hosts_dns: 'lab07-checkpoint-1-hosts-dns',
      checkpoint_2_port_audit: 'lab07-checkpoint-2-port-audit',
      checkpoint_3_ssh_hardening: 'lab07-checkpoint-3-ssh-hardening',
      checkpoint_4_firewall_rules: 'lab07-checkpoint-4-firewall-rules',
    },
  },
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

async function seedModule1LabsAndCurriculum(): Promise<void> {
  const diffRows = await db.select().from(difficultyLevels);
  const diffMap = new Map(diffRows.map((d) => [d.name, d.difficultyId]));
  const defaultDiffId = diffMap.get('Easy') ?? diffRows[0]?.difficultyId ?? 1;

  const cloudCategory = await db.query.categories.findFirst({
    where: eq(categories.slug, 'cloud'),
  });
  const categoryId = cloudCategory?.categoryId ?? null;

  for (const item of MODULE_1_LABS) {
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
  console.log('Seeded all 7 Module 1 labs in labs and pro_labs tables (lab_id 1..7).');

  // Seed Module 1 and its 7 Lab Lessons in Canonical Course
  const course = await db.query.academyCourses.findFirst({
    orderBy: (row, { asc }) => [asc(row.courseId)],
  });

  if (course) {
    let mod1 = await db.query.modules.findFirst({
      where: and(eq(modules.courseId, course.courseId), eq(modules.moduleOrder, 1)),
    });

    if (!mod1) {
      const inserted = await db.insert(modules).values({
        courseId: course.courseId,
        title: 'Module 1: Operating System & Linux Basics',
        description:
          'Foundational Linux systems engineering: kernel & process lifecycle, FHS storage layout, CLI file operations, package management & Vim, users/groups/permissions, pipes & Bash scripting, and networking/SSH security.',
        moduleOrder: 1,
        estimatedMinutes: 315,
        isPublished: true,
      });
      const modId = inserted[0]?.insertId;
      mod1 = await db.query.modules.findFirst({ where: eq(modules.moduleId, modId) });
    } else {
      await db
        .update(modules)
        .set({
          title: 'Module 1: Operating System & Linux Basics',
          description:
            'Foundational Linux systems engineering: kernel & process lifecycle, FHS storage layout, CLI file operations, package management & Vim, users/groups/permissions, pipes & Bash scripting, and networking/SSH security.',
          estimatedMinutes: 315,
          isPublished: true,
        })
        .where(eq(modules.moduleId, mod1.moduleId));
    }

    if (mod1) {
      for (const item of MODULE_1_LABS) {
        const existingLesson = await db.query.lessons.findFirst({
          where: and(eq(lessons.moduleId, mod1.moduleId), eq(lessons.lessonOrder, item.labId)),
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
            moduleId: mod1.moduleId,
            title: `${item.labName} (${item.slug})`,
            content: item.description,
            contentType: 'lab',
            lessonOrder: item.labId,
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

      console.log(`Seeded Module 1 with 7 hands-on lab lessons under course "${course.title}".`);
    }
  }

  // Seed Module 1 Track
  const trackSlug = 'module-1-os-linux-basics';
  const existingTrack = await db.query.tracks.findFirst({
    where: eq(tracks.slug, trackSlug),
  });

  let trackId: number;
  if (existingTrack) {
    trackId = existingTrack.trackId;
    await db
      .update(tracks)
      .set({
        trackName: 'Module 1: Operating System & Linux Basics',
        description:
          'Complete all 7 hands-on Linux engineering labs covering process management, FHS, CLI operations, APT & Vim, permissions, shell scripting, and SSH security.',
        totalLabs: 7,
        isActive: true,
        isPremium: false,
      })
      .where(eq(tracks.trackId, trackId));
  } else {
    const inserted = await db.insert(tracks).values({
      trackName: 'Module 1: Operating System & Linux Basics',
      slug: trackSlug,
      description:
        'Complete all 7 hands-on Linux engineering labs covering process management, FHS, CLI operations, APT & Vim, permissions, shell scripting, and SSH security.',
      difficultyId: defaultDiffId,
      categoryId,
      totalLabs: 7,
      isActive: true,
      isPremium: false,
    });
    trackId = inserted[0].insertId;
  }

  await db.delete(trackContent).where(eq(trackContent.trackId, trackId));
  for (const item of MODULE_1_LABS) {
    await db.insert(trackContent).values({
      trackId,
      contentType: 'lab',
      contentId: item.labId,
      displayOrder: item.labId,
      required: true,
    });
  }
  console.log('Seeded Module 1 Track with all 7 labs.');
}

async function main(): Promise<void> {
  await ensureLearnerLabPermissions();
  await seedVpnPool();
  await resetStaleInstancesAndCompletions();
  await seedModule1LabsAndCurriculum();
  console.log('Module 1 database seeding complete!');
}

main()
  .catch((err) => {
    console.error('Error seeding Module 1 labs:', err);
    process.exit(1);
  })
  .finally(async () => {
    await disconnectDatabase();
  });
