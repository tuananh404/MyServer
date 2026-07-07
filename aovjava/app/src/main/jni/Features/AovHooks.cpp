// Force rebuild 2026-06-01
#include "AovHooks.h"
#include "Includes/Logger.h"
#include "Includes/obfuscate.h"
#include "Includes/Utils.hpp"
#include "AutoUpdate/Il2CppResolver.h"
#include "Dobby/dobby.h"
#include "KittyMemory/KittyPtrValidator.hpp"
#include "Offsets.h"
#include <unistd.h>
#include <ctime>
#include <cstring>
#include <cmath>
#include <string>
#include <vector>
#include <utility>

// ── Toggles ──
bool  HackMap    = false;
bool  UnlockSkin = false;
bool  UnlockFps  = true;
float CameraZoom = 0.0f;
bool  CheckReport = false;

// AU 4.0 cooldown logic state
static bool Cd = false;
static void* (*AsHero)(void*) = nullptr;
static void (*_SetPlayerName)(uintptr_t, void*, void*, bool, void*) = nullptr;
static void* (*_String_CreateString)(void*, const char*, int, int) = nullptr;
static inline bool IsReadablePtr(uintptr_t addr, size_t len = sizeof(void*)) {
    if (addr < 0x10000) return false;
    return IsMemoryReadable((const void*)addr, len);
}

static void* CreateMonoString(const char* str) {
    if (!_String_CreateString || !str) return nullptr;
    int length = (int)strlen(str);
    return _String_CreateString(nullptr, str, 0, length);
}

void AovHooks_SetShowCooldown(bool enabled) {
    Cd = enabled;
}

void AovHooks_OnActorLinkerUpdate(void* instance) {
    if (!instance || !Cd || !AsHero || !_SetPlayerName || !_String_CreateString) return;
    if (!IsReadablePtr((uintptr_t)instance, sizeof(void*))) return;
    if (!IsReadablePtr((uintptr_t)instance + 0x70, sizeof(uintptr_t))) return;

    void* SkillControl = AsHero(instance);
    if (!SkillControl || !IsReadablePtr((uintptr_t)SkillControl, sizeof(void*))) return;
    if (!IsReadablePtr((uintptr_t)SkillControl + 0x3C, sizeof(int)) ||
        !IsReadablePtr((uintptr_t)SkillControl + 0x5C, sizeof(int)) ||
        !IsReadablePtr((uintptr_t)SkillControl + 0x7C, sizeof(int)) ||
        !IsReadablePtr((uintptr_t)SkillControl + 0xBC, sizeof(int))) {
        return;
    }
    uintptr_t HudControl = *(uintptr_t*)((uintptr_t)instance + 0x70);
    if (HudControl > 0 && IsReadablePtr(HudControl, sizeof(void*)) && SkillControl) {
        int hn1 = (int)std::ceil(*(int*)((uintptr_t)SkillControl + 0x3C) / 1000.0);
        int hn2 = (int)std::ceil(*(int*)((uintptr_t)SkillControl + 0x5C) / 1000.0);
        int hn3 = (int)std::ceil(*(int*)((uintptr_t)SkillControl + 0x7C) / 1000.0);
        int hn4 = (int)std::ceil(*(int*)((uintptr_t)SkillControl + 0xBC) / 1000.0);

        std::string ShowSkill =
            " [" + std::to_string(hn1) + "] " +
            " [" + std::to_string(hn2) + "] " +
            " [" + std::to_string(hn3) + "] ";
        std::string ShowSkill2 = " [" + std::to_string(hn4) + "] ";

        void* playerName = CreateMonoString(ShowSkill.c_str());
        void* prefixName = CreateMonoString(ShowSkill2.c_str());
        void* customName = CreateMonoString("");
        if (playerName && prefixName && customName) {
            _SetPlayerName(HudControl, playerName, prefixName, true, customName);
        }
    }
}

static bool isValidRva(uintptr_t rva) {
    return rva > 0x1000;
}

static bool safeHookRva(const char* tag,
                        uintptr_t libBase,
                        uintptr_t rva,
                        dobby_dummy_func_t replace,
                        dobby_dummy_func_t* original,
                        bool* alreadyHooked = nullptr) {
    if (alreadyHooked && *alreadyHooked) {
        return true;
    }

    if (!isValidRva(rva)) {
        LOGE("[AovHooks] %s skipped: invalid RVA 0x%lX", tag, (unsigned long)rva);
        return false;
    }

    int rc = DobbyHook((void*)(libBase + rva), replace, original);
    if (rc != 0) {
        LOGW("[AovHooks] %s warning: DobbyHook rc=%d addr=0x%lX. Assuming already hooked.", tag, rc,
             (unsigned long)(libBase + rva));
        if (alreadyHooked) *alreadyHooked = true;
        return true;
    }

    LOGI("[AovHooks] %s OK @ 0x%lX", tag, (unsigned long)rva);
    if (alreadyHooked) *alreadyHooked = true;
    return true;
}

template <typename T>
static T ResolveFnOrNull(uintptr_t libBase, const char* tag, uintptr_t rva) {
    if (!isValidRva(rva)) {
        LOGE("[AovHooks] %s unresolved: invalid RVA 0x%lX", tag, (unsigned long)rva);
        return nullptr;
    }
    return reinterpret_cast<T>(libBase + rva);
}

static bool IsValidFieldOffset(int off) {
    return off > 0;
}

// ── Unlock 120FPS hook ──
static bool (*orig_SupportedBoth60FPSCameraHeight)(void*) = nullptr;
static bool (*orig_Supported90FPSMode)(void*) = nullptr;
static bool (*orig_Supported120FPSMode)(void*) = nullptr;

static bool fake_SupportedBoth60FPSCameraHeight(void* instance) {
    if (UnlockFps) return true;
    return orig_SupportedBoth60FPSCameraHeight ? orig_SupportedBoth60FPSCameraHeight(instance) : false;
}

