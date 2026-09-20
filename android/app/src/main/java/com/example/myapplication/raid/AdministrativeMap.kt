package com.example.myapplication.raid

import android.content.Context
import android.graphics.BitmapFactory
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectTransformGestures
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.PathFillType
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Semaphore
import kotlinx.coroutines.sync.withPermit
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import kotlin.math.*

private val MapInk = Color(0xFF101A28)
private val MapPanel = Color(0xE818293D)
private val MapMint = Color(0xFF80C9BE)
private val MapText = Color(0xFFB4C5DD)
private val MapEdge = Color(0xFF42566E)
private const val TILE_SIZE = 256.0
private const val MIN_ZOOM = 5.0
private const val MAX_ZOOM = 18.0

/** Interactive nationwide map. Administrative data remains server-owned and is fetched only for the visible viewport. */
@Composable
fun AdministrativeMap(
    latitude: Double?, longitude: Double?, focusRegion: JSONObject?, mode: String,
    virtualX: Double, virtualY: Double, participants: JSONArray,
    loadAreas: suspend (west: Double, south: Double, east: Double, north: Double, level: String) -> JSONObject,
    lookupArea: suspend (lat: Double, lon: Double, level: String) -> JSONObject,
    onCandidate: (JSONObject) -> Unit, refreshKey: String = "", modifier: Modifier = Modifier
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val density = LocalDensity.current.density
    val densityZoom = log2(density.toDouble())
    var size by remember { mutableStateOf(IntSize.Zero) }
    var zoom by remember { mutableDoubleStateOf(6.6 + densityZoom) }
    var centerX by remember { mutableDoubleStateOf(mercatorX(127.8)) }
    var centerY by remember { mutableDoubleStateOf(mercatorY(36.0)) }
    var features by remember { mutableStateOf<List<MapFeature>>(emptyList()) }
    var loadedLevel by remember { mutableStateOf<String?>(null) }
    var selectedId by remember { mutableStateOf<String?>(null) }
    var fetchState by remember { mutableStateOf("지도를 준비 중이에요") }
    var tiles by remember { mutableStateOf<Map<String, androidx.compose.ui.graphics.ImageBitmap>>(emptyMap()) }
    var visibleTileKeys by remember { mutableStateOf<Set<String>>(emptySet()) }
    var inFlightTileKeys by remember { mutableStateOf<Set<String>>(emptySet()) }
    val tileRequests = remember { Semaphore(6) }
    var lastFocusId by remember { mutableStateOf<String?>(null) }
    // Geography occupies the same physical screen area on different-density devices.
    val displayZoom = zoom - densityZoom
    val level = when {
        displayZoom < 6.0 -> null
        displayZoom < 7.5 -> "sido"
        displayZoom < 9.5 -> "city"
        displayZoom < 11.0 -> "sigungu"
        else -> "emd"
    }
    val visibleFeatures = if (level != null && loadedLevel == level) features else emptyList()

    fun recenter(lat: Double, lon: Double, newZoom: Double? = null) {
        centerX = mercatorX(lon); centerY = mercatorY(lat)
        if (newZoom != null) zoom = newZoom
    }
    LaunchedEffect(focusRegion?.optString("id")) {
        val id = focusRegion?.optString("id")?.takeIf { it.isNotBlank() } ?: return@LaunchedEffect
        if (id != lastFocusId) {
            focusRegion.optJSONObject("center")?.let { c ->
                if (c.has("lat") && c.has("lon")) recenter(c.getDouble("lat"), c.getDouble("lon"), focusZoom(focusRegion.optString("level"), focusRegion.optBoolean("isAggregateCity")) + densityZoom)
            }
            lastFocusId = id
        }
    }

    val bounds = viewportBounds(centerX, centerY, zoom, size)
    val viewportKey = "${level}:${"%.3f".format(bounds.west)}:${"%.3f".format(bounds.south)}:${"%.3f".format(bounds.east)}:${"%.3f".format(bounds.north)}"
    LaunchedEffect(viewportKey, refreshKey) {
        if (size == IntSize.Zero) return@LaunchedEffect
        if (level == null) {
            features = emptyList(); loadedLevel = null; fetchState = ""
            return@LaunchedEffect
        }
        delay(350)
        fetchState = "행정 경계를 불러오는 중"
        try {
            val result = loadAreas(bounds.west, bounds.south, bounds.east, bounds.north, level)
            features = withContext(Dispatchers.Default) { parseFeatures(result.optJSONArray("features")) }
            loadedLevel = level
            fetchState = when {
                result.optBoolean("truncated") -> "표시 범위의 일부 경계만 표시 중"
                features.isEmpty() -> "이 확대 수준의 경계 데이터가 없어요"
                else -> "${levelName(level)} · ${features.size}개 경계"
            }
        } catch (cancelled: CancellationException) { throw cancelled }
        catch (_: Exception) { fetchState = "경계 데이터를 불러오지 못했어요" }
    }
    LaunchedEffect(centerX, centerY, zoom, size) {
        if (size == IntSize.Zero) return@LaunchedEffect
        delay(100)
        val needed = visibleTiles(centerX, centerY, zoom, size)
        // Disk cache retains reusable tiles; memory retains only the current viewport.
        val neededKeys = needed.mapTo(mutableSetOf()) { it.key }
        visibleTileKeys = neededKeys
        tiles = tiles.filterKeys { it in neededKeys }
        val requests = needed.filter { it.key !in tiles && it.key !in inFlightTileKeys }
        inFlightTileKeys = inFlightTileKeys + requests.map { it.key }
        // A needed tile may still be downloading when the camera moves. Keep that one
        // request alive so deduplication cannot leave a permanent hole in the new viewport.
        requests.forEach { tile -> scope.launch {
                try {
                    tileRequests.withPermit {
                        if (tile.key !in visibleTileKeys) return@withPermit
                        val image = withContext(Dispatchers.IO) { loadTile(context, tile.z, tile.x, tile.y) }
                        if (image != null && tile.key in visibleTileKeys) tiles = tiles + (tile.key to image)
                    }
                } finally {
                    inFlightTileKeys = inFlightTileKeys - tile.key
                }
            }
        }
    }

    Box(modifier.clipToBounds().background(MapInk).onSizeChanged { size = it }) {
        androidx.compose.foundation.Canvas(
            Modifier.fillMaxSize().testTag("administrative-map").pointerInput(Unit) {
                detectTransformGestures { centroid, pan, gestureZoom, _ ->
                    val before = screenToGeo(centroid, centerX, centerY, zoom, size)
                    zoom = (zoom + ln(gestureZoom) / ln(2.0)).coerceIn(MIN_ZOOM, MAX_ZOOM)
                    val after = screenToGeo(centroid, centerX, centerY, zoom, size)
                    centerX = (centerX + before.x - after.x).coerceIn(0.0, 1.0)
                    centerY = (centerY + before.y - after.y).coerceIn(0.0, 1.0)
                    val world = TILE_SIZE * 2.0.pow(zoom)
                    centerX = (centerX - pan.x / world).coerceIn(0.0, 1.0)
                    centerY = (centerY - pan.y / world).coerceIn(0.0, 1.0)
                }
            }
        ) {
            // Base tiles are requested only when they occupy this current viewport; missing tiles expose the honest fallback grid.
            val world = TILE_SIZE * 2.0.pow(zoom)
            visibleTiles(centerX, centerY, zoom, size).forEach { t ->
                tiles[t.key]?.let { image ->
                    val left = ((t.x / 2.0.pow(t.z) - centerX) * world + size.width / 2.0).toFloat()
                    val top = ((t.y / 2.0.pow(t.z) - centerY) * world + size.height / 2.0).toFloat()
                    val tilePixels = (TILE_SIZE * 2.0.pow(zoom - t.z)).roundToInt()
                    drawImage(image, IntOffset.Zero, IntSize(image.width, image.height), IntOffset(left.roundToInt(), top.roundToInt()), IntSize(tilePixels, tilePixels), alpha = .78f)
                }
            }
            if (tiles.isEmpty()) drawFallbackGrid(size, zoom)
            visibleFeatures.forEach { feature ->
                val selected = feature.region.optString("id") == selectedId
                feature.polygons.forEach { rings ->
                    val path = geoPath(rings, centerX, centerY, zoom, size)
                    drawPath(path, if (selected) MapMint.copy(.32f) else MapMint.copy(.10f))
                    drawPath(path, MapMint.copy(if (selected) .95f else .55f), style = Stroke(if (selected) 3f else 1.4f))
                }
            }
            if (level != null) drawPeople(participants, focusRegion, mode, centerX, centerY, zoom, size)
        }
        CaptureFlags(visibleFeatures, centerX, centerY, zoom, size) { region ->
            selectedId = region.optString("id")
            onCandidate(region)
        }
        if (level != null) Column(Modifier.align(Alignment.TopStart).padding(12.dp)) {
            MapChip("${levelName(level)} 선택", "국기를 눌러 공략하기")
        }
        if (level != null && visibleFeatures.isEmpty()) Text(fetchState, color = MapText, fontSize = 11.sp,
            modifier = Modifier.align(Alignment.BottomStart).padding(start = 10.dp, bottom = 30.dp).background(MapPanel).padding(6.dp))
        Column(Modifier.align(Alignment.CenterEnd).padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            MapButton("확대") { zoom = (zoom + 1).coerceAtMost(MAX_ZOOM) }
            MapButton("축소") { zoom = (zoom - 1).coerceAtLeast(MIN_ZOOM) }
            MapButton("현재 위치로") {
                if (latitude != null && longitude != null) recenter(latitude, longitude, max(zoom, 11.9 + densityZoom))
                else focusRegion?.optJSONObject("center")?.let { recenter(it.optDouble("lat"), it.optDouble("lon"), max(zoom, 9.9 + densityZoom)) }
            }
        }
        Text("© OpenStreetMap contributors", color = Color.White.copy(.9f), fontSize = 10.sp,
            modifier = Modifier.align(Alignment.BottomEnd).padding(8.dp).background(MapInk.copy(.7f), RoundedCornerShape(3.dp)).padding(horizontal = 4.dp, vertical = 2.dp))
    }
}

