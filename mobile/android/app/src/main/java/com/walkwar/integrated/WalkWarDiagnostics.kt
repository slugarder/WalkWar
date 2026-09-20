package com.walkwar.integrated

import android.app.ActivityManager
import android.app.ApplicationExitInfo
import android.content.Context
import android.os.Build
import android.webkit.WebView
import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.uimanager.ViewManager
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.Executors

/** Diagnostic-only, local crash context. It is intentionally not registered in release builds. */
class WalkWarDiagnostics(context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
  private val executor = Executors.newSingleThreadExecutor()
  private val preferences = context.getSharedPreferences("walkwar-diagnostics", Context.MODE_PRIVATE)

  override fun getName() = "WalkWarDiagnostics"

  override fun getConstants(): MutableMap<String, Any> = mutableMapOf("enabled" to true)

  @ReactMethod
  fun recordEvent(kind: String, details: String) {
    executor.execute {
      try {
        val events = readEvents()
        events.put(JSONObject().apply {
          put("at", System.currentTimeMillis())
          put("kind", sanitize(kind, 80))
          put("details", sanitize(details, 300))
        })
        while (events.length() > MAX_EVENTS) events.remove(0)
        preferences.edit().putString(EVENTS_KEY, events.toString()).apply()
      } catch (_: Exception) {
        // Diagnostics must never be able to take down the debug build.
      }
    }
  }

  @ReactMethod
  fun getReport(promise: Promise) {
    executor.execute {
      try {
        val packageInfo = reactApplicationContext.packageManager.getPackageInfo(reactApplicationContext.packageName, 0)
        val report = JSONObject().apply {
          put("diagnostic", true)
          put("appVersion", packageInfo.versionName.orEmpty())
          put("device", "${Build.MANUFACTURER} ${Build.MODEL}".trim())
          put("os", "Android ${Build.VERSION.RELEASE}")
          put("api", Build.VERSION.SDK_INT)
          put("webViewProvider", webViewProvider())
          put("events", readEvents())
          put("processExits", recentProcessExits())
        }
        promise.resolve(report.toString())
      } catch (error: Exception) {
        promise.reject("DIAGNOSTIC_REPORT_FAILED", "Could not create the local diagnostic report", error)
      }
    }
  }

  private fun readEvents(): JSONArray = try {
    JSONArray(preferences.getString(EVENTS_KEY, "[]"))
  } catch (_: Exception) {
    JSONArray()
  }

  private fun webViewProvider(): JSONObject? = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
    WebView.getCurrentWebViewPackage()?.let { provider ->
      JSONObject().put("name", provider.packageName).put("version", provider.versionName)
    }
  } else null

  private fun recentProcessExits(): JSONArray {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) return JSONArray()
    val manager = reactApplicationContext.getSystemService(Context.ACTIVITY_SERVICE) as? ActivityManager ?: return JSONArray()
    return JSONArray().apply {
      manager.getHistoricalProcessExitReasons(reactApplicationContext.packageName, 0, 5).forEach { exit ->
        put(JSONObject().apply {
          put("reason", exit.reason)
          put("reasonName", reasonName(exit.reason))
          put("status", exit.status)
          put("description", sanitize(exit.description.orEmpty(), 300))
          put("pssKb", exit.pss)
          put("rssKb", exit.rss)
          put("timestamp", exit.timestamp)
        })
      }
    }
  }

  private fun sanitize(value: String, limit: Int): String = value
    .replace(Regex("(?i)\\b(token|authorization|bearer|cookie|password)\\s*[=:]\\s*[^\\s,;]+"), "$1=[redacted]")
    .replace(Regex("(?i)\\bplayer-[a-z0-9-]+"), "player-[redacted]")
    .replace(Regex("[-+]?\\d{1,3}\\.\\d{4,}"), "[coordinate]")
    .take(limit)

  private fun reasonName(reason: Int): String = when (reason) {
    ApplicationExitInfo.REASON_CRASH -> "CRASH"
    ApplicationExitInfo.REASON_CRASH_NATIVE -> "CRASH_NATIVE"
    ApplicationExitInfo.REASON_LOW_MEMORY -> "LOW_MEMORY"
    ApplicationExitInfo.REASON_ANR -> "ANR"
    ApplicationExitInfo.REASON_USER_REQUESTED -> "USER_REQUESTED"
    else -> "REASON_$reason"
  }

  private companion object {
    const val EVENTS_KEY = "events"
    const val MAX_EVENTS = 80
  }
}

class WalkWarDiagnosticsPackage : ReactPackage {
  override fun createNativeModules(context: ReactApplicationContext): List<NativeModule> =
    listOf(WalkWarDiagnostics(context))

  override fun createViewManagers(context: ReactApplicationContext): List<ViewManager<*, *>> = emptyList()
}
