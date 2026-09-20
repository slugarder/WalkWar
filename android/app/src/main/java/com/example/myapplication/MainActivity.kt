package com.example.myapplication

import android.os.Bundle
import android.Manifest
import android.os.Build
import android.content.pm.PackageManager
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat
import androidx.compose.ui.platform.LocalContext
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.SystemBarStyle
import androidx.compose.animation.Crossfade
import androidx.compose.animation.core.tween
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.LinearEasing
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.rotate
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.delay
import com.example.myapplication.raid.RaidClient

private val Ink = Color(0xFF101A28)
private val Mint = Color(0xFF80C9BE)
private val Quiet = Color(0xFFABBDD1)
private val Palette = darkColorScheme(primary = Mint, onPrimary = Ink, background = Ink,
    surface = Color(0xFF182638), onSurface = Color(0xFFECF0F6), outline = Color(0xFF42566E))

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge(statusBarStyle = SystemBarStyle.dark(android.graphics.Color.TRANSPARENT),
            navigationBarStyle = SystemBarStyle.dark(android.graphics.Color.TRANSPARENT))
        setContent { MaterialTheme(colorScheme = Palette) { Surface(Modifier.fillMaxSize(), color = Palette.background) { WalkWarApp() } } }
    }
}

@Composable
private fun WalkWarApp() {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val client = remember { RaidClient(context.applicationContext, scope) }
    var page by rememberSaveable { mutableStateOf("loading") }
    var name by rememberSaveable { mutableStateOf(client.displayName) }
    var serverSettings by remember { mutableStateOf(false) }
    var serverDraft by remember { mutableStateOf(client.serverUrl) }
    LaunchedEffect(Unit) { if (page == "map" && client.snapshot == null) page = "ready" }
    // A short brand introduction; no simulated download percentage or location request.
    LaunchedEffect(page) { if (page == "loading") { delay(1800); page = "welcome" } }
    BackHandler(page == "ready" || page == "map") { client.leave(); page = if (page == "map") "ready" else "welcome" }
    Box(Modifier.fillMaxSize().background(Ink)) {
        Image(painterResource(R.drawable.walkwar_map), null, Modifier.fillMaxSize(), contentScale = ContentScale.Crop)
        Box(Modifier.fillMaxSize().background(Brush.verticalGradient(listOf(Ink.copy(.66f), Ink.copy(.88f), Ink))))
        Crossfade(page, animationSpec = tween(450), label = "startup", modifier = Modifier.fillMaxSize()) { current ->
            when (current) {
                "loading" -> LoadingScreen()
                "welcome" -> WelcomeScreen(name, { name = it.take(20) }) { page = "ready" }
                "ready" -> ReadyScreen(name, onBack = { page = "welcome" }, onOpenMap = {
                    client.connect(name, it) { page = "map" }
                })
                "map" -> LiveRaidScreen(client) { page = "ready" }
            }
        }
        if (page == "welcome" || page == "ready") {
            TextButton(onClick = { serverDraft = client.serverUrl; serverSettings = true }, enabled = !client.busy,
                modifier = Modifier.align(Alignment.TopEnd).statusBarsPadding().padding(end = 12.dp)) { Text("서버 연결", fontSize = 12.sp) }
            if (client.busy) LinearProgressIndicator(Modifier.align(Alignment.TopCenter).statusBarsPadding().fillMaxWidth(), color = Mint)
            client.error?.let { message ->
                AlertDialog(onDismissRequest = client::dismissError, title = { Text("연결을 확인해 주세요") }, text = { Text(message) },
                    confirmButton = { TextButton(onClick = client::retry, enabled = !client.busy) { Text("재시도") } },
                    dismissButton = { TextButton(onClick = { client.dismissError(); serverSettings = true }) { Text("서버 설정") } })
            }
        }
        Box(
            Modifier.align(Alignment.TopCenter)
                .fillMaxWidth()
                .windowInsetsTopHeight(WindowInsets.statusBars.union(WindowInsets.displayCutout))
                .background(Ink)
        )
    }
    if (serverSettings) AlertDialog(onDismissRequest = { serverSettings = false }, title = { Text("게임 서버 연결") }, text = {
        Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
            OutlinedTextField(serverDraft, { serverDraft = it }, label = { Text("서버 주소") }, singleLine = true)
            Text("에뮬레이터: http://10.0.2.2:3040\nUSB 연결 휴대폰: http://127.0.0.1:3040\n서버 실행 도구의 안내를 따라 연결해 주세요.", fontSize = 12.sp, color = Quiet)
        }
    }, confirmButton = { Button(onClick = { if (client.configure(serverDraft)) serverSettings = false }) { Text("저장") } }, dismissButton = { TextButton(onClick = { serverSettings = false }) { Text("취소") } })
}

