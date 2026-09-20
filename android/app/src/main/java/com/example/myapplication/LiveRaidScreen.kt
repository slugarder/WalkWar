package com.example.myapplication

import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.*
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import com.example.myapplication.raid.*
import kotlinx.coroutines.*
import org.json.JSONArray
import org.json.JSONObject
import kotlin.math.*
import java.text.SimpleDateFormat
import java.util.Locale
import java.util.TimeZone

private val LiveInk = Color(0xFF101A28)
private val LivePanel = Color(0xFF182638)
private val LiveMint = Color(0xFF80C9BE)
private val LiveQuiet = Color(0xFFABBDD1)

private fun color(value: String, fallback: Color = LiveMint): Color = runCatching { Color(android.graphics.Color.parseColor(value)) }.getOrDefault(fallback)
private fun levelName(level: String) = when (level) { "sido" -> "시·도"; "sigungu" -> "시·군·구"; else -> "읍·면·동" }
private fun captureTime(value: String): String = runCatching {
    val date = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US).apply { timeZone = TimeZone.getTimeZone("UTC") }.parse(value)!!
    SimpleDateFormat("yyyy-MM-dd HH:mm:ss", Locale.KOREA).apply { timeZone = TimeZone.getTimeZone("Asia/Seoul") }.format(date) + " KST"
}.getOrDefault(value)
private fun flag(country: String): String = if (country.length == 2 && country.all { it.isLetter() }) country.uppercase().map { String(Character.toChars(0x1F1E6 + it.code - 'A'.code)) }.joinToString("") else "🏳️"
private fun captureFlags(region: JSONObject): String = region.obj("capture").arr("teams").objects().map { it.nullableString("flag") ?: flag(it.optString("country")) }.distinct().joinToString(" ").ifBlank { "🏳️" }

