CREATE TABLE `academy_courses` (
	`course_id` int AUTO_INCREMENT NOT NULL,
	`title` varchar(255) NOT NULL,
	`slug` varchar(255) NOT NULL,
	`description` text,
	`difficulty_id` int NOT NULL,
	`category_id` int,
	`instructor_id` int NOT NULL,
	`cover_image_url` varchar(255),
	`video_trailer_url` varchar(255),
	`estimated_hours` int NOT NULL DEFAULT 0,
	`total_lessons` int NOT NULL DEFAULT 0,
	`total_quizzes` int NOT NULL DEFAULT 0,
	`is_published` boolean NOT NULL DEFAULT false,
	`is_premium` boolean NOT NULL DEFAULT false,
	`price` decimal(10,2) NOT NULL DEFAULT '0',
	`discount_price` decimal(10,2),
	`average_rating` decimal(3,2) NOT NULL DEFAULT '0',
	`total_ratings` int NOT NULL DEFAULT 0,
	`enrollment_count` int NOT NULL DEFAULT 0,
	`prerequisites` json,
	`learning_objectives` json,
	`release_date` date,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `academy_courses_course_id` PRIMARY KEY(`course_id`),
	CONSTRAINT `academy_courses_slug_key` UNIQUE(`slug`)
);
--> statement-breakpoint
CREATE TABLE `achievements` (
	`achievement_id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(100) NOT NULL,
	`description` text,
	`points_awarded` int NOT NULL DEFAULT 0,
	`trigger_type` varchar(50),
	`trigger_value` json,
	`is_active` boolean NOT NULL DEFAULT true,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `achievements_achievement_id` PRIMARY KEY(`achievement_id`),
	CONSTRAINT `achievements_name_key` UNIQUE(`name`)
);
--> statement-breakpoint
CREATE TABLE `activity_logs` (
	`log_id` int AUTO_INCREMENT NOT NULL,
	`user_id` int NOT NULL,
	`activity_type` varchar(50) NOT NULL,
	`details` json,
	`ip_address` varchar(45),
	`user_agent` text,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `activity_logs_log_id` PRIMARY KEY(`log_id`)
);
--> statement-breakpoint
CREATE TABLE `announcement_reads` (
	`announcement_id` int NOT NULL,
	`user_id` int NOT NULL,
	`read_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `announcement_reads_announcement_id_user_id_pk` PRIMARY KEY(`announcement_id`,`user_id`)
);
--> statement-breakpoint
CREATE TABLE `announcements` (
	`announcement_id` int AUTO_INCREMENT NOT NULL,
	`title` varchar(255) NOT NULL,
	`content` longtext NOT NULL,
	`announcement_type` enum('general','maintenance','feature','security','event') NOT NULL,
	`priority` enum('low','medium','high','critical') NOT NULL DEFAULT 'medium',
	`is_published` boolean NOT NULL DEFAULT false,
	`published_at` timestamp,
	`expires_at` timestamp,
	`created_by` int NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `announcements_announcement_id` PRIMARY KEY(`announcement_id`)
);
--> statement-breakpoint
CREATE TABLE `badges` (
	`badge_id` int AUTO_INCREMENT NOT NULL,
	`badge_name` varchar(100) NOT NULL,
	`slug` varchar(100) NOT NULL,
	`description` text,
	`badge_type` enum('bronze','silver','gold','platinum','diamond','special') NOT NULL DEFAULT 'bronze',
	`icon_url` varchar(255),
	`points_required` int NOT NULL DEFAULT 0,
	`criteria` json,
	`is_hidden` boolean NOT NULL DEFAULT false,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `badges_badge_id` PRIMARY KEY(`badge_id`),
	CONSTRAINT `badges_badge_name_key` UNIQUE(`badge_name`),
	CONSTRAINT `badges_slug_key` UNIQUE(`slug`)
);
--> statement-breakpoint
CREATE TABLE `categories` (
	`category_id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(100) NOT NULL,
	`slug` varchar(100) NOT NULL,
	`description` text,
	`icon_url` varchar(255),
	`parent_category_id` int,
	`display_order` int NOT NULL DEFAULT 0,
	`is_active` boolean NOT NULL DEFAULT true,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `categories_category_id` PRIMARY KEY(`category_id`),
	CONSTRAINT `categories_name_key` UNIQUE(`name`),
	CONSTRAINT `categories_slug_key` UNIQUE(`slug`)
);
--> statement-breakpoint
CREATE TABLE `certificates` (
	`certificate_id` int AUTO_INCREMENT NOT NULL,
	`user_id` int NOT NULL,
	`course_id` int NOT NULL,
	`certificate_number` varchar(50) NOT NULL,
	`grade` decimal(5,2),
	`certificate_url` varchar(255),
	`issued_at` timestamp NOT NULL DEFAULT (now()),
	`expires_at` timestamp,
	`is_valid` boolean NOT NULL DEFAULT true,
	`verifier_ip` varchar(45),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `certificates_certificate_id` PRIMARY KEY(`certificate_id`),
	CONSTRAINT `certificates_certificate_number_key` UNIQUE(`certificate_number`),
	CONSTRAINT `certificates_user_course_key` UNIQUE(`user_id`,`course_id`)
);
--> statement-breakpoint
CREATE TABLE `challenge_tags` (
	`challenge_id` int NOT NULL,
	`tag_id` int NOT NULL,
	CONSTRAINT `challenge_tags_challenge_id_tag_id_pk` PRIMARY KEY(`challenge_id`,`tag_id`)
);
--> statement-breakpoint
CREATE TABLE `comments` (
	`comment_id` int AUTO_INCREMENT NOT NULL,
	`user_id` int NOT NULL,
	`parent_comment_id` int,
	`target_type` enum('machine','challenge','writeup','forum','course','lab','news') NOT NULL,
	`target_id` int NOT NULL,
	`content` text NOT NULL,
	`is_pinned` boolean NOT NULL DEFAULT false,
	`is_hidden` boolean NOT NULL DEFAULT false,
	`likes_count` int NOT NULL DEFAULT 0,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `comments_comment_id` PRIMARY KEY(`comment_id`)
);
--> statement-breakpoint
CREATE TABLE `coupons` (
	`coupon_id` int AUTO_INCREMENT NOT NULL,
	`code` varchar(50) NOT NULL,
	`description` text,
	`discount_type` enum('percentage','fixed_amount') NOT NULL,
	`discount_value` decimal(10,2) NOT NULL,
	`max_uses` int NOT NULL DEFAULT 1,
	`used_count` int NOT NULL DEFAULT 0,
	`expires_at` timestamp NOT NULL,
	`is_active` boolean NOT NULL DEFAULT true,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `coupons_coupon_id` PRIMARY KEY(`coupon_id`),
	CONSTRAINT `coupons_code_key` UNIQUE(`code`)
);
--> statement-breakpoint
CREATE TABLE `difficulty_levels` (
	`difficulty_id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(50) NOT NULL,
	`level_value` int NOT NULL,
	`color_hex` varchar(7),
	`icon_class` varchar(50),
	`points_multiplier` decimal(3,2) DEFAULT '1.00',
	`description` text,
	`is_active` boolean NOT NULL DEFAULT true,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `difficulty_levels_difficulty_id` PRIMARY KEY(`difficulty_id`),
	CONSTRAINT `difficulty_levels_name_key` UNIQUE(`name`),
	CONSTRAINT `difficulty_levels_level_value_key` UNIQUE(`level_value`)
);
--> statement-breakpoint
CREATE TABLE `downloads` (
	`download_id` int AUTO_INCREMENT NOT NULL,
	`user_id` int NOT NULL,
	`file_id` int NOT NULL,
	`ip_address` varchar(45),
	`user_agent` text,
	`downloaded_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `downloads_download_id` PRIMARY KEY(`download_id`)
);
--> statement-breakpoint
CREATE TABLE `email_templates` (
	`template_id` int AUTO_INCREMENT NOT NULL,
	`template_key` varchar(50) NOT NULL,
	`name` varchar(100) NOT NULL,
	`subject` varchar(255) NOT NULL,
	`body_html` longtext NOT NULL,
	`body_text` text,
	`placeholders` json,
	`is_active` boolean NOT NULL DEFAULT true,
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `email_templates_template_id` PRIMARY KEY(`template_id`),
	CONSTRAINT `email_templates_template_key_key` UNIQUE(`template_key`)
);
--> statement-breakpoint
CREATE TABLE `event_registrations` (
	`registration_id` int AUTO_INCREMENT NOT NULL,
	`event_id` int NOT NULL,
	`user_id` int NOT NULL,
	`attendee_name` varchar(100),
	`attendee_email` varchar(255),
	`company` varchar(100),
	`dietary_restrictions` text,
	`special_requirements` text,
	`status` enum('registered','attended','cancelled','waitlisted') NOT NULL DEFAULT 'registered',
	`registered_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `event_registrations_registration_id` PRIMARY KEY(`registration_id`),
	CONSTRAINT `event_registrations_event_user_key` UNIQUE(`event_id`,`user_id`)
);
--> statement-breakpoint
CREATE TABLE `events` (
	`event_id` int AUTO_INCREMENT NOT NULL,
	`title` varchar(255) NOT NULL,
	`description` text,
	`location` varchar(255),
	`event_type` enum('webinar','workshop','competition','conference','meetup') NOT NULL,
	`start_time` timestamp NOT NULL,
	`end_time` timestamp,
	`timezone` varchar(50),
	`max_attendees` int NOT NULL DEFAULT 0,
	`is_free` boolean NOT NULL DEFAULT true,
	`price` decimal(10,2) NOT NULL DEFAULT '0',
	`registration_deadline` timestamp,
	`banner_url` varchar(255),
	`is_active` boolean NOT NULL DEFAULT true,
	`created_by` int NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `events_event_id` PRIMARY KEY(`event_id`)
);
--> statement-breakpoint
CREATE TABLE `invoices` (
	`invoice_id` int AUTO_INCREMENT NOT NULL,
	`order_id` int NOT NULL,
	`invoice_number` varchar(50) NOT NULL,
	`invoice_url` varchar(255),
	`due_date` timestamp,
	`paid_at` timestamp,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `invoices_invoice_id` PRIMARY KEY(`invoice_id`),
	CONSTRAINT `invoices_invoice_number_key` UNIQUE(`invoice_number`)
);
--> statement-breakpoint
CREATE TABLE `labs` (
	`lab_id` int AUTO_INCREMENT NOT NULL,
	`lab_name` varchar(100) NOT NULL,
	`slug` varchar(100) NOT NULL,
	`description` text,
	`difficulty_id` int NOT NULL,
	`category_id` int,
	`lab_type` enum('pro_lab','fortress','sherlock','vip_lab') NOT NULL,
	`is_active` boolean NOT NULL DEFAULT true,
	`is_premium` boolean NOT NULL DEFAULT false,
	`estimated_hours` int NOT NULL DEFAULT 0,
	`network_diagram_url` varchar(255),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `labs_lab_id` PRIMARY KEY(`lab_id`),
	CONSTRAINT `labs_lab_name_key` UNIQUE(`lab_name`),
	CONSTRAINT `labs_slug_key` UNIQUE(`slug`)
);
--> statement-breakpoint
CREATE TABLE `leaderboard_history` (
	`history_id` int AUTO_INCREMENT NOT NULL,
	`user_id` int NOT NULL,
	`total_points` int NOT NULL DEFAULT 0,
	`global_rank` int,
	`recorded_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `leaderboard_history_history_id` PRIMARY KEY(`history_id`)
);
--> statement-breakpoint
CREATE TABLE `leaderboards` (
	`leaderboard_id` int AUTO_INCREMENT NOT NULL,
	`user_id` int NOT NULL,
	`total_points` int NOT NULL DEFAULT 0,
	`machine_owns_count` int NOT NULL DEFAULT 0,
	`challenge_solves_count` int NOT NULL DEFAULT 0,
	`course_completions_count` int NOT NULL DEFAULT 0,
	`global_rank` int,
	`country_rank` int,
	`region_rank` int,
	`calculated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `leaderboards_leaderboard_id` PRIMARY KEY(`leaderboard_id`)
);
--> statement-breakpoint
CREATE TABLE `lessons` (
	`lesson_id` int AUTO_INCREMENT NOT NULL,
	`module_id` int NOT NULL,
	`title` varchar(255) NOT NULL,
	`content` longtext,
	`content_type` enum('text','video','interactive','lab') NOT NULL DEFAULT 'text',
	`video_url` varchar(255),
	`video_duration_seconds` int,
	`lesson_order` int NOT NULL,
	`is_published` boolean NOT NULL DEFAULT true,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `lessons_lesson_id` PRIMARY KEY(`lesson_id`)
);
--> statement-breakpoint
CREATE TABLE `likes` (
	`like_id` int AUTO_INCREMENT NOT NULL,
	`user_id` int NOT NULL,
	`target_type` enum('comment','review','writeup','forum_post','solution','machine') NOT NULL,
	`target_id` int NOT NULL,
	`like_type` enum('like','love','useful','funny') NOT NULL DEFAULT 'like',
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `likes_like_id` PRIMARY KEY(`like_id`),
	CONSTRAINT `likes_unique_user_target` UNIQUE(`user_id`,`target_type`,`target_id`)
);
--> statement-breakpoint
CREATE TABLE `media` (
	`media_id` int AUTO_INCREMENT NOT NULL,
	`file_id` int NOT NULL,
	`alt_text` varchar(255),
	`width` int,
	`height` int,
	`duration_seconds` int,
	`thumbnail_url` varchar(255),
	CONSTRAINT `media_media_id` PRIMARY KEY(`media_id`)
);
--> statement-breakpoint
CREATE TABLE `modules` (
	`module_id` int AUTO_INCREMENT NOT NULL,
	`course_id` int NOT NULL,
	`title` varchar(255) NOT NULL,
	`description` text,
	`module_order` int NOT NULL,
	`estimated_minutes` int NOT NULL DEFAULT 0,
	`is_published` boolean NOT NULL DEFAULT true,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `modules_module_id` PRIMARY KEY(`module_id`)
);
--> statement-breakpoint
CREATE TABLE `notification_preferences` (
	`user_id` int NOT NULL,
	`type` varchar(50) NOT NULL,
	`email_enabled` boolean NOT NULL DEFAULT true,
	`push_enabled` boolean NOT NULL DEFAULT true,
	`in_app_enabled` boolean NOT NULL DEFAULT true,
	CONSTRAINT `notification_preferences_user_id_type_pk` PRIMARY KEY(`user_id`,`type`)
);
--> statement-breakpoint
CREATE TABLE `notifications` (
	`notification_id` int AUTO_INCREMENT NOT NULL,
	`user_id` int NOT NULL,
	`type` enum('system','achievement','badge','mention','comment','like','follow','team_invite','ctf','event','security') NOT NULL,
	`title` varchar(255) NOT NULL,
	`message` text,
	`link_url` varchar(255),
	`icon_url` varchar(255),
	`is_read` boolean NOT NULL DEFAULT false,
	`is_dismissed` boolean NOT NULL DEFAULT false,
	`read_at` timestamp,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `notifications_notification_id` PRIMARY KEY(`notification_id`)
);
--> statement-breakpoint
CREATE TABLE `orders` (
	`order_id` int AUTO_INCREMENT NOT NULL,
	`user_id` int NOT NULL,
	`subscription_id` int,
	`order_number` varchar(50) NOT NULL,
	`total_amount` decimal(12,2) NOT NULL,
	`discount_amount` decimal(12,2) NOT NULL DEFAULT '0',
	`tax_amount` decimal(12,2) NOT NULL DEFAULT '0',
	`final_amount` decimal(12,2) NOT NULL,
	`currency` varchar(3) NOT NULL DEFAULT 'USD',
	`status` enum('pending','paid','failed','refunded','cancelled') NOT NULL DEFAULT 'pending',
	`payment_method_id` int,
	`stripe_payment_intent_id` varchar(255),
	`paid_at` timestamp,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `orders_order_id` PRIMARY KEY(`order_id`),
	CONSTRAINT `orders_order_number_key` UNIQUE(`order_number`)
);
--> statement-breakpoint
CREATE TABLE `payment_methods` (
	`payment_method_id` int AUTO_INCREMENT NOT NULL,
	`user_id` int NOT NULL,
	`method_type` enum('credit_card','paypal','crypto','bank_transfer','enterprise_invoice') NOT NULL,
	`last4_digits` varchar(4),
	`card_brand` varchar(20),
	`stripe_payment_method_id` varchar(255),
	`paypal_email` varchar(255),
	`is_default` boolean NOT NULL DEFAULT false,
	`is_active` boolean NOT NULL DEFAULT true,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `payment_methods_payment_method_id` PRIMARY KEY(`payment_method_id`)
);
--> statement-breakpoint
CREATE TABLE `points_history` (
	`history_id` int AUTO_INCREMENT NOT NULL,
	`user_id` int NOT NULL,
	`points_change` int NOT NULL,
	`points_balance_after` int NOT NULL,
	`source_type` enum('machine_own','challenge_solve','course_complete','achievement','daily_bonus','admin_adjustment','penalty') NOT NULL,
	`source_id` int,
	`description` text,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `points_history_history_id` PRIMARY KEY(`history_id`)
);
--> statement-breakpoint
CREATE TABLE `pro_labs` (
	`pro_lab_id` int AUTO_INCREMENT NOT NULL,
	`lab_id` int NOT NULL,
	`network_ip_range` varchar(50),
	`total_machines` int NOT NULL DEFAULT 0,
	`required_root_count` int NOT NULL DEFAULT 0,
	`flag_values` json,
	`active_users_count` int NOT NULL DEFAULT 0,
	CONSTRAINT `pro_labs_pro_lab_id` PRIMARY KEY(`pro_lab_id`),
	CONSTRAINT `pro_labs_lab_id_key` UNIQUE(`lab_id`)
);
--> statement-breakpoint
CREATE TABLE `pwnbox_instances` (
	`instance_id` int AUTO_INCREMENT NOT NULL,
	`user_id` int NOT NULL,
	`vpn_id` int NOT NULL,
	`hostname` varchar(100),
	`assigned_ip` varchar(15),
	`ssh_port` int NOT NULL DEFAULT 22,
	`root_password` varchar(255),
	`ram_gb` int NOT NULL DEFAULT 2,
	`cpu_cores` int NOT NULL DEFAULT 2,
	`disk_gb` int NOT NULL DEFAULT 20,
	`status` enum('pending','running','stopped','terminated','error') NOT NULL DEFAULT 'pending',
	`started_at` timestamp NOT NULL DEFAULT (now()),
	`expires_at` timestamp,
	`terminated_at` timestamp,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `pwnbox_instances_instance_id` PRIMARY KEY(`instance_id`)
);
--> statement-breakpoint
CREATE TABLE `quiz_answers` (
	`answer_id` int AUTO_INCREMENT NOT NULL,
	`question_id` int NOT NULL,
	`answer_text` text NOT NULL,
	`is_correct` boolean NOT NULL DEFAULT false,
	`answer_order` int NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `quiz_answers_answer_id` PRIMARY KEY(`answer_id`)
);
--> statement-breakpoint
CREATE TABLE `quiz_attempts` (
	`attempt_id` int AUTO_INCREMENT NOT NULL,
	`user_id` int NOT NULL,
	`quiz_id` int NOT NULL,
	`score` int NOT NULL DEFAULT 0,
	`is_passed` boolean NOT NULL DEFAULT false,
	`attempt_number` int NOT NULL DEFAULT 1,
	`started_at` timestamp NOT NULL DEFAULT (now()),
	`completed_at` timestamp,
	`time_taken_seconds` int,
	CONSTRAINT `quiz_attempts_attempt_id` PRIMARY KEY(`attempt_id`)
);
--> statement-breakpoint
CREATE TABLE `quiz_questions` (
	`question_id` int AUTO_INCREMENT NOT NULL,
	`quiz_id` int NOT NULL,
	`question_text` text NOT NULL,
	`question_type` enum('multiple_choice','true_false','fill_blank','multiple_select') NOT NULL DEFAULT 'multiple_choice',
	`points` int NOT NULL DEFAULT 10,
	`explanation` text,
	`question_order` int NOT NULL,
	`is_active` boolean NOT NULL DEFAULT true,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `quiz_questions_question_id` PRIMARY KEY(`question_id`)
);
--> statement-breakpoint
CREATE TABLE `quizzes` (
	`quiz_id` int AUTO_INCREMENT NOT NULL,
	`module_id` int NOT NULL,
	`title` varchar(255) NOT NULL,
	`description` text,
	`passing_score` int NOT NULL DEFAULT 70,
	`time_limit_minutes` int,
	`is_required` boolean NOT NULL DEFAULT true,
	`is_published` boolean NOT NULL DEFAULT true,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `quizzes_quiz_id` PRIMARY KEY(`quiz_id`)
);
--> statement-breakpoint
CREATE TABLE `reports` (
	`report_id` int AUTO_INCREMENT NOT NULL,
	`reporter_user_id` int NOT NULL,
	`reported_user_id` int,
	`target_type` enum('user','comment','review','machine','writeup','challenge','course') NOT NULL,
	`target_id` int NOT NULL,
	`report_reason` varchar(100) NOT NULL,
	`description` text,
	`status` enum('pending','reviewing','resolved','dismissed') NOT NULL DEFAULT 'pending',
	`resolved_by` int,
	`resolved_at` timestamp,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `reports_report_id` PRIMARY KEY(`report_id`)
);
--> statement-breakpoint
CREATE TABLE `reviews` (
	`review_id` int AUTO_INCREMENT NOT NULL,
	`user_id` int NOT NULL,
	`target_type` enum('machine','challenge','course','lab','writeup') NOT NULL,
	`target_id` int NOT NULL,
	`rating` int,
	`title` varchar(255),
	`content` text,
	`is_approved` boolean NOT NULL DEFAULT false,
	`helpful_count` int NOT NULL DEFAULT 0,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `reviews_review_id` PRIMARY KEY(`review_id`)
);
--> statement-breakpoint
CREATE TABLE `season_content` (
	`season_id` int NOT NULL,
	`content_type` enum('machine','challenge','lab') NOT NULL,
	`content_id` int NOT NULL,
	`release_order` int NOT NULL,
	`is_released` boolean NOT NULL DEFAULT false,
	`released_at` timestamp,
	CONSTRAINT `season_content_season_id_content_type_content_id_pk` PRIMARY KEY(`season_id`,`content_type`,`content_id`)
);
--> statement-breakpoint
CREATE TABLE `season_leaderboards` (
	`leaderboard_id` int AUTO_INCREMENT NOT NULL,
	`season_id` int NOT NULL,
	`user_id` int NOT NULL,
	`points_earned` int NOT NULL DEFAULT 0,
	`rank` int,
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `season_leaderboards_leaderboard_id` PRIMARY KEY(`leaderboard_id`),
	CONSTRAINT `season_leaderboards_season_user_key` UNIQUE(`season_id`,`user_id`)
);
--> statement-breakpoint
CREATE TABLE `seasons` (
	`season_id` int AUTO_INCREMENT NOT NULL,
	`season_name` varchar(100) NOT NULL,
	`season_number` int NOT NULL,
	`description` text,
	`banner_url` varchar(255),
	`start_date` date NOT NULL,
	`end_date` date NOT NULL,
	`is_active` boolean NOT NULL DEFAULT true,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `seasons_season_id` PRIMARY KEY(`season_id`),
	CONSTRAINT `seasons_season_number_key` UNIQUE(`season_number`)
);
--> statement-breakpoint
CREATE TABLE `sherlocks` (
	`sherlock_id` int AUTO_INCREMENT NOT NULL,
	`lab_id` int NOT NULL,
	`evidence_file_url` varchar(255),
	`evidence_file_size` bigint,
	`file_hash` varchar(64),
	`questions` json,
	`answers` json,
	`required_correct_answers` int NOT NULL DEFAULT 0,
	CONSTRAINT `sherlocks_sherlock_id` PRIMARY KEY(`sherlock_id`),
	CONSTRAINT `sherlocks_lab_id_key` UNIQUE(`lab_id`)
);
--> statement-breakpoint
CREATE TABLE `subscriptions` (
	`subscription_id` int AUTO_INCREMENT NOT NULL,
	`user_id` int NOT NULL,
	`organization_id` int,
	`plan_name` varchar(50) NOT NULL,
	`plan_type` enum('free','premium','enterprise','student') NOT NULL,
	`stripe_subscription_id` varchar(255),
	`start_date` timestamp NOT NULL,
	`end_date` timestamp,
	`auto_renew` boolean NOT NULL DEFAULT true,
	`is_active` boolean NOT NULL DEFAULT true,
	`cancelled_at` timestamp,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `subscriptions_subscription_id` PRIMARY KEY(`subscription_id`)
);
--> statement-breakpoint
CREATE TABLE `tags` (
	`tag_id` int AUTO_INCREMENT NOT NULL,
	`tag_name` varchar(50) NOT NULL,
	`slug` varchar(50) NOT NULL,
	`color_hex` varchar(7) NOT NULL DEFAULT '#6c757d',
	`description` text,
	`is_active` boolean NOT NULL DEFAULT true,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `tags_tag_id` PRIMARY KEY(`tag_id`),
	CONSTRAINT `tags_tag_name_key` UNIQUE(`tag_name`),
	CONSTRAINT `tags_slug_key` UNIQUE(`slug`)
);
--> statement-breakpoint
CREATE TABLE `track_content` (
	`track_id` int NOT NULL,
	`content_type` enum('machine','challenge','lab','course') NOT NULL,
	`content_id` int NOT NULL,
	`display_order` int NOT NULL,
	`required` boolean NOT NULL DEFAULT false,
	CONSTRAINT `track_content_track_id_content_type_content_id_pk` PRIMARY KEY(`track_id`,`content_type`,`content_id`)
);
--> statement-breakpoint
CREATE TABLE `tracks` (
	`track_id` int AUTO_INCREMENT NOT NULL,
	`track_name` varchar(100) NOT NULL,
	`slug` varchar(100) NOT NULL,
	`description` text,
	`difficulty_id` int NOT NULL,
	`category_id` int,
	`total_machines` int NOT NULL DEFAULT 0,
	`total_challenges` int NOT NULL DEFAULT 0,
	`total_labs` int NOT NULL DEFAULT 0,
	`is_active` boolean NOT NULL DEFAULT true,
	`is_premium` boolean NOT NULL DEFAULT false,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `tracks_track_id` PRIMARY KEY(`track_id`),
	CONSTRAINT `tracks_track_name_key` UNIQUE(`track_name`),
	CONSTRAINT `tracks_slug_key` UNIQUE(`slug`)
);
--> statement-breakpoint
CREATE TABLE `user_achievements` (
	`user_id` int NOT NULL,
	`achievement_id` int NOT NULL,
	`unlocked_at` timestamp NOT NULL DEFAULT (now()),
	`progress_data` json,
	CONSTRAINT `user_achievements_user_id_achievement_id_pk` PRIMARY KEY(`user_id`,`achievement_id`)
);
--> statement-breakpoint
CREATE TABLE `user_badges` (
	`user_id` int NOT NULL,
	`badge_id` int NOT NULL,
	`awarded_at` timestamp NOT NULL DEFAULT (now()),
	`awarded_reason` text,
	CONSTRAINT `user_badges_user_id_badge_id_pk` PRIMARY KEY(`user_id`,`badge_id`)
);
--> statement-breakpoint
CREATE TABLE `user_progress` (
	`progress_id` int AUTO_INCREMENT NOT NULL,
	`user_id` int NOT NULL,
	`course_id` int,
	`module_id` int,
	`lesson_id` int,
	`progress_percentage` decimal(5,2) NOT NULL DEFAULT '0',
	`is_completed` boolean NOT NULL DEFAULT false,
	`completed_at` timestamp,
	`last_accessed_at` timestamp NOT NULL DEFAULT (now()),
	`time_spent_seconds` int NOT NULL DEFAULT 0,
	CONSTRAINT `user_progress_progress_id` PRIMARY KEY(`progress_id`)
);
--> statement-breakpoint
CREATE TABLE `user_quiz_answers` (
	`user_answer_id` int AUTO_INCREMENT NOT NULL,
	`attempt_id` int NOT NULL,
	`question_id` int NOT NULL,
	`answer_id` int,
	`is_correct` boolean NOT NULL DEFAULT false,
	`answer_text` text,
	`points_earned` int NOT NULL DEFAULT 0,
	`answered_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `user_quiz_answers_user_answer_id` PRIMARY KEY(`user_answer_id`)
);
--> statement-breakpoint
CREATE TABLE `vpn_assignments` (
	`assignment_id` int AUTO_INCREMENT NOT NULL,
	`user_id` int NOT NULL,
	`vpn_id` int NOT NULL,
	`assigned_ip` varchar(15),
	`ovpn_config_url` varchar(255),
	`assigned_at` timestamp NOT NULL DEFAULT (now()),
	`expires_at` timestamp,
	`is_active` boolean NOT NULL DEFAULT true,
	CONSTRAINT `vpn_assignments_assignment_id` PRIMARY KEY(`assignment_id`)
);
--> statement-breakpoint
CREATE TABLE `vpn_servers` (
	`vpn_id` int AUTO_INCREMENT NOT NULL,
	`server_name` varchar(100) NOT NULL,
	`server_location` varchar(100),
	`country_id` int,
	`ip_address` varchar(15),
	`port` int NOT NULL DEFAULT 443,
	`region` enum('US','EU','ASIA','AUSTRALIA','SOUTH_AMERICA','AFRICA') NOT NULL,
	`max_users` int NOT NULL DEFAULT 100,
	`current_users` int NOT NULL DEFAULT 0,
	`is_active` boolean NOT NULL DEFAULT true,
	`is_maintenance` boolean NOT NULL DEFAULT false,
	`load_balancer_url` varchar(255),
	`status` enum('online','offline','degraded') NOT NULL DEFAULT 'online',
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `vpn_servers_vpn_id` PRIMARY KEY(`vpn_id`)
);
--> statement-breakpoint
ALTER TABLE `academy_courses` ADD CONSTRAINT `academy_courses_difficulty_id_difficulty_levels_difficulty_id_fk` FOREIGN KEY (`difficulty_id`) REFERENCES `difficulty_levels`(`difficulty_id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `academy_courses` ADD CONSTRAINT `academy_courses_category_id_categories_category_id_fk` FOREIGN KEY (`category_id`) REFERENCES `categories`(`category_id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `academy_courses` ADD CONSTRAINT `academy_courses_instructor_id_users_user_id_fk` FOREIGN KEY (`instructor_id`) REFERENCES `users`(`user_id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `activity_logs` ADD CONSTRAINT `activity_logs_user_id_users_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`user_id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `announcement_reads` ADD CONSTRAINT `announcement_reads_announcement_id_announcements_announcement_id_fk` FOREIGN KEY (`announcement_id`) REFERENCES `announcements`(`announcement_id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `announcement_reads` ADD CONSTRAINT `announcement_reads_user_id_users_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`user_id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `announcements` ADD CONSTRAINT `announcements_created_by_users_user_id_fk` FOREIGN KEY (`created_by`) REFERENCES `users`(`user_id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `categories` ADD CONSTRAINT `categories_parent_category_id_categories_category_id_fk` FOREIGN KEY (`parent_category_id`) REFERENCES `categories`(`category_id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `certificates` ADD CONSTRAINT `certificates_user_id_users_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`user_id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `certificates` ADD CONSTRAINT `certificates_course_id_academy_courses_course_id_fk` FOREIGN KEY (`course_id`) REFERENCES `academy_courses`(`course_id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `challenge_tags` ADD CONSTRAINT `challenge_tags_challenge_id_lessons_lesson_id_fk` FOREIGN KEY (`challenge_id`) REFERENCES `lessons`(`lesson_id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `challenge_tags` ADD CONSTRAINT `challenge_tags_tag_id_tags_tag_id_fk` FOREIGN KEY (`tag_id`) REFERENCES `tags`(`tag_id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `comments` ADD CONSTRAINT `comments_user_id_users_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`user_id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `comments` ADD CONSTRAINT `comments_parent_comment_id_comments_comment_id_fk` FOREIGN KEY (`parent_comment_id`) REFERENCES `comments`(`comment_id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `downloads` ADD CONSTRAINT `downloads_user_id_users_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`user_id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `downloads` ADD CONSTRAINT `downloads_file_id_files_file_id_fk` FOREIGN KEY (`file_id`) REFERENCES `files`(`file_id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `event_registrations` ADD CONSTRAINT `event_registrations_event_id_events_event_id_fk` FOREIGN KEY (`event_id`) REFERENCES `events`(`event_id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `event_registrations` ADD CONSTRAINT `event_registrations_user_id_users_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`user_id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `events` ADD CONSTRAINT `events_created_by_users_user_id_fk` FOREIGN KEY (`created_by`) REFERENCES `users`(`user_id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `invoices` ADD CONSTRAINT `invoices_order_id_orders_order_id_fk` FOREIGN KEY (`order_id`) REFERENCES `orders`(`order_id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `labs` ADD CONSTRAINT `labs_difficulty_id_difficulty_levels_difficulty_id_fk` FOREIGN KEY (`difficulty_id`) REFERENCES `difficulty_levels`(`difficulty_id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `labs` ADD CONSTRAINT `labs_category_id_categories_category_id_fk` FOREIGN KEY (`category_id`) REFERENCES `categories`(`category_id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `leaderboard_history` ADD CONSTRAINT `leaderboard_history_user_id_users_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`user_id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `leaderboards` ADD CONSTRAINT `leaderboards_user_id_users_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`user_id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `lessons` ADD CONSTRAINT `lessons_module_id_modules_module_id_fk` FOREIGN KEY (`module_id`) REFERENCES `modules`(`module_id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `likes` ADD CONSTRAINT `likes_user_id_users_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`user_id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `media` ADD CONSTRAINT `media_file_id_files_file_id_fk` FOREIGN KEY (`file_id`) REFERENCES `files`(`file_id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `modules` ADD CONSTRAINT `modules_course_id_academy_courses_course_id_fk` FOREIGN KEY (`course_id`) REFERENCES `academy_courses`(`course_id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `notification_preferences` ADD CONSTRAINT `notification_preferences_user_id_users_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`user_id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `notifications` ADD CONSTRAINT `notifications_user_id_users_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`user_id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `orders` ADD CONSTRAINT `orders_user_id_users_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`user_id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `orders` ADD CONSTRAINT `orders_subscription_id_subscriptions_subscription_id_fk` FOREIGN KEY (`subscription_id`) REFERENCES `subscriptions`(`subscription_id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `orders` ADD CONSTRAINT `orders_payment_method_id_payment_methods_payment_method_id_fk` FOREIGN KEY (`payment_method_id`) REFERENCES `payment_methods`(`payment_method_id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `payment_methods` ADD CONSTRAINT `payment_methods_user_id_users_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`user_id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `points_history` ADD CONSTRAINT `points_history_user_id_users_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`user_id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `pro_labs` ADD CONSTRAINT `pro_labs_lab_id_labs_lab_id_fk` FOREIGN KEY (`lab_id`) REFERENCES `labs`(`lab_id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `pwnbox_instances` ADD CONSTRAINT `pwnbox_instances_user_id_users_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`user_id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `pwnbox_instances` ADD CONSTRAINT `pwnbox_instances_vpn_id_vpn_servers_vpn_id_fk` FOREIGN KEY (`vpn_id`) REFERENCES `vpn_servers`(`vpn_id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `quiz_answers` ADD CONSTRAINT `quiz_answers_question_id_quiz_questions_question_id_fk` FOREIGN KEY (`question_id`) REFERENCES `quiz_questions`(`question_id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `quiz_attempts` ADD CONSTRAINT `quiz_attempts_user_id_users_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`user_id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `quiz_attempts` ADD CONSTRAINT `quiz_attempts_quiz_id_quizzes_quiz_id_fk` FOREIGN KEY (`quiz_id`) REFERENCES `quizzes`(`quiz_id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `quiz_questions` ADD CONSTRAINT `quiz_questions_quiz_id_quizzes_quiz_id_fk` FOREIGN KEY (`quiz_id`) REFERENCES `quizzes`(`quiz_id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `quizzes` ADD CONSTRAINT `quizzes_module_id_modules_module_id_fk` FOREIGN KEY (`module_id`) REFERENCES `modules`(`module_id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `reports` ADD CONSTRAINT `reports_reporter_user_id_users_user_id_fk` FOREIGN KEY (`reporter_user_id`) REFERENCES `users`(`user_id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `reports` ADD CONSTRAINT `reports_reported_user_id_users_user_id_fk` FOREIGN KEY (`reported_user_id`) REFERENCES `users`(`user_id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `reports` ADD CONSTRAINT `reports_resolved_by_users_user_id_fk` FOREIGN KEY (`resolved_by`) REFERENCES `users`(`user_id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `reviews` ADD CONSTRAINT `reviews_user_id_users_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`user_id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `season_content` ADD CONSTRAINT `season_content_season_id_seasons_season_id_fk` FOREIGN KEY (`season_id`) REFERENCES `seasons`(`season_id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `season_leaderboards` ADD CONSTRAINT `season_leaderboards_season_id_seasons_season_id_fk` FOREIGN KEY (`season_id`) REFERENCES `seasons`(`season_id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `season_leaderboards` ADD CONSTRAINT `season_leaderboards_user_id_users_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`user_id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `sherlocks` ADD CONSTRAINT `sherlocks_lab_id_labs_lab_id_fk` FOREIGN KEY (`lab_id`) REFERENCES `labs`(`lab_id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `subscriptions` ADD CONSTRAINT `subscriptions_user_id_users_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`user_id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `subscriptions` ADD CONSTRAINT `subscriptions_organization_id_organizations_organization_id_fk` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`organization_id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `track_content` ADD CONSTRAINT `track_content_track_id_tracks_track_id_fk` FOREIGN KEY (`track_id`) REFERENCES `tracks`(`track_id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `tracks` ADD CONSTRAINT `tracks_difficulty_id_difficulty_levels_difficulty_id_fk` FOREIGN KEY (`difficulty_id`) REFERENCES `difficulty_levels`(`difficulty_id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `tracks` ADD CONSTRAINT `tracks_category_id_categories_category_id_fk` FOREIGN KEY (`category_id`) REFERENCES `categories`(`category_id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `user_achievements` ADD CONSTRAINT `user_achievements_user_id_users_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`user_id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `user_achievements` ADD CONSTRAINT `user_achievements_achievement_id_achievements_achievement_id_fk` FOREIGN KEY (`achievement_id`) REFERENCES `achievements`(`achievement_id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `user_badges` ADD CONSTRAINT `user_badges_user_id_users_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`user_id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `user_badges` ADD CONSTRAINT `user_badges_badge_id_badges_badge_id_fk` FOREIGN KEY (`badge_id`) REFERENCES `badges`(`badge_id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `user_progress` ADD CONSTRAINT `user_progress_user_id_users_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`user_id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `user_progress` ADD CONSTRAINT `user_progress_course_id_academy_courses_course_id_fk` FOREIGN KEY (`course_id`) REFERENCES `academy_courses`(`course_id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `user_progress` ADD CONSTRAINT `user_progress_module_id_modules_module_id_fk` FOREIGN KEY (`module_id`) REFERENCES `modules`(`module_id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `user_progress` ADD CONSTRAINT `user_progress_lesson_id_lessons_lesson_id_fk` FOREIGN KEY (`lesson_id`) REFERENCES `lessons`(`lesson_id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `user_quiz_answers` ADD CONSTRAINT `user_quiz_answers_attempt_id_quiz_attempts_attempt_id_fk` FOREIGN KEY (`attempt_id`) REFERENCES `quiz_attempts`(`attempt_id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `user_quiz_answers` ADD CONSTRAINT `user_quiz_answers_question_id_quiz_questions_question_id_fk` FOREIGN KEY (`question_id`) REFERENCES `quiz_questions`(`question_id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `user_quiz_answers` ADD CONSTRAINT `user_quiz_answers_answer_id_quiz_answers_answer_id_fk` FOREIGN KEY (`answer_id`) REFERENCES `quiz_answers`(`answer_id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `vpn_assignments` ADD CONSTRAINT `vpn_assignments_user_id_users_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`user_id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `vpn_assignments` ADD CONSTRAINT `vpn_assignments_vpn_id_vpn_servers_vpn_id_fk` FOREIGN KEY (`vpn_id`) REFERENCES `vpn_servers`(`vpn_id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `vpn_servers` ADD CONSTRAINT `vpn_servers_country_id_countries_country_id_fk` FOREIGN KEY (`country_id`) REFERENCES `countries`(`country_id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `idx_al_user` ON `activity_logs` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_al_type` ON `activity_logs` (`activity_type`);--> statement-breakpoint
CREATE INDEX `idx_al_created` ON `activity_logs` (`created_at`);--> statement-breakpoint
CREATE INDEX `idx_published` ON `announcements` (`is_published`,`published_at`);--> statement-breakpoint
CREATE INDEX `idx_expires` ON `announcements` (`expires_at`);--> statement-breakpoint
CREATE INDEX `idx_cert_number` ON `certificates` (`certificate_number`);--> statement-breakpoint
CREATE INDEX `idx_tag` ON `challenge_tags` (`tag_id`);--> statement-breakpoint
CREATE INDEX `idx_target` ON `comments` (`target_type`,`target_id`);--> statement-breakpoint
CREATE INDEX `idx_parent` ON `comments` (`parent_comment_id`);--> statement-breakpoint
CREATE INDEX `idx_coupons_code` ON `coupons` (`code`);--> statement-breakpoint
CREATE INDEX `idx_user_file` ON `downloads` (`user_id`,`file_id`);--> statement-breakpoint
CREATE INDEX `idx_dates` ON `events` (`start_time`,`end_time`);--> statement-breakpoint
CREATE INDEX `idx_invoices_invoice_number` ON `invoices` (`invoice_number`);--> statement-breakpoint
CREATE INDEX `idx_labs_difficulty` ON `labs` (`difficulty_id`);--> statement-breakpoint
CREATE INDEX `idx_lh_user` ON `leaderboard_history` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_lh_recorded` ON `leaderboard_history` (`recorded_at`);--> statement-breakpoint
CREATE INDEX `idx_global_rank` ON `leaderboards` (`global_rank`);--> statement-breakpoint
CREATE INDEX `idx_points` ON `leaderboards` (`total_points`);--> statement-breakpoint
CREATE INDEX `idx_module_order` ON `lessons` (`module_id`,`lesson_order`);--> statement-breakpoint
CREATE INDEX `idx_media_file` ON `media` (`file_id`);--> statement-breakpoint
CREATE INDEX `idx_course_order` ON `modules` (`course_id`,`module_order`);--> statement-breakpoint
CREATE INDEX `idx_user_read` ON `notifications` (`user_id`,`is_read`);--> statement-breakpoint
CREATE INDEX `idx_created` ON `notifications` (`created_at`);--> statement-breakpoint
CREATE INDEX `idx_orders_user` ON `orders` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_orders_order_number` ON `orders` (`order_number`);--> statement-breakpoint
CREATE INDEX `idx_pm_user` ON `payment_methods` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_ph_user` ON `points_history` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_ph_created` ON `points_history` (`created_at`);--> statement-breakpoint
CREATE INDEX `idx_pi_user` ON `pwnbox_instances` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_pi_status` ON `pwnbox_instances` (`status`);--> statement-breakpoint
CREATE INDEX `idx_question` ON `quiz_answers` (`question_id`);--> statement-breakpoint
CREATE INDEX `idx_qa_user_quiz` ON `quiz_attempts` (`user_id`,`quiz_id`);--> statement-breakpoint
CREATE INDEX `idx_quiz_order` ON `quiz_questions` (`quiz_id`,`question_order`);--> statement-breakpoint
CREATE INDEX `idx_quiz_module` ON `quizzes` (`module_id`);--> statement-breakpoint
CREATE INDEX `idx_status` ON `reports` (`status`);--> statement-breakpoint
CREATE INDEX `idx_target` ON `reports` (`target_type`,`target_id`);--> statement-breakpoint
CREATE INDEX `idx_target` ON `reviews` (`target_type`,`target_id`);--> statement-breakpoint
CREATE INDEX `idx_seasons_dates` ON `seasons` (`start_date`,`end_date`);--> statement-breakpoint
CREATE INDEX `idx_sub_user` ON `subscriptions` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_sub_active` ON `subscriptions` (`is_active`);--> statement-breakpoint
CREATE INDEX `idx_tc_track` ON `track_content` (`track_id`);--> statement-breakpoint
CREATE INDEX `idx_user_badges_user` ON `user_badges` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_up_user` ON `user_progress` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_up_module` ON `user_progress` (`module_id`);--> statement-breakpoint
CREATE INDEX `idx_up_lesson` ON `user_progress` (`lesson_id`);--> statement-breakpoint
CREATE INDEX `idx_uqa_attempt` ON `user_quiz_answers` (`attempt_id`);--> statement-breakpoint
CREATE INDEX `idx_vpn_assignments_user` ON `vpn_assignments` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_vpn_region` ON `vpn_servers` (`region`);