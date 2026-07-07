#pragma once
// EspHooks.h — ESP + Aimbot + AutoSkill hooks for AoV
// Ported from aovimgui main.cpp

#include "imgui.h"
#include "imgui_internal.h"
#include "EspVariables.h"
#include "AovHooks.h"
#include "Includes/obfuscate.h"
#include "Includes/Utils.hpp"
#include <unistd.h>
#include <mutex>
#include <set>
#include <map>
#include <cmath>
#include <algorithm>
#include <ctime>

// ── Safety ──
static std::mutex g_espRenderMutex;  // Guard EspBeginDraw from concurrent calls

// ── Structs ──

struct VInt3 {
    int X, Y, Z;
    VInt3() : X(0), Y(0), Z(0) {}
    VInt3(int x, int y, int z) : X(x), Y(y), Z(z) {}
};

struct ESPVector3 {
    float x, y, z;
    ESPVector3() : x(0), y(0), z(0) {}
    ESPVector3(float _x, float _y, float _z) : x(_x), y(_y), z(_z) {}
};

struct EntityInfo {
    ESPVector3 myPos;
    ESPVector3 enemyPos;
    ESPVector3 moveForward;
    int   currentSpeed;
    float DoLech;
    float Ranger;
};

struct HeroWrapSkillData {
    int SkillId;
    int skillSlotCDMax;
    int skillLv;
    const char* skillIconPath;
    bool skillSlotUnlock;
    bool skillSlotReady;
    int Skill1SlotCD;
};

// ── Typedefs ──
typedef void         (*fn_void_ptr)(void*);
typedef void         (*fn_void_ptr_int)(void*, int);
typedef uint32_t     (*fn_uint_ptr)(void*);
typedef int          (*fn_int_ptr)(void*);
typedef bool         (*fn_bool_ptr)(void*);
typedef ESPVector3   (*fn_vec3_ptr)(void*);
typedef void*        (*fn_ptr_void)();
typedef ESPVector3   (*fn_cam_w2s)(void*, ESPVector3, int);
typedef void*        (*fn_voidp_ptr)(void*);
typedef HeroWrapSkillData (*fn_herodata_ptr_int)(void*, int);
typedef bool         (*fn_bool_ptr_bool)(void*, bool);

// ── Cache ──
static std::mutex g_espCacheMutex;
static void*     g_myActorLinker  = nullptr;
static void*     g_myLActorRoot   = nullptr;
static int       g_myCamp         = -1;
static std::set<uint32_t>              g_enemyObjIDs;
static std::map<uint32_t, void*>       g_enemyLActorRoots;
static std::map<uint32_t, void*>       g_enemyActorLinkers;
static std::map<uint32_t, void*>       g_monsterActorLinkers;
static std::map<uintptr_t, ESPVector3> g_previousPositions;
static std::time_t                     g_lastActorUpdateTime = 0;

static inline bool EspIsReadable(uintptr_t addr, size_t len = sizeof(void*)) {
    if (addr < 0x10000) return false;
    return IsMemoryReadable((const void*)addr, len);
}

template <typename T>
static inline bool EspReadValue(uintptr_t addr, T* out) {
    if (!out || !EspIsReadable(addr, sizeof(T))) return false;
    *out = *(T*)addr;
    return true;
}

static inline bool EspReadPtr(uintptr_t addr, void** out) {
    if (!out || !EspIsReadable(addr, sizeof(void*))) return false;
    *out = *(void**)addr;
    return true;
}

// ── Aimbot / AutoSkill internal state (not in EspVariables — local to this TU) ──
static int          g_skillSlot      = 0;
static int          g_resetSkill     = -1;
static EntityInfo   g_enemyTarget    = {};
static void*        g_skillReq[14]   = {};
static float        g_skillRange[14] = {};
static ESPVector3   g_currentSkillDir = {};

// ── Function pointers (ESP) ──
static fn_int_ptr  esp_getObjCamp    = nullptr;
static fn_int_ptr  esp_getObjType    = nullptr;
static fn_uint_ptr esp_getObjID      = nullptr;
static fn_bool_ptr esp_isHostPlayer  = nullptr;
static fn_vec3_ptr esp_getPosition   = nullptr;
static fn_ptr_void esp_cameraGetMain = nullptr;
static fn_cam_w2s  esp_cameraW2S     = nullptr;
static fn_uint_ptr esp_lrGetObjID    = nullptr;

