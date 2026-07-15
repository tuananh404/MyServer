package com.serverkey.sdk;

import android.content.Context;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;

import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.TimeUnit;

import javax.net.ssl.HttpsURLConnection;

public final class ServerKeyClient {
    public interface Listener {
        void onPolicy(RemotePolicy policy);
        void onActivationRequired(String message);
        void onConnectionState(String state, String message);
    }

    private static final int MAX_RESPONSE_CHARS = 256 * 1024;

    private final ServerKeyConfig config;
    private final Listener listener;
    private final String deviceId;
    private final String deviceName;
    private final SecureSessionStore sessionStore;
    private final ScheduledExecutorService executor = Executors.newSingleThreadScheduledExecutor();
    private final Handler mainHandler = new Handler(Looper.getMainLooper());

    private volatile boolean stopped;
    private volatile String sessionToken = "";
    private volatile String licenseKey = "";
    private volatile String lastNotificationId = "";
    private volatile String lastNotificationTitle = "";
    private volatile String lastNotificationMessage = "";
    private volatile String lastNotificationCreatedAt = "";
    private volatile long lastSuccessfulContactElapsed;
    private ScheduledFuture<?> heartbeatFuture;

    public ServerKeyClient(Context context, ServerKeyConfig config, Listener listener) {
        if (context == null || config == null || listener == null) {
            throw new IllegalArgumentException("Context, config and listener are required.");
        }
        Context appContext = context.getApplicationContext();
        this.config = config;
        this.listener = listener;
        this.deviceId = DeviceIdentity.create(appContext, config.projectId);
        this.deviceName = DeviceIdentity.displayName(appContext);
        this.sessionStore = new SecureSessionStore(appContext, config.projectId);
    }

    public synchronized void start() {
        if (stopped) return;
        SecureSessionStore.SessionRecord saved = sessionStore.load();
        if (saved == null) {
            postActivationRequired("Nhập license để kích hoạt · Enter a license to activate.");
            return;
        }
        sessionToken = saved.sessionToken;
        licenseKey = saved.licenseKey;
        lastNotificationId = saved.lastNotificationId;
        lastNotificationTitle = saved.lastNotificationTitle;
        lastNotificationMessage = saved.lastNotificationMessage;
        lastNotificationCreatedAt = saved.lastNotificationCreatedAt;
        postConnectionState("connecting", "Đang xác minh phiên · Verifying saved session...");
        executor.execute(new Runnable() {
            @Override public void run() { performHeartbeat(true); }
        });
    }

    public void activate(final String license) {
        final String normalized = license == null ? "" : license.trim();
        if (normalized.isEmpty()) {
            postActivationRequired("License không được để trống · License is required.");
            return;
        }
        postConnectionState("connecting", "Đang kích hoạt · Activating license...");
        executor.execute(new Runnable() {
            @Override public void run() { performActivation(normalized); }
        });
    }

    public synchronized void stop() {
        stopped = true;
        if (heartbeatFuture != null) heartbeatFuture.cancel(false);
        executor.shutdownNow();
    }

    public void logout() {
        final String token = sessionToken;
        sessionToken = "";
        licenseKey = "";
        sessionStore.clear();
        if (!token.isEmpty() && !stopped) {
            executor.execute(new Runnable() {
                @Override public void run() {
                    try { postJson("/api/v1/client/logout", new JSONObject(), token); }
                    catch (Exception ignored) {}
                }
            });
        }
        publishPolicy(RemotePolicy.locked("logged_out", "Đã đăng xuất khỏi ServerKey."));
        postActivationRequired("Nhập license để đăng nhập lại · Enter a license to sign in again.");
    }

