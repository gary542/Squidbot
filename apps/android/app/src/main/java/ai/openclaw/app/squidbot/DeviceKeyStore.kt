// Adapted from openclaw/openclaw (MIT), modified for Squidbot.
// Modified: the phone device key and pairing token stay in the Android Keystore.
package ai.openclaw.app.squidbot

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.security.spec.ECGenParameterSpec
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

class DeviceKeyStore(context: Context) {
  private val prefs = context.getSharedPreferences("squidbot-phone", Context.MODE_PRIVATE)

  fun save(
    token: String,
    deviceId: String,
    computerPublicKey: String,
    hostId: String,
    relayHost: String = "127.0.0.1",
    relayPort: Int = 18790,
    fingerprint: String = "",
  ) {
    val cipher = Cipher.getInstance("AES/GCM/NoPadding")
    cipher.init(Cipher.ENCRYPT_MODE, secret())
    val sealed = cipher.doFinal(token.toByteArray(Charsets.UTF_8))
    identity()
    prefs.edit()
      .putString("iv", b64u(cipher.iv))
      .putString("token", b64u(sealed))
      .putString("deviceId", deviceId)
      .putString("computerPublicKey", computerPublicKey)
      .putString("hostId", hostId)
      .putString("relayHost", relayHost)
      .putInt("relayPort", relayPort)
      .putString("fingerprint", fingerprint)
      .apply()
  }

  fun load(): SavedPhone? {
    val iv = prefs.getString("iv", null) ?: return null
    val token = prefs.getString("token", null) ?: return null
    val deviceId = prefs.getString("deviceId", null) ?: return null
    val computerPublicKey = prefs.getString("computerPublicKey", null) ?: return null
    val hostId = prefs.getString("hostId", null) ?: return null
    val cipher = Cipher.getInstance("AES/GCM/NoPadding")
    cipher.init(Cipher.DECRYPT_MODE, secret(), GCMParameterSpec(128, java.util.Base64.getUrlDecoder().decode(iv)))
    val opened = cipher.doFinal(java.util.Base64.getUrlDecoder().decode(token)).toString(Charsets.UTF_8)
    return SavedPhone(
      opened,
      deviceId,
      computerPublicKey,
      hostId,
      prefs.getString("relayHost", null) ?: "127.0.0.1",
      prefs.getInt("relayPort", 18790),
      prefs.getString("fingerprint", null) ?: "",
    )
  }

  fun clear() {
    prefs.edit().clear().apply()
  }

  private fun identity() {
    val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
    if (store.containsAlias(IDENTITY)) return
    val generator = KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_EC, "AndroidKeyStore")
    generator.initialize(
      KeyGenParameterSpec.Builder(IDENTITY, KeyProperties.PURPOSE_SIGN)
        .setAlgorithmParameterSpec(ECGenParameterSpec("secp256r1"))
        .setDigests(KeyProperties.DIGEST_SHA256)
        .build(),
    )
    generator.generateKeyPair()
  }

  private fun secret(): SecretKey {
    val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
    val existing = store.getKey(KEY, null) as? SecretKey
    if (existing != null) return existing
    val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
    generator.init(
      KeyGenParameterSpec.Builder(KEY, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
        .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
        .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
        .build(),
    )
    return generator.generateKey()
  }

  companion object {
    private const val KEY = "squidbot-phone-device"
    private const val IDENTITY = "squidbot-phone-identity"
  }
}

data class SavedPhone(
  val token: String,
  val deviceId: String,
  val computerPublicKey: String,
  val hostId: String,
  val relayHost: String = "127.0.0.1",
  val relayPort: Int = 18790,
  val fingerprint: String = "",
)