@Composable private fun MapButton(label: String, action: () -> Unit) = Text(label, color = MapMint, fontWeight = FontWeight.Bold, fontSize = 13.sp,
    modifier = Modifier.semantics { contentDescription = label }.clip(CircleShape).background(MapPanel).border(1.dp, MapEdge, CircleShape).clickable(onClick = action).padding(horizontal = 12.dp, vertical = 10.dp))
@Composable private fun MapChip(title: String, detail: String) = Column(Modifier.padding(bottom = 6.dp).background(MapPanel, RoundedCornerShape(10.dp)).border(1.dp, MapEdge, RoundedCornerShape(10.dp)).padding(horizontal = 10.dp, vertical = 6.dp)) { Text(title, color = MapMint, fontSize = 12.sp, fontWeight = FontWeight.SemiBold); if (detail.isNotBlank()) Text(detail, color = MapText, fontSize = 10.sp) }

/** Every marker opens one region directly. Nearby markers never become count clusters. */
@Composable private fun BoxScope.CaptureFlags(features: List<MapFeature>, cx: Double, cy: Double, zoom: Double, size: IntSize, choose: (JSONObject) -> Unit) {
    val density = LocalDensity.current.density
    val markers = remember(features, cx, cy, zoom, size, density) {
        placeFlags(features, cx, cy, zoom, size, density)
    }
    androidx.compose.foundation.Canvas(Modifier.fillMaxSize()) {
        markers.forEach { marker ->
            if ((marker.anchor - marker.bounds.center).getDistance() > 12.dp.toPx()) {
                drawLine(MapInk.copy(.65f), marker.anchor, marker.bounds.center, 1.dp.toPx())
                drawCircle(MapMint, 1.5.dp.toPx(), marker.anchor)
            }
        }
    }
    markers.forEach { marker ->
        val region = marker.region
        val name = region.optString("name", region.optString("fullName", "지역"))
        Column(Modifier.offset { IntOffset(marker.bounds.left.roundToInt(), marker.bounds.top.roundToInt()) }
            .size(width = 48.dp, height = 44.dp)
            .semantics { contentDescription = "${region.optString("fullName", name)} 공략 깃발. 지역 정보 열기" }
            .clickable { choose(region) },
            horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
            Text(captureFlags(region.optJSONObject("capture")), maxLines = 1, color = Color.White, fontSize = 18.sp,
                modifier = Modifier.background(MapPanel, RoundedCornerShape(6.dp)).padding(horizontal = 3.dp))
            Text(shortRegionName(name), maxLines = 1, overflow = TextOverflow.Ellipsis, color = Color.White,
                fontSize = 9.sp, lineHeight = 11.sp,
                modifier = Modifier.background(MapInk.copy(.78f), RoundedCornerShape(3.dp)).padding(horizontal = 3.dp))
        }
    }
}

