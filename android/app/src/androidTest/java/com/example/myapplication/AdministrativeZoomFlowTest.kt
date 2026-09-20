package com.example.myapplication

import android.graphics.Bitmap
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.assertFalse
import org.junit.Rule
import org.junit.Test
import java.io.File

/** Checks the visible scale transitions against the running map server, without starting a raid. */
class AdministrativeZoomFlowTest {
    @get:Rule val compose = createAndroidComposeRule<MainActivity>()
    private val flags = hasContentDescription("공략 깃발", substring = true)
    private fun exists(text: String) = compose.onAllNodesWithText(text, substring = true).fetchSemanticsNodes().isNotEmpty()
    private fun waitForLevel(label: String) {
        compose.waitUntil(45000) { exists("$label 선택") && compose.onAllNodes(flags).fetchSemanticsNodes().isNotEmpty() }
        compose.onAllNodes(hasContentDescription("겹친 공략 깃발", substring = true)).assertCountEquals(0)
        assertFalse("Region count labels must not appear", exists("지역 2개") || exists("지역 3개"))
    }
    private fun capture(name: String) {
        compose.waitForIdle()
        Thread.sleep(4000)
        compose.waitForIdle()
        val instrument = InstrumentationRegistry.getInstrumentation()
        val bitmap = instrument.uiAutomation.takeScreenshot()
        try {
            File(instrument.targetContext.getExternalFilesDir(null), name).outputStream().use {
                bitmap.compress(Bitmap.CompressFormat.PNG, 100, it)
            }
        } finally { bitmap.recycle() }
    }
    @Test fun mapHidesAtFarScaleAndRevealsIndividualAdministrativeLevels() {
        compose.waitUntil(15000) { exists("시작하기") }
        compose.onNode(hasSetTextAction()).performTextReplacement("전국테스터")
        compose.onNodeWithText("시작하기", substring = true).performScrollTo().performClick()
        compose.onNodeWithText("지금은 가상 이동으로 체험").performClick()
        waitForLevel("시·도")
        capture("01-national-map.png")
        compose.onAllNodes(flags)[0].performClick()
        compose.waitUntil(15000) { exists("공략 시작") }
        compose.onAllNodesWithText("HP ", substring = true).assertCountEquals(0)
        capture("02-region-description.png")
        compose.onNodeWithText("닫기").performClick()
        compose.onNodeWithTag("administrative-map").performTouchInput {
            pinch(start0 = Offset(width * .05f, center.y - 180f), end0 = Offset(width * .05f, center.y - 50f),
                start1 = Offset(width * .05f, center.y + 180f), end1 = Offset(width * .05f, center.y + 50f), durationMillis = 500)
        }
        capture("08-far-map.png")
        compose.waitUntil(10000) { !exists("국기를 눌러 공략하기") }
        compose.onAllNodes(flags).assertCountEquals(0)
        Thread.sleep(700)
        compose.onAllNodes(flags).assertCountEquals(0)
        compose.onNodeWithTag("administrative-map").performTouchInput {
            pinch(start0 = Offset(width * .05f, center.y - 50f), end0 = Offset(width * .05f, center.y - 180f),
                start1 = Offset(width * .05f, center.y + 50f), end1 = Offset(width * .05f, center.y + 180f), durationMillis = 500)
        }
        capture("11-return-overview.png")
        waitForLevel("시·도")
        repeat(2) { compose.onNodeWithText("확대").performClick() }
        waitForLevel("시·군")
        capture("09-city-map.png")
        repeat(2) { compose.onNodeWithText("확대").performClick() }
        waitForLevel("시·군·구")
        capture("10-district-map.png")
        compose.onNodeWithText("확대").performClick()
        waitForLevel("읍·면·동")
        capture("06-dong-map.png")
    }
}
