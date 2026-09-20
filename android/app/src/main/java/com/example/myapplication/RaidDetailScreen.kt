package com.example.myapplication

import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.sp
import java.util.Locale

private val DetailMint = Color(0xFF80C9BE)
private val DetailText = Color(0xFFB4C5DD)
private val DetailEdge = Color(0xFF354A62)

@Composable
internal fun RaidDetailScreen(
    page: String, name: String, steps: Int, wins: Int, points: Int, owned: Boolean,
    modifier: Modifier = Modifier, onNavigate: (String) -> Unit, onNext: () -> Unit, onPurchase: () -> Unit,
    profilePhoto: ImageBitmap? = null, photoBusy: Boolean = false, onEditPhoto: (() -> Unit)? = null, tint: Color = DetailMint, inventory: Set<String> = if (owned) setOf("mint") else emptySet(), equippedId: String = if (owned) "mint" else "", onBuyItem: ((String) -> Unit)? = null, onEquip: (String) -> Unit = {}
) {
    var designOpen by remember { mutableStateOf(false) }
    var pendingItem by remember { mutableStateOf<ShopFrame?>(null) }
    pendingItem?.let { item ->
        AlertDialog(onDismissRequest = { pendingItem = null }, containerColor = Color(0xFF1A2A3F),
            title = { Text("구매하시겠습니까?", color = Color.White) },
            text = { Column(horizontalAlignment = Alignment.CenterHorizontally, modifier = Modifier.fillMaxWidth()) {
                ProfileMarker(true, size = 110.dp, photo = profilePhoto, tint = item.tint)
                Text(item.price.toString() + " P", color = DetailMint, fontSize = 22.sp)
            } },
            confirmButton = { TextButton(enabled = points >= item.price && item.id !in inventory, onClick = {
                if (points >= item.price && item.id !in inventory) {
                    if (onBuyItem != null) onBuyItem(item.id) else if (item.id == "mint") onPurchase()
                }
                pendingItem = null
            }) { Text("구매", color = DetailMint) } },
            dismissButton = { TextButton(onClick = { pendingItem = null }) { Text("취소", color = DetailText) } })
    }
    val title = when(page) { "place" -> "전포카페거리"; "ranking" -> "공략 순위"; "badges" -> "내 수집"; else -> "탐험 상점" }
    val scrollState = androidx.compose.runtime.key(page) { rememberScrollState() }
    if (designOpen) {
        AlertDialog(
            onDismissRequest = { designOpen = false },
            containerColor = Color(0xFF1A2A3F),
            title = { Text("프로필 디자인 변경", color = Color.White) },
            text = {
                Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    Text("보유 테두리", color = DetailText)
                    DetailAction(if (equippedId.isEmpty()) "기본 테두리 · 적용 중" else "기본 테두리",
                        { onEquip("") }, secondary = true, enabled = equippedId.isNotEmpty())
                    shopItems.filter { it.id in inventory }.forEach { item ->
                        DetailAction(item.title + if (equippedId == item.id) " · 적용 중" else "",
                            { onEquip(item.id) }, secondary = true, enabled = equippedId != item.id)
                    }
                    if (inventory.isEmpty()) Text("구매한 테두리가 여기에 표시돼요", color = DetailText, fontSize = 13.sp)
                }
            },
            confirmButton = { TextButton(onClick = { designOpen = false }) { Text("완료", color = DetailMint) } }
        )
    }
    Column(modifier.background(Brush.verticalGradient(listOf(Color(0xF5101D30), Color(0xFF101A28)))).statusBarsPadding()) {
        Row(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
            TextButton(onClick = { onNavigate("") }) { Text("← 지도", color = DetailMint) }
            Text(title, color = Color.White, fontSize = 20.sp, fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f))
            if(page in listOf("badges", "shop")) Text("${fmt(points)} P", color = DetailMint, fontWeight = FontWeight.Bold)
        }
        Box(Modifier.weight(1f).fillMaxWidth()) {
            Column(Modifier.fillMaxSize().verticalScroll(scrollState).padding(start = 22.dp, end = 22.dp, top = 12.dp, bottom = 24.dp), verticalArrangement = Arrangement.spacedBy(20.dp)) {
                when(page) {
                    "place" -> {
                        Image(painterResource(R.drawable.walkwar_alley), "골목 분위기를 표현한 시안 이미지", Modifier.fillMaxWidth().height(210.dp).clip(RoundedCornerShape(20.dp)), contentScale = ContentScale.Crop)
                        Text("부산의 골목을 만나다", color = DetailMint, fontSize = 12.sp)
                        DetailHeading("골목마다 새로운 카페")
                        Text("작은 카페와 개성 있는 가게가 이어지는 전포카페거리\n잠깐 쉬어가며 나만의 장소를 발견해 보세요", color = DetailText, lineHeight = 24.sp)
                        DetailCard {
                            InfoRow("대표 안내 주소", "부산 부산진구 전포대로209번길 26")
                            HorizontalDivider(color = DetailEdge)
                            InfoRow("탐방 테마", "카페 · 골목 산책")
                        }
                        Text("지도 위치와 이미지는 시연용입니다", color = DetailText.copy(.65f), fontSize = 12.sp)
                        DetailAction("닫고 계속 탐험", { onNavigate("") })
                    }
                    "ranking" -> {
                        Text("부전동 골목대장", color = DetailMint, fontSize = 13.sp)
                        DetailHeading("함께 걸어 만든 순위"); Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) { Text("순위 / 탐험가", color = DetailText); Text("기여도", color = DetailText) }
                        DetailCard {
                            listOf("달려형" to 48200, "피넛션" to 41500, "타이거풀" to 38900).forEachIndexed { index, (label, count) ->
                                DetailRank(index + 1, label, count, false)
                                HorizontalDivider(color = DetailEdge.copy(.5f))
                            }
                            DetailRank(7, name.trim(), 28900 + steps - 7000, true)
                        }
                        DetailHeading("팀별 기여")
                        DetailCard {
                            listOf("우리 여행팀" to 34, "산책팀" to 26, "탐험팀" to 22, "다국적팀" to 18).forEachIndexed { i, (label, value) ->
                                val color = listOf(DetailMint, Color(0xFFB99A76), Color(0xFF9D86B9), Color(0xFF759FD2))[i]
                                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) { Text(label, color = DetailText); Text("$value%", color = color) }
                                LinearProgressIndicator(progress = { value / 100f }, modifier = Modifier.fillMaxWidth().height(6.dp).clip(CircleShape), color = color, trackColor = DetailEdge)
                            }
                        }
                    }
                    "badges" -> {
                        DetailHeading("걸음으로 남긴 기록")
                        DetailCard {
                            Text("보유 포인트", color = DetailText)
                            Text("${fmt(points)} P", color = DetailMint, fontSize = 36.sp, fontWeight = FontWeight.Bold)
                        }
                        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            BadgeTile("첫걸음", "탐험의 시작", true, Modifier.weight(1f))
                            BadgeTile("첫 승리", if(wins > 0) "공략 성공" else "첫 공략 후 획득", wins > 0, Modifier.weight(1f))
                            BadgeTile("해운대 공략", "아직 닿지 않은 곳", false, Modifier.weight(1f))
                        }
                        DetailCard {
                            Text("공략 이력", color = Color.White, fontWeight = FontWeight.Bold)
                            Text(if(wins > 0) "부전동 · $wins 회 공략 완료" else "첫 공략을 완료하면 기록이 표시돼요", color = DetailText)
                        }
                        DetailAction("포인트로 꾸미기", { onNavigate("shop") })

                    }
                    "shop" -> {
                        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) { OutlinedButton(onClick = { designOpen = true }, shape = CircleShape) { Text("디자인 변경", color = DetailMint) } }
                        FramePreview(name, equippedId.isNotEmpty(), profilePhoto, photoBusy, onEditPhoto, frameTint(equippedId))
                        if (equippedId.isNotEmpty()) DetailAction("테두리 해제", { onEquip("") }, secondary = true)
                        Text("프레임 상점", color = DetailMint, fontWeight = FontWeight.Bold)
                        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            shopItems.forEach { item ->
                                val purchased = item.id in inventory
                                Column(
                                    Modifier.weight(1f).clip(RoundedCornerShape(18.dp))
                                        .clickable(enabled = !purchased && points >= item.price) { pendingItem = item }
                                        .padding(vertical = 16.dp),
                                    horizontalAlignment = Alignment.CenterHorizontally
                                ) {
                                    BoxWithConstraints(Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) {
                                        ProfileMarker(true, size = minOf(maxWidth, 100.dp), photo = profilePhoto, tint = item.tint)
                                    }
                                    Text(item.price.toString() + " P", color = DetailMint, fontSize = 18.sp, fontWeight = FontWeight.Bold, modifier = Modifier.padding(top = 6.dp).background(DetailMint.copy(alpha = .14f), RoundedCornerShape(8.dp)).padding(horizontal = 18.dp, vertical = 6.dp))
                                }
                            }
                        }
                        Text("보유한 테두리는 디자인 변경에서 선택할 수 있어요", color = DetailText, fontSize = 13.sp)
                    }
                }
            }
            if (scrollState.canScrollForward) {
                Box(Modifier.align(Alignment.BottomCenter).fillMaxWidth().height(24.dp)
                    .background(Brush.verticalGradient(listOf(Color.Transparent, Color(0xFF101A28)))))
            }
        }
    }
}