// ── Function pointers (Aimbot/AutoSkill) ──
static fn_bool_ptr          g_isDeadState         = nullptr;
static fn_int_ptr           g_getActorHp          = nullptr;
static fn_int_ptr           g_getActorHpTotal      = nullptr;
static fn_int_ptr           g_getSpeed            = nullptr;
static fn_voidp_ptr         g_getPlayerMovement   = nullptr;
static fn_voidp_ptr         g_lrAsHero            = nullptr;
static fn_int_ptr           g_getCurSkillSlotType  = nullptr;
static fn_herodata_ptr_int  g_getHeroWrapSkillData = nullptr;
static fn_bool_ptr          g_reqSkill            = nullptr;
static fn_bool_ptr_bool     g_reqSkill2           = nullptr;
static fn_int_ptr           g_vlGetActorHp        = nullptr;
static fn_int_ptr           g_vlGetActorHpTotal   = nullptr;
static fn_int_ptr           g_vlGetSoulLevel      = nullptr;

// ── Field offsets (resolved in EspInit) ──
static int off_LActorRoot_location       = 0;
static int off_LActorRoot_forward        = 0;
static int off_LActorRoot_ActorControl   = 0;
static int off_LActorRoot_ValueComponent = 0;
static int off_Sk_SlotType             = 0;
static int off_Sk_skillIndicator       = 0;
static int off_Sk_curindicatorDistance = 0;
static int off_Sk_useSkillDirection    = 0;
static int off_Actorlk_ObjLinker       = 0;
static int off_Actorlk_ValueComponent  = 0;
static int off_ActorConfig_ConfigID    = 0;

// ============================================================

// [MATH HELPERS]
// ============================================================
static int dem(int num1) {
    int div = 1;
    if (num1 < 0) num1 = -num1;
    while (num1 >= 10) { num1 /= 10; div *= 10; }
    return div;
}

static ESPVector3 VInt2Vector(VInt3 location, VInt3 forward) {
    float fx = (float)(location.X * dem(forward.X) + forward.X) / (1000.0f * dem(forward.X));
    float fy = (float)(location.Y * dem(forward.Y) + forward.Y) / (1000.0f * dem(forward.Y));
    float fz = (float)(location.Z * dem(forward.Z) + forward.Z) / (1000.0f * dem(forward.Z));
    return ESPVector3(fx, fy, fz);
}

static ESPVector3 VIntVector(VInt3 location) {
    return ESPVector3((float)location.X / 1000.0f,
                      (float)location.Y / 1000.0f,
                      (float)location.Z / 1000.0f);
}

static ESPVector3 Lerp(ESPVector3& a, const ESPVector3& b, float t) {
    float d = std::sqrt((a.x-b.x)*(a.x-b.x)+(a.y-b.y)*(a.y-b.y)+(a.z-b.z)*(a.z-b.z));
    if (d > 1.0f) a = b;
    return ESPVector3{a.x+(b.x-a.x)*t, a.y+(b.y-a.y)*t, a.z+(b.z-a.z)*t};
}

static float ESPVector3_Distance(ESPVector3 a, ESPVector3 b) {
    float dx=a.x-b.x, dy=a.y-b.y, dz=a.z-b.z;
    return std::sqrt(dx*dx+dy*dy+dz*dz);
}

static float ESPVector3_Magnitude(ESPVector3 v) {
    return std::sqrt(v.x*v.x+v.y*v.y+v.z*v.z);
}

static ESPVector3 ESPVector3_Normalized(ESPVector3 v) {
    float m = ESPVector3_Magnitude(v);
    if (m < 0.0001f) return ESPVector3(0,0,0);
    return ESPVector3(v.x/m, v.y/m, v.z/m);
}

static float DotProduct(ESPVector3 a, ESPVector3 b) {
    return a.x*b.x + a.y*b.y + a.z*b.z;
}

static float ClosestDistanceEnemy(ESPVector3 myPos, ESPVector3 enemyPos, ESPVector3 dir) {
    ESPVector3 AC(enemyPos.x-myPos.x, enemyPos.y-myPos.y, enemyPos.z-myPos.z);
    float t = DotProduct(AC, dir);
    ESPVector3 proj(myPos.x+dir.x*t, myPos.y+dir.y*t, myPos.z+dir.z*t);
    return ESPVector3_Distance(proj, enemyPos);
}

// ============================================================
// [WORLD TO SCREEN]
// ============================================================
static bool WorldToScreen(ESPVector3 worldPos, float& sx, float& sy) {
    if (!esp_cameraGetMain || !esp_cameraW2S) return false;
    if (g_screenW <= 0 || g_screenH <= 0) return false;
    void* camera = nullptr;
    try { camera = esp_cameraGetMain(); } catch(...) { return false; }
    if (!camera) return false;
    ESPVector3 sc;
    try { sc = esp_cameraW2S(camera, worldPos, 2); } catch(...) { return false; }
    float w = g_screenW, h = g_screenH;
    if (sc.z > 0.0f) { sx = sc.x*w; sy = h - sc.y*h; }
    else             { sx = w - sc.x*w; sy = sc.y*h; }
    float maxR = 5.0f * std::max(w, h);
    if (std::abs(sx) > maxR || std::abs(sy) > maxR) return false;
    return true;
}

