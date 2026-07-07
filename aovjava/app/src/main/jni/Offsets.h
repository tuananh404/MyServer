#pragma once
#define TARGET_LIB "libil2cpp.so"

// Patch template note:
// - Keep only TARGET_LIB in this header for the runtime hook path.
// - For future direct offset patches, prefer updating the commented ANOGS template
//   in Main.cpp and uncommenting only the offsets that match the current build.
