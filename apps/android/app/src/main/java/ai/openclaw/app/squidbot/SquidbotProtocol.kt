// Adapted from milind-soni/OpenMausBot (Apache-2.0), modified for Squidbot.
// Upstream: companion/src/e2e/noise.ts @ 96ff8445.
// Modified: the phone side of the Noise handshake and the pairing payload.
package ai.openclaw.app.squidbot

import java.math.BigInteger
import java.security.KeyFactory
import java.security.KeyPairGenerator
import java.security.MessageDigest
import java.security.PrivateKey
import java.security.PublicKey
import java.security.spec.ECGenParameterSpec
import java.security.spec.ECPoint
import java.security.spec.ECPrivateKeySpec
import java.security.spec.ECPublicKeySpec
import javax.crypto.Cipher
import javax.crypto.KeyAgreement
import javax.crypto.Mac
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

private const val PROTOCOL = "Noise_NKpsk0_P256_AESGCM_SHA256"

data class PairingPayload(
  val code: String,
  val host: String = "127.0.0.1",
  val port: Int = 18790,
  val fingerprint: String = "",
)

fun parsePairingPayload(text: String): PairingPayload? {
  val trimmed = text.trim()
  if (trimmed.startsWith("squidbot-phone://")) {
    val rest = trimmed.removePrefix("squidbot-phone://")
    val slash = rest.indexOf('/')
    if (slash <= 0) return null
    val hostPort = rest.substring(0, slash)
    val host = hostPort.substringBefore(':')
    val port = hostPort.substringAfter(':', "").toIntOrNull() ?: return null
    val tail = rest.substring(slash + 1)
    val code = tail.substringBefore('?').uppercase()
    val fingerprint = tail.substringAfter("fp=", "").substringBefore('&').lowercase()
    if (!validPairingCode(code) || host.isEmpty() || port !in 1..65535) return null
    return PairingPayload(code, host, port, fingerprint)
  }
  val code = when {
    trimmed.startsWith("squidbot-phone:") -> trimmed.removePrefix("squidbot-phone:")
    else -> trimmed
  }.trim().uppercase()
  if (!validPairingCode(code)) return null
  return PairingPayload(code)
}

private fun validPairingCode(code: String): Boolean =
  code.length == 8 && code.all { it in "ABCDEFGHJKLMNPQRSTUVWXYZ23456789" }

fun certificateMatchesPin(der: ByteArray, fingerprint: String): Boolean {
  val digest = sha256(der).joinToString("") { "%02x".format(it) }
  return digest.equals(fingerprint.replace(":", ""), ignoreCase = true)
}

fun sha256(bytes: ByteArray): ByteArray = MessageDigest.getInstance("SHA-256").digest(bytes)

fun hmacSha256(key: ByteArray, data: ByteArray): ByteArray {
  val mac = Mac.getInstance("HmacSHA256")
  mac.init(SecretKeySpec(key, "HmacSHA256"))
  return mac.doFinal(data)
}

fun credentialHash(token: String): ByteArray = sha256(token.toByteArray(Charsets.UTF_8))

fun keyId(publicKey: ByteArray): ByteArray = sha256(publicKey).copyOf(16)

fun phonePsk(token: String, computerPublic: ByteArray): ByteArray {
  val label = "squidbot-e2e psk v1".toByteArray(Charsets.UTF_8)
  return hmacSha256(credentialHash(token), label + keyId(computerPublic))
}

fun admissionHash(token: String, hostId: ByteArray): String {
  val label = "squidbot-relay admission v1".toByteArray(Charsets.UTF_8)
  val adm = hmacSha256(credentialHash(token), label + hostId)
  return b64u(sha256(adm))
}

fun b64u(bytes: ByteArray): String = java.util.Base64.getUrlEncoder().withoutPadding().encodeToString(bytes)

private fun hkdf(salt: ByteArray, ikm: ByteArray, outputs: Int): List<ByteArray> {
  val prk = hmacSha256(salt, ikm)
  val parts = ArrayList<ByteArray>(outputs)
  var previous = ByteArray(0)
  for (counter in 1..outputs) {
    previous = hmacSha256(prk, previous + byteArrayOf(counter.toByte()))
    parts.add(previous)
  }
  return parts
}

class CipherState(private val key: ByteArray?) {
  private var n = 0

  fun encrypt(ad: ByteArray, plaintext: ByteArray): ByteArray {
    val secret = key ?: return plaintext
    val cipher = Cipher.getInstance("AES/GCM/NoPadding")
    cipher.init(Cipher.ENCRYPT_MODE, SecretKeySpec(secret, "AES"), GCMParameterSpec(128, nonce(n)))
    cipher.updateAAD(ad)
    n += 1
    return cipher.doFinal(plaintext)
  }

