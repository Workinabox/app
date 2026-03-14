package com.workinabox

import android.media.MediaPlayer
import android.util.Base64
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.io.File

class AgentAudioPlayerModule(
  reactContext: ReactApplicationContext
) : ReactContextBaseJavaModule(reactContext) {

  private var mediaPlayer: MediaPlayer? = null
  private var currentFile: File? = null

  override fun getName(): String = "AgentAudioPlayer"

  @ReactMethod
  fun playBase64Wav(audioBase64: String, promise: Promise) {
    var outputFile: File? = null
    try {
      val audioBytes = Base64.decode(audioBase64, Base64.DEFAULT)
      outputFile = File.createTempFile("wiab-agent-", ".wav", reactApplicationContext.cacheDir)
      outputFile.writeBytes(audioBytes)

      mediaPlayer?.release()
      currentFile?.delete()
      currentFile = null

      val player = MediaPlayer()
      player.setDataSource(outputFile.absolutePath)
      player.setOnCompletionListener {
        it.release()
        mediaPlayer = null
        currentFile?.delete()
        currentFile = null
        promise.resolve(null)
      }
      player.setOnErrorListener { mediaPlayer, what, extra ->
        mediaPlayer.release()
        this.mediaPlayer = null
        currentFile?.delete()
        currentFile = null
        promise.reject(
          "agent_audio_playback_failed",
          "MediaPlayer error what=$what extra=$extra",
        )
        true
      }
      player.prepare()
      mediaPlayer = player
      currentFile = outputFile
      player.start()
    } catch (error: Exception) {
      mediaPlayer?.release()
      mediaPlayer = null
      currentFile?.delete()
      currentFile = null
      outputFile?.delete()
      promise.reject("agent_audio_playback_failed", error)
    }
  }
}