static bool fake_Supported90FPSMode(void* instance) {
    if (UnlockFps) return true;
    return orig_Supported90FPSMode ? orig_Supported90FPSMode(instance) : false;
}

static bool fake_Supported120FPSMode(void* instance) {
    if (UnlockFps) return true;
    return orig_Supported120FPSMode ? orig_Supported120FPSMode(instance) : false;
}

// ── Check Report hook ──
static bool (*orig_get_IsHostProfile)(void*) = nullptr;
static bool fake_get_IsHostProfile(void* instance) {
    if (CheckReport) return true;
    return orig_get_IsHostProfile ? orig_get_IsHostProfile(instance) : false;
}

// ═══════════════════════════════════════════════════════════════════
//  HACK MAP — Fog of War bypass
// ═══════════════════════════════════════════════════════════════════
static void (*orig_SetVisible)(void*, int, bool, bool) = nullptr;
static void fake_SetVisible(void* instance, int camp, bool bVisible, bool forceSync) {
    if (instance && HackMap) {
        if (camp == 1 || camp == 2) bVisible = true;
    }
    if (orig_SetVisible) orig_SetVisible(instance, camp, bVisible, forceSync);
}

// ═══════════════════════════════════════════════════════════════════
//  CAMERA ZOOM — Wide View
// ═══════════════════════════════════════════════════════════════════
static float (*orig_GetCameraHeightRateValue)(void*, int*) = nullptr;
static void  (*orig_CameraSystemUpdate)(void*)             = nullptr;
static void  (*OnCameraHeightChanged)(void*)               = nullptr;
static float g_LiveFov   = 0.0f;
static float g_ZoomDelta = 0.0f;

static float fake_GetCameraHeightRateValue(void* instance, int* type) {
    if (!instance || !orig_GetCameraHeightRateValue) return 0.0f;
    g_LiveFov = orig_GetCameraHeightRateValue(instance, type);
    if (g_ZoomDelta != 0.0f) return g_ZoomDelta + g_LiveFov;
    return g_LiveFov;
}
static void fake_CameraSystemUpdate(void* instance) {
    if (instance && OnCameraHeightChanged && g_ZoomDelta != 0.0f)
        OnCameraHeightChanged(instance);
    if (orig_CameraSystemUpdate) orig_CameraSystemUpdate(instance);
}

// ═══════════════════════════════════════════════════════════════════
//  UNLOCK SKIN — Bypass skin ownership checks
// ═══════════════════════════════════════════════════════════════════
enum class TdrErrorType {};

static int   g_off_dwHeroID = 0;
static int   g_off_wSkinID  = 0;

struct SkinData {
    uint32_t heroId = 0;
    uint16_t skinId = 0;
    bool     enable = false;
    std::vector<std::pair<uintptr_t, uint16_t>> unpacked;
    void Set(uint32_t hid, uint16_t sid) { heroId = hid; skinId = sid; }
    void Reset() {
        unpacked.clear();
    }
};
static SkinData g_Skin;

static TdrErrorType (*orig_unpack)(void*, void*, int32_t)   = nullptr;
static bool     (*orig_IsCanUseSkin)(void*, uint32_t, uint32_t) = nullptr;
static bool     (*orig_IsHaveHeroSkin)(uint32_t, uint32_t, bool) = nullptr;
static uint32_t (*orig_GetHeroWearSkinId)(void*, uint32_t) = nullptr;
static void     (*orig_OnClickSelectHeroSkin)(void*, int, int) = nullptr;
static void*    orig_RefreshHeroPanel = nullptr;

void AovHooks_SetUnlockSkin(bool enabled) {
    if (UnlockSkin == enabled) return;
    if (!enabled) g_Skin.Reset();
    UnlockSkin = enabled;
    if (!enabled) {
        g_Skin.enable = false;
        g_Skin.heroId = 0;
        g_Skin.skinId = 0;
    }
}

static TdrErrorType fake_unpack(void* instance, void* tdr, int32_t cutVer) {
    TdrErrorType result = orig_unpack ? orig_unpack(instance, tdr, cutVer) : TdrErrorType{};
    if (!instance || !UnlockSkin || !g_Skin.enable) return result;
    if (g_Skin.heroId == 0 || g_Skin.skinId == 0) return result;
    uint32_t hid = *(uint32_t*)((uintptr_t)instance + g_off_dwHeroID);
    if (hid != g_Skin.heroId) return result;
    g_Skin.unpacked.emplace_back((uintptr_t)instance,
                                  *(uint16_t*)((uintptr_t)instance + g_off_wSkinID));
    *(uint16_t*)((uintptr_t)instance + g_off_wSkinID) = g_Skin.skinId;
    return result;
}
static bool fake_IsCanUseSkin(void* instance, uint32_t heroId, uint32_t skinId) {
    if (UnlockSkin) { if (heroId != 0) g_Skin.Set(heroId, (uint16_t)skinId); return true; }
    return orig_IsCanUseSkin ? orig_IsCanUseSkin(instance, heroId, skinId) : false;
}
static bool fake_IsHaveHeroSkin(uint32_t heroId, uint32_t skinId, bool incl) {
    if (UnlockSkin) return true;
    return orig_IsHaveHeroSkin ? orig_IsHaveHeroSkin(heroId, skinId, incl) : false;
}
static uint32_t fake_GetHeroWearSkinId(void* instance, uint32_t heroId) {
    if (UnlockSkin && heroId != 0 && heroId == g_Skin.heroId && g_Skin.skinId != 0) {
        g_Skin.enable = true;
        return (uint32_t)g_Skin.skinId;
    }
    return orig_GetHeroWearSkinId ? orig_GetHeroWearSkinId(instance, heroId) : 0;
}
static void fake_OnClickSelectHeroSkin(void* ins, int heroid, int skinid) {
    if (UnlockSkin && heroid != 0 && skinid != 0) {
        g_Skin.Set((uint32_t)heroid, (uint16_t)skinid);
        g_Skin.enable = true;
    }
    if (orig_OnClickSelectHeroSkin) orig_OnClickSelectHeroSkin(ins, heroid, skinid);
    if (UnlockSkin && ins && skinid != 0 && orig_RefreshHeroPanel)
        ((void(*)(void*, bool, bool, bool))orig_RefreshHeroPanel)(ins, true, true, true);
}