    private void performActivation(String license) {
        try {
            JSONObject body = new JSONObject();
            body.put("token_string", config.productToken);
            body.put("key_string", license);
            body.put("hwid", deviceId);
            body.put("device_name", deviceName);
            body.put("app_version", config.appVersion);
            body.put("last_notification_id", lastNotificationId);
            HttpResult result = postJson("/api/v1/client/activate", body, "");
            if (result.code < 200 || result.code >= 300 || !result.body.optBoolean("success", false)) {
                String message = result.body.optString("message", "Kích hoạt license thất bại.");
                sessionToken = "";
                licenseKey = "";
                sessionStore.clear();
                publishPolicy(RemotePolicy.locked(
                        result.body.optString("code", "activation_failed"), message));
                postActivationRequired(message);
                return;
            }
            String token = result.body.optString("token", "").trim();
            if (token.isEmpty()) throw new IllegalStateException("Server did not return a session token.");
            sessionToken = token;
            licenseKey = license;
            lastSuccessfulContactElapsed = SystemClock.elapsedRealtime();
            RemotePolicy policy = RemotePolicy.fromResponse(result.body,
                    lastNotificationId, lastNotificationTitle,
                    lastNotificationMessage, lastNotificationCreatedAt);
            rememberNotification(policy);
            sessionStore.save(token, license, lastNotificationId,
                    lastNotificationTitle, lastNotificationMessage,
                    lastNotificationCreatedAt);
            publishPolicy(policy);
            postConnectionState(policy.authorized ? "online" : "locked",
                    policy.statusMessage.isEmpty() ? "Đã nhận policy từ ServerKey." : policy.statusMessage);
            scheduleHeartbeat(policy.heartbeatIntervalSeconds);
        } catch (Exception error) {
            handleNetworkFailure("Không thể kích hoạt: " + safeMessage(error));
            postActivationRequired("Không thể kết nối ServerKey. Kiểm tra mạng và thử lại.");
        }
    }

    private void performHeartbeat(boolean restoringSession) {
        if (stopped || sessionToken.isEmpty()) return;
        try {
            JSONObject body = new JSONObject();
            body.put("app_version", config.appVersion);
            body.put("device_name", deviceName);
            body.put("last_notification_id", lastNotificationId);
            HttpResult result = postJson("/api/v1/client/heartbeat", body, sessionToken);
            String responseCode = result.body.optString("code", "");
            if (result.code == 401 && "session_expired".equals(responseCode) &&
                    !licenseKey.isEmpty()) {
                sessionToken = "";
                postConnectionState("connecting", "Phiên đã hết hạn, đang tự động gia hạn...");
                performActivation(licenseKey);
                return;
            }
            if (result.code == 401 || result.code == 403) {
                String message = result.body.optString("message", "Phiên đã bị thu hồi hoặc hết hạn.");
                sessionToken = "";
                sessionStore.clear();
                publishPolicy(RemotePolicy.locked(
                        result.body.optString("code", "session_revoked"), message));
                postConnectionState("locked", message);
                postActivationRequired(message);
                return;
            }
            if (result.code < 200 || result.code >= 300 || !result.body.optBoolean("success", false)) {
                throw new IllegalStateException(result.body.optString("message", "Heartbeat failed."));
            }
            lastSuccessfulContactElapsed = SystemClock.elapsedRealtime();
            RemotePolicy policy = RemotePolicy.fromResponse(result.body,
                    lastNotificationId, lastNotificationTitle,
                    lastNotificationMessage, lastNotificationCreatedAt);
            rememberNotification(policy);
            publishPolicy(policy);
            postConnectionState(policy.authorized ? "online" : "locked",
                    policy.statusMessage.isEmpty() ? "ServerKey đã đồng bộ." : policy.statusMessage);
            scheduleHeartbeat(policy.heartbeatIntervalSeconds);
        } catch (Exception error) {
            handleNetworkFailure("Heartbeat lỗi: " + safeMessage(error));
            if (restoringSession && lastSuccessfulContactElapsed == 0) {
                postActivationRequired("Không xác minh được phiên đã lưu. Vui lòng thử lại khi có mạng.");
            }
            scheduleHeartbeat(30);
        }
    }

    private synchronized void scheduleHeartbeat(int intervalSeconds) {
        if (stopped || sessionToken.isEmpty()) return;
        if (heartbeatFuture != null) heartbeatFuture.cancel(false);
        int bounded = Math.max(15, Math.min(3600, intervalSeconds));
        double jitter = 0.90 + Math.random() * 0.20;
        long delay = Math.max(15, Math.round(bounded * jitter));
        heartbeatFuture = executor.schedule(new Runnable() {
            @Override public void run() { performHeartbeat(false); }
        }, delay, TimeUnit.SECONDS);
    }

