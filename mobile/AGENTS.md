# Expo HAS CHANGED

Read the exact versioned docs at https://docs.expo.dev/versions/v57.0.0/ before writing any code.

## WalkWar product requirements (2026-09-20)
- Ship one React Native application targeting iOS and Android. The existing walkwar-mobile folder is a separate web prototype; preserve it.
- The map is the main surface. Use compact floating top panels and a floating bottom bar, leaving the middle of the map clear.
- Use real Apple Liquid Glass only when the compiled iOS runtime supports both required availability checks. Android and older iOS use the blur/translucency fallback.
- Muted teal #5F9C99 / #72AAA6 over dark navy #101A28. Never place opacity on a native GlassView or its ancestors.
- Let the user choose compact / standard / large UI. Persist choice locally; scale text, icons, spacing and panel layouts together. Do not disable system font scaling or truncate essential labels to force a layout.
- Small visual icons must retain at least 48 x 48 logical-pixel pressable targets. Large text takes priority over map density; make secondary ranking expandable instead of clipping.
- Respect the OS Reduce Transparency preference and offer an explicit contrast option. Use solid surfaces when reduced transparency is active.
- No backend, GPS or pedometer production claims until connected and tested. Current migration milestone is native UI and simulated raid behavior.
- Map cleanup: omit the step-count widget, other people's map markers, raid thumbnail, monster sequence and trial label. Keep participant rankings.
- Hide the on-screen movement guide and direction buttons, but retain web WASD/arrow-key simulation. Keep the own-location marker compact and responsive to the UI size preset.
- Shop uses concise product names and prices in a shallow card. Omit promotional headings and decorative descriptions; keep purchase state and a short insufficient-points message.
- Settings shows only size choices with a sample glyph and the contrast control. Omit explanatory copy, a duplicate preview card and a duplicate close action; retain relevant OS override state and save errors.
- Purchasable cosmetics show their actual appearance inside the product card, sharing decoration with the equipped marker. Use 12px corners for content cards; reserve pill shapes for navigation. Keep landmark names on one line when space permits without truncating accessibility text.
- Map scope is all of Busan using OpenFreeMap/OSM real geometry and 16 district shortcuts. Preserve map attribution and failure/retry UI. Browsing the map must not teleport the simulated player or award raid progress. Native map currently uses WebView; device GPS remains disconnected.
- Floating controls use native clear Liquid Glass on supported iOS; web uses an explicitly approximate edge-refraction effect with reflection highlights. Never present web/native-fallback visuals as verified Apple Liquid Glass. High contrast disables decorative transparency.
