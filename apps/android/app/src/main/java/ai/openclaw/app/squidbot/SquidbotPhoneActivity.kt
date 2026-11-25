// Adapted from openclaw/openclaw (MIT), modified for Squidbot.
// Modified: a Squidbot phone screen for pairing, encrypted chat, and unpair.
package ai.openclaw.app.squidbot

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import java.net.Socket
import java.nio.ByteBuffer
import java.util.Base64

class SquidbotPhoneActivity : ComponentActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    val store = DeviceKeyStore(this)
    setContent {
      MaterialTheme {
        val saved = remember { mutableStateOf(store.load()) }
        val lines = remember { mutableStateListOf<String>() }
        var code by remember { mutableStateOf("") }
        var draft by remember { mutableStateOf("") }
        var status by remember { mutableStateOf(if (saved.value == null) "Not paired" else "Paired") }
        Column(Modifier.fillMaxSize().padding(16.dp)) {
          Text("Squidbot", style = MaterialTheme.typography.headlineMedium)
          Text(status)
          if (saved.value == null) {
            OutlinedTextField(code, { code = it }, label = { Text("Pairing code or QR text") })
            Button(onClick = {
              val parsed = parsePairingPayload(code)
              if (parsed == null) {
                status = "That code is not 8 characters"
                return@Button
              }
              status = "Pairing"
              Thread {
                val result = runCatching { claim(parsed.code) }
                runOnUiThread {
                  result.onSuccess { phone ->
                    store.save(phone.token, phone.deviceId, phone.computerPublicKey, phone.hostId)
                    saved.value = phone
                    status = "Paired"
                  }.onFailure { error ->
                    status = error.message ?: "Pairing failed"
                  }
                }
              }.start()
            }) { Text("Pair") }
          } else {
            lines.forEach { Text(it) }
            OutlinedTextField(draft, { draft = it }, label = { Text("Message") })
            Button(onClick = {
              val phone = saved.value ?: return@Button
              val text = draft
              if (text.isBlank()) return@Button
              draft = ""
              lines.add("You: $text")
              val replyAt = lines.size
              lines.add("")
              Thread {
                val result = runCatching {
                  sendEncrypted(phone, text) { chunk ->
                    runOnUiThread { lines[replyAt] = lines[replyAt] + chunk }
                  }
                }
                runOnUiThread {
                  result.onFailure { error ->
                    lines[replyAt] = error.message ?: "Send failed"
                  }
                }
              }.start()
            }) { Text("Send") }
            Button(onClick = {
              val phone = saved.value
              if (phone != null) runCatching { revoke(phone.deviceId) }
              store.clear()
              saved.value = null
              status = "Not paired"
              lines.clear()
            }) { Text("Unpair") }
          }
        }
      }
    }
  }
}

private fun claim(code: String): SavedPhone {
  Socket("127.0.0.1", 18790).use { socket ->
    writeJson(socket.getOutputStream(), """{"type":"claim","code":"$code"}""")
    val json = readJson(socket.getInputStream())
    if (!json.contains("\"paired\"")) error("Relay refused the code")
    return SavedPhone(
      token = jsonField(json, "token"),
      deviceId = jsonField(json, "deviceId"),
      computerPublicKey = jsonField(json, "computerPublicKey"),
      hostId = jsonField(json, "hostId"),
    )
  }
}

private fun jsonField(json: String, name: String): String {
  val match = Regex(""""$name"\s*:\s*"([^"]*)"""").find(json) ?: error("missing $name")
  return match.groupValues[1]
}

private fun sendEncrypted(phone: SavedPhone, text: String, onChunk: (String) -> Unit) {
  Socket("127.0.0.1", 18790).use { socket ->
    val out = socket.getOutputStream()
    val input = socket.getInputStream()
    writeJson(out, """{"type":"phone","hash":"${admissionHash(phone.token, b64(phone.hostId))}"}""")
    val reply = readJson(input)
    if (!reply.contains("\"splice\"")) error("Relay refused the phone")
    val remote = b64(phone.computerPublicKey)
    val secret = phonePsk(phone.token, remote)
    val hello = phoneHello(remote, secret, ByteArray(32) { 9 }, """{"v":1,"conn":"${b64u(ByteArray(16) { 3 })}","app":"phone"}""".toByteArray())
    writeSized(out, hello.message1)
    val session = hello.finish(readSized(input))
    writeSized(out, session.seal(text))
    while (true) {
      val frame = decodeRelayFrame(session.open(readSized(input))) ?: error("The bot could not answer.")
      when (frame) {
        is RelayFrame.Chunk -> onChunk(frame.text)
        RelayFrame.Done -> return
        is RelayFrame.Error -> error(friendlyRelayError(frame.code))
      }
    }
  }
}

private fun revoke(deviceId: String) {
  Socket("127.0.0.1", 18790).use { socket ->
    writeJson(socket.getOutputStream(), """{"type":"revoke","deviceId":"$deviceId"}""")
  }
}

private fun writeJson(out: java.io.OutputStream, json: String) {
  val body = json.toByteArray()
  val header = ByteBuffer.allocate(4).putInt(body.size).array()
  out.write(header)
  out.write(body)
  out.flush()
}

private fun readJson(input: java.io.InputStream): String = readSized(input).toString(Charsets.UTF_8)

private fun writeSized(out: java.io.OutputStream, bytes: ByteArray) {
  out.write(ByteBuffer.allocate(4).putInt(bytes.size).array())
  out.write(bytes)
  out.flush()
}

private fun readSized(input: java.io.InputStream): ByteArray {
  val header = input.readNBytes(4)
  val length = ByteBuffer.wrap(header).int
  return input.readNBytes(length)
}

private fun b64(text: String): ByteArray = Base64.getUrlDecoder().decode(text)
