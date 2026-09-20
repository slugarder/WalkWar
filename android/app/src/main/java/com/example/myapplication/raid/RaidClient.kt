package com.example.myapplication.raid

import android.content.Context
import androidx.compose.runtime.*
import kotlinx.coroutines.*
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder
import java.util.UUID

fun JSONObject.obj(key: String): JSONObject = optJSONObject(key) ?: JSONObject()
fun JSONObject.arr(key: String): JSONArray = optJSONArray(key) ?: JSONArray()
fun JSONArray.objects(): List<JSONObject> = (0 until length()).mapNotNull { optJSONObject(it) }
fun JSONArray.strings(): Set<String> = (0 until length()).map { optString(it) }.toSet()
fun JSONObject.nullableString(key: String): String? = if (isNull(key)) null else optString(key).takeIf { it.isNotEmpty() }
fun JSONObject.nullableDouble(key: String): Double? = if (isNull(key)) null else optDouble(key).takeIf { it.isFinite() }
fun json(vararg pairs: Pair<String, Any?>) = JSONObject().apply { pairs.forEach { (key, value) -> put(key, value ?: JSONObject.NULL) } }
fun encoded(value: String): String = URLEncoder.encode(value, "UTF-8")

class RaidApi(private val base: String) {
    suspend fun request(path: String, method: String = "GET", body: JSONObject? = null): JSONObject = withContext(Dispatchers.IO) {
        val connection = URL("${base.trimEnd('/')}/api/v1$path").openConnection() as HttpURLConnection
        try {
            connection.requestMethod = method
            connection.connectTimeout = 5000
            connection.readTimeout = 10000
            connection.setRequestProperty("Accept", "application/json")
            if (body != null) {
                connection.doOutput = true
                connection.setRequestProperty("Content-Type", "application/json; charset=utf-8")
                connection.outputStream.use { it.write(body.toString().toByteArray(Charsets.UTF_8)) }
            }
            val status = connection.responseCode
            val stream = if (status in 200..299) connection.inputStream else connection.errorStream
            val raw = stream?.bufferedReader()?.use { it.readText() }.orEmpty()
            val result = try { JSONObject(raw) } catch (_: Exception) { JSONObject() }
            if (status !in 200..299) throw IllegalStateException(result.obj("error").optString("message").ifBlank { "서버 응답 오류 ($status)" })
            result
        } finally { connection.disconnect() }
    }
}

/** Server snapshots are applied under one gate: an old poll cannot overwrite a purchase or mode change. */
class RaidClient(context: Context, private val scope: CoroutineScope) {
    private val prefs = context.getSharedPreferences("walkwar-live", Context.MODE_PRIVATE)
    var serverUrl by mutableStateOf(prefs.getString("server", "http://10.0.2.2:3040")!!)
        private set
    var displayName by mutableStateOf(prefs.getString("name", "")!!)
        private set
    var snapshot by mutableStateOf<JSONObject?>(null)
        private set
    var error by mutableStateOf<String?>(null)
        private set
    var busy by mutableStateOf(false)
        private set
    var foreground by mutableStateOf(false)
    var axisX = 0.0
    var axisY = 0.0
    private var seq = 0L
    private val gate = Mutex()
    private var gpsPending: JSONObject? = null
    private var pendingMutation: (suspend () -> Unit)? = null
    private var reconnect: (suspend () -> Unit)? = null
    val api get() = RaidApi(serverUrl)
    val mode get() = snapshot?.obj("player")?.optString("mode") ?: "virtual"
    private val playerId get() = snapshot?.obj("player")?.optString("id").orEmpty()
    private val sessionId get() = snapshot?.optString("sessionId").orEmpty()
    private fun playerPath(path: String) = "/players/${encoded(playerId)}$path"

