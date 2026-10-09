-- Preserve existing checkpoints and derive their canonical location from their map node.
ALTER TABLE "Floor" ADD COLUMN "corridors" JSONB;
UPDATE "Floor" SET "corridors" = jsonb_build_array(jsonb_build_object('id','f'||"number"||'-main','x',50,'y',270,'width',660,'height',60));
ALTER TABLE "Floor" ALTER COLUMN "corridors" SET NOT NULL;
ALTER TABLE "QRCheckpoint" ADD COLUMN "hospitalId" TEXT,
  ADD COLUMN "floorId" TEXT, ADD COLUMN "x" DOUBLE PRECISION,
  ADD COLUMN "y" DOUBLE PRECISION, ADD COLUMN "locationName" TEXT,
  ADD COLUMN "names" JSONB;
UPDATE "QRCheckpoint" q SET "hospitalId"=f."hospitalId", "floorId"=n."floorId", "x"=n."x", "y"=n."y",
  "locationName"=COALESCE(r."names"->>'ar',CASE n."kind" WHEN 'stairs' THEN 'الدرج' WHEN 'elevator' THEN 'المصعد' ELSE 'الممر' END || ' ' || n."x"::text),
  "names"=COALESCE(r."names",jsonb_build_object('ar',CASE n."kind" WHEN 'stairs' THEN 'الدرج' WHEN 'elevator' THEN 'المصعد' ELSE 'الممر' END || ' ' || n."x"::text,
    'en',n."kind" || ' ' || n."x"::text,'ur','مقام ' || n."x"::text,'fr','Emplacement ' || n."x"::text,'tr','Konum ' || n."x"::text,'id','Lokasi ' || n."x"::text))
FROM "MapNode" n JOIN "Floor" f ON f."id"=n."floorId" LEFT JOIN "Room" r ON r."nodeId"=n."id" WHERE q."nodeId"=n."id";
ALTER TABLE "QRCheckpoint" ALTER COLUMN "hospitalId" SET NOT NULL,
  ALTER COLUMN "floorId" SET NOT NULL, ALTER COLUMN "x" SET NOT NULL,
  ALTER COLUMN "y" SET NOT NULL, ALTER COLUMN "locationName" SET NOT NULL,
  ALTER COLUMN "names" SET NOT NULL;
CREATE INDEX "QRCheckpoint_hospitalId_floorId_idx" ON "QRCheckpoint"("hospitalId","floorId");
ALTER TABLE "QRCheckpoint" ADD CONSTRAINT "QRCheckpoint_hospitalId_fkey" FOREIGN KEY ("hospitalId") REFERENCES "Hospital"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "QRCheckpoint" ADD CONSTRAINT "QRCheckpoint_floorId_fkey" FOREIGN KEY ("floorId") REFERENCES "Floor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
INSERT INTO "QRCheckpoint" ("id","nodeId","hospitalId","floorId","x","y","locationName","names")
SELECT 'QR-'||n."id",n."id",f."hospitalId",f."id",n."x",n."y",'الدرج - الطابق '||f."number",
  jsonb_build_object('ar','الدرج - الطابق '||f."number",'en','Stairs - floor '||f."number",'ur','سیڑھیاں - منزل '||f."number",'fr','Escalier - étage '||f."number",'tr','Merdiven - kat '||f."number",'id','Tangga - lantai '||f."number")
FROM "MapNode" n JOIN "Floor" f ON f."id"=n."floorId"
WHERE n."kind"='stairs' AND NOT EXISTS (SELECT 1 FROM "QRCheckpoint" q WHERE q."nodeId"=n."id")
ON CONFLICT ("id") DO NOTHING;
ALTER TABLE "PatientJourney" ADD COLUMN "confirmedAt" TIMESTAMP(3), ADD COLUMN "confirmedCheckpointId" TEXT;
