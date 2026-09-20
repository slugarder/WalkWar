# API v1 implementation contract

Types: `../contracts/walkwar.ts`. All success responses JSON. Failures `{error:{code,message,retryable}}` HTTP 400/404/409/503. Base `/api/v1`; initial server port 3040 loopback. All timestamps ISO except GPS capturedAt is Unix milliseconds. Nullable fields are explicit null. Persistent clientId reused on app restart; no inferred matching with old web users.

| Method/path | Body/query | Response |
|---|---|---|
| GET /health | none | {ok:true,dataInfo,...} |
| GET /regions | parentId optional (absent root), q optional searches all, level optional, offset=0, limit=100 max200 | RegionsResponse |
| GET /regions/:id | none | {region,ancestors:Region[]} |
| GET /map/regions | west,south,east,north numeric WGS84 bounds; level=sido/sigungu/emd;limit=100 max200 | {features:[{region:Region,geometry:GeoJSON Polygon or MultiPolygon}],truncated:boolean,dataInfo}; simplified actual polygons intersecting viewport |
| GET /map/region-at | lat,lon,level | {region:Region or null,ancestors:Region[]} actual emd containment then chosen ancestor; no centroid guessing |
| POST /players | JoinRequest | Snapshot; existing client returns same player, stops old input |
| GET /players/:id/state | none | Snapshot |
| POST /players/:id/session | SessionRequest | Snapshot; changes mode/region, issues new sessionId, resets input seq/sensor baseline; omitted regionId creates browsing-only session in either mode; explicit GPS target must contain a fresh verified location |
| PUT /players/:id/input | InputRequest | {accepted:boolean,lastSeq:number}; virtual only; zero axes maintains presence; stale session 409 |
| POST /players/:id/gps | GpsRequest | Snapshot; GPS only; first sample sets baseline; no backward/reset count reward; stale seq no reward; location finds emd+parents; inaccurate/stale/unmatched/region-crossing interval gives zero new contribution |
| POST /players/:id/heartbeat | {sessionId} | {ok:true}; GPS foreground presence distinct from samples |
| POST /players/:id/control | {sessionId,requestId,action:'pause'|'resume'|'reset'} | Snapshot; selected region/mode only; reset preserves progress/history |
| POST /players/:id/purchases | {requestId,itemId} | Snapshot; transactional idempotent purchase; mode captured/validated as needed; see below |
| PUT /players/:id/equipment | {requestId,slot,itemId:string|null} | Snapshot; owns item/title, correct slot, persists; use sessionId in mutation bodies to reject old-mode requests |
| GET /players/:id/history | regionId optional, offset=0, limit=30 max100 | {records:Defeat[],total:number,offset:number} current mode, all regional records (myContribution can zero) |

Purchases/equipment also accept required sessionId. Receipts scope participant+requestId, compare full logical request including mode. Response replay must not mutate twice; return fresh snapshot. Titles: first-expedition first contributed victory, local-guardian 3 contributed wins in one region, national-explorer 5 distinct emd regions. Earn once per mode. Frame `cafe-postcard` 30P #80C9BE; badge `wave-pin`60P #7FB5F4; nameplate `bujeon-pass`100P #E5BE70, names from original game. Separate wallets, inventories, titles, equipment, raids and rankings by mode for this first integration. Shared client/name/photo; UI clearly marks selected mode.

Regions=data agent ownership; metadata may have extra fields. Region service should load catalogue+WGS84 emd GeoJSON, bbox filter then point-in-polygon holes/MultiPolygon. Ancestors derive parentId; never nearest centroid as membership. Boundary source date shown in app. Source catalogue can have extra future source fields.

Map/details endpoints accept `mode=virtual|gps` (default virtual) and enrich Region with factual Korean `description` and `capture:null|{defeatedAt,encounterNumber,teams:[{id,name,country,rank:1,flag}]}`. Capture is the immutable last completed encounter's first-place team(s), never current leaders. Uncaptured regions display 🏳️. User flow: flag -> description/capture -> explicit start. GPS samples in browsing mode cannot attack or automatically select a target; exiting the selected target does not change the target.

`GET /map/regions?level=sigungu&overview=true` shows enclosing cities in place of their wards. Default sigungu shows wards. Android zoom <=8 shows sido, <=10 city overview, <=12 detailed sigungu, >12 emd. Region identifiers and server levels remain unchanged. Overlapping flags open a chooser. `/regions` searches normalize 제1동/1동 aliases. The code/boundary snapshot is 2026-07-01, not real-time current administrative data.

Virtual speed6m/s, step length .75m, 250ms server tick, 750ms input expiry,3s foreground presence expiry. Human steps affect chosen region only. Active region/mode tick only, region-scoped simulated NPCs labelled. HP720, each human contributor 100P on defeat, first-step/first-victory badges. Ranks 1,1,3, freeze latest defeat, immediate respawn, excess final contribution not transferred. State poll1s, current/history views from same confirmed server data. GPS reasonable max cadence + accepted accuracy <=50m and age<=30s, first sample or sensorEpoch/counter reset new baseline; region crossing re-baselines. Out of scope: background GPS, cash purchases, public deployment, mapping legacy ambiguous bujeon-dong to official emd. Preserve legacy original DB, provide import utility/documentation if feasible without mutating it.
