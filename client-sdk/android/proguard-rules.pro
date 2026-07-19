# Native symbols use this fixed Java package/class name. Keep only JNI names;
# allow R8 to shrink and obfuscate the platform implementation itself.
-keepnames class com.serverkey.sdk.NativeBridge
-keepclassmembernames class com.serverkey.sdk.NativeBridge {
    native <methods>;
}