// ============================================================

// [AIMBOT] Hero config
// ============================================================
void ApplyHeroConfig() {
    if (g_resetSkill == g_heroSet) return;
    g_resetSkill = g_heroSet;
    if (g_heroSet == 0) return;

    g_aimSkill1 = g_aimSkill2 = g_aimSkill3 = false;
    switch (g_heroSet) {
        case 1:  g_aimDistance=25.0f; g_aimSmooth=0.368f; g_aimSkill2=true; break; // Elsu
        case 2:  g_aimDistance=15.0f; g_aimSmooth=1.064f; g_aimSkill2=true; break; // Gildur
        case 3:  g_aimDistance=13.0f; g_aimSmooth=1.085f; g_aimSkill2=true; break; // Grakk
        case 4:  g_aimDistance=19.0f; g_aimSmooth=1.692f; g_aimSkill1=true; break; // Slimz
        case 5:  g_aimDistance=14.0f; g_aimSmooth=0.952f; g_aimSkill2=true; break; // Yue
        case 6:  g_aimDistance=13.0f; g_aimSmooth=1.556f; g_aimSkill2=true; break; // Natalya
        case 7:  g_aimDistance=11.0f; g_aimSmooth=0.932f; g_aimSkill2=true; break; // Enzo
        case 8:  g_aimDistance=17.0f; g_aimSmooth=1.418f; g_aimSkill1=true; break; // Stuart
        case 9:  g_aimDistance=9.0f;  g_aimSmooth=0.542f; g_aimSkill1=true; break; // Florentino
        case 10: g_aimDistance=11.0f; g_aimSmooth=1.032f; g_aimSkill2=true; break; // Volkath
        case 11: g_aimDistance=12.0f; g_aimSmooth=0.842f; g_aimSkill2=true; break; // Raz
    }
}

static ESPVector3 calculateSkillDirection(ESPVector3 myPos, ESPVector3 enemyPos,
                                           ESPVector3 moveForward, int currentSpeed, float doLech) {
    ESPVector3 toEnemy(enemyPos.x-myPos.x, enemyPos.y-myPos.y, enemyPos.z-myPos.z);
    float dist = ESPVector3_Magnitude(toEnemy);
    float bulletSpeed = g_aimDistance / (g_aimSmooth < 0.001f ? 1.0f : g_aimSmooth);
    float t = dist / bulletSpeed;
    ESPVector3 futurePos(
        enemyPos.x + moveForward.x * currentSpeed * t,
        enemyPos.y + moveForward.y * currentSpeed * t,
        enemyPos.z + moveForward.z * currentSpeed * t
    );
    return ESPVector3_Normalized(ESPVector3(futurePos.x-myPos.x, futurePos.y-myPos.y, futurePos.z-myPos.z));
}

// ============================================================

// [HOOKS] Original pointers
// ============================================================
static void      (*orig_ActorLinker_Update)(void*)            = nullptr;
static void      (*orig_ActorLinker_DestroyActor)(void*)      = nullptr;
static void      (*orig_LActorRoot_UpdateLogic)(void*, int)   = nullptr;
static ESPVector3(*orig_GetUseSkillDirection)(void*, bool)    = nullptr;
static void      (*orig_SkillButtonManager_LateUpdate)(void*) = nullptr;
static void      (*orig_SkillSlot_LateUpdate)(void*, int)     = nullptr;

