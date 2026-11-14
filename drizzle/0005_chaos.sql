CREATE TABLE `class_assignments` (
	`assignment_id` int AUTO_INCREMENT NOT NULL,
	`team_id` int NOT NULL,
	`course_id` int NOT NULL,
	`assigned_by` int NOT NULL,
	`assigned_at` timestamp NOT NULL DEFAULT (now()),
	`due_date` timestamp,
	`is_mandatory` boolean NOT NULL DEFAULT true,
	CONSTRAINT `class_assignments_assignment_id` PRIMARY KEY(`assignment_id`),
	CONSTRAINT `class_assignments_team_course_key` UNIQUE(`team_id`,`course_id`)
);
--> statement-breakpoint
ALTER TABLE `announcement_reads` DROP FOREIGN KEY `announcement_reads_announcement_id_fk`;
--> statement-breakpoint
ALTER TABLE `quiz_questions` MODIFY COLUMN `question_type` enum('multiple_choice','true_false','fill_blank','multiple_select','bucket_sort','ordering') NOT NULL DEFAULT 'multiple_choice';--> statement-breakpoint
ALTER TABLE `lessons` ADD `slug` varchar(160);--> statement-breakpoint
ALTER TABLE `quiz_questions` ADD `config` json;--> statement-breakpoint
ALTER TABLE `lessons` ADD CONSTRAINT `lessons_slug_key` UNIQUE(`slug`);--> statement-breakpoint
ALTER TABLE `class_assignments` ADD CONSTRAINT `class_assignments_team_id_teams_team_id_fk` FOREIGN KEY (`team_id`) REFERENCES `teams`(`team_id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `class_assignments` ADD CONSTRAINT `class_assignments_course_id_academy_courses_course_id_fk` FOREIGN KEY (`course_id`) REFERENCES `academy_courses`(`course_id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `class_assignments` ADD CONSTRAINT `class_assignments_assigned_by_users_user_id_fk` FOREIGN KEY (`assigned_by`) REFERENCES `users`(`user_id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `idx_assignment_course` ON `class_assignments` (`course_id`);--> statement-breakpoint
CREATE INDEX `idx_assignment_due` ON `class_assignments` (`due_date`);--> statement-breakpoint
ALTER TABLE `announcement_reads` ADD CONSTRAINT `announcement_reads_announcement_id_fk` FOREIGN KEY (`announcement_id`) REFERENCES `announcements`(`announcement_id`) ON DELETE cascade ON UPDATE no action;
-- ─────────────────────────────────────────────────────────────────────────────
-- CHAOS WAVE 2 (merged into this migration on purpose).
-- Tenancy + hardening DDL that shipped after the first chaos cutdown:
--   * organization_memberships — real per-org roles/status (replaces the
--     single-valued user_settings.org_id pointer as the authorization source)
--   * audit_logs.admin_user_id -> nullable + ON DELETE SET NULL, plus
--     actor_email so the trail survives account deletion
--   * otp_codes.attempts + users.two_factor_pending_secret (auth hardening)
-- Existing deployments that already recorded 0005 apply this section manually
-- (documented in task.md); fresh deployments execute the whole file.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE `organization_memberships` (
	`membership_id` int AUTO_INCREMENT NOT NULL,
	`organization_id` int NOT NULL,
	`user_id` int NOT NULL,
	`role` enum('org_admin','professor','org_student') NOT NULL,
	`status` enum('active','invited','suspended','left') NOT NULL DEFAULT 'active',
	`is_primary` boolean NOT NULL DEFAULT false,
	`joined_at` timestamp NOT NULL DEFAULT (now()),
	`invited_by` int,
	`left_at` timestamp,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `organization_memberships_membership_id` PRIMARY KEY(`membership_id`),
	CONSTRAINT `organization_memberships_org_user_key` UNIQUE(`organization_id`,`user_id`)
);
--> statement-breakpoint
ALTER TABLE `audit_logs` DROP FOREIGN KEY `audit_logs_admin_user_id_users_user_id_fk`;
--> statement-breakpoint
ALTER TABLE `audit_logs` MODIFY COLUMN `admin_user_id` int;
--> statement-breakpoint
ALTER TABLE `audit_logs` ADD `actor_email` varchar(255);
--> statement-breakpoint
ALTER TABLE `otp_codes` ADD `attempts` int DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `users` ADD `two_factor_pending_secret` varchar(255);
--> statement-breakpoint
ALTER TABLE `organization_memberships` ADD CONSTRAINT `org_memberships_org_fk` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`organization_id`) ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `organization_memberships` ADD CONSTRAINT `org_memberships_user_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`user_id`) ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `organization_memberships` ADD CONSTRAINT `org_memberships_inviter_fk` FOREIGN KEY (`invited_by`) REFERENCES `users`(`user_id`) ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX `idx_om_user_status` ON `organization_memberships` (`user_id`,`status`);
--> statement-breakpoint
CREATE INDEX `idx_om_org_role` ON `organization_memberships` (`organization_id`,`status`,`role`);
--> statement-breakpoint
ALTER TABLE `audit_logs` ADD CONSTRAINT `audit_logs_admin_user_id_users_user_id_fk` FOREIGN KEY (`admin_user_id`) REFERENCES `users`(`user_id`) ON DELETE set null ON UPDATE no action;

-- CHAOS WAVE 3: OTP codes stored as HMAC digests (column widened to 64).
ALTER TABLE `otp_codes` MODIFY COLUMN `code` varchar(64) NOT NULL;

-- CHAOS WAVE 4: legacy enum taxonomy retired (skills, lab types, team roles,
-- track/season content, points sources, payment methods).
ALTER TABLE `labs` MODIFY COLUMN `lab_type` enum('pro_lab','sherlock','vip_lab') NOT NULL;
--> statement-breakpoint
ALTER TABLE `payment_methods` MODIFY COLUMN `method_type` enum('credit_card','paypal','enterprise_invoice') NOT NULL;
--> statement-breakpoint
ALTER TABLE `points_history` MODIFY COLUMN `source_type` enum('lab_complete','course_complete','achievement','daily_bonus','admin_adjustment','penalty') NOT NULL;
--> statement-breakpoint
ALTER TABLE `season_content` MODIFY COLUMN `content_type` enum('lab') NOT NULL;
--> statement-breakpoint
ALTER TABLE `skills` MODIFY COLUMN `category` enum('cloud','containers','automation','observability','scripting','networking','security','platform','governance') NOT NULL;
--> statement-breakpoint
ALTER TABLE `team_members` MODIFY COLUMN `role` enum('member','captain','co_captain') NOT NULL DEFAULT 'member';
--> statement-breakpoint
ALTER TABLE `track_content` MODIFY COLUMN `content_type` enum('lab','course') NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- CHAOS DATA BACKFILL: migrate legacy single-org scope pointers and class
-- rosters into organization_memberships. Safe on fresh volumes (empty tables)
-- and idempotent via INSERT IGNORE + the (organization_id, user_id) unique key.
-- ─────────────────────────────────────────────────────────────────────────────
INSERT IGNORE INTO `organization_memberships` (`organization_id`, `user_id`, `role`, `status`, `joined_at`)
SELECT CAST(us.setting_value AS UNSIGNED), us.user_id,
       CASE
         WHEN MAX(r.role_name = 'org_admin') = 1 THEN 'org_admin'
         WHEN MAX(r.role_name = 'professor') = 1 THEN 'professor'
         ELSE 'org_student'
       END,
       'active', MIN(u.created_at)
  FROM `user_settings` us
  JOIN `users` u ON u.user_id = us.user_id
  LEFT JOIN `user_roles` ur ON ur.user_id = us.user_id
  LEFT JOIN `roles` r ON r.role_id = ur.role_id
       AND r.role_name IN ('org_admin', 'professor', 'org_student')
 WHERE us.setting_key = 'org_id'
   AND JSON_VALID(us.setting_value)
 GROUP BY us.user_id, us.setting_value;
--> statement-breakpoint
INSERT IGNORE INTO `organization_memberships` (`organization_id`, `user_id`, `role`, `status`, `joined_at`)
SELECT t.organization_id, tm.user_id,
       CASE WHEN tm.role IN ('captain', 'co_captain') THEN 'professor' ELSE 'org_student' END,
       'active', MIN(tm.joined_at)
  FROM `team_members` tm
  JOIN `teams` t ON t.team_id = tm.team_id
 WHERE tm.is_active = 1
   AND t.organization_id IS NOT NULL
   AND t.slug <> '__org_invites__'
 GROUP BY t.organization_id, tm.user_id, tm.role;
