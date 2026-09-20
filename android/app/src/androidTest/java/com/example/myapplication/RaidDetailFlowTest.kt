package com.example.myapplication

import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.*
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import org.junit.Rule
import org.junit.Test

class RaidDetailFlowTest {
    @get:Rule val compose = createComposeRule()

    @Test fun purchaseUpdatesBalanceAndPreventsDuplicatePurchase() {
        compose.setContent {
            var page by remember { mutableStateOf("badges") }
            var points by remember { mutableIntStateOf(100) }
            var owned by remember { mutableStateOf(false) }
            MaterialTheme {
                RaidDetailScreen(page, "테스터", 7000, 1, points, owned, Modifier.fillMaxSize(),
                    onNavigate = { page = it }, onNext = {}, onPurchase = {
                        if (!owned && points >= 30) { points -= 30; owned = true }
                    })
            }
        }
        compose.onNodeWithText("포인트로 꾸미기").performScrollTo().performClick()
        compose.onNodeWithText("30 P").performScrollTo().performClick()
        compose.onNodeWithText("구매하시겠습니까?").assertExists()
        compose.onNodeWithText("구매", useUnmergedTree = true).performClick()
        compose.onNodeWithText("30 P").assertIsNotEnabled()
        compose.onNodeWithText("70 P").assertExists()
    }

    @Test fun insufficientBalanceDisablesPurchase() {
        compose.setContent { MaterialTheme {
            RaidDetailScreen("shop", "테스터", 7000, 0, 0, false, Modifier.fillMaxSize(), {}, {}, {})
        } }
        compose.onNodeWithText("30 P").performScrollTo().performClick()
        compose.onNodeWithText("구매하시겠습니까?").assertDoesNotExist()
    }
}
