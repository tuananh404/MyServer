package com.serverkey.sdk;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;

import org.json.JSONObject;

import java.nio.charset.StandardCharsets;
import java.security.KeyStore;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

final class SecureSessionStore {
    static final class SessionRecord {
        final String sessionToken;
        final String licenseKey;
        final String lastNotificationId;
        final String lastNotificationTitle;
        final String lastNotificationMessage;
        final String lastNotificationCreatedAt;

        SessionRecord(String sessionToken, String licenseKey, String lastNotificationId,
                      String lastNotificationTitle, String lastNotificationMessage,
                      String lastNotificationCreatedAt) {
            this.sessionToken = sessionToken;
            this.licenseKey = licenseKey;
            this.lastNotificationId = lastNotificationId;
            this.lastNotificationTitle = lastNotificationTitle;
            this.lastNotificationMessage = lastNotificationMessage;
            this.lastNotificationCreatedAt = lastNotificationCreatedAt;
        }
    }

    private static final String ANDROID_KEY_STORE = "AndroidKeyStore";
    private static final String VALUE_CIPHERTEXT = "ciphertext";
    private static final String VALUE_IV = "iv";

    private final SharedPreferences preferences;
    private final String keyAlias;

    SecureSessionStore(Context context, String projectId) {
        this.preferences = context.getSharedPreferences(
                "serverkey_secure_" + safeName(projectId), Context.MODE_PRIVATE);
        this.keyAlias = "serverkey.session." + context.getPackageName() + "." + safeName(projectId);
    }

    synchronized void save(String sessionToken, String licenseKey,
                           String lastNotificationId, String lastNotificationTitle,
                           String lastNotificationMessage,
                           String lastNotificationCreatedAt) throws Exception {
        JSONObject value = new JSONObject();
        value.put("session_token", sessionToken);
        value.put("license_key", licenseKey);
        value.put("last_notification_id", lastNotificationId == null ? "" : lastNotificationId);
        value.put("last_notification_title", lastNotificationTitle == null ? "" : lastNotificationTitle);
        value.put("last_notification_message", lastNotificationMessage == null ? "" : lastNotificationMessage);
        value.put("last_notification_created_at", lastNotificationCreatedAt == null ? "" : lastNotificationCreatedAt);

        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.ENCRYPT_MODE, getOrCreateKey());
        byte[] encrypted = cipher.doFinal(value.toString().getBytes(StandardCharsets.UTF_8));
        preferences.edit()
                .putString(VALUE_CIPHERTEXT, Base64.encodeToString(encrypted, Base64.NO_WRAP))
                .putString(VALUE_IV, Base64.encodeToString(cipher.getIV(), Base64.NO_WRAP))
                .apply();
    }

    synchronized SessionRecord load() {
        String ciphertext = preferences.getString(VALUE_CIPHERTEXT, "");
        String iv = preferences.getString(VALUE_IV, "");
        if (ciphertext.isEmpty() || iv.isEmpty()) return null;
        try {
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.DECRYPT_MODE, getOrCreateKey(),
                    new GCMParameterSpec(128, Base64.decode(iv, Base64.NO_WRAP)));
            String json = new String(cipher.doFinal(
                    Base64.decode(ciphertext, Base64.NO_WRAP)), StandardCharsets.UTF_8);
            JSONObject value = new JSONObject(json);
            String token = value.optString("session_token", "").trim();
            String license = value.optString("license_key", "").trim();
            String notificationId = value.optString("last_notification_id", "").trim();
            String notificationTitle = value.optString("last_notification_title", "").trim();
            String notificationMessage = value.optString("last_notification_message", "").trim();
            String notificationCreatedAt = value.optString("last_notification_created_at", "").trim();
            return token.isEmpty() ? null : new SessionRecord(
                    token, license, notificationId, notificationTitle,
                    notificationMessage, notificationCreatedAt);
        } catch (Exception error) {
            clear();
            return null;
        }
    }

    synchronized void clear() {
        preferences.edit().clear().apply();
    }

    private SecretKey getOrCreateKey() throws Exception {
        KeyStore keyStore = KeyStore.getInstance(ANDROID_KEY_STORE);
        keyStore.load(null);
        KeyStore.Entry existing = keyStore.getEntry(keyAlias, null);
        if (existing instanceof KeyStore.SecretKeyEntry) {
            return ((KeyStore.SecretKeyEntry) existing).getSecretKey();
        }
        KeyGenerator generator = KeyGenerator.getInstance(
                KeyProperties.KEY_ALGORITHM_AES, ANDROID_KEY_STORE);
        generator.init(new KeyGenParameterSpec.Builder(
                keyAlias, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .setUserAuthenticationRequired(false)
                .build());
        return generator.generateKey();
    }

    private static String safeName(String value) {
        return value.replaceAll("[^A-Za-z0-9_.-]", "_");
    }
}
