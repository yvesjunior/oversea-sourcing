CREATE TABLE "notification_pref" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"prefs" jsonb NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "notification_pref" ADD CONSTRAINT "notification_pref_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "notification_pref_user_uq" ON "notification_pref" USING btree ("user_id");