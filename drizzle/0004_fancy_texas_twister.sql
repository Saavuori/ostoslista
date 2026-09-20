ALTER TABLE "list_items" ADD COLUMN "image_url" varchar(400);--> statement-breakpoint
ALTER TABLE "list_items" ADD COLUMN "comparison_cents" integer;--> statement-breakpoint
ALTER TABLE "list_items" ADD COLUMN "comparison_unit" varchar(8);--> statement-breakpoint
ALTER TABLE "list_items" ADD COLUMN "discount_percent" integer;--> statement-breakpoint
ALTER TABLE "list_items" ADD COLUMN "discount_type" varchar(24);--> statement-breakpoint
ALTER TABLE "list_items" ADD COLUMN "offer_amount" integer;--> statement-breakpoint
ALTER TABLE "list_items" ADD COLUMN "offer_bundle_cents" integer;