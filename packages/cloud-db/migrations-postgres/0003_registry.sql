CREATE TABLE "publishers" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"tier" text DEFAULT 'verified' NOT NULL,
	"url" text
);
--> statement-breakpoint
CREATE TABLE "catalog_items" (
	"item_id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"publisher_id" text NOT NULL,
	"display_name" text NOT NULL,
	"one_line_description" text NOT NULL,
	"category" text NOT NULL,
	"icon_name" text NOT NULL,
	"recommended_scope" text,
	"minimum_tier" text DEFAULT 'basic' NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "item_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"item_id" text NOT NULL,
	"version" text NOT NULL,
	"changelog" text DEFAULT '' NOT NULL,
	"manifest_json" text NOT NULL,
	"artifact_sha256" text NOT NULL,
	"artifact_size" integer NOT NULL,
	"min_app_version" text,
	"released_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "catalog_items" ADD CONSTRAINT "catalog_items_publisher_id_publishers_id_fk" FOREIGN KEY ("publisher_id") REFERENCES "public"."publishers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_versions" ADD CONSTRAINT "item_versions_item_id_catalog_items_item_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."catalog_items"("item_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "item_versions_item_version_unique" ON "item_versions" USING btree ("item_id","version");--> statement-breakpoint
CREATE INDEX "item_versions_item_id_idx" ON "item_versions" USING btree ("item_id");