@Composable
internal fun LiveRaidScreen(client: RaidClient, onBack: () -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val activity = context as ComponentActivity
    var active by remember { mutableStateOf(activity.lifecycle.currentState.isAtLeast(Lifecycle.State.STARTED)) }
    var tab by remember { mutableStateOf("지도") }
    var candidate by remember { mutableStateOf<JSONObject?>(null) }
    var search by remember { mutableStateOf(false) }
    var history by remember { mutableStateOf(false) }
    var confirmReset by remember { mutableStateOf(false) }
    var gpsText by remember { mutableStateOf("현재 위치를 확인하고 있어요") }
    var infoError by remember { mutableStateOf<String?>(null) }
    var loadingInfo by remember { mutableStateOf(false) }
    val state = client.snapshot ?: return
    val player = state.obj("player")
    val raid = state.optJSONObject("raid")
    val region = state.optJSONObject("region")
    val progress = state.obj("progress")
    val mode = client.mode
    DisposableEffect(activity, client) {
        val observer = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_START) { active = true; client.foreground = true }
            if (event == Lifecycle.Event.ON_STOP) { active = false; client.leave() }
        }
        activity.lifecycle.addObserver(observer)
        client.foreground = active
        onDispose { activity.lifecycle.removeObserver(observer); client.leave() }
    }
    LaunchedEffect(tab) { client.stopMoving() }
    if (mode == "gps") GpsTracking(active, client::gps) { gpsText = it }

    fun inspect(area: JSONObject) {
        if (loadingInfo) return
        loadingInfo = true; infoError = null
        scope.launch {
            try { candidate = client.api.request("/regions/${encoded(area.getString("id"))}?mode=$mode").obj("region") }
            catch (cancelled: CancellationException) { throw cancelled }
            catch (e: Exception) { infoError = e.message ?: "지역 설명을 불러오지 못했어요" }
            finally { loadingInfo = false }
        }
    }

    Column(Modifier.fillMaxSize().background(LiveInk).safeDrawingPadding()) {
        Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
            TextButton(onClick = { client.leave(); onBack() }) { Text("‹ 모드") }
            Column(Modifier.weight(1f)) {
                Text("WalkWar", fontSize = 22.sp, fontWeight = FontWeight.Bold)
                Text(if (mode == "gps") "GPS · 실제 걸음" else "가상 · 자유 탐험", color = LiveMint, fontSize = 12.sp)
            }
            Text("${progress.optInt("points")} P", color = LiveMint, fontWeight = FontWeight.Bold)
        }
        if (client.error != null || infoError != null) {
            Row(Modifier.fillMaxWidth().background(Color(0xFF49342E)).padding(10.dp), verticalAlignment = Alignment.CenterVertically) {
                Text(client.error ?: infoError.orEmpty(), Modifier.weight(1f), fontSize = 12.sp)
                if (client.error != null) TextButton(onClick = client::retry, enabled = !client.busy) { Text("재시도") }
                TextButton(onClick = { client.dismissError(); infoError = null }) { Text("닫기") }
            }
        }
        if (client.busy || loadingInfo) LinearProgressIndicator(Modifier.fillMaxWidth(), color = LiveMint)
        Box(Modifier.weight(1f)) {
            when (tab) {
                "지도" -> Column {
                    CardPanel(Modifier.padding(horizontal = 14.dp)) {
                        Text(region?.optString("fullName") ?: "국기를 눌러 공략할 지역을 골라 주세요", fontSize = 14.sp, fontWeight = FontWeight.Bold)
                        if (raid != null) {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Text(raid.optString("bossName"), Modifier.weight(1f), color = LiveQuiet, fontSize = 12.sp)
                                Text("${raid.optInt("number")}번째 공략", color = LiveQuiet, fontSize = 11.sp)
                            }
                            LinearProgressIndicator(progress = { (raid.optDouble("hp") / raid.optDouble("maxHp", 1.0)).toFloat().coerceIn(0f, 1f) }, modifier = Modifier.fillMaxWidth().padding(vertical = 7.dp), color = LiveMint)
                            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                                Text("HP ${raid.optInt("hp")} / ${raid.optInt("maxHp")}", fontSize = 11.sp)
                                Text("내 기여 ${raid.optInt("selfContribution")} · ${if (raid.optString("status") == "paused") "일시 정지" else "공략 중"}", fontSize = 11.sp, color = LiveMint)
                            }
                        } else Text("지도를 줄이면 시·도, 늘리면 시·군·구와 읍·면·동을 선택할 수 있어요.", color = LiveQuiet, fontSize = 12.sp)
                    }
                    Box(Modifier.weight(1f).fillMaxWidth().padding(top = 8.dp)) {
                        AdministrativeMap(player.nullableDouble("lat"), player.nullableDouble("lon"), region, mode,
                            player.optDouble("xM", 60.0), player.optDouble("yM", 40.0), state.arr("participants"),
                            loadAreas = { w, s, e, n, level -> client.api.request("/map/regions?west=$w&south=$s&east=$e&north=$n&level=${if (level == "city") "sigungu&overview=true" else level}&mode=$mode") },
                            lookupArea = { lat, lon, level -> client.api.request("/map/region-at?lat=$lat&lon=$lon&level=${if (level == "city") "sigungu" else level}&mode=$mode") },
                            onCandidate = ::inspect, modifier = Modifier.fillMaxSize(),
                            refreshKey = "$mode:${state.arr("history").optJSONObject(0)?.optString("id")}")
                        FilledTonalButton(onClick = { search = true }, colors = ButtonDefaults.filledTonalButtonColors(containerColor = LivePanel, contentColor = LiveMint), modifier = Modifier.align(Alignment.TopEnd).padding(top = 8.dp, end = 12.dp)) { Text("지역 검색") }
                    }
                    Row(Modifier.fillMaxWidth().background(LivePanel).padding(horizontal = 14.dp, vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f)) {
                            Text("${player.optInt("totalSteps")} 걸음", color = LiveMint, fontSize = 20.sp, fontWeight = FontWeight.Bold)
                            Text(if (mode == "virtual") "조이스틱을 밀어 걸어 보세요" else gpsText, color = LiveQuiet, fontSize = 11.sp)
                            if (mode == "gps" && state.nullableString("gpsStatus") != null) Text(state.optString("gpsStatus"), color = LiveQuiet, fontSize = 10.sp)
                            if (raid != null) TextButton(onClick = { client.control(if (raid.optString("status") == "paused") "resume" else "pause") }, enabled = !client.busy) { Text(if (raid.optString("status") == "paused") "공략 재개" else "잠시 쉬기", fontSize = 12.sp) }
                        }
                        if (mode == "virtual" && raid != null) Joystick(client, enabled = !client.busy && raid.optString("status") != "paused")
                    }
                }
                "순위" -> ScrollPage {
                    Text("공략 순위", fontSize = 26.sp, fontWeight = FontWeight.Bold)
                    Text(region?.optString("fullName") ?: "공략 지역을 선택해 주세요", color = LiveQuiet)
                    RankPanel("현재 개인 순위", raid?.arr("currentPersonal") ?: JSONArray())
                    RankPanel("현재 팀 순위", raid?.arr("currentTeams") ?: JSONArray())
                    raid?.optJSONObject("latestDefeat")?.let { last ->
                        Text("최근 점령 · ${captureTime(last.optString("defeatedAt"))}", color = LiveMint)
                        RankPanel("마지막 공략 확정 팀 순위", last.arr("teams"))
                    }
                    Button(onClick = { history = true }, modifier = Modifier.fillMaxWidth()) { Text("전체 공략 기록") }
                    if (raid != null) OutlinedButton(onClick = { confirmReset = true }, modifier = Modifier.fillMaxWidth()) { Text("현재 공략 초기화") }
                }
                "수집" -> CollectionPage(client, state)
                "상점" -> ShopPage(client, state)
            }
        }
        Row(Modifier.fillMaxWidth().background(LiveInk).padding(vertical = 7.dp), horizontalArrangement = Arrangement.SpaceEvenly) {
            listOf("지도" to "map", "순위" to "trophy", "수집" to "badge", "상점" to "shop").forEach { (name, icon) ->
                Column(Modifier.width(72.dp).clickable { client.stopMoving(); tab = name }.padding(vertical = 7.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                    MapIcon(icon, if (tab == name) LiveMint else LiveQuiet, Modifier.size(23.dp))
                    Text(name, color = if (tab == name) LiveMint else LiveQuiet, fontSize = 11.sp, modifier = Modifier.padding(top = 4.dp))
                }
            }
        }
    }
    candidate?.let { area ->
        AlertDialog(onDismissRequest = { candidate = null }, containerColor = LivePanel,
            title = { Text("${captureFlags(area)}  ${area.optString("name")}") },
            text = { Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Text(area.optString("fullName"), fontWeight = FontWeight.Bold)
                Text(area.nullableString("description") ?: "${area.optString("fullName")} · ${levelName(area.optString("level"))} 행정구역입니다.")
                val capture = area.optJSONObject("capture")
                if (capture == null) Text("🏳️ 아직 점령된 적이 없는 지역이에요.", color = LiveMint)
                else {
                    Text("최근 점령 ${captureTime(capture.optString("defeatedAt"))}")
                    Text("1위 팀: ${capture.arr("teams").objects().joinToString(" · ") { it.optString("name") }}", color = LiveMint)
                }
                Text(if (mode == "gps") "GPS 모드에서는 현재 위치가 이 구역 안에 있어야 공략할 수 있어요." else "가상 모드에서는 선택한 지역에서 조이스틱으로 걸을 수 있어요.", fontSize = 12.sp, color = LiveQuiet)
                Text("행정 경계 기준 ${state.obj("dataInfo").optString("date")}", fontSize = 11.sp, color = LiveQuiet)
                client.error?.let { Text(it, color = Color(0xFFFFBD9B), fontSize = 12.sp) }
            } },
            confirmButton = { Button(enabled = !client.busy, onClick = { client.select(area) { candidate = null; tab = "지도" } }) { Text("공략 시작") } },
            dismissButton = { TextButton(onClick = { candidate = null }) { Text("닫기") } })
    }
    if (search) RegionSearch(client, onDismiss = { search = false }, onRegion = { search = false; inspect(it) })
    if (history) HistoryDialog(client) { history = false }
    if (confirmReset) AlertDialog(onDismissRequest = { confirmReset = false }, title = { Text("현재 공략을 다시 시작할까요?") },
        text = { Text("진행 중인 보스 HP와 현재 기여도를 초기화합니다. 획득한 포인트, 장비와 완료 기록은 유지됩니다.") },
        confirmButton = { TextButton(onClick = { confirmReset = false; client.control("reset") }) { Text("초기화") } },
        dismissButton = { TextButton(onClick = { confirmReset = false }) { Text("취소") } })
}

