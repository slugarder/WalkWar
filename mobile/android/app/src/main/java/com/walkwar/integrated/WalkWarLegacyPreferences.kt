package com.walkwar.integrated

import android.content.Context
import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.uimanager.ViewManager

/** Reads only the old app's connection identity so an APK update keeps server progress. */
class WalkWarLegacyPreferences(context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
    override fun getName() = "WalkWarLegacyPreferences"
    override fun getConstants(): MutableMap<String, Any> {
        val prefs = reactApplicationContext.getSharedPreferences("walkwar-live", Context.MODE_PRIVATE)
        val server = prefs.getString("server", "http://10.0.2.2:3040").orEmpty()
        return mutableMapOf("server" to server, "name" to prefs.getString("name", "").orEmpty(),
            "clientId" to prefs.getString("client:$server", "").orEmpty())
    }
}
class WalkWarLegacyPackage : ReactPackage {
    override fun createNativeModules(context: ReactApplicationContext): List<NativeModule> = listOf(WalkWarLegacyPreferences(context))
    override fun createViewManagers(context: ReactApplicationContext): List<ViewManager<*, *>> = emptyList()
}