    init {
        scope.launch {
            var cycle = 0
            while (isActive) {
                delay(250)
                if (!foreground || snapshot == null || busy) continue
                try {
                    gate.withLock {
                        if (!foreground || snapshot == null || busy) return@withLock
                        if (mode == "virtual") {
                            api.request(playerPath("/input"), "PUT", json("sessionId" to sessionId, "seq" to ++seq, "axisX" to axisX, "axisY" to axisY))
                        } else if (cycle % 4 == 0) {
                            api.request(playerPath("/heartbeat"), "POST", json("sessionId" to sessionId))
                            val sample = gpsPending
                            gpsPending = null
                            if (sample != null) {
                                sample.put("sessionId", sessionId).put("seq", ++seq)
                                snapshot = api.request(playerPath("/gps"), "POST", sample)
                            }
                        }
                        if (cycle++ % 4 == 0) snapshot = api.request(playerPath("/state"))
                    }
                } catch (cancelled: CancellationException) { throw cancelled }
                catch (failure: Exception) { error = failure.message ?: "서버에 연결하지 못했어요"; stopMoving(); delay(1500) }
            }
        }
    }

    fun configure(url: String): Boolean {
        val normalized = url.trim().trimEnd('/')
        val valid = runCatching { URL(normalized).let { it.protocol in listOf("http", "https") && it.host.isNotBlank() && it.userInfo == null && it.path.isBlank() && it.query == null } }.getOrDefault(false)
        if (!valid) { error = "http://주소:포트 또는 https://주소 형식으로 입력해 주세요"; return false }
        stopMoving(); snapshot = null; gpsPending = null; seq = 0
        serverUrl = normalized; prefs.edit().putString("server", normalized).apply()
        return true
    }

    fun connect(name: String, virtual: Boolean, onSuccess: () -> Unit) {
        displayName = name.trim().take(20)
        prefs.edit().putString("name", displayName).apply()
        val operation: suspend () -> Unit = {
            val key = "client:$serverUrl"
            val client = prefs.getString(key, null) ?: UUID.randomUUID().toString().also { prefs.edit().putString(key, it).apply() }
            snapshot = api.request("/players", "POST", json("clientId" to client, "displayName" to displayName))
            val request = json("requestId" to UUID.randomUUID().toString(), "mode" to if (virtual) "virtual" else "gps")
            snapshot = api.request(playerPath("/session"), "POST", request)
            seq = 0; gpsPending = null; onSuccess()
        }
        reconnect = operation
        perform(operation)
    }

    private fun perform(operation: suspend () -> Unit) {
        if (busy) return
        busy = true; error = null; stopMoving()
        scope.launch {
            try { gate.withLock { operation() }; pendingMutation = null }
            catch (cancelled: CancellationException) { throw cancelled }
            catch (failure: Exception) { error = failure.message ?: "요청을 처리하지 못했어요"; pendingMutation = operation }
            finally { busy = false }
        }
    }
    fun retry() { (pendingMutation ?: reconnect)?.let { perform(it) } }
    fun dismissError() { error = null }
    fun stopMoving() { axisX = 0.0; axisY = 0.0 }
    fun leave() { foreground = false; stopMoving(); gpsPending = null }
    fun select(region: JSONObject, onSelected: () -> Unit = {}) {
        val body = json("requestId" to UUID.randomUUID().toString(), "mode" to mode, "regionId" to region.getString("id"))
        perform {
            snapshot = api.request(playerPath("/session"), "POST", body)
            seq = 0; gpsPending = null
            if (mode == "virtual") prefs.edit().putString("virtualRegion:$serverUrl", region.getString("id")).apply()
            onSelected()
        }
    }
    fun control(action: String) = mutate("/control", "POST", json("action" to action))
    fun purchase(itemId: String) = mutate("/purchases", "POST", json("itemId" to itemId))
    fun equip(slot: String, itemId: String?) = mutate("/equipment", "PUT", json("slot" to slot, "itemId" to itemId))
    private fun mutate(path: String, method: String, payload: JSONObject) {
        val url = playerPath(path)
        payload.put("sessionId", sessionId).put("requestId", UUID.randomUUID().toString())
        perform { snapshot = api.request(url, method, payload) }
    }
    fun gps(lat: Double, lon: Double, accuracy: Double, time: Long, counter: Long, epoch: String) {
        if (foreground && mode == "gps") gpsPending = json("lat" to lat, "lon" to lon, "accuracyM" to accuracy, "capturedAt" to time, "stepCounter" to counter, "sensorEpoch" to epoch)
    }
    suspend fun history(offset: Int): JSONObject = gate.withLock { api.request(playerPath("/history?offset=$offset&limit=30")) }
}