// ============================================================
// ★ Hook: ActorLinker.Update
//   FIX: Hero AND Monster are tracked in the same hook.
//   Old code had early-return for type!=0 before monster branch
//   → monster tracking was dead code and AutoTrungTri never worked.
// ============================================================
void hook_ActorLinker_Update(void* _this) {
    if (!_this || !EspIsReadable((uintptr_t)_this)) {
        if (orig_ActorLinker_Update) orig_ActorLinker_Update(_this);
        return;
    }
    g_lastActorUpdateTime = std::time(nullptr);
    AovHooks_OnActorLinkerUpdate(_this);
    if (orig_ActorLinker_Update) orig_ActorLinker_Update(_this);
    if (!esp_getObjID || !esp_getObjCamp) return;

    uint32_t objID = esp_getObjID(_this);
    if (objID == 0) return;

    int objType = esp_getObjType ? esp_getObjType(_this) : 0;

    if (objType == 0) {
        // Hero
        if (esp_isHostPlayer && esp_isHostPlayer(_this)) {
            if (g_myActorLinker != _this) {
                std::lock_guard<std::mutex> lock(g_espCacheMutex);
                g_enemyObjIDs.clear();
                g_enemyLActorRoots.clear();
                g_enemyActorLinkers.clear();
                g_monsterActorLinkers.clear();
                g_previousPositions.clear();
                g_enemyTarget = {};
                g_skillSlot = 0;
            }
            g_myActorLinker = _this;
            g_myCamp = esp_getObjCamp(_this);
            return;
        }
        if (g_myCamp != -1) {
            int camp = esp_getObjCamp(_this);
            if (camp != g_myCamp && camp != 0) {
                std::lock_guard<std::mutex> lock(g_espCacheMutex);
                g_enemyObjIDs.insert(objID);
                g_enemyActorLinkers[objID] = _this;
            }
        }
    } else if (objType == 1) {
        // Monster — FIX: was never reached before
        std::lock_guard<std::mutex> lock(g_espCacheMutex);
        g_monsterActorLinkers[objID] = _this;
    }
}

// ★ Hook: ActorLinker.DestroyActor — clean up on death/leave
void hook_ActorLinker_DestroyActor(void* _this) {
    if (_this && EspIsReadable((uintptr_t)_this)) {
        if (_this == g_myActorLinker) {
            g_myActorLinker = nullptr;
            g_myLActorRoot = nullptr;
            g_myCamp = -1;
            g_enemyTarget = {};
            g_skillSlot = 0;
            // Signal scene reload so hooks can re-init if needed
            g_lastActorUpdateTime = 0;
        }
        uint32_t objID = esp_getObjID ? esp_getObjID(_this) : 0;
        if (objID) {
            std::lock_guard<std::mutex> lock(g_espCacheMutex);
            g_enemyActorLinkers.erase(objID);
            g_enemyObjIDs.erase(objID);
            g_enemyLActorRoots.erase(objID);
            g_monsterActorLinkers.erase(objID);
            g_previousPositions.erase((uintptr_t)_this);
        }
    }
    if (orig_ActorLinker_DestroyActor) orig_ActorLinker_DestroyActor(_this);
}

// ★ Hook: LActorRoot.UpdateLogic — fog persistence + track myLActorRoot
void hook_LActorRoot_UpdateLogic(void* _this, int delta) {
    if (orig_LActorRoot_UpdateLogic) orig_LActorRoot_UpdateLogic(_this, delta);
    if (!_this || !EspIsReadable((uintptr_t)_this) || !esp_lrGetObjID) return;
    try {
        uint32_t objID = esp_lrGetObjID(_this);
        if (objID == 0) return;
        std::lock_guard<std::mutex> lock(g_espCacheMutex);
        if (g_enemyObjIDs.count(objID)) g_enemyLActorRoots[objID] = _this;
        if (g_myActorLinker && esp_getObjID && EspIsReadable((uintptr_t)g_myActorLinker)) {
            if (objID == esp_getObjID(g_myActorLinker)) g_myLActorRoot = _this;
        }
    } catch(...) {}
}

// ★ Hook: GetUseSkillDirection — Aimbot direction
//   FIX: Works independently of ESP toggle.
ESPVector3 hook_GetUseSkillDirection(void* instance, bool isTouchUse) {
    if (instance && EspIsReadable((uintptr_t)instance) && g_aimEnabled) {
        bool validPos = !(g_enemyTarget.myPos.x==0&&g_enemyTarget.myPos.y==0&&g_enemyTarget.myPos.z==0)
                     && !(g_enemyTarget.enemyPos.x==0&&g_enemyTarget.enemyPos.y==0&&g_enemyTarget.enemyPos.z==0);
        bool validSlot = (g_skillSlot==1&&g_aimSkill1)
                      || (g_skillSlot==2&&g_aimSkill2)
                      || (g_skillSlot==3&&g_aimSkill3);
        if (validPos && validSlot)
            return calculateSkillDirection(g_enemyTarget.myPos, g_enemyTarget.enemyPos,
                                           g_enemyTarget.moveForward, g_enemyTarget.currentSpeed,
                                           g_enemyTarget.DoLech);
    }
    if (orig_GetUseSkillDirection) return orig_GetUseSkillDirection(instance, isTouchUse);
    return ESPVector3{0,0,0};
}

