-- Shopping mode now groups by top-level department ("Maito, juusto, munat ja
-- rasvat") instead of the leaf category ("Mozzarella"), which gave nearly
-- every item its own group. Rewrites rows written before the change.
-- Department names and orders are generated from DEPARTMENT_NAMES and
-- aisleOrderForSlug in src/lib/kruoka/aisles.ts. Rows whose department is not
-- in that table are left as they were.
UPDATE "products" AS p
SET "category_name" = d.name, "category_order" = d.ord
FROM (VALUES
  ('hedelmat-ja-vihannekset', 'Hedelmät ja vihannekset', 10),
  ('leivat-keksit-ja-leivonnaiset', 'Leivät, keksit ja leivonnaiset', 20),
  ('liha-ja-kasviproteiinit', 'Liha ja kasviproteiinit', 30),
  ('kala-ja-merenelavat', 'Kala ja merenelävät', 40),
  ('valmisruoka', 'Valmisruoka', 50),
  ('maito-juusto-munat-ja-rasvat', 'Maito, juusto, munat ja rasvat', 60),
  ('kuivat-elintarvikkeet-ja-leivonta', 'Kuivat elintarvikkeet ja leivonta', 70),
  ('sailykkeet-keitot-ja-ateria-ainekset', 'Säilykkeet, keitot ja ateria-ainekset', 80),
  ('oljyt-etikat-ja-salaattikastikkeet', 'Öljyt, etikat ja salaattikastikkeet', 90),
  ('mausteet-ja-maustaminen', 'Mausteet ja maustaminen', 100),
  ('texmex-ja-maailman-maut', 'Texmex ja maailman maut', 110),
  ('pakasteet', 'Pakasteet', 120),
  ('makeiset-ja-naposteltavat', 'Makeiset ja naposteltavat', 130),
  ('juomat', 'Juomat', 140),
  ('lapset', 'Lapset', 150),
  ('lemmikit', 'Lemmikit', 160),
  ('kosmetiikka-terveys-ja-hygienia', 'Kosmetiikka, terveys ja hygienia', 170),
  ('keittio-astiat-ja-kattaus', 'Keittiö, astiat ja kattaus', 190),
  ('kodinhoito-ja-taloustarvikkeet', 'Kodinhoito ja taloustarvikkeet', 200),
  ('kodintekstiilit-ja-sisustus', 'Sisustus ja kodintekstiilit', 210),
  ('kodinkoneet-ja-elektroniikka', 'Kodinkoneet ja elektroniikka', 220),
  ('kukat-ja-puutarha', 'Kukat ja puutarha', 240),
  ('vapaa-aika-ja-urheilu', 'Vapaa-aika ja urheilu', 250),
  ('kirjat-lehdet-ja-paperitarvikkeet', 'Kirjat, lehdet ja paperitarvikkeet', 260),
  ('kengat-ja-kenkienhoito', 'Kengät ja kenkienhoito', 270),
  ('vaatteet-ja-asusteet', 'Vaatteet ja asusteet', 280)
) AS d(slug, name, ord)
WHERE split_part(p."category_path", '/', 1) = d.slug;
--> statement-breakpoint
UPDATE "list_items" AS li
SET "aisle_name" = d.name, "aisle_order" = d.ord
FROM "products" AS p, (VALUES
  ('hedelmat-ja-vihannekset', 'Hedelmät ja vihannekset', 10),
  ('leivat-keksit-ja-leivonnaiset', 'Leivät, keksit ja leivonnaiset', 20),
  ('liha-ja-kasviproteiinit', 'Liha ja kasviproteiinit', 30),
  ('kala-ja-merenelavat', 'Kala ja merenelävät', 40),
  ('valmisruoka', 'Valmisruoka', 50),
  ('maito-juusto-munat-ja-rasvat', 'Maito, juusto, munat ja rasvat', 60),
  ('kuivat-elintarvikkeet-ja-leivonta', 'Kuivat elintarvikkeet ja leivonta', 70),
  ('sailykkeet-keitot-ja-ateria-ainekset', 'Säilykkeet, keitot ja ateria-ainekset', 80),
  ('oljyt-etikat-ja-salaattikastikkeet', 'Öljyt, etikat ja salaattikastikkeet', 90),
  ('mausteet-ja-maustaminen', 'Mausteet ja maustaminen', 100),
  ('texmex-ja-maailman-maut', 'Texmex ja maailman maut', 110),
  ('pakasteet', 'Pakasteet', 120),
  ('makeiset-ja-naposteltavat', 'Makeiset ja naposteltavat', 130),
  ('juomat', 'Juomat', 140),
  ('lapset', 'Lapset', 150),
  ('lemmikit', 'Lemmikit', 160),
  ('kosmetiikka-terveys-ja-hygienia', 'Kosmetiikka, terveys ja hygienia', 170),
  ('keittio-astiat-ja-kattaus', 'Keittiö, astiat ja kattaus', 190),
  ('kodinhoito-ja-taloustarvikkeet', 'Kodinhoito ja taloustarvikkeet', 200),
  ('kodintekstiilit-ja-sisustus', 'Sisustus ja kodintekstiilit', 210),
  ('kodinkoneet-ja-elektroniikka', 'Kodinkoneet ja elektroniikka', 220),
  ('kukat-ja-puutarha', 'Kukat ja puutarha', 240),
  ('vapaa-aika-ja-urheilu', 'Vapaa-aika ja urheilu', 250),
  ('kirjat-lehdet-ja-paperitarvikkeet', 'Kirjat, lehdet ja paperitarvikkeet', 260),
  ('kengat-ja-kenkienhoito', 'Kengät ja kenkienhoito', 270),
  ('vaatteet-ja-asusteet', 'Vaatteet ja asusteet', 280)
) AS d(slug, name, ord)
WHERE li."ean" = p."ean" AND split_part(p."category_path", '/', 1) = d.slug;
