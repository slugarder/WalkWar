package com.example.myapplication

import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.test.platform.app.InstrumentationRegistry
import android.graphics.Bitmap
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.semantics.SemanticsProperties
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import java.io.File

/** Runs against the local server through the emulator gateway. No fake balances or UI-only purchase state. */
class LiveIntegrationFlowTest {
    @get:Rule val compose = createAndroidComposeRule<MainActivity>()
    private fun exists(text: String) = compose.onAllNodesWithText(text, substring = true).fetchSemanticsNodes().isNotEmpty()
    private fun capture(name: String) {
        compose.waitForIdle()
        Thread.sleep(300)
        val instrument = InstrumentationRegistry.getInstrumentation()
        val target = instrument.targetContext
        val file = File(target.getExternalFilesDir(null), name)
        instrument.uiAutomation.takeScreenshot().useBitmap { bitmap -> file.outputStream().use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) } }
    }
    private fun Bitmap.useBitmap(block: (Bitmap) -> Unit) { try { block(this) } finally { recycle() } }
    private fun steps(): Int = compose.onAllNodes(hasText(" 걸음", substring = true)).fetchSemanticsNodes().flatMap {
        it.config.getOrElse(SemanticsProperties.Text) { emptyList() }
    }.mapNotNull { Regex("^(\\d+) 걸음$").matchEntire(it.text)?.groupValues?.get(1)?.toIntOrNull() }.maxOrNull() ?: 0

    @Test fun joystickContinuesAfterArrowPulseAndStopsOnRelease() {
        compose.waitUntil(15000) { exists("시작하기") }
        compose.onNode(hasSetTextAction()).performTextReplacement("전국테스터")
        compose.onNodeWithText("시작하기", substring = true).performScrollTo().performClick()
        compose.onNodeWithText("지금은 가상 이동으로 체험").performClick()
        compose.waitUntil(60000) { compose.onAllNodes(hasContentDescription("공략 깃발", substring = true)).fetchSemanticsNodes().isNotEmpty() }
        capture("01-national-map.png")
        compose.onAllNodes(hasContentDescription("공략 깃발", substring = true))[0].performClick()
        compose.waitUntil(15000) { exists("공략 시작") }
        capture("02-region-description.png")
        compose.onNodeWithText("공략 시작").performClick()
        compose.waitUntil(15000) { exists("HP ") }
        compose.waitForIdle(); Thread.sleep(400)
        val before = steps()
        compose.onNodeWithText("→").performClick()
        compose.onNodeWithContentDescription("가상 이동 조이스틱").performTouchInput {
            down(center); moveTo(Offset(width.toFloat() - 3f, center.y)); moveBy(Offset(1f, 0f))
        }
        compose.waitUntil(15000) { steps() >= before + 40 }
        compose.onNodeWithContentDescription("가상 이동 조이스틱").performTouchInput { up() }
        Thread.sleep(1800); val stopped = steps()
        Thread.sleep(1500); assertTrue("Released joystick must stop steps", steps() <= stopped + 1)
        capture("07-final-map.png")
    }

    @Test fun flagsRequireDescriptionAndExplicitStartThenVirtualMovementWorks() {
        compose.waitUntil(15000) { exists("시작하기") }
        compose.onNode(hasSetTextAction()).performTextReplacement("전국테스터")
        compose.onNodeWithText("시작하기", substring = true).performScrollTo().performClick()
        compose.onNodeWithText("지금은 가상 이동으로 체험").performClick()
        compose.waitUntil(45000) { exists("국기를 눌러 공략할 지역") }
        compose.waitUntil(60000) { compose.onAllNodes(hasContentDescription("공략 깃발", substring = true)).fetchSemanticsNodes().isNotEmpty() }
        capture("01-national-map.png")
        compose.onAllNodes(hasContentDescription("공략 깃발", substring = true))[0].performClick()
        compose.waitUntil(15000) { exists("공략 시작") }
        compose.onAllNodesWithText("HP ", substring = true).assertCountEquals(0)
        capture("02-region-description.png")
        compose.onNodeWithText("공략 시작").performClick()
        compose.waitUntil(20000) { exists("HP ") }
        compose.waitForIdle()
        Thread.sleep(500)
        compose.onNodeWithText("→").performClick()
        capture("03a-before-walking.png")
        compose.onNodeWithContentDescription("가상 이동 조이스틱").performTouchInput {
            down(center)
            moveTo(Offset(width.toFloat() - 2f, center.y))
        }
        compose.waitUntil(150000) { exists("100 P") }
        compose.onNodeWithContentDescription("가상 이동 조이스틱").performTouchInput { up() }
        capture("03-live-raid.png")
        repeat(2) { compose.onNodeWithText("확대").performClick() }
        compose.waitUntil(10000) { exists("시·군 선택") }
        repeat(2) { compose.onNodeWithText("확대").performClick() }
        compose.waitUntil(10000) { exists("시·군·구 선택") }
        compose.onNodeWithText("확대").performClick()
        compose.waitUntil(10000) { exists("읍·면·동 선택") }
        capture("06-dong-map.png")
        compose.onNodeWithText("상점", useUnmergedTree = true).performClick()
        compose.waitUntil(10000) { exists("전포 네온 프레임") }
        compose.onNodeWithText("30 P · 구매").performClick()
        compose.onNodeWithText("구매 확정").performClick()
        compose.waitUntil(10000) { exists("70 P") }
        compose.onNodeWithText("보유 중 · 장착").performClick()
        compose.waitUntil(10000) { exists("장착 중 · 해제") }
        capture("04-shop.png")
        compose.onNodeWithText("수집", useUnmergedTree = true).performClick()
        compose.waitUntil(10000) { exists("나의 탐험 기록") }
        compose.onNodeWithText("칭호 장착").performScrollTo().performClick()
        compose.waitUntil(10000) { exists("장착 해제") }
        capture("05-collection.png")
        compose.activityRule.scenario.recreate()
        compose.waitUntil(15000) { exists("지금은 가상 이동으로 체험") }
        compose.onNodeWithText("지금은 가상 이동으로 체험").performClick()
        compose.waitUntil(20000) { exists("70 P") }
        compose.onNodeWithText("상점", useUnmergedTree = true).performClick()
        compose.waitUntil(10000) { exists("장착 중 · 해제") }
    }
}
