#pragma once

#include <cstdint>
#include <string>
#include <unordered_map>

#include "serverkey_ui.h"

namespace ServerKey {

struct FeatureState {
    bool enabled = false;
    bool locked = true;
    std::string displayName;
    std::string description;
};

struct PolicySnapshot {
    bool authorized = false;
    bool menuEnabled = false;
    bool maintenanceMode = false;
    bool autoUpdateEnabled = false;
    std::string minimumVersion;
    std::string latestVersion;
    std::string updateUrl;
    std::string announcement;
    std::string notificationId;
    std::string notificationTitle;
    std::string notificationMessage;
    std::string notificationCreatedAt;
    bool notificationFresh = false;
    uint64_t revision = 0;
    std::string statusCode = "boot_locked";
    std::string statusMessage = "Waiting for ServerKey authorization.";
    std::string connectionState = "boot";
    std::unordered_map<std::string, FeatureState> features;
};

bool IsRuntimeAllowed();
bool IsFeatureEnabled(const std::string& featureKey);
bool IsFeatureLocked(const std::string& featureKey);
PolicySnapshot GetSnapshot();

enum class UiSurface : uint32_t {
    LockPanel = SERVERKEY_UI_SURFACE_LOCK_PANEL,
    NotificationPage = SERVERKEY_UI_SURFACE_NOTIFICATION_PAGE,
    NotificationOverlay = SERVERKEY_UI_SURFACE_NOTIFICATION_OVERLAY
};

struct UiResult {
    bool visible = false;
    bool unread = false;
    bool openNotification = false;
    int touchX = 0;
    int touchY = 0;
    int touchWidth = 0;
    int touchHeight = 0;
};

UiResult DrawUi(UiSurface surface, float screenWidth = 0.0f,
                float screenHeight = 0.0f, bool vietnamese = false,
                float scale = 1.0f);
UiResult GetLastUiResult();
bool HasUnreadNotification();
void ResetUi();

}  // namespace ServerKey