// ═══════════════════════════════════════════════════════════════════
//  MASTER INIT — giong style aovjavaVIP 100%
//  Chỉ chạy 1 lần, tránh double-hook gây crash
// ═══════════════════════════════════════════════════════════════════
static bool g_hooksDone = false;

bool AovHooks_IsReady() {
    return g_hooksDone;
}

bool AovHooks_InitAll() {
    if (g_hooksDone) return true;

    LOGI("[AovHooks] Initializing Unity auto-update cache...");
    for (int retry = 0; retry < 5; retry++) {
        if (Unity::EnsureCache()) break;
        LOGE("[AovHooks] retry %d/5 ...", retry+1);
        sleep(2);
    }
    if (!Unity::EnsureCache()) {
        LOGE("[AovHooks] FATAL: Unity::EnsureCache() failed.");
        return false;
    }
    LOGI("[AovHooks] Unity cache OK. Installing hooks...");

    uintptr_t libBase = getLibraryAddress(TARGET_LIB);
    LOGI("[AovHooks] libBase=0x%lX", (unsigned long)libBase);
    if (!libBase) {
        LOGE("[AovHooks] getLibraryAddress failed for %s", TARGET_LIB);
        return false;
    }

    bool coreHooksOk = true;

    // ── HackMap ──
    LOGI("[AovHooks] hook 1/9: HackMap...");
    static bool h_hackMap = false;
    uintptr_t setVisibleRva = Unity::FindMethodOffset(
        OBFUSCATE("Project.Plugins_d.dll"), OBFUSCATE("NucleusDrive.Logic"),
        OBFUSCATE("LVActorLinker"), OBFUSCATE("SetVisible"), 3);
    coreHooksOk &= safeHookRva("HackMap::SetVisible", libBase, setVisibleRva,
                               (dobby_dummy_func_t)fake_SetVisible,
                               (dobby_dummy_func_t*)&orig_SetVisible, &h_hackMap);

    // ── Camera Zoom ──
    LOGI("[AovHooks] hook 2/9: Camera OnCameraHeightChanged...");
    uintptr_t onCameraHeightChangedRva = Unity::FindMethodOffset(
        OBFUSCATE("Project_d.dll"), OBFUSCATE(""),
        OBFUSCATE("CameraSystem"), OBFUSCATE("OnCameraHeightChanged"), 0);
    if (isValidRva(onCameraHeightChangedRva)) {
        OnCameraHeightChanged = (void(*)(void*))(libBase + onCameraHeightChangedRva);
    } else {
        LOGE("[AovHooks] Camera OnCameraHeightChanged skipped: invalid RVA 0x%lX",
             (unsigned long)onCameraHeightChangedRva);
        coreHooksOk = false;
    }

    LOGI("[AovHooks] hook 3/9: Camera Update...");
    static bool h_camUpdate = false;
    uintptr_t cameraUpdateRva = Unity::FindMethodOffset(
        OBFUSCATE("Project_d.dll"), OBFUSCATE(""),
        OBFUSCATE("CameraSystem"), OBFUSCATE("Update"), 0);
    coreHooksOk &= safeHookRva("CameraSystem::Update", libBase, cameraUpdateRva,
                               (dobby_dummy_func_t)fake_CameraSystemUpdate,
                               (dobby_dummy_func_t*)&orig_CameraSystemUpdate, &h_camUpdate);

    LOGI("[AovHooks] hook 4/9: Camera GetCameraHeightRateValue...");
    static bool h_camHeightRate = false;
    uintptr_t cameraHeightRateRva = Unity::FindMethodOffset(
        OBFUSCATE("Project_d.dll"), OBFUSCATE(""),
        OBFUSCATE("CameraSystem"), OBFUSCATE("GetCameraHeightRateValue"), 1);
    coreHooksOk &= safeHookRva("CameraSystem::GetCameraHeightRateValue", libBase, cameraHeightRateRva,
                               (dobby_dummy_func_t)fake_GetCameraHeightRateValue,
                               (dobby_dummy_func_t*)&orig_GetCameraHeightRateValue, &h_camHeightRate);

    if (!coreHooksOk) {
        LOGE("[AovHooks] Core hook resolution failed. Abort install to avoid bad patching.");
        return false;
    }

    // ── UnlockSkin — Fields ──
    LOGI("[AovHooks] hook 5/9: Skin fields...");
    g_off_dwHeroID = Unity::FindFieldOffset(
        OBFUSCATE("AovTdr.dll"), OBFUSCATE("CSProtocol"),
        OBFUSCATE("COMDT_HERO_COMMON_INFO"), OBFUSCATE("dwHeroID"));
    g_off_wSkinID  = Unity::FindFieldOffset(
        OBFUSCATE("AovTdr.dll"), OBFUSCATE("CSProtocol"),
        OBFUSCATE("COMDT_HERO_COMMON_INFO"), OBFUSCATE("wSkinID"));

    bool skinHooksReady = g_off_dwHeroID > 0 && g_off_wSkinID > 0;
    if (!skinHooksReady) {
        LOGE("[AovHooks] Skin hooks skipped: field offsets invalid hero=%d skin=%d",
             g_off_dwHeroID, g_off_wSkinID);
    }

    // ── UnlockSkin — Hooks ──
    if (skinHooksReady) {
        LOGI("[AovHooks] hook 6/9: Skin unpack...");
        static bool h_skinUnpack = false;
        uintptr_t unpackRva = Unity::FindMethodOffset(
            OBFUSCATE("AovTdr.dll"), OBFUSCATE("CSProtocol"),
            OBFUSCATE("COMDT_HERO_COMMON_INFO"), OBFUSCATE("unpack"), 2);
        safeHookRva("Skin::unpack", libBase, unpackRva,
                    (dobby_dummy_func_t)fake_unpack,
                    (dobby_dummy_func_t*)&orig_unpack, &h_skinUnpack);

        LOGI("[AovHooks] hook 7/9: Skin GetHeroWearSkinId...");
        static bool h_skinGetHeroWearSkinId = false;
        uintptr_t getHeroWearSkinIdRva = Unity::FindMethodOffset(
            OBFUSCATE("Project_d.dll"), OBFUSCATE("Assets.Scripts.GameSystem"),
            OBFUSCATE("CRoleInfo"), OBFUSCATE("GetHeroWearSkinId"), 1);
        safeHookRva("CRoleInfo::GetHeroWearSkinId", libBase, getHeroWearSkinIdRva,
                    (dobby_dummy_func_t)fake_GetHeroWearSkinId,
                    (dobby_dummy_func_t*)&orig_GetHeroWearSkinId, &h_skinGetHeroWearSkinId);

        LOGI("[AovHooks] hook 8/9: Skin IsCanUseSkin + IsHaveHeroSkin...");
        static bool h_skinIsCanUseSkin = false;
        uintptr_t isCanUseSkinRva = Unity::FindMethodOffset(
            OBFUSCATE("Project_d.dll"), OBFUSCATE("Assets.Scripts.GameSystem"),
            OBFUSCATE("CRoleInfo"), OBFUSCATE("IsCanUseSkin"), 2);
        safeHookRva("CRoleInfo::IsCanUseSkin", libBase, isCanUseSkinRva,
                    (dobby_dummy_func_t)fake_IsCanUseSkin,
                    (dobby_dummy_func_t*)&orig_IsCanUseSkin, &h_skinIsCanUseSkin);

        static bool h_skinIsHaveHeroSkin = false;
        uintptr_t isHaveHeroSkinRva = Unity::FindMethodOffset(
            OBFUSCATE("Project_d.dll"), OBFUSCATE("Assets.Scripts.GameSystem"),
            OBFUSCATE("CRoleInfo"), OBFUSCATE("IsHaveHeroSkin"), 3);
        safeHookRva("CRoleInfo::IsHaveHeroSkin", libBase, isHaveHeroSkinRva,
                    (dobby_dummy_func_t)fake_IsHaveHeroSkin,
                    (dobby_dummy_func_t*)&orig_IsHaveHeroSkin, &h_skinIsHaveHeroSkin);

        LOGI("[AovHooks] hook 9/9: Skin OnClickSelectHeroSkin + RefreshHeroPanel...");
        static bool h_skinOnClickSelectHeroSkin = false;
        uintptr_t onClickSelectHeroSkinRva = Unity::FindMethodOffset(
            OBFUSCATE("Project_d.dll"), OBFUSCATE("Assets.Scripts.GameSystem"),
            OBFUSCATE("HeroSelectNormalWindow"), OBFUSCATE("OnClickSelectHeroSkin"), 2);
        safeHookRva("HeroSelectNormalWindow::OnClickSelectHeroSkin", libBase, onClickSelectHeroSkinRva,
                    (dobby_dummy_func_t)fake_OnClickSelectHeroSkin,
                    (dobby_dummy_func_t*)&orig_OnClickSelectHeroSkin, &h_skinOnClickSelectHeroSkin);

        uintptr_t refreshHeroPanelRva = Unity::FindMethodOffset(
            OBFUSCATE("Project_d.dll"), OBFUSCATE("Assets.Scripts.GameSystem"),
            OBFUSCATE("HeroSelectNormalWindow"), OBFUSCATE("RefreshHeroPanel"), 3);
        if (isValidRva(refreshHeroPanelRva)) {
            orig_RefreshHeroPanel = (void*)(libBase + refreshHeroPanelRva);
        } else {
            LOGE("[AovHooks] RefreshHeroPanel skipped: invalid RVA 0x%lX",
                 (unsigned long)refreshHeroPanelRva);
        }
    }

    // ── Unlock 120FPS ──
    LOGI("[AovHooks] hook: Unlock FPS...");
    static bool h_fpsSupportedBoth60CameraHeight = false;
    uintptr_t supportedBoth60CameraHeightRva = Unity::FindMethodOffset(
        OBFUSCATE("Project_d.dll"), OBFUSCATE("Assets.Scripts.Framework"),
        OBFUSCATE("GameSettings"), OBFUSCATE("get_SupportedBoth60FPS_CameraHeight"), 0);
    safeHookRva("GameSettings::get_SupportedBoth60FPS_CameraHeight", libBase, supportedBoth60CameraHeightRva,
                (dobby_dummy_func_t)fake_SupportedBoth60FPSCameraHeight,
                (dobby_dummy_func_t*)&orig_SupportedBoth60FPSCameraHeight, &h_fpsSupportedBoth60CameraHeight);

    static bool h_fpsSupported90Fps = false;
    uintptr_t supported90FpsRva = Unity::FindMethodOffset(
        OBFUSCATE("Project_d.dll"), OBFUSCATE("Assets.Scripts.Framework"),
        OBFUSCATE("GameSettings"), OBFUSCATE("get_Supported90FPSMode"), 0);
    safeHookRva("GameSettings::get_Supported90FPSMode", libBase, supported90FpsRva,
                (dobby_dummy_func_t)fake_Supported90FPSMode,
                (dobby_dummy_func_t*)&orig_Supported90FPSMode, &h_fpsSupported90Fps);
    static bool h_fpsSupported120Fps = false;
    uintptr_t supported120FpsRva = Unity::FindMethodOffset(
        OBFUSCATE("Project_d.dll"), OBFUSCATE("Assets.Scripts.Framework"),
        OBFUSCATE("GameSettings"), OBFUSCATE("get_Supported120FPSMode"), 0);
    safeHookRva("GameSettings::get_Supported120FPSMode", libBase, supported120FpsRva,
                (dobby_dummy_func_t)fake_Supported120FPSMode,
                (dobby_dummy_func_t*)&orig_Supported120FPSMode, &h_fpsSupported120Fps);

    // ── Check Report ──
    LOGI("[AovHooks] hook: Check Report...");
    static bool h_checkReport = false;
    uintptr_t getIsHostProfileRva = Unity::FindMethodOffset(
        OBFUSCATE("Project_d.dll"), OBFUSCATE("Assets.Scripts.GameSystem"),
        OBFUSCATE("CPlayerProfile"), OBFUSCATE("get_IsHostProfile"), 0);
    safeHookRva("CPlayerProfile::get_IsHostProfile", libBase, getIsHostProfileRva,
                (dobby_dummy_func_t)fake_get_IsHostProfile,
                (dobby_dummy_func_t*)&orig_get_IsHostProfile, &h_checkReport);

    LOGI("[AovHooks] All hooks installed.");
    g_hooksDone = true;
    return true;
}

