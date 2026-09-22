# 深夜汤馆 Android

这是一个本地题库的 Expo Android 壳：题库、进度和游戏逻辑都在手机，Jev 通过用户自己的 Vercel AI Gateway Key 直连。

```bash
npm install
npm run apk
```

生成的 APK 在 `android/app/build/outputs/apk/release/app-release.apk`。默认使用 debug keystore 生成可安装测试包；正式发布时设置 `SOUP_KEYSTORE`、`SOUP_STORE_PASSWORD`、`SOUP_KEY_PASSWORD`。

Key 只写入 Android Keystore，不进入网页、仓库或 APK 常量。