@Composable private fun CardPanel(modifier: Modifier = Modifier, content: @Composable ColumnScope.() -> Unit) {
    Column(modifier.fillMaxWidth().background(LivePanel, RoundedCornerShape(20.dp)).border(1.dp, Color(0xFF354D64), RoundedCornerShape(20.dp)).padding(16.dp), verticalArrangement = Arrangement.spacedBy(7.dp), content = content)
}
@Composable private fun ScrollPage(content: @Composable ColumnScope.() -> Unit) {
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(18.dp), verticalArrangement = Arrangement.spacedBy(16.dp), content = content)
}
@Composable private fun RankPanel(title: String, rows: JSONArray) {
    CardPanel {
        Text(title, fontWeight = FontWeight.Bold)
        if (rows.length() == 0) Text("아직 공략 기록이 없어요", color = LiveQuiet, fontSize = 12.sp)
        rows.objects().forEach { row ->
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Text("${row.optInt("rank")}  ${flag(row.optString("country"))}", Modifier.width(60.dp), color = LiveMint)
                Column(Modifier.weight(1f)) {
                    Text(row.optString("name"), fontSize = 13.sp)
                    Text(listOfNotNull(row.nullableString("title"), if (row.optBoolean("simulated")) "시뮬레이션" else null).joinToString(" · "), color = LiveQuiet, fontSize = 10.sp)
                }
                Text("${row.optInt("steps")}", fontSize = 13.sp)
            }
        }
    }
}