  fun decrypt(ad: ByteArray, ciphertext: ByteArray): ByteArray {
    val secret = key ?: return ciphertext
    val cipher = Cipher.getInstance("AES/GCM/NoPadding")
    cipher.init(Cipher.DECRYPT_MODE, SecretKeySpec(secret, "AES"), GCMParameterSpec(128, nonce(n)))
    cipher.updateAAD(ad)
    val opened = cipher.doFinal(ciphertext)
    n += 1
    return opened
  }
}

private fun nonce(n: Int): ByteArray {
  val out = ByteArray(12)
  var value = n.toLong() and 0xffffffffL
  for (index in 11 downTo 4) {
    out[index] = (value and 0xff).toByte()
    value = value ushr 8
  }
  return out
}

class SymmetricState(var h: ByteArray, var ck: ByteArray) {
  var cipher = CipherState(null)

  fun mixHash(data: ByteArray) {
    h = sha256(h + data)
  }

  fun mixKey(ikm: ByteArray) {
    val (nextCk, key) = hkdf(ck, ikm, 2)
    ck = nextCk
    cipher = CipherState(key)
  }

  fun mixKeyAndHash(ikm: ByteArray) {
    val parts = hkdf(ck, ikm, 3)
    ck = parts[0]
    mixHash(parts[1])
    cipher = CipherState(parts[2])
  }

  fun encryptAndHash(plaintext: ByteArray): ByteArray {
    val out = cipher.encrypt(h, plaintext)
    mixHash(out)
    return out
  }

  fun decryptAndHash(ciphertext: ByteArray): ByteArray {
    val out = cipher.decrypt(h, ciphertext)
    mixHash(ciphertext)
    return out
  }

  fun split(): Pair<CipherState, CipherState> {
    val (first, second) = hkdf(ck, ByteArray(0), 2)
    return CipherState(first) to CipherState(second)
  }
}

private fun initialized(remoteStatic: ByteArray): SymmetricState {
  val name = PROTOCOL.toByteArray(Charsets.UTF_8)
  val h = if (name.size <= 32) name + ByteArray(32 - name.size) else sha256(name)
  val state = SymmetricState(h, h.copyOf())
  val prologue = "squidbot-e2e/1".toByteArray(Charsets.UTF_8) + byteArrayOf(0, 1)
  state.mixHash(prologue)
  state.mixHash(remoteStatic)
  return state
}

private val ecParams by lazy {
  val generator = KeyPairGenerator.getInstance("EC")
  generator.initialize(ECGenParameterSpec("secp256r1"))
  (generator.generateKeyPair().public as java.security.interfaces.ECPublicKey).params
}

fun uncompressedPublic(privateScalar: ByteArray): ByteArray {
  val point = derivePoint(privateScalar)
  return byteArrayOf(4) + point.affineX.toUnsigned(32) + point.affineY.toUnsigned(32)
}

private fun BigInteger.toUnsigned(size: Int): ByteArray {
  val raw = toByteArray()
  val stripped = if (raw.size > 1 && raw[0] == 0.toByte()) raw.copyOfRange(1, raw.size) else raw
  return if (stripped.size == size) stripped else ByteArray(size - stripped.size) + stripped
}

private fun privateKey(scalar: ByteArray): PrivateKey {
  val factory = KeyFactory.getInstance("EC")
  return factory.generatePrivate(ECPrivateKeySpec(BigInteger(1, scalar), ecParams))
}

private fun derivePoint(scalar: ByteArray): ECPoint {
  val private = privateKey(scalar) as java.security.interfaces.ECPrivateKey
  val g = private.params.generator
  val curve = private.params.curve
  var result: ECPoint? = null
  var addend = g
  var k = BigInteger(1, scalar)
  while (k.signum() > 0) {
    if (k.testBit(0)) result = if (result == null) addend else curve.add(result, addend)
    addend = curve.double(addend)
    k = k.shiftRight(1)
  }
  return result ?: error("zero scalar")
}

private fun java.security.spec.EllipticCurve.add(p: ECPoint, q: ECPoint): ECPoint = addPoints(this, p, q)

private fun java.security.spec.EllipticCurve.double(p: ECPoint): ECPoint = addPoints(this, p, p)

private fun addPoints(curve: java.security.spec.EllipticCurve, p: ECPoint, q: ECPoint): ECPoint {
  val prime = (curve.field as java.security.spec.ECFieldFp).p
  val a = curve.a
  val lambda = if (p.affineX == q.affineX && p.affineY == q.affineY) {
    p.affineX.multiply(p.affineX).multiply(BigInteger.valueOf(3)).add(a).multiply(p.affineY.shiftLeft(1).modInverse(prime)).mod(prime)
  } else {
    q.affineY.subtract(p.affineY).multiply(q.affineX.subtract(p.affineX).modInverse(prime)).mod(prime)
  }
  val x = lambda.multiply(lambda).subtract(p.affineX).subtract(q.affineX).mod(prime)
  val y = lambda.multiply(p.affineX.subtract(x)).subtract(p.affineY).mod(prime)
  return ECPoint(x, y)
}

