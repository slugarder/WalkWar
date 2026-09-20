package com.example.myapplication

import androidx.activity.compose.BackHandler
import androidx.compose.animation.Crossfade
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.tween
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.ui.platform.LocalContext
import android.widget.Toast
import android.app.Activity
import androidx.compose.ui.platform.LocalView
import androidx.core.view.WindowCompat
import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.*
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.zIndex
import kotlinx.coroutines.delay
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.util.Locale
import kotlin.math.roundToInt

private val Teal = Color(0xFF69C6BD)
private val Frost = Color(0xFFB4C5ED)
private val Panel = Color(0xE6101C2D)
private val Edge = Color(0xFF35465D)
private fun number(n: Int) = String.format(Locale.US, "%,d", n)

@Composable
fun RaidMapScreen(name: String, virtualMode: Boolean, onBack: () -> Unit) {
    val view = LocalView.current
    val context = LocalContext.current.applicationContext
    val scope = rememberCoroutineScope()
    var profilePhoto by remember { mutableStateOf<ImageBitmap?>(null) }
    var photoBusy by remember { mutableStateOf(true) }
    LaunchedEffect(Unit) {
        profilePhoto = withContext(Dispatchers.IO) { loadProfilePhoto(context)?.asImageBitmap() }
        photoBusy = false
    }
    val photoPicker = rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri ->
        if (uri != null) scope.launch {
            photoBusy = true
            try {
                profilePhoto = withContext(Dispatchers.IO) { saveProfilePhoto(context, uri).asImageBitmap() }
            } catch (cancelled: kotlinx.coroutines.CancellationException) {
                throw cancelled
            } catch (_: Exception) {
                Toast.makeText(context, "사진을 불러오지 못했어요. 다른 사진을 선택해 주세요", Toast.LENGTH_SHORT).show()
            } finally {
                photoBusy = false
            }
        }
    }
    DisposableEffect(view) {
        val window = (view.context as? Activity)?.window
        val controller = window?.let { WindowCompat.getInsetsController(it, view) }
        val previous = controller?.isAppearanceLightNavigationBars
        controller?.isAppearanceLightNavigationBars = false
        onDispose { if (previous != null) controller?.isAppearanceLightNavigationBars = previous }
    }
    var x by rememberSaveable { mutableFloatStateOf(.5f) }
    var y by rememberSaveable { mutableFloatStateOf(.62f) }
    var steps by rememberSaveable { mutableIntStateOf(7000) }
    var hp by rememberSaveable { mutableIntStateOf(388) }
    var seconds by rememberSaveable { mutableIntStateOf(5057) }
    var wins by rememberSaveable { mutableIntStateOf(0) }
    var points by rememberSaveable { mutableIntStateOf(0) }
    var owned by rememberSaveable { mutableStateOf(false) }; var inventoryIds by rememberSaveable { mutableStateOf("") }; var equippedId by rememberSaveable { mutableStateOf("") }
    var paused by rememberSaveable { mutableStateOf(false) }
    var sheet by rememberSaveable { mutableStateOf("") }
    var notice by remember { mutableStateOf("") }
    BackHandler(sheet.isNotEmpty()) { sheet = "" }
    LaunchedEffect(paused, sheet, hp) {
        while (!paused && sheet.isEmpty() && hp > 0 && seconds > 0) { delay(1000); seconds-- }
    }
    LaunchedEffect(notice) { if (notice.isNotEmpty()) { delay(2200); notice = "" } }
    fun nextBoss() { hp = 720; seconds = 5400; sheet = "" }

    Box(Modifier.fillMaxSize().background(Color(0xFF101A28))) {
        Image(painterResource(R.drawable.walkwar_map), null, Modifier.fillMaxSize(), contentScale = ContentScale.Crop)
        Box(Modifier.fillMaxSize().background(Color(0xFF06101E).copy(alpha = .22f)))
        Column(Modifier.fillMaxSize()) {
            val screenKey = if (sheet in listOf("place", "ranking", "badges", "shop")) sheet else ""
            Crossfade(targetState = screenKey, modifier = Modifier.weight(1f).fillMaxWidth(),
                animationSpec = tween(240), label = "navigationScreen") { screen ->
            if (screen in listOf("place", "ranking", "badges", "shop")) {
                RaidDetailScreen(screen, name, steps, wins, points, owned,
                    modifier = Modifier.fillMaxSize(),
                    profilePhoto = profilePhoto, photoBusy = photoBusy, inventory = inventoryIds.split(",").filter { it.isNotEmpty() }.toSet(), equippedId = equippedId, onEquip = { id -> if (id.isEmpty() || id in inventoryIds.split(",")) { equippedId = id; owned = id.isNotEmpty() } }, onBuyItem = { id -> shopItems.find { it.id == id }?.let { item -> if (id !in inventoryIds.split(",") && points >= item.price) { points -= item.price; inventoryIds = (inventoryIds.split(",").filter { it.isNotEmpty() } + id).joinToString(","); equippedId = id; owned = true } } },
                    onEditPhoto = { photoPicker.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly)) },
                    onNavigate = { sheet = it },
                    onNext = { if (hp == 0 || seconds == 0) nextBoss() else sheet = "" },
                    onPurchase = { if (!owned && points >= 30) { points -= 30; owned = true } })
            } else {
            BoxWithConstraints(Modifier.fillMaxSize().statusBarsPadding()) {
                val width = maxWidth
                val height = maxHeight
                Box(Modifier.fillMaxWidth().height(12.dp).background(Color(0xFF101A28)))
                Column(Modifier.fillMaxWidth().zIndex(1f).padding(horizontal = 12.dp, vertical = 12.dp)) {
                    BossCard(hp, seconds, wins + 2) { sheet = "raid" }
                    Row(Modifier.fillMaxWidth().padding(top = 12.dp), horizontalArrangement = Arrangement.End, verticalAlignment = Alignment.Top) {
                        RankingCard(name, steps, Modifier.width(if (width < 370.dp) 158.dp else 170.dp)) { sheet = "ranking" }
                    }
                }
                MapLabel("부전역", "train", Modifier.offset(width * .065f, height * .46f)) { notice = "부전역 · 시연 지도" }
                MapLabel("서면역", "train", Modifier.offset(width * .77f, height * .46f)) { notice = "서면역 · 시연 지도" }
                Column(Modifier.offset(width * .80f, height * .63f), horizontalAlignment = Alignment.CenterHorizontally) {
                    MapIcon("tree", Teal, Modifier.size(23.dp))
                    Text("부전\n시민공원", color = Teal, fontSize = 13.sp, textAlign = TextAlign.Center, lineHeight = 19.sp)
                }
                Column(Modifier.offset(width * x - 36.dp, height * y), horizontalAlignment = Alignment.CenterHorizontally) {
                    ProfileMarker(equipped = equippedId.isNotEmpty(), size = 72.dp, photo = profilePhoto, tint = frameTint(equippedId),
                        modifier = Modifier.semantics {
                            contentDescription = if (owned) "내 위치 · 프레임 적용" else "내 위치 · 기본 프로필"
                        })
                }
                MapLabel("전포카페거리", "food", Modifier.align(Alignment.BottomEnd).padding(end = 20.dp, bottom = 125.dp)) { sheet = "place" }
                Column(Modifier.align(Alignment.BottomStart).padding(start = 12.dp, bottom = 16.dp)) {
                    Glass(Modifier.clickable { x = .5f; y = .62f; notice = "시작 위치로 돌아왔어요" }) {
                        Row(Modifier.padding(horizontal = 13.dp, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
                            MapIcon("target", Frost, Modifier.size(24.dp)); Spacer(Modifier.width(9.dp))
                            Text("내 위치로", color = Color.White, fontSize = 15.sp)
                        }
                    }
                }
                if (notice.isNotEmpty()) Text(notice, color = Color.White, fontSize = 12.sp,
                    modifier = Modifier.align(Alignment.Center).background(Panel, RoundedCornerShape(12.dp)).padding(16.dp))
            }
            }
            }
            Box(Modifier.fillMaxWidth()
                .background(if (sheet in listOf("place", "ranking", "badges", "shop")) Color(0xFF101A28) else Color.Transparent)
                .navigationBarsPadding().padding(horizontal = 18.dp, vertical = 12.dp)) {
                Row(
                    Modifier.fillMaxWidth()
                        .background(Brush.verticalGradient(listOf(Color(0xFF293C53), Color(0xFF18283C))), CircleShape)
                        .border(1.dp, Color(0xFF4A6077), CircleShape)
                        .padding(6.dp),
                    horizontalArrangement = Arrangement.spacedBy(4.dp)
                ) {
                    listOf(Triple("map", "지도", ""), Triple("ranking", "순위", "ranking"), Triple("medal", "수집", "badges"), Triple("cart", "상점", "shop")).forEach { (icon, label, dest) ->
                        val active = sheet == dest
                        val tabColor by animateColorAsState(if (active) Teal else Frost, tween(200), label = "tabColor")
                        val tabBackground by animateColorAsState(if (active) Teal.copy(.20f) else Color.Transparent, tween(200), label = "tabBackground")
                        Column(
                            Modifier.weight(1f).clip(CircleShape)
                                .background(tabBackground)
                                .clickable { sheet = dest }.padding(vertical = 10.dp),
                            horizontalAlignment = Alignment.CenterHorizontally
                        ) {
                            MapIcon(icon, tabColor, Modifier.size(24.dp))
                            Text(label, color = tabColor, fontSize = 12.sp,
                                fontWeight = if (active) FontWeight.SemiBold else FontWeight.Normal,
                                modifier = Modifier.padding(top = 4.dp))
                        }
                    }
                }
            }
        }
    }
    if (sheet in listOf("raid", "reward", "settings")) {
        val titles = mapOf("raid" to "부전동 골목대장", "ranking" to "참여자 랭킹", "place" to "전포카페거리", "reward" to "부전동 공략 성공!", "badges" to "내 수집", "shop" to "탐험 상점", "settings" to "탐험 설정")
        AlertDialog(onDismissRequest = { sheet = "" }, containerColor = Color(0xFF142132), titleContentColor = Color.White,
            title = { Text(titles[sheet] ?: "탐험") },
            text = { Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(14.dp)) {
                when (sheet) {
                    "raid" -> { Image(painterResource(R.drawable.walkwar_alley), "부전동 밤 골목 시안", Modifier.fillMaxWidth().height(140.dp).clip(RoundedCornerShape(12.dp)), contentScale = ContentScale.Crop)
                        Text("HP $hp / 720", color = Teal)
                        Text("동네를 걸을수록 보스의 체력이 줄어들어요\n처치에 기여하면 100 P를 받아요", color = Frost)
                        }
                    "ranking" -> { RankingRows(name, steps); Text("팀별 기여", color = Color.White); ContributionBar(1f); Text("우리 여행팀 34% · 산책팀 26%\n탐험팀 22% · 다국적팀 18%\n시연용 참가자·순위", color = Frost) }
                    "place" -> { Image(painterResource(R.drawable.walkwar_alley), null, Modifier.fillMaxWidth().height(140.dp).clip(RoundedCornerShape(12.dp)), contentScale = ContentScale.Crop)
                        Text("작은 카페와 개성 있는 가게가 이어지는 전포카페거리\n잠깐 쉬어가며 나만의 장소를 발견해 보세요", color = Frost) }
                    "reward" -> { Text("+100 P", color = Teal, fontSize = 36.sp); Text("당신의 걸음이 동네를 바꿨어요\n첫 승리 배지 획득 · 누적 공략 $wins 회", color = Frost) }
                    "badges" -> { Text("보유 포인트 $points P", color = Teal); Text("첫걸음 · 획득\n첫 승리 · ${if (wins > 0) "획득" else "첫 공략 후 획득"}\n해운대 공략 · 잠김", color = Frost); Text("공략 이력 · 부전동 $wins 회", color = Frost) }
                    "shop" -> { Avatar(64); Text("전포 네온 프레임 · 30 P", color = Teal); Text("보유 포인트 $points P", color = Frost)
                        Button(onClick = { points -= 30; owned = true }, enabled = points >= 30 && !owned) { Text(if (owned) "구매 완료" else "구매하기") } }
                    "settings" -> {
                        Row(verticalAlignment = Alignment.CenterVertically) { Text("시연 일시정지", Modifier.weight(1f), color = Frost); Switch(paused, { paused = it }) }
                        Text("지도·걸음·순위는 시연 데이터이며 이번 탐험 동안 유지됩니다", color = Frost, fontSize = 12.sp)
                        TextButton(onClick = { sheet = ""; onBack() }) { Text("탐험 준비로 돌아가기") }
                    }
                }
            } }, confirmButton = { TextButton(onClick = {
                if (sheet == "reward" || (sheet == "raid" && (hp == 0 || seconds == 0))) nextBoss()
                else { sheet = "" }
            }) { Text(if (sheet == "reward" || (sheet == "raid" && (hp == 0 || seconds == 0))) "다음 보스 공략" else "닫기") } })
    }
}

