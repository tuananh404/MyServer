package com.serverkey.sdk;

import android.net.Uri;

public final class ServerKeyConfig {
    public final String baseUrl;
    public final String productToken;
    public final String projectId;
    public final String appVersion;
    public final int connectTimeoutMs;
    public final int readTimeoutMs;
    public final int offlineGraceSeconds;

    private ServerKeyConfig(Builder builder) {
        this.baseUrl = trimTrailingSlash(builder.baseUrl);
        this.productToken = builder.productToken;
        this.projectId = builder.projectId;
        this.appVersion = builder.appVersion;
        this.connectTimeoutMs = builder.connectTimeoutMs;
        this.readTimeoutMs = builder.readTimeoutMs;
        this.offlineGraceSeconds = builder.offlineGraceSeconds;
    }

    public static Builder builder(String baseUrl, String productToken, String projectId, String appVersion) {
        return new Builder(baseUrl, productToken, projectId, appVersion);
    }

    private static String trimTrailingSlash(String value) {
        String result = value == null ? "" : value.trim();
        while (result.endsWith("/")) result = result.substring(0, result.length() - 1);
        return result;
    }

    public static final class Builder {
        private final String baseUrl;
        private final String productToken;
        private final String projectId;
        private final String appVersion;
        private int connectTimeoutMs = 12_000;
        private int readTimeoutMs = 15_000;
        private int offlineGraceSeconds = 120;

        private Builder(String baseUrl, String productToken, String projectId, String appVersion) {
            this.baseUrl = baseUrl == null ? "" : baseUrl.trim();
            this.productToken = productToken == null ? "" : productToken.trim();
            this.projectId = projectId == null ? "" : projectId.trim();
            this.appVersion = appVersion == null ? "" : appVersion.trim();
        }

        public Builder timeouts(int connectTimeoutMs, int readTimeoutMs) {
            this.connectTimeoutMs = connectTimeoutMs;
            this.readTimeoutMs = readTimeoutMs;
            return this;
        }

        public Builder offlineGraceSeconds(int seconds) {
            this.offlineGraceSeconds = seconds;
            return this;
        }

        public ServerKeyConfig build() {
            Uri uri = Uri.parse(baseUrl);
            if (!"https".equalsIgnoreCase(uri.getScheme()) || uri.getHost() == null) {
                throw new IllegalArgumentException("ServerKey baseUrl must be a valid HTTPS URL.");
            }
            if (productToken.isEmpty()) throw new IllegalArgumentException("ServerKey productToken is required.");
            if (projectId.isEmpty()) throw new IllegalArgumentException("ServerKey projectId is required.");
            if (appVersion.isEmpty()) throw new IllegalArgumentException("ServerKey appVersion is required.");
            if (connectTimeoutMs < 1_000 || readTimeoutMs < 1_000) {
                throw new IllegalArgumentException("ServerKey network timeouts must be at least 1000 ms.");
            }
            if (offlineGraceSeconds < 0 || offlineGraceSeconds > 3600) {
                throw new IllegalArgumentException("offlineGraceSeconds must be between 0 and 3600.");
            }
            return new ServerKeyConfig(this);
        }
    }
}