    private void handleNetworkFailure(String message) {
        long last = lastSuccessfulContactElapsed;
        boolean graceExpired = last == 0 ||
                SystemClock.elapsedRealtime() - last > config.offlineGraceSeconds * 1000L;
        if (graceExpired) {
            publishPolicy(RemotePolicy.locked("offline", message));
            postConnectionState("offline", message);
        } else {
            postConnectionState("degraded", message);
        }
    }

    private void rememberNotification(RemotePolicy policy) {
        if (policy.notificationId == null || policy.notificationId.isEmpty() ||
                policy.notificationId.equals(lastNotificationId)) return;
        lastNotificationId = policy.notificationId;
        lastNotificationTitle = policy.notificationTitle;
        lastNotificationMessage = policy.notificationMessage;
        lastNotificationCreatedAt = policy.notificationCreatedAt;
        if (!sessionToken.isEmpty() && !licenseKey.isEmpty()) {
            try {
                sessionStore.save(sessionToken, licenseKey, lastNotificationId,
                        lastNotificationTitle, lastNotificationMessage,
                        lastNotificationCreatedAt);
            } catch (Exception ignored) {
                // Notification acknowledgement is retried on the next successful contact.
            }
        }
    }

    private HttpResult postJson(String path, JSONObject payload, String bearerToken) throws Exception {
        URL url = new URL(config.baseUrl + path);
        HttpsURLConnection connection = (HttpsURLConnection) url.openConnection();
        try {
            connection.setRequestMethod("POST");
            connection.setConnectTimeout(config.connectTimeoutMs);
            connection.setReadTimeout(config.readTimeoutMs);
            connection.setUseCaches(false);
            connection.setDoOutput(true);
            connection.setRequestProperty("Accept", "application/json");
            connection.setRequestProperty("Content-Type", "application/json; charset=utf-8");
            connection.setRequestProperty("Cache-Control", "no-store");
            if (bearerToken != null && !bearerToken.isEmpty()) {
                connection.setRequestProperty("Authorization", "Bearer " + bearerToken);
            }
            byte[] body = payload.toString().getBytes(StandardCharsets.UTF_8);
            connection.setFixedLengthStreamingMode(body.length);
            try (OutputStream output = connection.getOutputStream()) {
                output.write(body);
            }
            int status = connection.getResponseCode();
            InputStream stream = status >= 200 && status < 400
                    ? connection.getInputStream() : connection.getErrorStream();
            String response = readLimited(stream);
            JSONObject json = response.isEmpty() ? new JSONObject() : new JSONObject(response);
            return new HttpResult(status, json);
        } finally {
            connection.disconnect();
        }
    }

    private static String readLimited(InputStream stream) throws Exception {
        if (stream == null) return "";
        StringBuilder output = new StringBuilder();
        try (BufferedReader reader = new BufferedReader(
                new InputStreamReader(stream, StandardCharsets.UTF_8))) {
            char[] buffer = new char[4096];
            int count;
            while ((count = reader.read(buffer)) != -1) {
                if (output.length() + count > MAX_RESPONSE_CHARS) {
                    throw new IllegalStateException("Server response exceeds the size limit.");
                }
                output.append(buffer, 0, count);
            }
        }
        return output.toString();
    }

    private void publishPolicy(final RemotePolicy policy) {
        mainHandler.post(new Runnable() {
            @Override public void run() { if (!stopped) listener.onPolicy(policy); }
        });
    }

    private void postActivationRequired(final String message) {
        mainHandler.post(new Runnable() {
            @Override public void run() { if (!stopped) listener.onActivationRequired(message); }
        });
    }

    private void postConnectionState(final String state, final String message) {
        mainHandler.post(new Runnable() {
            @Override public void run() { if (!stopped) listener.onConnectionState(state, message); }
        });
    }

    private static String safeMessage(Exception error) {
        String message = error.getMessage();
        return message == null || message.trim().isEmpty()
                ? error.getClass().getSimpleName() : message.trim();
    }

    private static final class HttpResult {
        final int code;
        final JSONObject body;
        HttpResult(int code, JSONObject body) {
            this.code = code;
            this.body = body;
        }
    }
}
