import os, re

p = 'android/app/build.gradle'
s = open(p).read()
RUN = os.environ.get('RUN_NUMBER', '1')

# Bump versionCode / versionName so each build is a real upgrade
s = re.sub(r'versionCode \d+', 'versionCode ' + RUN, s, count=1)
s = re.sub(r'versionName "[^"]*"', 'versionName "1.0.' + RUN + '"', s, count=1)

# Ensure a fixed, repo-committed debug signing config (stable signatures => clean overwrite install)
if 'storePassword "android"' not in s:
    s = s.replace('android {',
        'android {\n    signingConfigs {\n        debug {\n            storeFile file("debug.keystore")\n            storePassword "android"\n            keyAlias "androiddebugkey"\n            keyPassword "android"\n        }\n    }', 1)

if 'signingConfig signingConfigs.debug' not in s:
    old = """        release {
            minifyEnabled false
            proguardFiles getDefaultProguardFile('proguard-android.txt'), 'proguard-rules.pro'
        }
    }"""
    new = old + "\n        debug {\n            signingConfig signingConfigs.debug\n        }"
    s = s.replace(old, new, 1)

open(p, 'w').write(s)
print('patched build.gradle: versionCode=' + RUN)
