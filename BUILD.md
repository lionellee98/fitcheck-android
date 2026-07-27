# 健身打卡 — 打包为 Android APK

本目录已包含完整、可直接编译的原生 Android 工程（`android/`），由 Capacitor 把 `fitness-app/`（PWA）包进原生 WebView 而成。
所有页面、1,324 个动作演示 GIF、本地数据留存逻辑都已打进 APK，**完全离线、无网络权限**。

> ⚠️ 当前沙箱环境**没有 JDK / Android SDK / Gradle**，因此无法在这里直接编译出 `.apk` 二进制文件。
> 下面的两种方式任选其一，即可在你自己的机器或云端得到可安装的 APK。

---

## 方式一：Android Studio（本地，最简单）

1. 安装 [Android Studio](https://developer.android.com/studio)（会自带 JDK 17 与 Android SDK）。
2. 终端在项目根目录执行一次同步（确保 Web 资源最新）：
   ```bash
   npm install
   npx cap sync android
   ```
3. 用 Android Studio 打开 `android/` 目录（`npx cap open android` 也可直接打开）。
4. 菜单 **Build → Generate Signed Bundle / APK → APK**：
   - 首次需新建一个 keystore（记住密码与别名，后续升级必须用同一个）。
   - 选择 release，等待构建完成，得到 `android/app/release/app-release.apk`。
5. 把 APK 传到手机安装即可（安卓允许“未知来源”安装）。

> 想快速自测，也可直接 **Build → Build Bundle(s) / APK(s) → Build APK(s)**，生成的 `app-debug.apk` 用 debug 密钥签名，可直接安装。

---

## 方式二：GitHub Actions（云端，无需本机装 SDK）

已提供工作流 `.github/workflows/build-apk.yml`：

1. 把本目录初始化为 git 仓库并推到 GitHub（注意：`android/app/src/main/assets/public` 内含约 128MB 的 GIF，单文件都很小，未超 GitHub 100MB 限制，可正常提交）。
2. 在仓库 **Actions** 页找到 **Build Android APK**，手动触发（或 push 到 main/master 自动触发）。
3. 运行结束后在 **Artifacts** 下载 `fitness-checkin-apk`，里面是 `app-debug.apk`（已用 debug 密钥签名，可直接安装到手机）。

如需发布到 Google Play，请在 Android Studio 中按方式一生成**签名 release** 后用同一 keystore 构建。

---

## 工程关键信息

- **包名（Application ID）**：`com.fitcheck.app`
- **应用名**：健身打卡
- **最低 / 目标 SDK**：23 / 35（Android 6.0+）
- **图标 / 启动屏**：已替换为品牌绿→蓝渐变 + 哑铃图形（见 `android/app/src/main/res/`）
- **权限**：已移除 `INTERNET`，真正纯本地、离线可用
- **Web 资源位置**：`android/app/src/main/assets/public/`（改完 `fitness-app/` 后跑 `npx cap sync android` 同步）

## 重新同步 Web 改动的命令

```bash
npx cap sync android
```

## 关于“AI”与本地数据（与 Web 版一致）

- 教练建议、计划生成、身体分析均为**本地启发式算法**（基于 1,324 条动作数据 + 你的身体指标），不依赖任何云端大模型。
- 所有打卡、身体数据、照片均只存在设备本地（WebView 的 localStorage / IndexedDB），不上传任何服务器。