@Composable private fun Joystick(client: RaidClient, enabled: Boolean) {
    var knob by remember { mutableStateOf(Offset.Zero) }
    var pulse by remember { mutableStateOf<Job?>(null) }
    val scope = rememberCoroutineScope()
    DisposableEffect(enabled) { onDispose { pulse?.cancel(); client.stopMoving(); knob = Offset.Zero } }
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        Canvas(Modifier.size(88.dp).semantics { contentDescription = "가상 이동 조이스틱" }.pointerInput(enabled) {
            if (enabled) detectDragGestures(onDragStart = { p ->
                pulse?.cancel(); pulse = null
                knob = p - Offset(size.width / 2f, size.height / 2f)
                val radius = size.width * .32f; val length = knob.getDistance().coerceAtLeast(1f)
                if (length > radius) knob *= radius / length
                client.axisX = (knob.x / radius).toDouble(); client.axisY = (knob.y / radius).toDouble()
            }, onDragEnd = { knob = Offset.Zero; client.stopMoving() }, onDragCancel = { knob = Offset.Zero; client.stopMoving() }) { change, drag ->
                change.consume(); knob += drag
                val radius = size.width * .32f; val length = knob.getDistance().coerceAtLeast(1f)
                if (length > radius) knob *= radius / length
                client.axisX = (knob.x / radius).toDouble(); client.axisY = (knob.y / radius).toDouble()
            }
        }) {
            drawCircle(LiveMint.copy(if (enabled) .14f else .04f))
            drawCircle(LiveMint.copy(.3f), radius = size.width * .32f, style = androidx.compose.ui.graphics.drawscope.Stroke(1.dp.toPx()))
            drawCircle(if (enabled) LiveMint else LiveQuiet, radius = 15.dp.toPx(), center = center + knob)
        }
        Row {
            listOf("←" to (-1.0 to 0.0), "↑" to (0.0 to -1.0), "↓" to (0.0 to 1.0), "→" to (1.0 to 0.0)).forEach { (label, axis) ->
                Text(label, modifier = Modifier.size(30.dp).clickable(enabled) { pulse?.cancel(); pulse = scope.launch { client.axisX = axis.first; client.axisY = axis.second; delay(750); client.stopMoving() } }.padding(6.dp), color = LiveMint)
            }
        }
    }
}