@Composable
private fun Glass(modifier: Modifier = Modifier, content: @Composable () -> Unit) {
    Box(modifier.background(Panel, RoundedCornerShape(13.dp)).border(1.dp, Edge, RoundedCornerShape(13.dp))) { content() }
}

@Composable
private fun BossCard(hp: Int, seconds: Int, encounter: Int, onClick: () -> Unit) {
    Glass(Modifier.fillMaxWidth().clickable(onClick = onClick)) {
        Row(Modifier.padding(10.dp), verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text("RAID", color = Teal, fontSize = 10.sp, modifier = Modifier.border(1.dp, Teal, RoundedCornerShape(4.dp)).padding(horizontal = 5.dp, vertical = 1.dp))
                    Text("  몬스터 #$encounter", color = Frost, fontSize = 10.sp, modifier = Modifier.weight(1f))
                    MapIcon("clock", Frost, Modifier.size(12.dp))
                    Text(String.format(Locale.US, " %02d:%02d:%02d", seconds / 3600, seconds / 60 % 60, seconds % 60), color = Frost, fontSize = 10.sp)
                }
                Text("부전동 골목대장", color = Color.White, fontWeight = FontWeight.Bold, fontSize = 20.sp, modifier = Modifier.padding(top = 5.dp, bottom = 3.dp))
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                    Text("HP  $hp / 720", color = Frost, fontSize = 12.sp)
                    Text("${(hp / 720f * 100).roundToInt()}%", color = Frost, fontSize = 12.sp)
                }
                Spacer(Modifier.height(5.dp)); ContributionBar(hp / 720f)
            }
        }
    }
}

