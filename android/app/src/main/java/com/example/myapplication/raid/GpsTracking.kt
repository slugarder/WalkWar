package com.example.myapplication.raid

import android.content.Context
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.SystemClock
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import java.util.UUID
import kotlin.math.max

/**
 * Foreground-only real device tracking. The parent sends accepted samples to the server.
 * It intentionally never supplies an invented location or a synthetic step count.
 */
@Composable
fun GpsTracking(
    enabled: Boolean,
    onSample: (lat: Double, lon: Double, accuracyM: Double, capturedAt: Long, stepCounter: Long, sensorEpoch: String) -> Unit,
    onStatus: (String) -> Unit
) {
    val context = LocalContext.current.applicationContext
    val lifecycle = LocalLifecycleOwner.current
    val sampleCallback = rememberUpdatedState(onSample)
    val statusCallback = rememberUpdatedState(onStatus)

    DisposableEffect(context, lifecycle, enabled) {
        val locations = context.getSystemService(Context.LOCATION_SERVICE) as LocationManager
        val sensors = context.getSystemService(Context.SENSOR_SERVICE) as SensorManager
        var active = false
        var stepSensorAvailable = false
        var stepBaseline: Long? = null
        var epoch = UUID.randomUUID().toString()
        var lastSentElapsed = 0L
        var rawSteps = 0L
        lateinit var sensorListener: SensorEventListener
        lateinit var locationListener: LocationListener

        fun status(text: String) = statusCallback.value(text)
        fun stop() {
            if (!active) return
            active = false
            try { locations.removeUpdates(locationListener) } catch (_: Exception) { }
            try { sensors.unregisterListener(sensorListener) } catch (_: Exception) { }
        }
        fun accept(location: Location) {
            if (!active) return
            // Last-known/cached fixes are deliberately not requested. Reject provider results that are already stale.
            val nowWall = System.currentTimeMillis()
            if (location.time <= 0L || nowWall - location.time > MAX_LOCATION_AGE_MS) {
                status("오래된 위치를 무시하고 새 GPS 위치를 기다리는 중")
                return
            }
            // The API requires a real accuracy value.  Do not submit a malformed
            // sample, and start a fresh server baseline once a reliable fix returns
            // so steps accrued while accuracy was unavailable cannot be backfilled.
            if (!location.hasAccuracy()) {
                epoch = UUID.randomUUID().toString()
                status("정확도 정보를 확인할 수 없어 새 GPS 위치를 기다리는 중")
                return
            }
            val elapsed = SystemClock.elapsedRealtime()
            if (elapsed - lastSentElapsed < MIN_SAMPLE_INTERVAL_MS) return
            lastSentElapsed = elapsed
            val count = stepBaseline?.let { max(0L, rawSteps - it) } ?: 0L
            val accuracy = location.accuracy.toDouble()
            sampleCallback.value(location.latitude, location.longitude, accuracy, location.time, count, epoch)
            val accuracyLabel = if (accuracy >= 0) "정확도 ${accuracy.toInt()}m" else "정확도 정보 없음"
            status("현재 위치 수신 · $accuracyLabel · " + if (stepBaseline == null) "걸음 센서 대기 중" else "걸음 $count")
        }
        sensorListener = object : SensorEventListener {
            override fun onSensorChanged(event: SensorEvent) {
                if (!active || event.sensor.type != Sensor.TYPE_STEP_COUNTER || event.values.isEmpty()) return
                rawSteps = event.values[0].toLong()
                if (stepBaseline == null) {
                    // The hardware value is since reboot. Start a fresh epoch when its baseline becomes known,
                    // so earlier location samples with zero cannot be joined to boot-time steps.
                    stepBaseline = rawSteps
                    epoch = UUID.randomUUID().toString()
                    status("걸음 센서 준비됨 · 이번 화면에서 0걸음부터 계산")
                }
            }
            override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) = Unit
        }
        locationListener = object : LocationListener {
            override fun onLocationChanged(location: Location) = accept(location)
            override fun onProviderEnabled(provider: String) { status("$provider 위치 제공자 사용 가능") }
            override fun onProviderDisabled(provider: String) { status("$provider 위치 제공자 사용할 수 없음") }
        }
        fun start() {
            if (active || !enabled) return
            active = true
            stepBaseline = null
            rawSteps = 0L
            epoch = UUID.randomUUID().toString()
            lastSentElapsed = 0L
            val stepSensor = sensors.getDefaultSensor(Sensor.TYPE_STEP_COUNTER)
            stepSensorAvailable = stepSensor != null && try { sensors.registerListener(sensorListener, stepSensor, SensorManager.SENSOR_DELAY_UI) } catch (_: SecurityException) { false }
            if (!stepSensorAvailable) status("위치 수신 대기 중 · 걸음 센서를 사용할 수 없어 0걸음으로 전송") else status("새 GPS 위치와 걸음 센서를 기다리는 중")
            var providerRegistered = false
            var permissionDenied = false
            listOf(LocationManager.GPS_PROVIDER, LocationManager.NETWORK_PROVIDER).forEach { provider ->
                try {
                    if (locations.isProviderEnabled(provider)) {
                        locations.requestLocationUpdates(provider, MIN_SAMPLE_INTERVAL_MS, 0f, locationListener)
                        providerRegistered = true
                    }
                } catch (_: SecurityException) { permissionDenied = true }
                catch (_: IllegalArgumentException) { }
            }
            if (!providerRegistered) status(if (permissionDenied) "위치 권한이 필요해요" else "사용 가능한 GPS 또는 네트워크 위치 제공자가 없어요")
        }
        val observer = LifecycleEventObserver { _, event ->
            when (event) {
                Lifecycle.Event.ON_START -> start()
                Lifecycle.Event.ON_STOP -> stop()
                else -> Unit
            }
        }
        lifecycle.lifecycle.addObserver(observer)
        if (enabled && lifecycle.lifecycle.currentState.isAtLeast(Lifecycle.State.STARTED)) start()
        onDispose { lifecycle.lifecycle.removeObserver(observer); stop() }
    }
}

private const val MIN_SAMPLE_INTERVAL_MS = 1_000L
private const val MAX_LOCATION_AGE_MS = 30_000L