@Composable
private fun DetailCard(content: @Composable ColumnScope.() -> Unit) {
    Column(Modifier.fillMaxWidth().background(Color(0xFF1A2A3F), RoundedCornerShape(18.dp)).border(1.dp, DetailEdge, RoundedCornerShape(18.dp)).padding(18.dp), verticalArrangement = Arrangement.spacedBy(14.dp), content = content)
}

@Composable
private fun DetailHeading(text: String) { Text(text, color = Color.White, fontWeight = FontWeight.Bold, fontSize = 25.sp, lineHeight = 34.sp) }

@Composable
private fun InfoRow(label: String, value: String) { Column(verticalArrangement = Arrangement.spacedBy(7.dp)) { Text(label, color = DetailText, fontSize = 12.sp); Text(value, color = Color.White, fontSize = 15.sp) } }

@Composable
private fun DetailAction(text: String, onClick: () -> Unit, secondary: Boolean = false, enabled: Boolean = true) {
    Button(onClick, modifier = Modifier.fillMaxWidth().heightIn(min = 52.dp), enabled = enabled,
        shape = RoundedCornerShape(13.dp), colors = ButtonDefaults.buttonColors(containerColor = if(secondary) Color(0xFF26384F) else DetailMint, contentColor = if(secondary) DetailText else Color(0xFF10262A))) { Text(text, fontSize = 15.sp, modifier = Modifier.padding(vertical = 4.dp)) }
}

