#include "../jni/ServerKey/RemotePolicy.h"

#include <cassert>

int main() {
    ServerKey::ApplyPolicy(
            true, true, false, false,
            "1.0.0", "1.1.0", "", "",
            "notification-id", "ServerKey", "Full message", "2026-07-15T12:00:00Z",
            true, 12,
            "menu_auto|1|0\nmenu_aim|0|1\n",
            "ok", "Authorized");

    assert(ServerKey::IsRuntimeAllowed());
    assert(ServerKey::IsFeatureEnabled("menu_auto"));
    assert(!ServerKey::IsFeatureLocked("menu_auto"));
    assert(!ServerKey::IsFeatureEnabled("menu_aim"));
    assert(ServerKey::IsFeatureLocked("menu_aim"));

    ServerKey::ApplyPolicy(
            false, false, false, false,
            "", "", "", "", "", "", "", "",
            false, 13, "", "all_clients_disabled", "Locked");
    assert(!ServerKey::IsRuntimeAllowed());
    assert(!ServerKey::IsFeatureEnabled("menu_auto"));
    return 0;
}
