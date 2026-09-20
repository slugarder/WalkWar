package com.example.myapplication

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.ImageDecoder
import android.net.Uri
import android.os.Build
import android.util.AtomicFile
import java.io.File

private fun photoFile(context: Context) = AtomicFile(File(context.filesDir, "profile-photo.png"))

internal fun loadProfilePhoto(context: Context): Bitmap? = runCatching {
    photoFile(context).openRead().use { BitmapFactory.decodeStream(it) }
}.getOrNull()

internal fun saveProfilePhoto(context: Context, uri: Uri): Bitmap {
    val resolver = context.contentResolver
    val bitmap = if (Build.VERSION.SDK_INT >= 28) {
        ImageDecoder.decodeBitmap(ImageDecoder.createSource(resolver, uri)) { decoder, info, _ ->
            val scale = minOf(1f, 512f / maxOf(info.size.width, info.size.height))
            decoder.setTargetSize(maxOf(1, (info.size.width * scale).toInt()), maxOf(1, (info.size.height * scale).toInt()))
            decoder.allocator = ImageDecoder.ALLOCATOR_SOFTWARE
        }
    } else {
        val options = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        resolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, options) }
        require(options.outWidth > 0 && options.outHeight > 0)
        options.inJustDecodeBounds = false
        options.inSampleSize = 1
        while (maxOf(options.outWidth, options.outHeight) / options.inSampleSize > 1024) options.inSampleSize *= 2
        requireNotNull(resolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, options) })
    }
    val file = photoFile(context)
    val stream = file.startWrite()
    try {
        check(bitmap.compress(Bitmap.CompressFormat.PNG, 100, stream))
        file.finishWrite(stream)
    } catch (error: Exception) {
        file.failWrite(stream)
        throw error
    }
    return bitmap
}
