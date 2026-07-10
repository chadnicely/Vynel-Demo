ALTER TABLE "accounts" ADD COLUMN "tier" text DEFAULT 'basic' NOT NULL;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "tier_expires_at" timestamp with time zone;