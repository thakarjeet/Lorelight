# Lorelight

Lorelight is an immersive reading-library project: a calm place to discover and
read public-domain books, with a thoughtful AI reading companion planned for a
later milestone.

## Getting started

```sh
npm install
npm run dev
```

The catalog uses the [Gutendex API](https://gutendex.com/) to discover
English-language books from Project Gutenberg. It loads more results as you
browse instead of trying to download the whole catalog at once. The reader only
lists editions with plain-text files and an explicit non-copyrighted catalog
flag; this is not a guarantee of public-domain status in every country. Book
text is fetched from Project Gutenberg and kept in local IndexedDB after it is
opened, so that book can be read offline on the same device. Reading position
is saved on-device too. Books are not bundled with the app or uploaded.

Open Library says its APIs are not intended to serve as a bulk data backend, so
Lorelight does not harvest its catalog or bypass its controlled lending.
Libraries with country-specific rights, access controls, or licenses need
separate review before their texts can be included. Catalog and source links
remain visible in the app.

## Android APK

Lorelight includes a Capacitor Android project. The Android app bundles the
built web UI and uses Capacitor's native HTTP support to reach Gutendex and
Project Gutenberg directly; the browser app continues to use the local Node
proxy.

1. Install Node.js 22 or newer and Android Studio. In Android Studio's SDK
   Manager, install **Android SDK Platform 36** and **Android SDK Platform
   Tools**. Select JDK 21 for Gradle (Android Studio's bundled JDK is suitable
   if it is version 21).
2. Install JavaScript dependencies and generate/synchronize the Android app:

   ```sh
   npm install
   npm run android:sync
   ```

3. Open the Android project:

   ```sh
   npm run android:open
   ```

4. In Android Studio, wait for Gradle sync, then choose **Build → Build
   Bundle(s) / APK(s) → Build APK(s)**. The debug APK is written to
   `android/app/build/outputs/apk/debug/app-debug.apk`.
5. Copy that APK to an Android phone and install it, or connect a phone with
   USB debugging enabled and run the app from Android Studio.

After changing web code, run `npm run android:sync` again before rebuilding so
the APK includes the latest UI. A debug APK is for testing; publishing on
Google Play requires a signed release build.

### Build the APK with GitHub Actions

The **Build Android APK** workflow runs when changes are pushed to `main`, when
a pull request targets `main`, or when started manually from the repository's
**Actions** tab. After a successful run, open its summary and download the
`Lorelight-debug-apk` artifact. The downloaded ZIP contains
`app-debug.apk`.

Commit and push the workflow and app changes to GitHub before expecting a build.
The artifact is a debug APK for testing, not a signed Play Store release.

The Android app needs an internet connection to discover books and fetch
books that have not yet been opened. Previously opened books and reading
progress are stored locally on that device.

## Install the web app

The browser version remains an installable PWA. On Android, use the browser's
**Install app** option. On iPhone, open Lorelight in Safari and choose
**Share → Add to Home Screen**. Previously opened books are available offline
on the same device and browser.

## Scripts

- `npm run dev` — start the local development server
- `npm run typecheck` — check TypeScript
- `npm run build` — type-check and create a production build
- `npm run preview` — preview the production build locally
- `npm start` — serve the production build and book-data proxy on port 4173
- `npm run android:sync` — build the web UI and copy it into the Android project
- `npm run android:open` — open the Android project in Android Studio

For production, run `npm run build` before `npm start`. The server expects the
generated `dist` directory and supports the `PORT` environment variable.

## Project direction

The first milestone focuses on discovery, a personal saved shelf, and a
customizable reading surface. AI features will be designed around cited,
book-grounded answers and introduced after the reading foundation is in place.