@Composable
private fun BrandMark(modifier: Modifier = Modifier) {
    Canvas(modifier.size(108.dp)) {
        val w = size.width
        drawCircle(Brush.radialGradient(listOf(Mint.copy(.20f), Color.Transparent)), w / 2)
        val path = Path().apply {
            moveTo(w * .23f, w * .34f); lineTo(w * .23f, w * .69f)
            lineTo(w * .41f, w * .60f); lineTo(w * .59f, w * .69f)
            lineTo(w * .77f, w * .60f); lineTo(w * .77f, w * .25f)
            lineTo(w * .59f, w * .34f); lineTo(w * .41f, w * .25f); close()
        }
        drawPath(path, Mint.copy(.12f))
        drawPath(path, Mint, style = Stroke(2.dp.toPx()))
        drawLine(Mint, Offset(w * .41f, w * .25f), Offset(w * .41f, w * .60f), 2.dp.toPx())
        drawLine(Mint, Offset(w * .59f, w * .34f), Offset(w * .59f, w * .69f), 2.dp.toPx())
        // Crossed swords sit above the map with a dark outline for separation.
        for (angle in listOf(-42f, 42f)) {
            rotate(angle, pivot = Offset(w * .5f, w * .49f)) {
                val blade = Path().apply {
                    moveTo(w * .5f, w * .17f)
                    lineTo(w * .545f, w * .25f)
                    lineTo(w * .535f, w * .57f)
                    lineTo(w * .465f, w * .57f)
                    lineTo(w * .455f, w * .25f)
                    close()
                }
                drawPath(blade, Ink, style = Stroke(5.dp.toPx()))
                drawPath(blade, Mint)
                drawLine(Color(0xFFE1FFF8), Offset(w * .5f, w * .24f), Offset(w * .5f, w * .54f), 1.dp.toPx())
                drawLine(Ink, Offset(w * .5f, w * .58f), Offset(w * .5f, w * .73f), 8.dp.toPx())
                drawLine(Mint, Offset(w * .5f, w * .58f), Offset(w * .5f, w * .73f), 4.dp.toPx())
                drawLine(Ink, Offset(w * .405f, w * .59f), Offset(w * .595f, w * .59f), 7.dp.toPx())
                drawLine(Mint, Offset(w * .405f, w * .59f), Offset(w * .595f, w * .59f), 3.dp.toPx())
                drawCircle(Mint, 3.dp.toPx(), Offset(w * .5f, w * .74f))
            }
        }
    }
}

@Composable
private fun LoadingScreen() {
    Box(Modifier.fillMaxSize().safeDrawingPadding().padding(28.dp)) {
        Column(Modifier.align(Alignment.Center).offset(y = (-26).dp), horizontalAlignment = Alignment.CenterHorizontally) {
            BrandMark()
            Spacer(Modifier.height(18.dp))
            Text("WalkWar", fontSize = 44.sp, fontWeight = FontWeight.Bold, color = Color.White, letterSpacing = (-1.5).sp)
            Spacer(Modifier.height(24.dp))
            Text("당신의 걸음이\n동네의 모험이 되는 곳", color = Quiet, textAlign = TextAlign.Center, fontSize = 15.sp, lineHeight = 24.sp)
        }
        Column(Modifier.align(Alignment.BottomCenter).padding(bottom = 24.dp), horizontalAlignment = Alignment.CenterHorizontally) {
            WalkingLoadingBar()
            Text("탐험을 준비하고 있어요", color = Quiet, fontSize = 12.sp, modifier = Modifier.padding(top = 16.dp))
            Text("WALK TOGETHER. RAID TOGETHER.", color = Quiet.copy(.55f), fontSize = 9.sp, letterSpacing = 1.sp, modifier = Modifier.padding(top = 36.dp))
        }
    }
}

