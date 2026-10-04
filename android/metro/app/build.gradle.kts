plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

val metroUrl = (project.findProperty("metroUrl") as String?)
    ?.trim()
    ?.takeIf { it.startsWith("https://") }
    ?: "https://office.yggmetro.com/metro"

android {
    namespace = "com.yggmetro.metro"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.yggmetro.metro"
        minSdk = 26
        targetSdk = 35
        versionCode = 1
        versionName = "0.1.0"
        buildConfigField("String", "METRO_URL", "\"$metroUrl\"")
    }

    buildTypes {
        debug {
            applicationIdSuffix = ".debug"
            versionNameSuffix = "-debug"
        }
        release {
            isMinifyEnabled = false
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro",
            )
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }

    buildFeatures {
        buildConfig = true
    }
}