// ★ Hook: SkillButtonManager.LateUpdate — track current skill slot
void hook_SkillButtonManager_LateUpdate(void* instance) {
    if (instance && EspIsReadable((uintptr_t)instance) && g_getCurSkillSlotType) {
        try { g_skillSlot = g_getCurSkillSlotType(instance); } catch(...) {}
    }
    if (orig_SkillButtonManager_LateUpdate) orig_SkillButtonManager_LateUpdate(instance);
}

// ============================================================
// ★ Hook: SkillSlot.LateUpdate — AutoSkill
//   FIX 1: Replaced 'goto' over variable declarations (C++ UB → crash)
//           with an immediately-invoked lambda using 'return'.
//   FIX 2: AutoSkill works independently (no ESP required).
//   FIX 3: Monster tracking in hook_ActorLinker_Update is now fixed
//           so AutoTrungTri actually has monsters to check.
// ============================================================
void hook_SkillSlot_LateUpdate(void* ins, int del) {
    if (ins && EspIsReadable((uintptr_t)ins)) {
        try {
            int slot = 0;
            void* si = nullptr;
            if (!EspReadValue((uintptr_t)ins + off_Sk_SlotType, &slot)) {
                if (orig_SkillSlot_LateUpdate) orig_SkillSlot_LateUpdate(ins, del);
                return;
            }
            if (!EspReadPtr((uintptr_t)ins + off_Sk_skillIndicator, &si) || !si) {
                if (orig_SkillSlot_LateUpdate) orig_SkillSlot_LateUpdate(ins, del);
                return;
            }

            if (si) {
                int range = 0;
                ESPVector3 curDir = {};
                if (!EspReadValue((uintptr_t)si + off_Sk_curindicatorDistance, &range) ||
                    !EspReadValue((uintptr_t)si + off_Sk_useSkillDirection, &curDir)) {
                    if (orig_SkillSlot_LateUpdate) orig_SkillSlot_LateUpdate(ins, del);
                    return;
                }
                if (slot >= 0 && slot < 14) {
                    g_skillReq[slot]   = ins;
                    g_skillRange[slot] = (float)range / 1000.0f;
                }
                if (slot == g_skillSlot) g_currentSkillDir = curDir;

                // ── AutoSkill block — lambda avoids goto UB ──
                [&]() {
                    void* myLR = g_myLActorRoot;
                    if (!myLR || !EspIsReadable((uintptr_t)myLR) || !g_lrAsHero) return;

                    void* SKC = g_lrAsHero(myLR);
                    if (!SKC || !EspIsReadable((uintptr_t)SKC) || !g_getHeroWrapSkillData) return;

                    HeroWrapSkillData sd5 = g_getHeroWrapSkillData(SKC, 5);
                    HeroWrapSkillData sd9 = g_getHeroWrapSkillData(SKC, 9);

                    bool autoPT = (sd9.SkillId==80112 || sd9.SkillId==8810101 || sd9.SkillId==91145
                                || sd9.SkillId==91149 || sd9.SkillId==91020  || sd9.SkillId==916211
                                || sd9.SkillId==916231);
                    bool autoBP = (sd5.SkillId == 80108);
                    bool autoTT = (sd5.SkillId == 80104 || sd5.SkillId == 80116);

                    void* myAL = g_myActorLinker;

                    // ── AutoPhuTro (slot 9 — Heal) ──
                    if (g_autoPhuTro && autoPT && slot == 9 && myAL
                            && g_vlGetActorHp && g_vlGetActorHpTotal) {
                        void* vc = nullptr;
                        if (!EspReadPtr((uint64_t)myAL + off_Actorlk_ValueComponent, &vc)) return;
                        if (!vc || !EspIsReadable((uintptr_t)vc)) return;
                        int hp  = g_vlGetActorHp(vc);
                        int hpt = g_vlGetActorHpTotal(vc);
                        if (hp <= 0 || hpt <= 0) return;
                        if ((float)hp / hpt * 100.0f > g_myHPThreshold) return;

                        std::lock_guard<std::mutex> lk(g_espCacheMutex);
                        for (auto& pr : g_enemyLActorRoots) {
                            void* en = pr.second; if (!en || !EspIsReadable((uintptr_t)en)) continue;
                            void* lo = nullptr;
                            void* vpc = nullptr;
                            if (!EspReadPtr((uint64_t)en + off_LActorRoot_ActorControl, &lo) ||
                                !EspReadPtr((uint64_t)en + off_LActorRoot_ValueComponent, &vpc)) continue;
                            if (!lo || !EspIsReadable((uintptr_t)lo) || !vpc || !EspIsReadable((uintptr_t)vpc)) continue;
                            if (g_isDeadState && g_isDeadState(lo)) continue;
                            int eHp  = g_getActorHp(vpc);
                            int eHpT = g_getActorHpTotal(vpc);
                            if (eHp <= 0 || eHpT <= 0) continue;
                            ESPVector3 myP = esp_getPosition(myAL);
                            VInt3* lp = (VInt3*)((uint64_t)en + off_LActorRoot_location);
                            VInt3* fp = (VInt3*)((uint64_t)en + off_LActorRoot_forward);
                            if (!EspIsReadable((uintptr_t)lp, sizeof(VInt3)) || !EspIsReadable((uintptr_t)fp, sizeof(VInt3))) continue;
                            float  dist = ESPVector3_Distance(myP, VInt2Vector(*lp, *fp));
                            if ((float)eHp / eHpT * 100.0f > 0.1f && dist <= 10.0f) {
                                if (g_reqSkill2) g_reqSkill2(ins, false);
                                if (g_reqSkill)  g_reqSkill(ins);
                                break;
                            }
                        }
                    }

                    // ── AutoBocPha + AutoTrungTri (slot 5) ──
                    if (slot != 5 || !myAL) return;
                    bool cast5 = false;

                    if (g_autoBocPha && autoBP) {
                        std::lock_guard<std::mutex> lk(g_espCacheMutex);
                        for (auto& pr : g_enemyLActorRoots) {
                            void* en = pr.second; if (!en || !EspIsReadable((uintptr_t)en)) continue;
                            void* lo = nullptr;
                            void* vpc = nullptr;
                            if (!EspReadPtr((uint64_t)en + off_LActorRoot_ActorControl, &lo) ||
                                !EspReadPtr((uint64_t)en + off_LActorRoot_ValueComponent, &vpc)) continue;
                            if (!lo || !EspIsReadable((uintptr_t)lo) || !vpc || !EspIsReadable((uintptr_t)vpc)) continue;
                            if (g_isDeadState && g_isDeadState(lo)) continue;
                            int eHp  = g_getActorHp(vpc);
                            int eHpT = g_getActorHpTotal(vpc);
                            if (eHp <= 0 || eHpT <= 0) continue;
                            float hpPct = (float)eHp / eHpT * 100.0f;
                            ESPVector3 myP = esp_getPosition(myAL);
                            VInt3* lp = (VInt3*)((uint64_t)en + off_LActorRoot_location);
                            VInt3* fp = (VInt3*)((uint64_t)en + off_LActorRoot_forward);
                            if (!EspIsReadable((uintptr_t)lp, sizeof(VInt3)) || !EspIsReadable((uintptr_t)fp, sizeof(VInt3))) continue;
                            float  dist = ESPVector3_Distance(myP, VInt2Vector(*lp, *fp));
                            if (dist < 5.0f && hpPct > 0.1f && hpPct <= g_enemyHPThreshold) {
                                cast5 = true; break;
                            }
                        }
                    }

                    if (!cast5 && g_autoTrungTri && autoTT && g_vlGetSoulLevel) {
                        void* mv = nullptr;
                        if (!EspReadPtr((uintptr_t)myAL + off_Actorlk_ValueComponent, &mv)) return;
                        if (mv && EspIsReadable((uintptr_t)mv)) {
                            int myLv  = g_vlGetSoulLevel(mv) - 1;
                            int minHp = 1350 + 100 * myLv;
                            std::lock_guard<std::mutex> lk(g_espCacheMutex);
                            for (auto& pr : g_monsterActorLinkers) {
                                void* mo = pr.second; if (!mo || !EspIsReadable((uintptr_t)mo)) continue;
                                void* vc = nullptr;
                                if (!EspReadPtr((uintptr_t)mo + off_Actorlk_ValueComponent, &vc) || !vc || !EspIsReadable((uintptr_t)vc)) continue;
                                int h = g_vlGetActorHp(vc); if (h < 1) continue;
                                void* ol = nullptr;
                                int cfgID = 0;
                                if (!EspReadPtr((uintptr_t)mo + off_Actorlk_ObjLinker, &ol) || !ol || !EspIsReadable((uintptr_t)ol)) continue;
                                if (!EspReadValue((uintptr_t)ol + off_ActorConfig_ConfigID, &cfgID)) continue;
                                bool isTgt = false;
                                if (g_ttBua)   isTgt = (cfgID==7010 || cfgID==7011);
                                if (g_ttBosst) isTgt = isTgt || (cfgID==7012||cfgID==7024||cfgID==7009||cfgID==70092||cfgID==70093);
                                if (g_ttAll)   isTgt = (cfgID==7010||cfgID==7011||cfgID==7012||cfgID==7024||cfgID==7009||cfgID==70092||cfgID==70093);
                                if (!isTgt) continue;
                                ESPVector3 myP = esp_getPosition(myAL);
                                ESPVector3 eP  = esp_getPosition(mo);
                                if (ESPVector3_Distance(myP, eP) <= 5.0f && h <= minHp) {
                                    cast5 = true; break;
                                }
                            }
                        }
                    }

                    if (cast5 && g_skillReq[5]) {
                        if (g_reqSkill2) g_reqSkill2(g_skillReq[5], false);
                        if (g_reqSkill)  g_reqSkill(g_skillReq[5]);
                    }
                }(); // ← immediately invoked lambda (replaces goto)
            }
        } catch(...) {}
    }
    if (orig_SkillSlot_LateUpdate) orig_SkillSlot_LateUpdate(ins, del);
}

