#pragma once
#include "imgui.h"

// Screen size
extern int g_screenW;
extern int g_screenH;

// ESP ready flag (set by EspInit after hooks installed)
extern bool g_espReady;

// Aimbot state
extern bool  g_aimEnabled;
extern bool  g_aimSkill1;
extern bool  g_aimSkill2;
extern bool  g_aimSkill3;
extern bool  g_drawAimLine;
extern int   g_aimType;
extern float g_aimDistance;
extern float g_aimSmooth;
extern int   g_heroSet;

// AutoSkill state
extern bool  g_autoPhuTro;
extern bool  g_autoBocPha;
extern bool  g_autoTrungTri;
extern bool  g_ttBua;
extern bool  g_ttBosst;
extern bool  g_ttAll;
extern float g_enemyHPThreshold;
extern float g_myHPThreshold;

void ApplyHeroConfig();

// Called from EGL hook — unified single-pass: aimbot target + aim line
void EspBeginDraw();

