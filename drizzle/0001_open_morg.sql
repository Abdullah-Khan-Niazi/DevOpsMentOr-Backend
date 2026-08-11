CREATE TABLE `audit_logs` (
	`log_id` int AUTO_INCREMENT NOT NULL,
	`admin_user_id` int NOT NULL,
	`action` varchar(50) NOT NULL,
	`target_type` varchar(50),
	`target_id` int,
	`changes` json,
	`ip_address` varchar(45),
	`user_agent` text,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `audit_logs_log_id` PRIMARY KEY(`log_id`)
);
--> statement-breakpoint
CREATE TABLE `countries` (
	`country_id` int AUTO_INCREMENT NOT NULL,
	`country_code` char(2) NOT NULL,
	`country_name` varchar(100) NOT NULL,
	`iso3_code` char(3),
	`numeric_code` int,
	`phone_code` varchar(10),
	`flag_emoji` varchar(10),
	`is_active` boolean NOT NULL DEFAULT true,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `countries_country_id` PRIMARY KEY(`country_id`),
	CONSTRAINT `countries_country_code_key` UNIQUE(`country_code`)
);
--> statement-breakpoint
CREATE TABLE `files` (
	`file_id` int AUTO_INCREMENT NOT NULL,
	`user_id` int NOT NULL,
	`file_name` varchar(255) NOT NULL,
	`file_path` varchar(255) NOT NULL,
	`file_size_bytes` bigint,
	`mime_type` varchar(100),
	`file_hash` varchar(64),
	`storage_type` enum('local','s3','azure','gcs') NOT NULL DEFAULT 'local',
	`bucket_name` varchar(100),
	`object_key` varchar(255),
	`is_public` boolean NOT NULL DEFAULT false,
	`upload_ip` varchar(45),
	`downloads_count` int NOT NULL DEFAULT 0,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `files_file_id` PRIMARY KEY(`file_id`)
);
--> statement-breakpoint
CREATE TABLE `skills` (
	`skill_id` int AUTO_INCREMENT NOT NULL,
	`skill_name` varchar(100) NOT NULL,
	`category` enum('offensive','defensive','forensics','networking','web','mobile','cloud','ai_ml','governance') NOT NULL,
	`description` text,
	`is_active` boolean NOT NULL DEFAULT true,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `skills_skill_id` PRIMARY KEY(`skill_id`),
	CONSTRAINT `skills_skill_name_key` UNIQUE(`skill_name`)
);
--> statement-breakpoint
CREATE TABLE `system_settings` (
	`setting_id` int AUTO_INCREMENT NOT NULL,
	`setting_key` varchar(100) NOT NULL,
	`setting_value` json,
	`group_name` varchar(50),
	`description` text,
	`is_editable` boolean NOT NULL DEFAULT true,
	`updated_by` int,
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `system_settings_setting_id` PRIMARY KEY(`setting_id`),
	CONSTRAINT `system_settings_setting_key_key` UNIQUE(`setting_key`)
);
--> statement-breakpoint
CREATE TABLE `user_follows` (
	`follower_id` int NOT NULL,
	`following_id` int NOT NULL,
	`followed_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `user_follows_follower_id_following_id_pk` PRIMARY KEY(`follower_id`,`following_id`)
);
--> statement-breakpoint
CREATE TABLE `user_profiles` (
	`profile_id` int AUTO_INCREMENT NOT NULL,
	`user_id` int NOT NULL,
	`country_id` int,
	`city` varchar(100),
	`address` text,
	`phone` varchar(20),
	`date_of_birth` date,
	`gender` enum('male','female','other','prefer_not_to_say'),
	`occupation` varchar(100),
	`company` varchar(100),
	`website` varchar(255),
	`github_url` varchar(255),
	`linkedin_url` varchar(255),
	`twitter_handle` varchar(50),
	`discord_username` varchar(100),
	`hacker_rank_points` int NOT NULL DEFAULT 0,
	`global_rank` int,
	`country_rank` int,
	`reputation_score` int NOT NULL DEFAULT 0,
	`profile_views` int NOT NULL DEFAULT 0,
	`is_public` boolean NOT NULL DEFAULT true,
	CONSTRAINT `user_profiles_profile_id` PRIMARY KEY(`profile_id`),
	CONSTRAINT `user_profiles_user_id_key` UNIQUE(`user_id`)
);
--> statement-breakpoint
CREATE TABLE `user_settings` (
	`user_id` int NOT NULL,
	`setting_key` varchar(100) NOT NULL,
	`setting_value` json,
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `user_settings_user_id_setting_key_pk` PRIMARY KEY(`user_id`,`setting_key`)
);
--> statement-breakpoint
CREATE TABLE `user_skills` (
	`user_id` int NOT NULL,
	`skill_id` int NOT NULL,
	`proficiency_level` enum('beginner','intermediate','advanced','expert') NOT NULL DEFAULT 'beginner',
	`years_experience` decimal(3,1) NOT NULL DEFAULT '0',
	`is_verified` boolean NOT NULL DEFAULT false,
	`endorsed_by` int,
	`endorsed_at` timestamp,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `user_skills_user_id_skill_id_pk` PRIMARY KEY(`user_id`,`skill_id`)
);
--> statement-breakpoint
ALTER TABLE `audit_logs` ADD CONSTRAINT `audit_logs_admin_user_id_users_user_id_fk` FOREIGN KEY (`admin_user_id`) REFERENCES `users`(`user_id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `files` ADD CONSTRAINT `files_user_id_users_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`user_id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `user_follows` ADD CONSTRAINT `user_follows_follower_id_users_user_id_fk` FOREIGN KEY (`follower_id`) REFERENCES `users`(`user_id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `user_follows` ADD CONSTRAINT `user_follows_following_id_users_user_id_fk` FOREIGN KEY (`following_id`) REFERENCES `users`(`user_id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `user_profiles` ADD CONSTRAINT `user_profiles_user_id_users_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`user_id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `user_profiles` ADD CONSTRAINT `user_profiles_country_id_countries_country_id_fk` FOREIGN KEY (`country_id`) REFERENCES `countries`(`country_id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `user_settings` ADD CONSTRAINT `user_settings_user_id_users_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`user_id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `user_skills` ADD CONSTRAINT `user_skills_user_id_users_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`user_id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `user_skills` ADD CONSTRAINT `user_skills_skill_id_skills_skill_id_fk` FOREIGN KEY (`skill_id`) REFERENCES `skills`(`skill_id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `idx_admin` ON `audit_logs` (`admin_user_id`);--> statement-breakpoint
CREATE INDEX `idx_action` ON `audit_logs` (`action`);--> statement-breakpoint
CREATE INDEX `idx_created` ON `audit_logs` (`created_at`);--> statement-breakpoint
CREATE INDEX `idx_user` ON `files` (`user_id`);