// ============================================================

// UpdateAimbotTarget() removed — duplicated inline in EspBeginDraw()

// ============================================================
// [AIM LINE] — separated from DrawESP, works independently
// ============================================================
static void DrawAimLine(ImDrawList* drawList) {
    if (!g_aimEnabled || !g_drawAimLine || !drawList) return;
    if (g_enemyTarget.enemyPos.x==0 && g_enemyTarget.enemyPos.y==0 && g_enemyTarget.enemyPos.z==0) return;
    if (g_enemyTarget.myPos.x==0 && g_enemyTarget.myPos.y==0 && g_enemyTarget.myPos.z==0) return;
    if (!esp_cameraGetMain || !esp_cameraW2S) return;
    if (g_screenW <= 0 || g_screenH <= 0) return;

    void* camOk = nullptr;
    try { camOk = esp_cameraGetMain(); } catch(...) { return; }
    if (!camOk) return;

    const float HEAD_H = 2.7f;
    float msx, msy, esx, esy;
    ESPVector3 mh(g_enemyTarget.myPos.x, g_enemyTarget.myPos.y+HEAD_H-1, g_enemyTarget.myPos.z);
    ESPVector3 eh(g_enemyTarget.enemyPos.x, g_enemyTarget.enemyPos.y+HEAD_H-1, g_enemyTarget.enemyPos.z);
    if (WorldToScreen(mh, msx, msy) && WorldToScreen(eh, esx, esy)) {
        drawList->AddLine(ImVec2(msx, msy), ImVec2(esx, esy), IM_COL32(116,255,23,255), 1.2f);
        drawList->AddCircleFilled(ImVec2(esx, esy), 4.0f, IM_COL32(116,255,23,200));
        drawList->AddCircle(ImVec2(esx, esy), 6.0f, IM_COL32(116,255,23,100), 64, 2.0f);
    }
}

