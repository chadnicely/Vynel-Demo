CREATE TABLE "platform_events" (
	"event_id" text PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"platform_user_id" text NOT NULL,
	"processed_at" timestamp with time zone DEFAULT now() NOT NULL
);