fun sharedX(privateScalar: ByteArray, remoteUncompressed: ByteArray): ByteArray {
  val agreement = KeyAgreement.getInstance("ECDH")
  agreement.init(privateKey(privateScalar))
  val x = BigInteger(1, remoteUncompressed.copyOfRange(1, 33))
  val y = BigInteger(1, remoteUncompressed.copyOfRange(33, 65))
  val remote = KeyFactory.getInstance("EC").generatePublic(ECPublicKeySpec(ECPoint(x, y), ecParams))
  agreement.doPhase(remote, true)
  val secret = agreement.generateSecret()
  return if (secret.size == 32) secret else secret.copyOfRange(secret.size - 32, secret.size)
}

sealed class RelayFrame {
  data class Chunk(val text: String) : RelayFrame()
  data class Done(val text: String, val stopped: Boolean) : RelayFrame()
  data object Stop : RelayFrame()
  data class Error(val code: String, val message: String) : RelayFrame()
}

fun phoneChunkJson(text: String): String = """{"v":1,"kind":"chunk","text":"${escapeJson(text)}"}"""

fun phoneDoneJson(text: String): String = """{"v":1,"kind":"done","text":"${escapeJson(text)}"}"""

fun phoneStopJson(): String = """{"v":1,"kind":"stop"}"""

fun phoneErrorJson(code: String, message: String): String =
  """{"v":1,"kind":"error","code":"${escapeJson(code)}","message":"${escapeJson(message)}"}"""

fun friendlyRelayError(code: String): String = when (code) {
  "bot_held" -> "This bot is paused."
  "spend_cap" -> "The spend cap is reached."
  "loop" -> "This chat stopped so it would not keep going."
  else -> "The bot could not answer."
}

fun decodeRelayFrame(json: String): RelayFrame? {
  val kind = jsonStringField(json, "kind") ?: return null
  return when (kind) {
    "chunk" -> RelayFrame.Chunk(jsonStringField(json, "text") ?: return null)
    "done" -> RelayFrame.Done(jsonStringField(json, "text") ?: "", json.contains("\"stopped\":true"))
    "stop" -> RelayFrame.Stop
    "error" -> RelayFrame.Error(jsonStringField(json, "code") ?: return null, jsonStringField(json, "message") ?: return null)
    else -> null
  }
}

private fun escapeJson(text: String): String = buildString {
  for (ch in text) {
    when (ch) {
      '\\' -> append("\\\\")
      '"' -> append("\\\"")
      '\n' -> append("\\n")
      else -> append(ch)
    }
  }
}

private fun jsonStringField(json: String, name: String): String? {
  val key = "\"$name\""
  val keyAt = json.indexOf(key)
  if (keyAt < 0) return null
  var index = keyAt + key.length
  while (index < json.length && json[index] != '"') index += 1
  if (index >= json.length) return null
  index += 1
  val out = StringBuilder()
  while (index < json.length) {
    val ch = json[index]
    if (ch == '"') return out.toString()
    if (ch == '\\' && index + 1 < json.length) {
      when (json[index + 1]) {
        '"' -> out.append('"')
        '\\' -> out.append('\\')
        'n' -> out.append('\n')
        else -> out.append(json[index + 1])
      }
      index += 2
      continue
    }
    out.append(ch)
    index += 1
  }
  return null
}

class PhoneSession(private val send: CipherState, private val receive: CipherState) {
  fun seal(text: String): ByteArray = send.encrypt(ByteArray(0), text.toByteArray(Charsets.UTF_8))
  fun open(record: ByteArray): String = receive.decrypt(ByteArray(0), record).toString(Charsets.UTF_8)
}

class PhoneHandshake(private val state: SymmetricState, private val ephemeralPrivate: ByteArray) {
  lateinit var message1: ByteArray

  fun finish(message2: ByteArray): PhoneSession {
    val remote = message2.copyOfRange(0, 65)
    state.mixHash(remote)
    state.mixKey(remote)
    state.mixKey(sharedX(ephemeralPrivate, remote))
    state.decryptAndHash(message2.copyOfRange(65, message2.size))
    val (pc, cp) = state.split()
    return PhoneSession(pc, cp)
  }
}

fun phoneHello(remoteStatic: ByteArray, secret: ByteArray, ephemeralPrivate: ByteArray, payload: ByteArray): PhoneHandshake {
  val state = initialized(remoteStatic)
  state.mixKeyAndHash(secret)
  val ephemeralPublic = uncompressedPublic(ephemeralPrivate)
  state.mixHash(ephemeralPublic)
  state.mixKey(ephemeralPublic)
  state.mixKey(sharedX(ephemeralPrivate, remoteStatic))
  val encrypted = state.encryptAndHash(payload)
  val hello = PhoneHandshake(state, ephemeralPrivate)
  hello.message1 = ephemeralPublic + encrypted
  return hello
}

private operator fun ByteArray.plus(other: ByteArray): ByteArray {
  val out = ByteArray(size + other.size)
  System.arraycopy(this, 0, out, 0, size)
  System.arraycopy(other, 0, out, size, other.size)
  return out
}
