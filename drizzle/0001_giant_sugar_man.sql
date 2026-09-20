CREATE TABLE "products" (
	"ean" varchar(20) PRIMARY KEY NOT NULL,
	"name" varchar(200) NOT NULL,
	"name_sv" varchar(200),
	"brand" varchar(120),
	"category_path" varchar(200),
	"category_name" varchar(120),
	"section" varchar(16),
	"category_order" integer,
	"image_url" varchar(400),
	"origin_country" varchar(8),
	"content_size" numeric(10, 3),
	"content_unit" varchar(8),
	"sold_by" varchar(20) DEFAULT 'piece' NOT NULL,
	"average_weight" numeric(10, 3),
	"popularity" numeric(12, 3) DEFAULT '0' NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "store_prices" (
	"ean" varchar(20) NOT NULL,
	"store_id" varchar(16) NOT NULL,
	"normal_cents" integer NOT NULL,
	"unit" varchar(8) DEFAULT 'kpl' NOT NULL,
	"best_unit_cents" integer NOT NULL,
	"best_kind" varchar(16) DEFAULT 'normal' NOT NULL,
	"best_amount" integer DEFAULT 1 NOT NULL,
	"best_bundle_cents" integer NOT NULL,
	"comparison_cents" integer,
	"comparison_unit" varchar(8),
	"discount_percent" integer,
	"discount_type" varchar(24),
	"valid_until" timestamp with time zone,
	"is_available" boolean DEFAULT true NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "products_name_idx" ON "products" USING btree ("name");--> statement-breakpoint
CREATE UNIQUE INDEX "store_prices_pk" ON "store_prices" USING btree ("ean","store_id");--> statement-breakpoint
CREATE INDEX "store_prices_stale_idx" ON "store_prices" USING btree ("fetched_at");