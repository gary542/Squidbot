// Adapted from milind-soni/OpenMausBot (Apache-2.0), modified for Squidbot.
// Modified: checks the phone protocol against a vector produced by the gateway.
package ai.openclaw.app.squidbot

import java.io.File
import java.util.Base64

object SquidbotProtocolTest

fun main() {
  val json = SquidbotProtocolTest::class.java.getResourceAsStream("/squidbot-noise-vector.json")?.bufferedReader()?.readText()
    ?: File("apps/android/app/src/test/resources/squidbot-noise-vector.json").readText()
  check(parsePairingPayload("squidbot-phone:AB23EFGH")?.code == "AB23EFGH")
  check(parsePairingPayload("ab23efgh")?.code == "AB23EFGH")
  check(parsePairingPayload("squidbot-phone:short") == null)
  val token = field(json, "token")
  val hostId = hex(field(json, "hostId"))
  check(admissionHash(token, hostId) == field(json, "admissionHash")) { "admission hash drifted" }
  val remote = hex(field(json, "computerPublic"))
  val secret = hex(field(json, "psk"))
  check(phonePsk(token, remote).contentEquals(secret)) { "psk drifted" }
  val hello = phoneHello(remote, secret, hex(field(json, "ephemeralPrivate")), payload())
  check(hello.message1.toHex() == field(json, "message1")) { "message1 drifted" }
  val session = hello.finish(hex(field(json, "message2")))
  check(session.seal(field(json, "plaintext")).toHex() == field(json, "record")) { "sealed record drifted" }
  println("squidbot phone protocol vectors passed")
}

private fun payload(): ByteArray {
  val conn = ByteArray(16) { 4 }
  val connText = Base64.getUrlEncoder().withoutPadding().encodeToString(conn)
  return """{"v":1,"conn":"$connText","app":"phone"}""".toByteArray(Charsets.UTF_8)
}

private fun field(json: String, name: String): String {
  val match = Regex(""""$name"\s*:\s*"([^"]*)"""").find(json) ?: error("missing $name")
  return match.groupValues[1]
}

private fun hex(text: String): ByteArray {
  val out = ByteArray(text.length / 2)
  for (index in out.indices) out[index] = text.substring(index * 2, index * 2 + 2).toInt(16).toByte()
  return out
}

private fun ByteArray.toHex(): String = joinToString("") { "%02x".format(it) }
