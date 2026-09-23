CREATE TABLE "store_locations" (
	"ean" varchar(20) NOT NULL,
	"store_id" varchar(16) NOT NULL,
	"department_name" varchar(120),
	"department_order" integer,
	"module" varchar(8),
	"level" varchar(8),
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "list_items" ADD COLUMN "shelf_module" varchar(8);--> statement-breakpoint
ALTER TABLE "list_items" ADD COLUMN "shelf_level" varchar(8);--> statement-breakpoint
ALTER TABLE "list_items" ADD COLUMN "located_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "store_locations_pk" ON "store_locations" USING btree ("ean","store_id");