private data class FlagMarker(val region: JSONObject, val anchor: Offset, val bounds: Rect)
private fun shortRegionName(name: String) = name.substringAfterLast(' ')
    .replace("특별자치도", "").replace("특별자치시", "").replace("통합특별시", "")
    .replace("특별시", "").replace("광역시", "")

private fun placeFlags(features: List<MapFeature>, cx: Double, cy: Double, zoom: Double, size: IntSize, density: Float): List<FlagMarker> {
    val width = 48f * density; val height = 44f * density; val gap = 2f * density
    val inset = 4f * density
    val viewport = Rect(inset, inset, size.width - inset, size.height - 26f * density)
    // Leave room for the level caption, search, and zoom/location controls.
    val occupied = mutableListOf(
        Rect(0f, 0f, 180f * density, 64f * density),
        Rect(size.width - 90f * density, 0f, size.width.toFloat(), 58f * density),
        Rect(size.width - 100f * density, size.height / 2f - 82f * density, size.width.toFloat(), size.height / 2f + 82f * density)
    )
    val candidates = (-3..3).flatMap { y -> (-3..3).map { x -> Offset(x * 14f * density, y * 14f * density) } }
        .sortedBy { it.getDistanceSquared() }
    return buildList {
        features.sortedBy { it.region.optString("id") }.forEach { feature ->
            val anchor = feature.labelPoint?.let { geoToScreen(it, cx, cy, zoom, size) } ?: return@forEach
            if (!viewport.contains(anchor)) return@forEach
            val bounds = candidates.asSequence().map { delta ->
                val center = anchor + delta
                Rect(center.x - width / 2, center.y - height / 2, center.x + width / 2, center.y + height / 2)
            }.firstOrNull { box ->
                box.left >= viewport.left && box.top >= viewport.top && box.right <= viewport.right && box.bottom <= viewport.bottom &&
                    occupied.none { it.overlaps(box.inflate(gap / 2)) }
            } ?: return@forEach
            occupied += bounds
            add(FlagMarker(feature.region, anchor, bounds))
        }
    }
}