@Composable
private fun WalkingLoadingBar() {
    val progress = remember { Animatable(0f) }
    LaunchedEffect(Unit) {
        progress.animateTo(1f, animationSpec = tween(1600, easing = LinearEasing))
    }
    Canvas(Modifier.widthIn(max = 280.dp).fillMaxWidth().height(48.dp)
        .semantics { contentDescription = "탐험 준비 중 · 걷는 사람" }) {
        val inset = 12.dp.toPx()
        val barY = size.height - 4.dp.toPx()
        val endX = inset + (size.width - inset * 2) * progress.value
        val barStart = Offset(inset, barY)
        val barEnd = Offset(endX, barY)
        drawLine(Quiet.copy(.28f), barStart, Offset(size.width - inset, barY), 4.dp.toPx(), StrokeCap.Round)
        if (progress.value > 0f) {
            drawLine(Mint.copy(.08f), barStart, barEnd, 14.dp.toPx(), StrokeCap.Round)
            drawLine(Mint.copy(.12f), barStart, barEnd, 9.dp.toPx(), StrokeCap.Round)
            drawLine(Mint, barStart, barEnd, 4.dp.toPx(), StrokeCap.Round)
        }

        // The feet follow the leading edge of the bar; limbs alternate with each step.
        val stride = kotlin.math.sin(progress.value * Math.PI.toFloat() * 10f)
        val footY = barY - 5.dp.toPx()
        val bob = kotlin.math.abs(stride) * 1.dp.toPx()
        fun point(x: Float, y: Float) = Offset(endX + x.dp.toPx(), footY + y.dp.toPx() - bob)
        fun limb(from: Offset, to: Offset) = drawLine(Mint, from, to, 2.3.dp.toPx(), StrokeCap.Round)
        val shoulder = point(1f, -20f)
        val hip = point(-1f, -11f)
        drawCircle(Mint, 2.6.dp.toPx(), point(2f, -26f))
        limb(shoulder, hip)
        limb(shoulder, point(-4f - stride * 2f, -15f))
        limb(point(-4f - stride * 2f, -15f), point(-5f - stride * 3f, -10f))
        limb(shoulder, point(4f + stride * 2f, -14f))
        limb(point(4f + stride * 2f, -14f), point(7f + stride * 2f, -13f))
        limb(hip, point(-1f + stride * 4f, -6f))
        limb(point(-1f + stride * 4f, -6f), point(stride * 7f, 0f))
        limb(hip, point(-1f - stride * 4f, -5f))
        limb(point(-1f - stride * 4f, -5f), point(-stride * 7f, 0f))
    }
}

@Composable
private fun WelcomeScreen(name: String, onName: (String) -> Unit, onStart: () -> Unit) {
    val keyboard = LocalSoftwareKeyboardController.current
    Column(Modifier.fillMaxSize().safeDrawingPadding().imePadding().verticalScroll(rememberScrollState()).padding(horizontal = 28.dp, vertical = 28.dp)) {
        Spacer(Modifier.height(48.dp))
        BrandMark()
        Text("함께 걷고,\n동네를 공략하세요", color = Color.White, fontSize = 32.sp, fontWeight = FontWeight.Bold, lineHeight = 44.sp)
        Text("익숙한 골목이 새로운 모험이 되는 시간", color = Quiet, fontSize = 14.sp, modifier = Modifier.padding(top = 16.dp, bottom = 44.dp))
        OutlinedTextField(name, onName, Modifier.fillMaxWidth(), label = { Text("참가 이름") },
            placeholder = { Text("어떤 이름으로 걸을까요?") }, singleLine = true, shape = RoundedCornerShape(14.dp),
            supportingText = { Text("${name.length}/20", Modifier.fillMaxWidth(), textAlign = TextAlign.End) },
            keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done),
            keyboardActions = KeyboardActions(onDone = { if (name.isNotBlank()) { keyboard?.hide(); onStart() } }))
        Spacer(Modifier.height(16.dp))
        Button(onClick = { keyboard?.hide(); onStart() }, enabled = name.isNotBlank(), shape = RoundedCornerShape(14.dp), modifier = Modifier.fillMaxWidth().height(54.dp)) {
            Text("시작하기  →", fontSize = 16.sp, fontWeight = FontWeight.Bold)
        }
    }
}