@Composable
private fun ContributionBar(fraction: Float) {
    Box(Modifier.fillMaxWidth().height(8.dp).clip(CircleShape).background(Color(0xFF1C293B))) {
        Box(Modifier.fillMaxWidth(fraction.coerceIn(0f, 1f)).fillMaxHeight().background(Teal))
    }
}

@Composable
private fun StepRing(steps: Int) {
    Glass { Row(Modifier.padding(9.dp), verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.size(56.dp), contentAlignment = Alignment.Center) {
            Canvas(Modifier.fillMaxSize().padding(4.dp)) {
                drawArc(Edge, 0f, 360f, false, style = Stroke(5.dp.toPx()))
                drawArc(Teal, -90f, 360f * (steps / 10000f).coerceAtMost(1f), false, style = Stroke(5.dp.toPx(), cap = StrokeCap.Round))
            }
            Text("${(steps / 100).coerceAtMost(100)}%", color = Teal, fontSize = 15.sp)
        }
        Column(Modifier.padding(start = 6.dp), verticalArrangement = Arrangement.spacedBy(9.dp)) {
            Text("● ${number(steps)}보", color = Teal, fontSize = 10.sp)
            Text("● ${number((10000 - steps).coerceAtLeast(0))}보", color = Frost, fontSize = 10.sp)
        }
    } }
}