private data class Geo(val x: Double, val y: Double)
private data class MapFeature(val region: JSONObject, val polygons: List<List<List<Geo>>>, val labelPoint: Geo?)
private data class Tile(val z: Int, val x: Int, val y: Int) { val key get() = "$z/$x/$y" }
private data class Bounds(val west: Double, val south: Double, val east: Double, val north: Double)
private fun mercatorX(lon: Double) = (lon + 180.0) / 360.0
private fun mercatorY(lat: Double): Double { val clamped = lat.coerceIn(-85.05112878, 85.05112878); return (1 - ln(tan(Math.PI / 4 + Math.toRadians(clamped) / 2)) / Math.PI) / 2 }
private fun mercatorLon(x: Double) = x * 360 - 180
private fun mercatorLat(y: Double) = Math.toDegrees(atan(sinh(Math.PI * (1 - 2 * y))))
private fun levelName(level: String) = when (level) { "sido" -> "시·도"; "city" -> "시·군"; "sigungu" -> "시·군·구"; else -> "읍·면·동" }
private fun focusZoom(level: String, isAggregateCity: Boolean = false) = when {
    isAggregateCity -> 8.2
    level.lowercase() in setOf("sido", "province") -> 6.6
    level.lowercase() in setOf("sigungu", "district") -> 9.9
    else -> 11.9
}
private fun captureFlags(capture: JSONObject?): String {
    val teams = capture?.optJSONArray("teams") ?: return "🏳️"
    val values = buildList { for (i in 0 until teams.length()) teams.optJSONObject(i)?.let { team -> add(team.optString("flag").ifBlank { countryFlag(team.optString("country", team.optString("countryISO", team.optString("countryIso")))) }) } }.filter { it.isNotBlank() }
    return values.take(3).joinToString("").ifBlank { "🏳️" }
}
private fun countryFlag(code: String): String {
    val c = code.trim().uppercase()
    if (c.length != 2 || c.any { it !in 'A'..'Z' }) return "🏳️"
    return String(Character.toChars(0x1F1E6 + c[0].code - 'A'.code)) + String(Character.toChars(0x1F1E6 + c[1].code - 'A'.code))
}
private fun viewportBounds(cx: Double, cy: Double, zoom: Double, s: IntSize): Bounds { val d = 1.0 / (TILE_SIZE * 2.0.pow(zoom)); return Bounds(mercatorLon(cx - s.width*d/2), mercatorLat(cy + s.height*d/2), mercatorLon(cx + s.width*d/2), mercatorLat(cy - s.height*d/2)) }
private fun geoToScreen(g: Geo, cx: Double, cy: Double, zoom: Double, s: IntSize): Offset { val w = TILE_SIZE * 2.0.pow(zoom); return Offset(((g.x-cx)*w+s.width/2).toFloat(), ((g.y-cy)*w+s.height/2).toFloat()) }
private fun screenToGeo(o: Offset, cx: Double, cy: Double, zoom: Double, s: IntSize): Geo { val w = TILE_SIZE * 2.0.pow(zoom); return Geo(cx+(o.x-s.width/2)/w, cy+(o.y-s.height/2)/w) }
private fun geoPath(rings: List<List<Geo>>, cx: Double, cy: Double, zoom: Double, s: IntSize) = androidx.compose.ui.graphics.Path().apply { fillType = PathFillType.EvenOdd; rings.forEach { ring -> ring.forEachIndexed { i, p -> val o=geoToScreen(p,cx,cy,zoom,s); if(i==0) moveTo(o.x,o.y) else lineTo(o.x,o.y) }; close() } }
private fun contains(polys: List<List<List<Geo>>>, p: Geo) = polys.any { rings -> rings.isNotEmpty() && inside(rings.first(),p) && rings.drop(1).none { inside(it,p) } }
private fun inside(ring: List<Geo>, p: Geo): Boolean { var hit=false; ring.indices.forEach { i -> val a=ring[i]; val b=ring[(i+1)%ring.size]; if ((a.y>p.y)!=(b.y>p.y) && p.x < (b.x-a.x)*(p.y-a.y)/(b.y-a.y)+a.x) hit=!hit }; return hit }
private fun parseFeatures(a: JSONArray?): List<MapFeature> = buildList { if(a!=null) for(i in 0 until a.length()) { val f=a.optJSONObject(i)?:continue; val region=f.optJSONObject("region")?:continue; val geo=f.optJSONObject("geometry")?:continue; val polygons=parseGeometry(geo); if(polygons.isNotEmpty()) { val center=region.optJSONObject("center")?.let { c -> if(c.has("lat")&&c.has("lon")) Geo(mercatorX(c.getDouble("lon")),mercatorY(c.getDouble("lat"))) else null } ?: polygons.firstOrNull()?.firstOrNull()?.let { r -> Geo(r.map{it.x}.average(),r.map{it.y}.average()) }; add(MapFeature(region, polygons, center)) } } }
private fun parseGeometry(g: JSONObject): List<List<List<Geo>>> {
    fun ring(values: JSONArray): List<Geo> = buildList {
        for (i in 0 until values.length()) values.optJSONArray(i)?.let { pair ->
            if (pair.length() >= 2) add(Geo(mercatorX(pair.optDouble(0)), mercatorY(pair.optDouble(1))))
        }
    }
    fun polygon(values: JSONArray): List<List<Geo>> = buildList {
        for (i in 0 until values.length()) values.optJSONArray(i)?.let { add(ring(it)) }
    }
    val coordinates = g.optJSONArray("coordinates") ?: return emptyList()
    return if (g.optString("type") == "MultiPolygon") buildList {
        for (i in 0 until coordinates.length()) coordinates.optJSONArray(i)?.let { add(polygon(it)) }
    } else listOf(polygon(coordinates))
}
private fun visibleTiles(cx:Double,cy:Double,z:Double,s:IntSize):List<Tile>{ val iz=floor(z).toInt().coerceIn(0,18); val n=1 shl iz; val b=viewportBounds(cx,cy,z,s); val x0=floor(mercatorX(b.west)*n).toInt().coerceIn(0,n-1); val x1=floor(mercatorX(b.east)*n).toInt().coerceIn(0,n-1); val y0=floor(mercatorY(b.north)*n).toInt().coerceIn(0,n-1); val y1=floor(mercatorY(b.south)*n).toInt().coerceIn(0,n-1); return buildList { for(y in y0..y1) for(x in x0..x1) add(Tile(iz,x,y)) } }
private fun androidx.compose.ui.graphics.drawscope.DrawScope.drawFallbackGrid(s:IntSize,z:Double){ val step=(TILE_SIZE*2.0.pow(z-floor(z))).toFloat(); var x=((s.width/2f)%step); while(x<s.width){drawLine(MapEdge.copy(.30f),Offset(x,0f),Offset(x,s.height.toFloat()));x+=step}; var y=((s.height/2f)%step);while(y<s.height){drawLine(MapEdge.copy(.30f),Offset(0f,y),Offset(s.width.toFloat(),y));y+=step} }
private fun androidx.compose.ui.graphics.drawscope.DrawScope.drawPeople(p:JSONArray, focus:JSONObject?,mode:String,cx:Double,cy:Double,z:Double,s:IntSize){
    val base=focus?.optJSONObject("center")
    for(i in 0 until p.length()){
        val u=p.optJSONObject(i)?:continue
        val hasCoordinates=!u.isNull("lat")&&!u.isNull("lon")&&u.optDouble("lat").isFinite()&&u.optDouble("lon").isFinite()
        val fallbackLat=base?.optDouble("lat")?:Double.NaN
        val lat=if(hasCoordinates)u.optDouble("lat") else fallbackLat-(u.optDouble("yM",40.0)-40.0)/111000.0
        val lon=if(hasCoordinates)u.optDouble("lon") else (base?.optDouble("lon")?:Double.NaN)+(u.optDouble("xM",60.0)-60.0)/(111000.0*cos(Math.toRadians(lat)))
        if(!lat.isFinite()||!lon.isFinite())continue
        val o=geoToScreen(Geo(mercatorX(lon),mercatorY(lat)),cx,cy,z,s)
        val simulated=u.optBoolean("simulated")
        val fill=if(simulated)Color(0xFF7FB5F4) else if(mode=="virtual")MapMint else Color(0xFFEFBE70)
        val radius=7.dp.toPx()
        drawCircle(fill,radius,o)
        drawCircle(MapInk,4.dp.toPx(),o)
        if(u.optString("frame")=="cafe-postcard")drawCircle(MapMint,radius+2.dp.toPx(),o,style=Stroke(2.dp.toPx()))
    }
}
private fun loadTile(context:Context,z:Int,x:Int,y:Int):androidx.compose.ui.graphics.ImageBitmap? { return try { val dir=File(context.cacheDir,"walkwar-osm").apply{mkdirs()}; val file=File(dir,"$z-$x-$y.png"); if(!file.exists() || System.currentTimeMillis()-file.lastModified()>7L*24*60*60*1000){ val c=(URL("https://tile.openstreetmap.org/$z/$x/$y.png").openConnection() as HttpURLConnection).apply{setRequestProperty("User-Agent","WalkWar/1.0 Android map") ;connectTimeout=7000;readTimeout=7000}; if(c.responseCode==200)c.inputStream.use{input->file.outputStream().use{input.copyTo(it)}}; c.disconnect() }; BitmapFactory.decodeFile(file.path)?.asImageBitmap() } catch(_:Exception){null} }