// ═══════════════════════════════════════════════════════════════════
//  update zoom live via slider (giong aovjavaVIP MainHook.h)
// ═══════════════════════════════════════════════════════════════════
void AovHooks_InitCameraZoom(float zoom) {
    g_ZoomDelta = zoom * 0.1362f;
}

// ═══════════════════════════════════════════════════════════════════
//  ESP Init — resolve IL2CPP offsets + install hooks
// ═══════════════════════════════════════════════════════════════════
#include "EspHooks.h"

bool EspInit() {
    static bool g_espInitDone = false;
    if (g_espInitDone) return true;

    if (g_espReady) return true;

    LOGI("[ESP] Resolving IL2CPP offsets...");
    uintptr_t libBase = getLibraryAddress(TARGET_LIB);
    if (!libBase) {
        LOGE("[ESP] getLibraryAddress failed for %s", TARGET_LIB);
        return false;
    }

    // ── ActorLinker methods (Project_d.dll / Kyrios.Actor / ActorLinker) ──
    // NOTE: ActorLinker ≠ LVActorLinker! LVActorLinker is in Plugins_d for visibility.
    uintptr_t alUpdate = Unity::FindMethodOffset(
        OBFUSCATE("Project_d.dll"), OBFUSCATE("Kyrios.Actor"),
        OBFUSCATE("ActorLinker"), OBFUSCATE("Update"), 0);
    uintptr_t alDestroy = Unity::FindMethodOffset(
        OBFUSCATE("Project_d.dll"), OBFUSCATE("Kyrios.Actor"),
        OBFUSCATE("ActorLinker"), OBFUSCATE("DestroyActor"), 0);
    uintptr_t alGetObjCamp = Unity::FindMethodOffset(
        OBFUSCATE("Project_d.dll"), OBFUSCATE("Kyrios.Actor"),
        OBFUSCATE("ActorLinker"), OBFUSCATE("get_objCamp"), 0);
    uintptr_t alGetObjType = Unity::FindMethodOffset(
        OBFUSCATE("Project_d.dll"), OBFUSCATE("Kyrios.Actor"),
        OBFUSCATE("ActorLinker"), OBFUSCATE("get_objType"), 0);
    uintptr_t alGetObjID = Unity::FindMethodOffset(
        OBFUSCATE("Project_d.dll"), OBFUSCATE("Kyrios.Actor"),
        OBFUSCATE("ActorLinker"), OBFUSCATE("get_ObjID"), 0);
    uintptr_t alIsHost = Unity::FindMethodOffset(
        OBFUSCATE("Project_d.dll"), OBFUSCATE("Kyrios.Actor"),
        OBFUSCATE("ActorLinker"), OBFUSCATE("IsHostPlayer"), 0);
    uintptr_t alGetPos = Unity::FindMethodOffset(
        OBFUSCATE("Project_d.dll"), OBFUSCATE("Kyrios.Actor"),
        OBFUSCATE("ActorLinker"), OBFUSCATE("get_position"), 0);

    // ── LActorRoot methods + fields (Project.Plugins_d.dll / NucleusDrive.Logic) ──
    uintptr_t lrUpdate = Unity::FindMethodOffset(
        OBFUSCATE("Project.Plugins_d.dll"), OBFUSCATE("NucleusDrive.Logic"),
        OBFUSCATE("LActorRoot"), OBFUSCATE("UpdateLogic"), 1);
    uintptr_t lrGetObjID = Unity::FindMethodOffset(
        OBFUSCATE("Project.Plugins_d.dll"), OBFUSCATE("NucleusDrive.Logic"),
        OBFUSCATE("LActorRoot"), OBFUSCATE("get_ObjID"), 0);
    off_LActorRoot_location = Unity::FindFieldOffset(
        OBFUSCATE("Project.Plugins_d.dll"), OBFUSCATE("NucleusDrive.Logic"),
        OBFUSCATE("LActorRoot"), OBFUSCATE("_location"));
    off_LActorRoot_forward = Unity::FindFieldOffset(
        OBFUSCATE("Project.Plugins_d.dll"), OBFUSCATE("NucleusDrive.Logic"),
        OBFUSCATE("LActorRoot"), OBFUSCATE("_forward"));

    // ── Camera methods (UnityEngine.CoreModule.dll / UnityEngine / Camera) ──
    uintptr_t camMain = Unity::FindMethodOffset(
        OBFUSCATE("UnityEngine.CoreModule.dll"), OBFUSCATE("UnityEngine"),
        OBFUSCATE("Camera"), OBFUSCATE("get_main"), 0);
    uintptr_t camW2S = Unity::FindMethodOffset(
        OBFUSCATE("UnityEngine.CoreModule.dll"), OBFUSCATE("UnityEngine"),
        OBFUSCATE("Camera"), OBFUSCATE("WorldToViewportPoint"), 2);

    // Verify critical offsets resolved
    if (!isValidRva(alUpdate) || !isValidRva(alDestroy) || !isValidRva(lrUpdate) ||
        !isValidRva(camMain) || !isValidRva(camW2S)) {
        LOGE("[ESP] Critical offset resolution FAILED — ESP disabled");
        LOGE("[ESP] alUpdate=0x%lX alDestroy=0x%lX lrUpdate=0x%lX camMain=0x%lX camW2S=0x%lX",
             (unsigned long)alUpdate, (unsigned long)alDestroy,
             (unsigned long)lrUpdate, (unsigned long)camMain,
             (unsigned long)camW2S);
        return false;
    }

    // Assign function pointers (validated)
    esp_getObjCamp    = ResolveFnOrNull<fn_int_ptr>(libBase, "ESP::ActorLinker::get_objCamp", alGetObjCamp);
    esp_getObjType    = ResolveFnOrNull<fn_int_ptr>(libBase, "ESP::ActorLinker::get_objType", alGetObjType);
    esp_getObjID      = ResolveFnOrNull<fn_uint_ptr>(libBase, "ESP::ActorLinker::get_ObjID", alGetObjID);
    esp_isHostPlayer  = ResolveFnOrNull<fn_bool_ptr>(libBase, "ESP::ActorLinker::IsHostPlayer", alIsHost);
    esp_getPosition   = ResolveFnOrNull<fn_vec3_ptr>(libBase, "ESP::ActorLinker::get_position", alGetPos);
    esp_cameraGetMain = ResolveFnOrNull<fn_ptr_void>(libBase, "ESP::Camera::get_main", camMain);
    esp_cameraW2S     = ResolveFnOrNull<fn_cam_w2s>(libBase, "ESP::Camera::WorldToViewportPoint", camW2S);
    esp_lrGetObjID    = ResolveFnOrNull<fn_uint_ptr>(libBase, "ESP::LActorRoot::get_ObjID", lrGetObjID);

    if (!esp_getObjCamp || !esp_getObjType || !esp_getObjID ||
        !esp_isHostPlayer || !esp_getPosition || !esp_cameraGetMain ||
        !esp_cameraW2S || !esp_lrGetObjID) {
        LOGE("[ESP] Required function pointers unresolved. Abort ESP init.");
        return false;
    }

    // ── Aimbot / AutoSkill: resolve field offsets ──
    off_LActorRoot_ActorControl   = Unity::FindFieldOffset(OBFUSCATE("Project.Plugins_d.dll"), OBFUSCATE("NucleusDrive.Logic"), OBFUSCATE("LActorRoot"), OBFUSCATE("ActorControl"));
    off_LActorRoot_ValueComponent = Unity::FindFieldOffset(OBFUSCATE("Project.Plugins_d.dll"), OBFUSCATE("NucleusDrive.Logic"), OBFUSCATE("LActorRoot"), OBFUSCATE("ValueComponent"));
    off_Sk_SlotType             = Unity::FindFieldOffset(OBFUSCATE("Project_d.dll"), OBFUSCATE("Assets.Scripts.GameLogic"), OBFUSCATE("SkillSlot"), OBFUSCATE("SlotType"));
    off_Sk_skillIndicator       = Unity::FindFieldOffset(OBFUSCATE("Project_d.dll"), OBFUSCATE("Assets.Scripts.GameLogic"), OBFUSCATE("SkillSlot"), OBFUSCATE("skillIndicator"));
    off_Sk_curindicatorDistance = Unity::FindFieldOffset(OBFUSCATE("Project_d.dll"), OBFUSCATE("Assets.Scripts.GameLogic"), OBFUSCATE("SkillControlIndicator"), OBFUSCATE("curindicatorDistance"));
    off_Sk_useSkillDirection    = Unity::FindFieldOffset(OBFUSCATE("Project_d.dll"), OBFUSCATE("Assets.Scripts.GameLogic"), OBFUSCATE("SkillControlIndicator"), OBFUSCATE("useSkillDirection"));
    off_Actorlk_ObjLinker       = Unity::FindFieldOffset(OBFUSCATE("Project_d.dll"), OBFUSCATE("Kyrios.Actor"), OBFUSCATE("ActorLinker"), OBFUSCATE("ObjLinker"));
    off_Actorlk_ValueComponent  = Unity::FindFieldOffset(OBFUSCATE("Project_d.dll"), OBFUSCATE("Kyrios.Actor"), OBFUSCATE("ActorLinker"), OBFUSCATE("ValueComponent"));
    off_ActorConfig_ConfigID    = Unity::FindFieldOffset(OBFUSCATE("Project_d.dll"), OBFUSCATE("Assets.Scripts.GameLogic"), OBFUSCATE("ActorConfig"), OBFUSCATE("ConfigID"));

    // ── Aimbot / AutoSkill: function pointers (validated) ──
    uintptr_t rvaGetCurSkillSlotType = Unity::FindMethodOffset(OBFUSCATE("Project_d.dll"), OBFUSCATE("Assets.Scripts.GameSystem"), OBFUSCATE("CSkillButtonManager"), OBFUSCATE("GetCurSkillSlotType"), 0);
    uintptr_t rvaIsDeadState = Unity::FindMethodOffset(OBFUSCATE("Project.Plugins_d.dll"), OBFUSCATE("NucleusDrive.Logic"), OBFUSCATE("LObjWrapper"), OBFUSCATE("get_IsDeadState"), 0);
    uintptr_t rvaGetActorHp = Unity::FindMethodOffset(OBFUSCATE("Project.Plugins_d.dll"), OBFUSCATE("NucleusDrive.Logic"), OBFUSCATE("ValuePropertyComponent"), OBFUSCATE("get_actorHp"), 0);
    uintptr_t rvaGetActorHpTotal = Unity::FindMethodOffset(OBFUSCATE("Project.Plugins_d.dll"), OBFUSCATE("NucleusDrive.Logic"), OBFUSCATE("ValuePropertyComponent"), OBFUSCATE("get_actorHpTotal"), 0);
    uintptr_t rvaGetSpeed = Unity::FindMethodOffset(OBFUSCATE("Project.Plugins_d.dll"), OBFUSCATE("NucleusDrive.Logic"), OBFUSCATE("PlayerMovement"), OBFUSCATE("get_speed"), 0);
    uintptr_t rvaGetPlayerMovement = Unity::FindMethodOffset(OBFUSCATE("Project.Plugins_d.dll"), OBFUSCATE("NucleusDrive.Logic"), OBFUSCATE("LActorRoot"), OBFUSCATE("get_PlayerMovement"), 0);
    uintptr_t rvaLrAsHero = Unity::FindMethodOffset(OBFUSCATE("Project.Plugins_d.dll"), OBFUSCATE("NucleusDrive.Logic"), OBFUSCATE("LActorRoot"), OBFUSCATE("AsHero"), 0);
    uintptr_t rvaGetHeroWrapSkillData = Unity::FindMethodOffset(OBFUSCATE("Project.Plugins_d.dll"), OBFUSCATE("NucleusDrive.Logic"), OBFUSCATE("LHeroWrapper"), OBFUSCATE("GetHeroWrapSkillData"), 1);
    uintptr_t rvaReqSkill = Unity::FindMethodOffset(OBFUSCATE("Project_d.dll"), OBFUSCATE("Assets.Scripts.GameLogic"), OBFUSCATE("SkillSlot"), OBFUSCATE("RequestUseSkill"), 0);
    uintptr_t rvaReqSkill2 = Unity::FindMethodOffset(OBFUSCATE("Project_d.dll"), OBFUSCATE("Assets.Scripts.GameLogic"), OBFUSCATE("SkillSlot"), OBFUSCATE("ReadyUseSkill"), 1);
    uintptr_t rvaVlGetActorHp = Unity::FindMethodOffset(OBFUSCATE("Project_d.dll"), OBFUSCATE("Kyrios.Actor"), OBFUSCATE("ValueLinkerComponent"), OBFUSCATE("get_actorHp"), 0);
    uintptr_t rvaVlGetActorHpTotal = Unity::FindMethodOffset(OBFUSCATE("Project_d.dll"), OBFUSCATE("Kyrios.Actor"), OBFUSCATE("ValueLinkerComponent"), OBFUSCATE("get_actorHpTotal"), 0);
    uintptr_t rvaVlGetSoulLevel = Unity::FindMethodOffset(OBFUSCATE("Project_d.dll"), OBFUSCATE("Kyrios.Actor"), OBFUSCATE("ValueLinkerComponent"), OBFUSCATE("get_actorSoulLevel"), 0);

    g_getCurSkillSlotType  = ResolveFnOrNull<fn_int_ptr>(libBase, "AIM::CSkillButtonManager::GetCurSkillSlotType", rvaGetCurSkillSlotType);
    g_isDeadState          = ResolveFnOrNull<fn_bool_ptr>(libBase, "AIM::LObjWrapper::get_IsDeadState", rvaIsDeadState);
    g_getActorHp           = ResolveFnOrNull<fn_int_ptr>(libBase, "AIM::ValuePropertyComponent::get_actorHp", rvaGetActorHp);
    g_getActorHpTotal      = ResolveFnOrNull<fn_int_ptr>(libBase, "AIM::ValuePropertyComponent::get_actorHpTotal", rvaGetActorHpTotal);
    g_getSpeed             = ResolveFnOrNull<fn_int_ptr>(libBase, "AIM::PlayerMovement::get_speed", rvaGetSpeed);
    g_getPlayerMovement    = ResolveFnOrNull<fn_voidp_ptr>(libBase, "AIM::LActorRoot::get_PlayerMovement", rvaGetPlayerMovement);
    g_lrAsHero             = ResolveFnOrNull<fn_voidp_ptr>(libBase, "AIM::LActorRoot::AsHero", rvaLrAsHero);
    g_getHeroWrapSkillData = ResolveFnOrNull<fn_herodata_ptr_int>(libBase, "AIM::LHeroWrapper::GetHeroWrapSkillData", rvaGetHeroWrapSkillData);
    g_reqSkill             = ResolveFnOrNull<fn_bool_ptr>(libBase, "AIM::SkillSlot::RequestUseSkill", rvaReqSkill);
    g_reqSkill2            = ResolveFnOrNull<fn_bool_ptr_bool>(libBase, "AIM::SkillSlot::ReadyUseSkill", rvaReqSkill2);
    g_vlGetActorHp         = ResolveFnOrNull<fn_int_ptr>(libBase, "AIM::ValueLinkerComponent::get_actorHp", rvaVlGetActorHp);
    g_vlGetActorHpTotal    = ResolveFnOrNull<fn_int_ptr>(libBase, "AIM::ValueLinkerComponent::get_actorHpTotal", rvaVlGetActorHpTotal);
    g_vlGetSoulLevel       = ResolveFnOrNull<fn_int_ptr>(libBase, "AIM::ValueLinkerComponent::get_actorSoulLevel", rvaVlGetSoulLevel);

    
    uintptr_t rvaAsHero = Unity::FindMethodOffset(
        OBFUSCATE("Project_d.dll"), OBFUSCATE("Kyrios.Actor"),
        OBFUSCATE("ActorLinker"), OBFUSCATE("AsHero"), 0);
    uintptr_t rvaSetPlayerName = Unity::FindMethodOffset(
        OBFUSCATE("Project_d.dll"), OBFUSCATE("Assets.Scripts.GameLogic"),
        OBFUSCATE("HudComponent3D"), OBFUSCATE("SetPlayerName"), 4);

    AsHero = ResolveFnOrNull<void* (*)(void*)>(libBase, "Cooldown::ActorLinker::AsHero", rvaAsHero);
    _SetPlayerName = ResolveFnOrNull<void (*)(uintptr_t, void*, void*, bool, void*)>(
        libBase, "Cooldown::HudComponent3D::SetPlayerName", rvaSetPlayerName);
    uintptr_t stringCreateRva = Unity::FindMethodOffset(
        OBFUSCATE("mscorlib.dll"), OBFUSCATE("System"),
        OBFUSCATE("String"), OBFUSCATE("CreateString"), 3);
    if (isValidRva(stringCreateRva)) {
        _String_CreateString = (void* (*)(void*, const char*, int, int))(libBase + stringCreateRva);
    } else {
        _String_CreateString = nullptr;
        LOGE("[AovHooks] Cooldown CreateString unresolved (mscorlib.dll/System/String/CreateString/3)");
    }

    if (!IsValidFieldOffset(off_LActorRoot_location) ||
        !IsValidFieldOffset(off_LActorRoot_forward) ||
        !IsValidFieldOffset(off_LActorRoot_ActorControl) ||
        !IsValidFieldOffset(off_LActorRoot_ValueComponent) ||
        !IsValidFieldOffset(off_Sk_SlotType) ||
        !IsValidFieldOffset(off_Sk_skillIndicator) ||
        !IsValidFieldOffset(off_Sk_curindicatorDistance) ||
        !IsValidFieldOffset(off_Sk_useSkillDirection) ||
        !IsValidFieldOffset(off_Actorlk_ObjLinker) ||
        !IsValidFieldOffset(off_Actorlk_ValueComponent) ||
        !IsValidFieldOffset(off_ActorConfig_ConfigID)) {
        LOGE("[ESP] Required field offsets unresolved. Abort ESP init.");
        return false;
    }

    // ── Hook ESP ──
    bool espHooksOk = true;
    LOGI("[ESP] Hooking ActorLinker::Update (0x%lX)...", (unsigned long)alUpdate);
    static bool h_espActorLinkerUpdate = false;
    espHooksOk &= safeHookRva("ESP::ActorLinker::Update", libBase, alUpdate,
                              (dobby_dummy_func_t)hook_ActorLinker_Update,
                              (dobby_dummy_func_t*)&orig_ActorLinker_Update, &h_espActorLinkerUpdate);

    LOGI("[ESP] Hooking ActorLinker::DestroyActor (0x%lX)...", (unsigned long)alDestroy);
    static bool h_espActorLinkerDestroyActor = false;
    espHooksOk &= safeHookRva("ESP::ActorLinker::DestroyActor", libBase, alDestroy,
                              (dobby_dummy_func_t)hook_ActorLinker_DestroyActor,
                              (dobby_dummy_func_t*)&orig_ActorLinker_DestroyActor, &h_espActorLinkerDestroyActor);

    LOGI("[ESP] Hooking LActorRoot::UpdateLogic (0x%lX)...", (unsigned long)lrUpdate);
    static bool h_espLActorRootUpdateLogic = false;
    espHooksOk &= safeHookRva("ESP::LActorRoot::UpdateLogic", libBase, lrUpdate,
                              (dobby_dummy_func_t)hook_LActorRoot_UpdateLogic,
                              (dobby_dummy_func_t*)&orig_LActorRoot_UpdateLogic, &h_espLActorRootUpdateLogic);

    if (!espHooksOk) {
        LOGE("[ESP] Core ESP hooks failed. Skip enabling ESP to avoid crash.");
        return false;
    }

    // ── Hook Aimbot / AutoSkill ──
    uintptr_t aimGetUseSkill = Unity::FindMethodOffset(OBFUSCATE("Project_d.dll"), OBFUSCATE("Assets.Scripts.GameLogic"), OBFUSCATE("SkillControlIndicator"), OBFUSCATE("GetUseSkillDirection"), 1);
    uintptr_t aimSkillBtnMgr = Unity::FindMethodOffset(OBFUSCATE("Project_d.dll"), OBFUSCATE("Assets.Scripts.GameSystem"), OBFUSCATE("CSkillButtonManager"), OBFUSCATE("LateUpdate"), 0);
    uintptr_t aimSkillSlot   = Unity::FindMethodOffset(OBFUSCATE("Project_d.dll"), OBFUSCATE("Assets.Scripts.GameLogic"), OBFUSCATE("SkillSlot"), OBFUSCATE("LateUpdate"), 1);

    if (isValidRva(aimGetUseSkill) && isValidRva(aimSkillBtnMgr) && isValidRva(aimSkillSlot)) {
        LOGI("[Aimbot] Hooking GetUseSkillDirection...");
        static bool h_aimGetUseSkill = false;
        safeHookRva("Aimbot::GetUseSkillDirection", libBase, aimGetUseSkill,
                    (dobby_dummy_func_t)hook_GetUseSkillDirection,
                    (dobby_dummy_func_t*)&orig_GetUseSkillDirection, &h_aimGetUseSkill);
        LOGI("[Aimbot] Hooking SkillButtonManager::LateUpdate...");
        static bool h_aimSkillBtnMgr = false;
        safeHookRva("Aimbot::CSkillButtonManager::LateUpdate", libBase, aimSkillBtnMgr,
                    (dobby_dummy_func_t)hook_SkillButtonManager_LateUpdate,
                    (dobby_dummy_func_t*)&orig_SkillButtonManager_LateUpdate, &h_aimSkillBtnMgr);
        LOGI("[AutoSkill] Hooking SkillSlot::LateUpdate...");
        static bool h_aimSkillSlot = false;
        safeHookRva("AutoSkill::SkillSlot::LateUpdate", libBase, aimSkillSlot,
                    (dobby_dummy_func_t)hook_SkillSlot_LateUpdate,
                    (dobby_dummy_func_t*)&orig_SkillSlot_LateUpdate, &h_aimSkillSlot);
    } else {
        LOGE("[Aimbot] Skipped: unresolved RVAs getUse=0x%lX btnMgr=0x%lX slot=0x%lX",
             (unsigned long)aimGetUseSkill,
             (unsigned long)aimSkillBtnMgr,
             (unsigned long)aimSkillSlot);
    }

    g_espInitDone = true;
    g_espReady = true;
    LOGI("[ESP] All hooks installed. g_espReady=true");
    return true;
}
