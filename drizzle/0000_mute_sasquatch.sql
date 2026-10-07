CREATE TABLE `plan_changes` (
	`owner` text NOT NULL,
	`id` text NOT NULL,
	`payload` text NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`owner`, `id`)
);
--> statement-breakpoint
CREATE TABLE `messages` (
	`owner` text NOT NULL,
	`id` text NOT NULL,
	`payload` text NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`owner`, `id`)
);
--> statement-breakpoint
CREATE TABLE `operations` (
	`owner` text NOT NULL,
	`id` text NOT NULL,
	`payload` text NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`owner`, `id`)
);
--> statement-breakpoint
CREATE TABLE `profiles` (
	`owner` text PRIMARY KEY NOT NULL,
	`settings` text NOT NULL,
	`plan` text NOT NULL,
	`plan_version` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `records` (
	`owner` text NOT NULL,
	`id` text NOT NULL,
	`kind` text NOT NULL,
	`date` text NOT NULL,
	`payload` text NOT NULL,
	`deleted` integer DEFAULT 0 NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`owner`, `id`)
);
--> statement-breakpoint
CREATE INDEX `records_owner_date` ON `records` (`owner`,`date`);