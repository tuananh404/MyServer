#include "EspVariables.h"

int g_screenW = 0;
int g_screenH = 0;
bool g_espReady = false;

// Aimbot state
bool  g_aimEnabled     = false;
bool  g_aimSkill1      = false;
bool  g_aimSkill2      = false;
bool  g_aimSkill3      = false;
bool  g_drawAimLine    = false;
int   g_aimType        = 0;
float g_aimDistance    = 60.0f;
float g_aimSmooth      = 1.0f;
int   g_heroSet        = 0;

// AutoSkill state
bool  g_autoPhuTro       = false;
bool  g_autoBocPha       = false;
bool  g_autoTrungTri     = false;
bool  g_ttBua            = false;
bool  g_ttBosst          = false;
bool  g_ttAll            = false;
float g_enemyHPThreshold = 50.0f;
float g_myHPThreshold    = 50.0f;