@Composable private fun CollectionPage(client: RaidClient, state: JSONObject) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var photo by remember { mutableStateOf(loadProfilePhoto(context)?.asImageBitmap()) }
    var photoBusy by remember { mutableStateOf(false) }
    var photoError by remember { mutableStateOf<String?>(null) }
    val picker = rememberLauncherForActivityResult(ActivityResultContracts.GetContent()) { uri ->
        if (uri != null) scope.launch { photoBusy = true; try { withContext(Dispatchers.IO) { saveProfilePhoto(context, uri) }; photo = loadProfilePhoto(context)?.asImageBitmap() } catch (_: Exception) { photoError = "사진을 저장하지 못했어요" } finally { photoBusy = false } }
    }
    val progress = state.obj("progress"); val equipped = progress.obj("equipment")
    val items = state.obj("catalog").arr("items").objects(); val titles = state.obj("catalog").arr("titles").objects()
    val frame = items.firstOrNull { it.optString("id") == equipped.optString("frame") }
    val nameplate = items.firstOrNull { it.optString("id") == equipped.optString("nameplate") }
    val title = titles.firstOrNull { it.optString("id") == equipped.optString("title") }
    ScrollPage {
        Text("나의 탐험 기록", fontSize = 26.sp, fontWeight = FontWeight.Bold)
        CardPanel {
            Row(verticalAlignment = Alignment.CenterVertically) {
                ProfileMarker(frame != null, 80.dp, photo = photo, tint = color(frame?.optString("color").orEmpty()))
                Column(Modifier.padding(start = 16.dp)) {
                    Text(state.obj("player").optString("name"), fontWeight = FontWeight.Bold, color = color(nameplate?.optString("color").orEmpty(), Color.White))
                    Text(title?.optString("name") ?: "칭호 미장착", color = LiveMint, fontSize = 12.sp)
                    items.firstOrNull { it.optString("id") == equipped.optString("badge") }?.let { Text("◆ ${it.optString("name")}", color = color(it.optString("color")), fontSize = 11.sp) }
                    TextButton(enabled = !photoBusy, onClick = { picker.launch("image/*") }) { Text("프로필 사진 변경", fontSize = 11.sp) }
                }
            }
            photoError?.let { Text(it, color = LiveQuiet) }
            Text("공략 성공 ${progress.optInt("wins")}회 · 탐험 지역 ${progress.optInt("distinctRegions")}곳", fontSize = 12.sp)
        }
        Text("칭호", fontSize = 20.sp, fontWeight = FontWeight.Bold)
        val earned = progress.arr("earnedTitles").strings()
        titles.forEach { item ->
            val id = item.optString("id"); val wearing = equipped.optString("title") == id
            CardPanel {
                Text(item.optString("name"), color = if (id in earned) LiveMint else LiveQuiet, fontWeight = FontWeight.Bold)
                Text(item.optString("description"), fontSize = 12.sp, color = LiveQuiet)
                OutlinedButton(enabled = id in earned && !client.busy, onClick = { client.equip("title", if (wearing) null else id) }) { Text(if (wearing) "장착 해제" else if (id in earned) "칭호 장착" else "아직 획득 전") }
            }
        }
        Text("획득 배지", fontSize = 20.sp, fontWeight = FontWeight.Bold)
        if (progress.arr("badges").length() == 0) Text("첫 걸음부터 기록이 쌓여요.", color = LiveQuiet)
        progress.arr("badges").objects().forEach { badge -> CardPanel { Text("✦ ${badge.optString("name")}", color = LiveMint); Text(badge.optString("earnedAt").take(10), fontSize = 12.sp, color = LiveQuiet) } }
        Text("GPS와 가상 모드의 포인트·칭호·장비는 각각 저장됩니다.", color = LiveQuiet, fontSize = 11.sp)
        Text("행정구역 ${state.obj("dataInfo").optInt("regionCount")}개 · ${state.obj("dataInfo").optString("date")} 기준", color = LiveQuiet, fontSize = 11.sp)
        Text(state.obj("dataInfo").optString("source"), color = LiveQuiet, fontSize = 10.sp)
    }
}

@Composable private fun ShopPage(client: RaidClient, state: JSONObject) {
    val progress = state.obj("progress"); val owned = progress.arr("ownedItems").strings(); val equipped = progress.obj("equipment")
    var purchase by remember { mutableStateOf<JSONObject?>(null) }
    ScrollPage {
        Text("탐험가의 상점", fontSize = 26.sp, fontWeight = FontWeight.Bold)
        Text("보유 ${progress.optInt("points")} P · 공략에 기여하고 보상을 모으세요", color = LiveMint)
        state.obj("catalog").arr("items").objects().forEach { item ->
            val id = item.optString("id"); val slot = item.optString("slot"); val wearing = equipped.optString(slot) == id
            CardPanel {
                Text(item.optString("name"), color = color(item.optString("color")), fontSize = 18.sp, fontWeight = FontWeight.Bold)
                Text(item.optString("description"), color = LiveQuiet, fontSize = 12.sp)
                if (id in owned) Button(enabled = !client.busy, onClick = { client.equip(slot, if (wearing) null else id) }) { Text(if (wearing) "장착 중 · 해제" else "보유 중 · 장착") }
                else Button(enabled = !client.busy && progress.optInt("points") >= item.optInt("price"), onClick = { purchase = item }) { Text("${item.optInt("price")} P · ${if (progress.optInt("points") < item.optInt("price")) "포인트 부족" else "구매"}") }
            }
        }
    }
    purchase?.let { item -> AlertDialog(onDismissRequest = { purchase = null }, title = { Text("${item.optString("name")} 구매") }, text = { Text("${item.optInt("price")} P를 사용합니다. 구매 후 장착할 수 있어요.") }, confirmButton = { Button(onClick = { purchase = null; client.purchase(item.getString("id")) }) { Text("구매 확정") } }, dismissButton = { TextButton(onClick = { purchase = null }) { Text("취소") } }) }
}

