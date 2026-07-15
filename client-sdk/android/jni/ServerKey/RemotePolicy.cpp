#include "RemotePolicy.h"

#include <mutex>
#include <sstream>

namespace ServerKey {
namespace {
std::mutex g_policyMutex;
PolicySnapshot g_policy;
std::atomic<bool> g_runtimeAllowed{false};
}

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
                 const std::string& statusMessage) {
    PolicySnapshot next;
    next.authorized = authorized;
    next.menuEnabled = menuEnabled;
    next.maintenanceMode = maintenanceMode;
    next.autoUpdateEnabled = autoUpdateEnabled;
    next.minimumVersion = minimumVersion;
    next.latestVersion = latestVersion;
    next.updateUrl = updateUrl;
    next.announcement = announcement;
    next.notificationId = notificationId;
    next.notificationTitle = notificationTitle;
    next.notificationMessage = notificationMessage;
    next.notificationCreatedAt = notificationCreatedAt;
    next.notificationFresh = notificationFresh;
    next.revision = revision;
    next.statusCode = statusCode.empty() ? (authorized ? "ok" : "locked") : statusCode;
    next.statusMessage = statusMessage;
    next.connectionState = authorized ? "online" : "locked";

    std::istringstream featureStream(featuresWire);
    std::string line;
    while (std::getline(featureStream, line)) {
        const size_t first = line.find('|');
        const size_t second = first == std::string::npos
                ? std::string::npos : line.find('|', first + 1);
        if (first == std::string::npos || second == std::string::npos) continue;
        const std::string key = line.substr(0, first);
        if (key.empty()) continue;
        FeatureState feature;
        feature.enabled = line.substr(first + 1, second - first - 1) == "1";
        feature.locked = line.substr(second + 1) != "0";
        next.features.emplace(key, std::move(feature));
    }

    const bool nextAllowed = next.authorized && next.menuEnabled && !next.maintenanceMode;
    const bool wasAllowed = g_runtimeAllowed.load(std::memory_order_acquire);
    // Revoke first, authorize last: no worker can observe an allowed state with
    // either stale policy or a policy that is still being replaced.
    if (!nextAllowed) g_runtimeAllowed.store(false, std::memory_order_release);
    {
        std::lock_guard<std::mutex> lock(g_policyMutex);
        g_policy = std::move(next);
    }
    if (nextAllowed) g_runtimeAllowed.store(true, std::memory_order_release);
    return wasAllowed && !nextAllowed;
}

void SetConnectionState(const std::string& state, const std::string& message) {
    std::lock_guard<std::mutex> lock(g_policyMutex);
    g_policy.connectionState = state;
    if (!message.empty()) g_policy.statusMessage = message;
}

bool IsRuntimeAllowed() {
    return g_runtimeAllowed.load(std::memory_order_acquire);
}

bool IsFeatureEnabled(const std::string& featureKey) {
    if (!IsRuntimeAllowed()) return false;
    std::lock_guard<std::mutex> lock(g_policyMutex);
    const auto found = g_policy.features.find(featureKey);
    return found != g_policy.features.end() && found->second.enabled;
}

bool IsFeatureLocked(const std::string& featureKey) {
    if (!IsRuntimeAllowed()) return true;
    std::lock_guard<std::mutex> lock(g_policyMutex);
    const auto found = g_policy.features.find(featureKey);
    return found == g_policy.features.end() || found->second.locked || !found->second.enabled;
}

PolicySnapshot GetSnapshot() {
    std::lock_guard<std::mutex> lock(g_policyMutex);
    return g_policy;
}

} // namespace ServerKey