@Composable
private fun ReadyScreen(name: String, onBack: () -> Unit, onOpenMap: (Boolean) -> Unit) {
    val context = LocalContext.current
    var permissionMessage by rememberSaveable { mutableStateOf<String?>(null) }
    var requesting by rememberSaveable { mutableStateOf(false) }
    val permissions = remember {
        buildList {
            add(Manifest.permission.ACCESS_COARSE_LOCATION)
            add(Manifest.permission.ACCESS_FINE_LOCATION)
            if (Build.VERSION.SDK_INT >= 29) add(Manifest.permission.ACTIVITY_RECOGNITION)
        }.toTypedArray()
    }
    fun granted(permission: String) = ContextCompat.checkSelfPermission(context, permission) == PackageManager.PERMISSION_GRANTED
    val launcher = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { result ->
        requesting = false
        val location = result[Manifest.permission.ACCESS_COARSE_LOCATION] == true ||
            result[Manifest.permission.ACCESS_FINE_LOCATION] == true || granted(Manifest.permission.ACCESS_COARSE_LOCATION)
        val activity = Build.VERSION.SDK_INT < 29 || result[Manifest.permission.ACTIVITY_RECOGNITION] == true || granted(Manifest.permission.ACTIVITY_RECOGNITION)
        if (location && activity) onOpenMap(false)
        else permissionMessage = "권한이 허용되지 않았어요. 아래 버튼으로 가상 이동을 체험할 수 있어요."
    }
    Column(Modifier.fillMaxSize().safeDrawingPadding().padding(horizontal = 24.dp)) {
      Column(Modifier.weight(1f).fillMaxWidth().verticalScroll(rememberScrollState())) {
        TextButton(onClick = onBack) { Text("← 이름 변경") }
        Spacer(Modifier.height(20.dp))
        Text("${name.trim()}님,\n탐험을 준비해 볼까요?", fontSize = 28.sp, lineHeight = 40.sp, fontWeight = FontWeight.Bold, color = Color.White)
        Text("함께 걷기 위한 두 가지 준비", color = Quiet, modifier = Modifier.padding(top = 12.dp, bottom = 32.dp))
        listOf("위치 접근" to "지도 위에서 내 위치를 확인해요", "걸음·활동 접근" to "걸음을 공략 기여도로 반영해요").forEach { (title, description) ->
            Column(Modifier.fillMaxWidth().padding(bottom = 14.dp).background(Palette.surface.copy(.9f), RoundedCornerShape(16.dp)).border(1.dp, Palette.outline, RoundedCornerShape(16.dp)).padding(20.dp)) {
                Text(title, color = Mint, fontWeight = FontWeight.Bold, fontSize = 17.sp)
                Text(description, color = Quiet, modifier = Modifier.padding(top = 8.dp), fontSize = 14.sp)
            }
        }
        permissionMessage?.let { Text(it, color = Mint, lineHeight = 22.sp, fontSize = 13.sp, modifier = Modifier.padding(vertical = 12.dp)) }
      }
      Column(Modifier.fillMaxWidth().padding(top = 16.dp, bottom = 16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Button(onClick = {
            permissionMessage = null
            requesting = true
            launcher.launch(permissions)
        }, enabled = !requesting, shape = RoundedCornerShape(12.dp), modifier = Modifier.fillMaxWidth().heightIn(min = 54.dp)) {
            Text("허용하고 지도 열기", fontSize = 16.sp, modifier = Modifier.padding(vertical = 6.dp))
        }
        OutlinedButton(onClick = { onOpenMap(true) }, enabled = !requesting,
            shape = RoundedCornerShape(12.dp), modifier = Modifier.fillMaxWidth().heightIn(min = 54.dp)) {
            Text("지금은 가상 이동으로 체험", fontSize = 16.sp, modifier = Modifier.padding(vertical = 6.dp))
        }
      }
    }
}

@Preview(widthDp = 390, heightDp = 844, showBackground = true)
@Composable
private fun LoadingPreview() { MaterialTheme(colorScheme = Palette) { Box(Modifier.fillMaxSize().background(Ink)) { LoadingScreen() } } }
