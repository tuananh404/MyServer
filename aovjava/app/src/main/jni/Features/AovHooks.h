#pragma once
// ── Toggles ──
extern bool  HackMap;
extern bool  UnlockSkin;
extern bool  UnlockFps;
extern float CameraZoom;
extern bool  CheckReport;

// ── Master init (gọi từ hack_thread) ──
bool AovHooks_InitAll();
bool AovHooks_IsReady();

// ── Toggle state helpers ──
void AovHooks_SetUnlockSkin(bool enabled);
void AovHooks_SetShowCooldown(bool enabled);
void AovHooks_OnActorLinkerUpdate(void* instance);

// ── Update zoom live (gọi từ slider) ──
void AovHooks_InitCameraZoom(float zoom);

// ── ESP init (gọi từ hack_thread) ──
bool EspInit();
