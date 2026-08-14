CREATE TABLE "tool_policy_defaults" (
	"tool_name" text PRIMARY KEY NOT NULL,
	"enabled" boolean,
	"card_class" text,
	"surfaces_json" jsonb,
	"feature_key" text,
	"capability_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
