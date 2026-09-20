ALTER TABLE "products" ADD COLUMN "slug" varchar(300);--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "search_name" varchar(200);--> statement-breakpoint
CREATE INDEX "products_search_idx" ON "products" USING btree ("search_name");