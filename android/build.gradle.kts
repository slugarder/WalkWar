// Top-level build file where you can add configuration options common to all sub-projects/modules.
plugins {
    alias(libs.plugins.android.application) apply false
    alias(libs.plugins.kotlin.compose) apply false
}
// Keep generated files on an ASCII-only path for Windows build tools.
val asciiBuildRoot = file("build")
layout.buildDirectory.set(asciiBuildRoot.resolve("root"))
subprojects {
    layout.buildDirectory.set(asciiBuildRoot.resolve(name))
}
