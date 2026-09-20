CREATE TABLE "list_items" (
	"id" uuid PRIMARY KEY NOT NULL,
	"list_id" uuid NOT NULL,
	"ean" varchar(20),
	"free_text" varchar(200),
	"name_snapshot" varchar(200),
	"price_cents_snapshot" integer,
	"qty" numeric(10, 3) DEFAULT '1' NOT NULL,
	"qty_unit" varchar(8) DEFAULT 'kpl' NOT NULL,
	"note" varchar(200),
	"checked" boolean DEFAULT false NOT NULL,
	"checked_by" uuid,
	"checked_at" timestamp with time zone,
	"sort_key" numeric(20, 6) DEFAULT '0' NOT NULL,
	"added_by" uuid,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "list_members" (
	"id" uuid PRIMARY KEY NOT NULL,
	"list_id" uuid NOT NULL,
	"nickname" varchar(40) NOT NULL,
	"role" varchar(16) DEFAULT 'editor' NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lists" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" varchar(120) NOT NULL,
	"store_id" varchar(16) DEFAULT 'N106' NOT NULL,
	"item_count" integer DEFAULT 0 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "share_tokens" (
	"token" varchar(32) PRIMARY KEY NOT NULL,
	"list_id" uuid NOT NULL,
	"role" varchar(16) DEFAULT 'editor' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"last_used_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "list_items" ADD CONSTRAINT "list_items_list_id_lists_id_fk" FOREIGN KEY ("list_id") REFERENCES "public"."lists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "list_members" ADD CONSTRAINT "list_members_list_id_lists_id_fk" FOREIGN KEY ("list_id") REFERENCES "public"."lists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "share_tokens" ADD CONSTRAINT "share_tokens_list_id_lists_id_fk" FOREIGN KEY ("list_id") REFERENCES "public"."lists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "list_items_list_idx" ON "list_items" USING btree ("list_id");--> statement-breakpoint
CREATE INDEX "list_items_live_idx" ON "list_items" USING btree ("list_id","sort_key") WHERE "list_items"."deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "list_members_unique" ON "list_members" USING btree ("list_id","id");--> statement-breakpoint
CREATE INDEX "lists_updated_idx" ON "lists" USING btree ("updated_at");--> statement-breakpoint
CREATE INDEX "share_tokens_list_idx" ON "share_tokens" USING btree ("list_id");