@Composable
private fun RankingCard(name: String, steps: Int, modifier: Modifier, onClick: () -> Unit) {
    Glass(modifier.clickable(onClick = onClick)) { Column(Modifier.padding(9.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) { MapIcon("medal", Teal, Modifier.size(16.dp)); Text(" 참여자 랭킹", color = Color.White, fontSize = 11.sp, modifier = Modifier.weight(1f)); Text("더보기 ›", color = Frost, fontSize = 9.sp) }
        Spacer(Modifier.height(6.dp)); RankingRows(name, steps)
    } }
}

@Composable
private fun RankingRows(name: String, steps: Int) {
    listOf("달려형", "피넛션", "타이거풀", "나").forEachIndexed { i, label ->
        if (i == 3) { HorizontalDivider(color = Edge, modifier = Modifier.padding(top = 4.dp)); Text("내 순위", color = Frost, fontSize = 9.sp, modifier = Modifier.padding(start = 26.dp, top = 4.dp)) }
        Row(Modifier.fillMaxWidth().padding(vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.size(21.dp).background(listOf(Color(0xFFD4B970), Color(0xFFA4B0D0), Color(0xFFC59978), Teal)[i], CircleShape), contentAlignment = Alignment.Center) { Text(if (i == 3) "7" else "${i + 1}", color = Color(0xFF101A28), fontSize = 13.sp) }
            Spacer(Modifier.width(6.dp)); Avatar(20); Spacer(Modifier.width(6.dp))
            Text(label, color = Frost, fontSize = 10.sp, modifier = Modifier.weight(1f))
            Text(number(listOf(48200, 41500, 38900, 28900 + steps - 7000)[i]), color = if (i == 0 || i == 3) Teal else Frost, fontSize = 10.sp)
        }
    }
}

