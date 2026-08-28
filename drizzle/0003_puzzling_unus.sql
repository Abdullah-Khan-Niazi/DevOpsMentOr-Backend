CREATE TABLE `team_invitations` (
	`invitation_id` int AUTO_INCREMENT NOT NULL,
	`team_id` int NOT NULL,
	`inviter_id` int NOT NULL,
	`invitee_email` varchar(255) NOT NULL,
	`invitee_user_id` int,
	`token` varchar(255) NOT NULL,
	`status` enum('pending','accepted','declined','expired') NOT NULL DEFAULT 'pending',
	`expires_at` timestamp NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`accepted_at` timestamp,
	CONSTRAINT `team_invitations_invitation_id` PRIMARY KEY(`invitation_id`),
	CONSTRAINT `team_invitations_token_key` UNIQUE(`token`)
);
--> statement-breakpoint
CREATE TABLE `team_members` (
	`team_id` int NOT NULL,
	`user_id` int NOT NULL,
	`role` enum('member','captain','co_captain','manager') NOT NULL DEFAULT 'member',
	`joined_at` timestamp NOT NULL DEFAULT (now()),
	`left_at` timestamp,
	`is_active` boolean NOT NULL DEFAULT true,
	CONSTRAINT `team_members_team_id_user_id_pk` PRIMARY KEY(`team_id`,`user_id`)
);
--> statement-breakpoint
CREATE TABLE `teams` (
	`team_id` int AUTO_INCREMENT NOT NULL,
	`organization_id` int,
	`team_name` varchar(100) NOT NULL,
	`slug` varchar(100) NOT NULL,
	`description` text,
	`logo_url` varchar(255),
	`team_owner_id` int NOT NULL,
	`is_public` boolean NOT NULL DEFAULT false,
	`max_members` int NOT NULL DEFAULT 50,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `teams_team_id` PRIMARY KEY(`team_id`),
	CONSTRAINT `teams_slug_key` UNIQUE(`slug`)
);
--> statement-breakpoint
ALTER TABLE `team_invitations` ADD CONSTRAINT `team_invitations_team_id_teams_team_id_fk` FOREIGN KEY (`team_id`) REFERENCES `teams`(`team_id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `team_invitations` ADD CONSTRAINT `team_invitations_inviter_id_users_user_id_fk` FOREIGN KEY (`inviter_id`) REFERENCES `users`(`user_id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `team_invitations` ADD CONSTRAINT `team_invitations_invitee_user_id_users_user_id_fk` FOREIGN KEY (`invitee_user_id`) REFERENCES `users`(`user_id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `team_members` ADD CONSTRAINT `team_members_team_id_teams_team_id_fk` FOREIGN KEY (`team_id`) REFERENCES `teams`(`team_id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `team_members` ADD CONSTRAINT `team_members_user_id_users_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`user_id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `teams` ADD CONSTRAINT `teams_organization_id_organizations_organization_id_fk` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`organization_id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `teams` ADD CONSTRAINT `teams_team_owner_id_users_user_id_fk` FOREIGN KEY (`team_owner_id`) REFERENCES `users`(`user_id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `idx_token` ON `team_invitations` (`token`);--> statement-breakpoint
CREATE INDEX `idx_email` ON `team_invitations` (`invitee_email`);--> statement-breakpoint
CREATE INDEX `idx_user` ON `team_members` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_org` ON `teams` (`organization_id`);