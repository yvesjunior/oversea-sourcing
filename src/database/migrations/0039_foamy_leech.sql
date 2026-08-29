CREATE TABLE "platform_role" (
	"name" text PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"created_by" text,
	"created_by_name" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
