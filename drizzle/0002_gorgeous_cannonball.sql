CREATE TABLE `organizations` (
	`organization_id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(255) NOT NULL,
	`slug` varchar(255) NOT NULL,
	`description` text,
	`logo_url` varchar(255),
	`website` varchar(255),
	`industry` varchar(100),
	`employee_count` int,
	`is_verified` boolean NOT NULL DEFAULT false,
	`billing_email` varchar(255),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `organizations_organization_id` PRIMARY KEY(`organization_id`),
	CONSTRAINT `organizations_name_key` UNIQUE(`name`),
	CONSTRAINT `organizations_slug_key` UNIQUE(`slug`)
);
--> statement-breakpoint
CREATE INDEX `idx_name` ON `organizations` (`name`);