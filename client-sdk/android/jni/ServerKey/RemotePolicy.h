#pragma once

#include <atomic>
#include <cstdint>
#include <string>
#include <unordered_map>

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
    std::string statusMessage = "Đang chờ ServerKey xác thực.";
    std::string connectionState = "boot";
    std::unordered_map<std::string, FeatureState> features;
};

bool ApplyPolicy(bool authorized,
                 bool menuEnabled,
                 bool maintenanceMode,
                 bool autoUpdateEnabled,
                 const std::string& minimumVersion,
                 const std::string& latestVersion,
                 const std::string& updateUrl,
                 const std::string& announcement,
                 const std::string& notificationId,
                 const std::string& notificationTitle,
                 const std::string& notificationMessage,
                 const std::string& notificationCreatedAt,
                 bool notificationFresh,
                 uint64_t revision,
                 const std::string& featuresWire,
                 const std::string& statusCode,
                 const std::string& statusMessage);

void SetConnectionState(const std::string& state, const std::string& message);
bool IsRuntimeAllowed();
bool IsFeatureEnabled(const std::string& featureKey);
bool IsFeatureLocked(const std::string& featureKey);
PolicySnapshot GetSnapshot();

} // namespace ServerKey
