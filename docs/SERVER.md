# WalkWar server

Run `npm --prefix server run dev`; it listens on `127.0.0.1:3040`. `RAID_DB_PATH` selects the SQLite file and `REGION_DATA_DIR` selects a directory containing data-agent owned `regions.json` and `boundaries.geojson`.

The boundary loader uses `properties.regionId` (with `id` and `code` fallbacks), filters map features by geometry bounding box, and uses WGS84 point-in-polygon membership including holes. It intentionally returns no fabricated regions when the official data has not been loaded.
