plugins {
    alias(libs.plugins.android.library)
    alias(libs.plugins.kotlin.android)
}

android {
    namespace = "com.dollhousestudio.websocket.websocket"
    compileSdk = 34

    defaultConfig {
        minSdk = 21
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_11
        targetCompatibility = JavaVersion.VERSION_11
    }
    kotlinOptions {
        jvmTarget = "11"
    }
}

dependencies {
    implementation(libs.androidx.core.ktx)
    implementation("com.squareup.okhttp3:okhttp:4.12.0")

    val sparklingVersion = (findProperty("SPARKLING_ANDROID_SDK_VERSION") as? String)
        ?: System.getenv("SPARKLING_ANDROID_SDK_VERSION")
        ?: "2.0.0-rc.5"
    api("com.tiktok.sparkling:sparkling-method:$sparklingVersion")
}