@Composable
private fun Avatar(size: Int) { MapIcon("person", Frost, Modifier.size(size.dp).background(Color(0xFF536D96), CircleShape).border(1.dp, Frost, CircleShape).padding(4.dp)) }

@Composable
private fun ToolButton(icon: String, description: String, onClick: () -> Unit) {
    Glass(Modifier.size(48.dp).semantics { contentDescription = description }.clickable(onClick = onClick)) {
        Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { MapIcon(icon, Frost, Modifier.size(25.dp)) }
    }
}

@Composable
private fun MapLabel(label: String, icon: String, modifier: Modifier, onClick: () -> Unit) {
    Row(modifier.background(Panel.copy(.65f), RoundedCornerShape(8.dp)).clickable(onClick = onClick).padding(6.dp), verticalAlignment = Alignment.CenterVertically) {
        MapIcon(icon, Frost, Modifier.size(21.dp)); Spacer(Modifier.width(6.dp)); Text(label, color = Color.White, fontSize = 12.sp)
    }
}

@Composable
internal fun MapIcon(kind: String, tint: Color, modifier: Modifier) {
    Canvas(modifier) {
        val w = size.width; val h = size.height; val stroke = 1.8.dp.toPx()
        fun line(x: Float, y: Float, x2: Float, y2: Float) = drawLine(tint, Offset(w*x,h*y),Offset(w*x2,h*y2),stroke,StrokeCap.Round)
        fun shape(vararg p: Float, fill: Boolean = false) { val path = Path(); path.moveTo(p[0]*w,p[1]*h); for(i in 2 until p.size step 2) path.lineTo(p[i]*w,p[i+1]*h); path.close(); drawPath(path,tint,style=if(fill) androidx.compose.ui.graphics.drawscope.Fill else Stroke(stroke, join=StrokeJoin.Round)) }
        when(kind) {
            "person" -> { drawCircle(tint,w*.18f,Offset(w*.5f,h*.28f)); drawArc(tint,180f,180f,true,Offset(w*.18f,h*.53f),androidx.compose.ui.geometry.Size(w*.64f,h*.70f)) }
            "map" -> { shape(.08f,.2f,.35f,.08f,.65f,.2f,.92f,.08f,.92f,.8f,.65f,.92f,.35f,.8f,.08f,.92f); line(.35f,.08f,.35f,.8f);line(.65f,.2f,.65f,.92f) }
            "clock" -> { drawCircle(tint,w*.4f,style=Stroke(stroke));line(.5f,.24f,.5f,.5f);line(.5f,.5f,.68f,.6f) }
            "target" -> { drawCircle(tint,w*.30f,style=Stroke(stroke));drawCircle(tint,w*.13f);line(.5f,.03f,.5f,.2f);line(.5f,.8f,.5f,.97f);line(.03f,.5f,.2f,.5f);line(.8f,.5f,.97f,.5f) }
            "layers" -> { shape(.08f,.36f,.5f,.10f,.92f,.36f,.5f,.62f);line(.08f,.55f,.5f,.81f);line(.5f,.81f,.92f,.55f);line(.08f,.73f,.5f,.98f);line(.5f,.98f,.92f,.73f) }
            "arrow" -> shape(.08f,.42f,.92f,.08f,.58f,.92f,.47f,.53f,fill=true)
            "tree" -> { shape(.5f,.04f,.17f,.52f,.32f,.52f,.12f,.77f,.88f,.77f,.68f,.52f,.83f,.52f,fill=true);line(.5f,.7f,.5f,.98f) }
            "medal" -> { shape(.25f,.05f,.43f,.05f,.57f,.4f,.38f,.45f,fill=true);shape(.60f,.05f,.80f,.05f,.63f,.45f,.47f,.4f,fill=true); drawCircle(tint,w*.28f,Offset(w*.5f,h*.66f),style=Stroke(stroke));drawCircle(tint,w*.09f,Offset(w*.5f,h*.66f)) }
            "ranking" -> { shape(.08f,.48f,.30f,.48f,.30f,.92f,.08f,.92f); shape(.39f,.16f,.61f,.16f,.61f,.92f,.39f,.92f); shape(.70f,.62f,.92f,.62f,.92f,.92f,.70f,.92f) }
            "cart" -> { line(.03f,.08f,.2f,.08f);shape(.2f,.2f,.94f,.2f,.80f,.65f,.3f,.65f);line(.2f,.08f,.3f,.65f);drawCircle(tint,w*.07f,Offset(w*.38f,h*.88f));drawCircle(tint,w*.07f,Offset(w*.76f,h*.88f)) }
            "gear" -> { drawCircle(tint,w*.28f,style=Stroke(stroke*2));repeat(8){val a=it*Math.PI/4;line((.5+.3*kotlin.math.cos(a)).toFloat(),(.5+.3*kotlin.math.sin(a)).toFloat(),(.5+.44*kotlin.math.cos(a)).toFloat(),(.5+.44*kotlin.math.sin(a)).toFloat())} }
            "train" -> { shape(.23f,.1f,.77f,.1f,.77f,.75f,.23f,.75f);line(.23f,.4f,.77f,.4f);line(.32f,.78f,.19f,.95f);line(.68f,.78f,.81f,.95f);drawCircle(tint,w*.05f,Offset(w*.37f,h*.61f));drawCircle(tint,w*.05f,Offset(w*.63f,h*.61f)) }
            "food" -> { line(.28f,.1f,.28f,.92f);line(.12f,.1f,.12f,.4f);line(.43f,.1f,.43f,.4f);line(.12f,.4f,.43f,.4f);line(.78f,.1f,.78f,.92f);line(.63f,.1f,.63f,.5f);line(.63f,.5f,.78f,.5f) }
        }
    }
}