// DrawESP() removed — all ESP visual rendering stripped

// ===========================================================

// Called per-frame from EGL hook — AIM-only: aimbot target + aim line
void EspBeginDraw() {
    std::lock_guard<std::mutex> renderLock(g_espRenderMutex);
    if (!g_espReady) return;

    try {
        std::time_t now = std::time(nullptr);
        if (g_lastActorUpdateTime > 0 && now - g_lastActorUpdateTime > 1) {
            // Scene likely destroyed — clear all cached object pointers
            std::lock_guard<std::mutex> lock(g_espCacheMutex);
            g_myActorLinker = nullptr;
            g_myLActorRoot = nullptr;
            g_myCamp = -1;
            g_enemyTarget = {};
            g_skillSlot = 0;
            g_enemyObjIDs.clear();
            g_enemyLActorRoots.clear();
            g_enemyActorLinkers.clear();
            g_monsterActorLinkers.clear();
            g_previousPositions.clear();
            g_lastActorUpdateTime = 0;
            return;
        }

        // Quick bail if nothing to do
        bool needAim = (g_aimEnabled && g_myActorLinker && EspIsReadable((uintptr_t)g_myActorLinker));
        bool needAimLine = (g_aimEnabled && g_drawAimLine);
        if (!needAim && !needAimLine) return;

        if (!esp_cameraGetMain || !esp_cameraW2S) return;
        void* camOk = nullptr;
        try { camOk = esp_cameraGetMain(); } catch(...) { return; }
        if (!camOk && needAimLine) return;

        // Snapshot enemy list ONCE
        std::map<uint32_t, void*> snapshot;
        { std::lock_guard<std::mutex> lock(g_espCacheMutex); snapshot = g_enemyLActorRoots; }

        ESPVector3 myPos = (esp_getPosition && g_myActorLinker)
                           ? esp_getPosition(g_myActorLinker) : ESPVector3(0,0,0);

        // Aimbot tracking state
        void*  bestLR    = nullptr;
        float  minHp     = 1e30f, minHp2 = 1e30f, minHpPct = 1e30f;
        float  closestD  = 1e30f, closestDV = 1e30f;

        const float HEAD_H = 2.7f;

        // ── SINGLE PASS: iterate enemies for aimbot target selection ──
        for (auto& pr : snapshot) {
            void* lr = pr.second;
            if (!lr || !EspIsReadable((uintptr_t)lr)) continue;
            if (!EspIsReadable((uintptr_t)lr + off_LActorRoot_location, sizeof(VInt3)) ||
                !EspIsReadable((uintptr_t)lr + off_LActorRoot_forward, sizeof(VInt3))) continue;

            try {
                // ── Read position ONCE ──
                VInt3* locPtr = (VInt3*)((uint64_t)lr + off_LActorRoot_location);
                VInt3* fwdPtr = (VInt3*)((uint64_t)lr + off_LActorRoot_forward);
                if (!locPtr || !fwdPtr) continue;

                ESPVector3 ePos = VInt2Vector(*locPtr, *fwdPtr);
                if (ePos.x==0 && ePos.y==0 && ePos.z==0) continue;

                // ── Lerp smoothing ──
                uintptr_t key = (uintptr_t)lr;
                {
                    std::lock_guard<std::mutex> lock(g_espCacheMutex);
                    if (!g_previousPositions.count(key)) g_previousPositions[key] = ePos;
                    ePos = Lerp(g_previousPositions[key], ePos, 0.2f);
                    g_previousPositions[key] = ePos;
                }

                // ── Aimbot target evaluation ──
                if (needAim) {
                    float dEnemy = ESPVector3_Distance(myPos, ePos);

                    // Hero-specific overrides
                    if (g_heroSet==5)  g_aimSkill1 = (dEnemy <= 10.0f);
                    if (g_heroSet==9)  g_aimSkill3 = (dEnemy <= 7.5f);
                    if (g_heroSet==11) { g_aimSkill1 = (dEnemy<=4.5f); g_aimSkill3 = (dEnemy<=7.0f); }

                    bool validSlot = (g_skillSlot==1 && g_aimSkill1)
                                  || (g_skillSlot==2 && g_aimSkill2)
                                  || (g_skillSlot==3 && g_aimSkill3);
                    if (!validSlot || dEnemy > g_aimDistance) continue;

                    void* vc = nullptr;
                    void* lo = nullptr;
                    if (!EspReadPtr((uint64_t)lr + off_LActorRoot_ValueComponent, &vc) ||
                        !EspReadPtr((uint64_t)lr + off_LActorRoot_ActorControl, &lo)) continue;
                    if (lo && EspIsReadable((uintptr_t)lo) && g_isDeadState && g_isDeadState(lo)) continue;

                    int health = 0, maxHP = 1;
                    if (vc && EspIsReadable((uintptr_t)vc) && g_getActorHp && g_getActorHpTotal) {
                        health = g_getActorHp(vc);
                        maxHP  = g_getActorHpTotal(vc);
                    }
                    if (health <= 0 || maxHP <= 0) continue;

                    float spd = 0.0f;
                    if (g_getSpeed && g_getPlayerMovement) {
                        void* pm = g_getPlayerMovement(lr);
                        if (pm && EspIsReadable((uintptr_t)pm)) spd = (float)g_getSpeed(pm) / 1000.0f;
                    }
                    float pct = (float)health / (float)maxHP;

                    bool best = false;
                    if      (g_aimType==0 && health < minHp) { minHp = health; best = true; }
                    else if (g_aimType==1 && (pct < minHpPct || (pct==minHpPct && health<minHp2))) { minHpPct=pct; minHp2=health; best=true; }
                    else if (g_aimType==2 && dEnemy < closestD) { closestD = dEnemy; best = true; }
                    else if (g_aimType==3) { float ad=ClosestDistanceEnemy(myPos,ePos,g_currentSkillDir); if(ad<closestDV){closestDV=ad;best=true;} }

                    if (best) {
                        bestLR = lr;
                        g_enemyTarget = {myPos, ePos, VIntVector(*fwdPtr), (int)spd, g_aimSmooth, g_aimDistance};
                    }
                }

            } catch(...) { continue; }
        }

        // ── Post-loop: set aimbot target result ──
        if (needAim && !bestLR) g_enemyTarget = {};

        // ── Aim line drawing ──
        if (needAimLine) {
            ImDrawList* dl = ImGui::GetBackgroundDrawList();
            if (dl) DrawAimLine(dl);
        }

    } catch(...) {
        // Safety: reset cached pointers on any exception
        g_myActorLinker = nullptr;
        g_myLActorRoot = nullptr;
        g_enemyTarget = {};
    }
}
