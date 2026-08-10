CREATE TABLE `api_tokens` (
	`token_id` int AUTO_INCREMENT NOT NULL,
	`user_id` int NOT NULL,
	`token_name` varchar(100) NOT NULL,
	`api_token` varchar(255) NOT NULL,
	`permissions` json,
	`last_used_at` timestamp,
	`expires_at` timestamp,
	`is_active` boolean NOT NULL DEFAULT true,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `api_tokens_token_id` PRIMARY KEY(`token_id`),
	CONSTRAINT `api_tokens_api_token_key` UNIQUE(`api_token`)
);
--> statement-breakpoint
CREATE TABLE `login_history` (
	`login_id` int AUTO_INCREMENT NOT NULL,
	`user_id` int NOT NULL,
	`ip_address` varchar(45),
	`user_agent` text,
	`login_type` enum('email','google','github') NOT NULL DEFAULT 'email',
	`is_successful` boolean NOT NULL DEFAULT true,
	`failure_reason` text,
	`location_city` varchar(100),
	`location_country` varchar(100),
	`device_id` varchar(255),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `login_history_login_id` PRIMARY KEY(`login_id`)
);
--> statement-breakpoint
CREATE TABLE `otp_codes` (
	`otp_id` int AUTO_INCREMENT NOT NULL,
	`user_id` int NOT NULL,
	`code` varchar(10) NOT NULL,
	`type` enum('email_verification','password_reset','two_factor','phone_verification') NOT NULL,
	`is_used` boolean NOT NULL DEFAULT false,
	`expires_at` timestamp NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `otp_codes_otp_id` PRIMARY KEY(`otp_id`)
);
--> statement-breakpoint
CREATE TABLE `permissions` (
	`permission_id` int AUTO_INCREMENT NOT NULL,
	`permission_name` varchar(100) NOT NULL,
	`description` text,
	`module` varchar(50),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `permissions_permission_id` PRIMARY KEY(`permission_id`),
	CONSTRAINT `permissions_permission_name_key` UNIQUE(`permission_name`)
);
--> statement-breakpoint
CREATE TABLE `role_permissions` (
	`role_id` int NOT NULL,
	`permission_id` int NOT NULL,
	`granted_at` timestamp NOT NULL DEFAULT (now()),
	`granted_by` int,
	CONSTRAINT `role_permissions_role_id_permission_id_pk` PRIMARY KEY(`role_id`,`permission_id`)
);
--> statement-breakpoint
CREATE TABLE `roles` (
	`role_id` int AUTO_INCREMENT NOT NULL,
	`role_name` varchar(50) NOT NULL,
	`description` text,
	`priority` int NOT NULL DEFAULT 0,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `roles_role_id` PRIMARY KEY(`role_id`),
	CONSTRAINT `roles_role_name_key` UNIQUE(`role_name`)
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`session_id` int AUTO_INCREMENT NOT NULL,
	`user_id` int NOT NULL,
	`session_token` varchar(255) NOT NULL,
	`refresh_token` varchar(255),
	`ip_address` varchar(45),
	`user_agent` text,
	`device_type` varchar(50),
	`browser` varchar(50),
	`os` varchar(50),
	`is_active` boolean NOT NULL DEFAULT true,
	`expires_at` timestamp NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`last_activity_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `sessions_session_id` PRIMARY KEY(`session_id`),
	CONSTRAINT `sessions_session_token_key` UNIQUE(`session_token`),
	CONSTRAINT `sessions_refresh_token_key` UNIQUE(`refresh_token`)
);
--> statement-breakpoint
CREATE TABLE `user_roles` (
	`user_id` int NOT NULL,
	`role_id` int NOT NULL,
	`assigned_at` timestamp NOT NULL DEFAULT (now()),
	`assigned_by` int,
	CONSTRAINT `user_roles_user_id_role_id_pk` PRIMARY KEY(`user_id`,`role_id`)
);
--> statement-breakpoint
CREATE TABLE `users` (
	`user_id` int AUTO_INCREMENT NOT NULL,
	`username` varchar(50) NOT NULL,
	`email` varchar(255) NOT NULL,
	`password_hash` varchar(255) NOT NULL,
	`salt` varchar(64) NOT NULL,
	`full_name` varchar(100),
	`display_name` varchar(50),
	`bio` text,
	`avatar_url` varchar(255),
	`cover_photo_url` varchar(255),
	`is_verified` boolean NOT NULL DEFAULT false,
	`is_active` boolean NOT NULL DEFAULT true,
	`is_banned` boolean NOT NULL DEFAULT false,
	`ban_reason` text,
	`last_login_at` timestamp,
	`last_login_ip` varchar(45),
	`registration_ip` varchar(45),
	`timezone` varchar(50) NOT NULL DEFAULT 'UTC',
	`language` varchar(10) NOT NULL DEFAULT 'en',
	`two_factor_enabled` boolean NOT NULL DEFAULT false,
	`two_factor_secret` varchar(255),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	`deleted_at` timestamp,
	CONSTRAINT `users_user_id` PRIMARY KEY(`user_id`),
	CONSTRAINT `users_username_key` UNIQUE(`username`),
	CONSTRAINT `users_email_key` UNIQUE(`email`)
);
--> statement-breakpoint
ALTER TABLE `api_tokens` ADD CONSTRAINT `api_tokens_user_id_users_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`user_id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `login_history` ADD CONSTRAINT `login_history_user_id_users_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`user_id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `otp_codes` ADD CONSTRAINT `otp_codes_user_id_users_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`user_id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `role_permissions` ADD CONSTRAINT `role_permissions_role_id_roles_role_id_fk` FOREIGN KEY (`role_id`) REFERENCES `roles`(`role_id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `role_permissions` ADD CONSTRAINT `role_permissions_permission_id_permissions_permission_id_fk` FOREIGN KEY (`permission_id`) REFERENCES `permissions`(`permission_id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `sessions` ADD CONSTRAINT `sessions_user_id_users_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`user_id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `user_roles` ADD CONSTRAINT `user_roles_user_id_users_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`user_id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `user_roles` ADD CONSTRAINT `user_roles_role_id_roles_role_id_fk` FOREIGN KEY (`role_id`) REFERENCES `roles`(`role_id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `idx_user_login` ON `login_history` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_created` ON `login_history` (`created_at`);--> statement-breakpoint
CREATE INDEX `idx_code` ON `otp_codes` (`code`);--> statement-breakpoint
CREATE INDEX `idx_expires` ON `otp_codes` (`expires_at`);--> statement-breakpoint
CREATE INDEX `idx_token` ON `sessions` (`session_token`);--> statement-breakpoint
CREATE INDEX `idx_refresh` ON `sessions` (`refresh_token`);--> statement-breakpoint
CREATE INDEX `idx_email` ON `users` (`email`);--> statement-breakpoint
CREATE INDEX `idx_username` ON `users` (`username`);--> statement-breakpoint
CREATE INDEX `idx_active` ON `users` (`is_active`);