@Composable
private fun DetailRank(rank: Int, label: String, steps: Int, self: Boolean) {
    Row(Modifier.fillMaxWidth().padding(vertical = 5.dp), verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.size(38.dp).background(if(self) DetailMint else when(rank) { 1 -> Color(0xFFB89B54); 2 -> Color(0xFF8799B5); 3 -> Color(0xFFAF805F); else -> Color(0xFF344860) }, CircleShape), contentAlignment = Alignment.Center) { Text("$rank", color = if(self) Color(0xFF10262A) else Color.White) }
        Text(label, color = if(self) DetailMint else DetailText, modifier = Modifier.weight(1f).padding(horizontal = 10.dp), fontSize = 14.sp)
        Text(fmt(steps), color = if(self) DetailMint else Color.White, fontSize = 14.sp)
    }
}

@Composable
private fun BadgeTile(title: String, subtitle: String, unlocked: Boolean, modifier: Modifier) {
    Column(modifier.background(Color(0xFF1A2A3F), RoundedCornerShape(16.dp)).border(1.dp, DetailEdge, RoundedCornerShape(16.dp)).padding(vertical = 18.dp, horizontal = 4.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(10.dp)) {
        MapIcon("medal", if(unlocked) DetailMint else DetailText.copy(.35f), Modifier.size(30.dp))
        Text(title, color = if(unlocked) Color.White else DetailText.copy(.6f), fontSize = 12.sp)
        Text(subtitle, color = DetailText.copy(.7f), fontSize = 9.sp)
    }
}

@Composable
private fun FramePreview(name: String, equipped: Boolean, photo: ImageBitmap? = null,
    photoBusy: Boolean = false, onEditPhoto: (() -> Unit)? = null, tint: Color = DetailMint, compact: Boolean = false) {
    Column(Modifier.fillMaxWidth().padding(vertical = 16.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Box(Modifier.size(if (compact) 110.dp else 156.dp), contentAlignment = Alignment.Center) {
            ProfileMarker(equipped = equipped, size = if (compact) 80.dp else 156.dp, photo = photo, tint = tint)
            if (onEditPhoto != null) {
                IconButton(onClick = onEditPhoto, enabled = !photoBusy,
                    modifier = Modifier.align(Alignment.TopEnd).size(48.dp)
                        .semantics { contentDescription = if (photoBusy) "프로필 사진 저장 중" else "프로필 사진 변경" }) {
                    Box(Modifier.size(30.dp).background(Color(0xFF263E4B), CircleShape)
                        .border(1.dp, DetailMint.copy(.7f), CircleShape), contentAlignment = Alignment.Center) {
                        if (photoBusy) {
                            CircularProgressIndicator(Modifier.size(16.dp), color = DetailMint, strokeWidth = 2.dp)
                        } else Canvas(Modifier.size(16.dp)) {
                            val pencil = Path().apply {
                                moveTo(size.width * .15f, size.height * .85f)
                                lineTo(size.width * .22f, size.height * .59f)
                                lineTo(size.width * .68f, size.height * .13f)
                                lineTo(size.width * .87f, size.height * .32f)
                                lineTo(size.width * .41f, size.height * .78f)
                                close()
                            }
                            drawPath(pencil, DetailMint, style = Stroke(1.5.dp.toPx()))
                        }
                    }
                }
            }
        }
        Text(name.trim(), color = DetailMint, fontSize = 17.sp)
    }
}

@Composable
internal fun ProfileMarker(equipped: Boolean, size: Dp = 110.dp, modifier: Modifier = Modifier, photo: ImageBitmap? = null, tint: Color = DetailMint) {
    Box(modifier.size(size).background(
        Brush.radialGradient(listOf(tint.copy(if (equipped) .25f else .08f), Color.Transparent)),
        CircleShape
    ), contentAlignment = Alignment.Center) {
        Box(Modifier.size(size * .82f)
            .background(Color(0xFF182B3A), CircleShape)
            .border(if (equipped) 3.dp else 1.dp, if (equipped) tint else DetailText, CircleShape)
            .padding(if (equipped) 3.dp else 1.dp).clip(CircleShape), contentAlignment = Alignment.Center) {
            if (photo != null) {
                Image(photo, "프로필 사진", Modifier.fillMaxSize(), contentScale = ContentScale.Crop)
            } else {
                MapIcon("person", Color.White, Modifier.fillMaxSize().padding(size * (13f / 110f)))
            }
        }
    }
}

private fun fmt(value: Int) = String.format(Locale.US, "%,d", value)

internal data class ShopFrame(val id: String, val title: String, val description: String, val price: Int, val tint: Color)
internal val shopItems = listOf(
    ShopFrame("mint", "전포 네온 프레임", "산뜻한 민트빛 테두리", 30, Color(0xFF80C9BE)),
    ShopFrame("violet", "별빛 탐험 프레임", "밤하늘을 닮은 보랏빛", 50, Color(0xFFB39DDB)),
    ShopFrame("gold", "골목대장 프레임", "빛나는 황금빛 테두리", 80, Color(0xFFE5BE70))
)
internal fun frameTint(id: String) = shopItems.find { it.id == id }?.tint ?: Color(0xFF80C9BE)
