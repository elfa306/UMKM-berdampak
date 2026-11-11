plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}
val cavaWebUrl = providers.gradleProperty("cavaWebUrl")
    .orElse("https://www.umkmberdampak.my.id").get()
android {
    namespace = "id.cava.mobile"
    compileSdk = 36
    defaultConfig {
        applicationId = "id.cava.mobile"
        minSdk = 23
        targetSdk = 36
        versionCode = 1
        versionName = "0.1.0"
        buildConfigField("String", "CAVA_WEB_URL", "\"$cavaWebUrl\"")
    }
    buildFeatures { buildConfig = true }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
}
dependencies { testImplementation("junit:junit:4.13.2") }
