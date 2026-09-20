# WalkWar integration

Goal: preserve the Android design and make nationwide region raids, GPS and virtual controls, titles, purchases and equipment persist through the game server.

2026-09-20: implementation authorized. User added map pinch zoom selection: wide 시도,medium 시군구,close 읍면동; tap/highlight then explicitly confirm target, zoom alone never changes active raid.

Original source game and original design are read-only references. This root contains independent implementation and DB.

Shared contract: docs/API-CONTRACT.md, contracts/walkwar.ts. Ownership: regions_data owns server/data+data import,game_server owns server/src+tests/config,android_map owns AdministrativeMap.kt,parent owns Android app/core/GPS and integration/package.

Defaults: foreground GPS first, separate progress/wallets/equipment and raid records by mode, same game rules/code; existing shop 30/60/100 P, new achievement titles; official source-covered nationwide dataset date displayed. Physical-device walking validation must be distinguished from simulator tests.

Checkpoints: regional data -> servercore contract -> Android build -> actual virtual end-to-end -> GPS permissions/location/sensor paths -> purchase/title/persistence -> packaged APK+server+run guide. No unrelated audits or broad tests.

User's final interaction decision: region flags show the winning team country from the last completed capture, white for uncaptured; tied first-place flags are displayed together. Flag -> factual region description and last capture -> explicit start. Map zoom does not change the active raid. Cities with wards appear at an intermediate city overview zoom. Browsing does not attack in either mode.

Implemented nationwide source snapshot, persistent regional/mode game server, real foreground GPS/step sensor adapter, virtual joystick, rankings/full histories, titles/shop/equipment, native zoomable map and local run/install scripts. Verification results and remaining device-validation limits: docs/VERIFICATION.md.
