#include "serverkey_imgui.hpp"

#include <atomic>

namespace ServerKeyHost {

using RuntimeAction = void (*)();

namespace {
std::atomic<RuntimeAction> g_disableAction{nullptr};
std::atomic<RuntimeAction> g_startAction{nullptr};
}

void Configure(RuntimeAction disableAllRuntimeFeatures,
               RuntimeAction startRuntimeFeaturesOnce) {
    g_disableAction.store(disableAllRuntimeFeatures, std::memory_order_release);
    g_startAction.store(startRuntimeFeaturesOnce, std::memory_order_release);
}

}  // namespace ServerKeyHost

// The static SDK invokes this weak host callback after policy/state changes.
// Calls arrive on Android's main thread.
extern "C" void ServerKey_OnPolicyApplied() {
    if (!ServerKey::IsRuntimeAllowed()) {
        const auto disable = ServerKeyHost::g_disableAction.load(std::memory_order_acquire);
        if (disable) disable();
        return;
    }
    const auto start = ServerKeyHost::g_startAction.load(std::memory_order_acquire);
    if (start) start();
}