@Composable private fun RegionSearch(client: RaidClient, onDismiss: () -> Unit, onRegion: (JSONObject) -> Unit) {
    var query by remember { mutableStateOf("") }; var results by remember { mutableStateOf<List<JSONObject>>(emptyList()) }
    var offset by remember { mutableIntStateOf(0) }; var total by remember { mutableIntStateOf(0) }; var error by remember { mutableStateOf<String?>(null) }; var loading by remember { mutableStateOf(false) }
    LaunchedEffect(query, offset) {
        loading = true; error = null
        try { delay(300); val response = client.api.request("/regions?limit=50&offset=$offset${if (query.isBlank()) "" else "&q=${encoded(query.trim())}"}"); results = response.arr("regions").objects(); total = response.optInt("total") }
        catch (cancelled: CancellationException) { throw cancelled } catch (e: Exception) { error = e.message } finally { loading = false }
    }
    AlertDialog(onDismissRequest = onDismiss, title = { Text("대한민국 지역 검색") }, text = { Column {
        OutlinedTextField(value = query, onValueChange = { query = it; offset = 0 }, singleLine = true, label = { Text("예: 부전1동, 수원시, 제주") })
        if (loading) LinearProgressIndicator(Modifier.fillMaxWidth())
        error?.let { Text(it) }
        Column(Modifier.heightIn(max = 310.dp).verticalScroll(rememberScrollState())) {
            results.forEach { area -> TextButton(onClick = { onRegion(area) }, modifier = Modifier.fillMaxWidth()) { Text("${area.optString("fullName")} · ${levelName(area.optString("level"))}", Modifier.fillMaxWidth(), fontSize = 12.sp) } }
            if (!loading && results.isEmpty()) Text("검색 결과가 없어요", Modifier.padding(16.dp))
        }
        Row { TextButton(enabled = offset > 0, onClick = { offset = (offset - 50).coerceAtLeast(0) }) { Text("이전") }; Text("${if (total == 0) 0 else offset + 1}–${min(offset + results.size, total)} / $total", Modifier.padding(top = 14.dp), fontSize = 11.sp); TextButton(enabled = offset + 50 < total, onClick = { offset += 50 }) { Text("다음") } }
    } }, confirmButton = { TextButton(onClick = onDismiss) { Text("닫기") } })
}

@Composable private fun HistoryDialog(client: RaidClient, onDismiss: () -> Unit) {
    var offset by remember { mutableIntStateOf(0) }; var result by remember { mutableStateOf(JSONObject()) }; var error by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(offset) { try { result = client.history(offset); error = null } catch (e: Exception) { error = e.message } }
    AlertDialog(onDismissRequest = onDismiss, title = { Text("완료된 공략 기록") }, text = { Column(Modifier.heightIn(max = 420.dp).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        error?.let { Text(it) }
        result.arr("records").objects().forEach { record -> CardPanel {
            Text(record.optString("regionName"), fontWeight = FontWeight.Bold)
            Text("${captureTime(record.optString("defeatedAt"))} · 내 기여 ${record.optInt("myContribution")}", fontSize = 11.sp, color = LiveQuiet)
            Text(record.arr("teams").objects().filter { it.optInt("rank") == 1 }.joinToString(" · ") { "${flag(it.optString("country"))} ${it.optString("name")}" }, color = LiveMint)
        } }
        if (result.arr("records").length() == 0 && error == null) Text("아직 완료된 공략이 없어요")
        Row { TextButton(enabled = offset > 0, onClick = { offset = (offset - 30).coerceAtLeast(0) }) { Text("이전") }; TextButton(enabled = offset + 30 < result.optInt("total"), onClick = { offset += 30 }) { Text("다음") } }
    } }, confirmButton = { TextButton(onClick = onDismiss) { Text("닫기") } })
}
