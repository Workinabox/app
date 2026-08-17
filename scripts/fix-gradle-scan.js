/**
 * Neutralizes the Gradle build files that ship inside node_modules so editor
 * Gradle integrations (VS Code's "Gradle for Java", Android Studio's scan) do
 * not try to configure them as standalone builds and fail:
 *
 * - react-native publishes its repo-root settings.gradle.kts/build.gradle.kts
 *   (the "build from source" entry point) whose project paths do not exist in
 *   the npm package. Both are stubbed; the app build consumes prebuilt
 *   artifacts and never reads them.
 * - Packages that ship an android/ library module without a settings file
 *   (react-native-webrtc) get an empty settings.gradle at the package root.
 *   Scanners then treat the package root as the build root (an empty build
 *   that configures cleanly) instead of configuring android/build.gradle
 *   standalone, where com.android.library cannot resolve. The app build still
 *   includes the module as a subproject via autolinking, which never reads a
 *   settings file at that level.
 *
 * Runs from npm postinstall; idempotent.
 */
const fs = require('fs');
const path = require('path');

const nodeModules = path.join(__dirname, '..', 'node_modules');

const stub = (original) =>
  '// Stubbed by scripts/fix-gradle-scan.js (npm postinstall) so editor Gradle\n' +
  '// scanners do not configure this directory as a standalone build.\n' +
  `// Replaces: ${original}\n`;

function writeIfDifferent(file, content) {
  if (fs.existsSync(file) && fs.readFileSync(file, 'utf8') === content) {
    return 0;
  }
  fs.writeFileSync(file, content);
  return 1;
}

function packageDirs() {
  const dirs = [];
  for (const entry of fs.readdirSync(nodeModules)) {
    if (entry.startsWith('.')) {
      continue;
    }
    const p = path.join(nodeModules, entry);
    if (!fs.statSync(p).isDirectory()) {
      continue;
    }
    if (entry.startsWith('@')) {
      for (const sub of fs.readdirSync(p)) {
        dirs.push(path.join(p, sub));
      }
    } else {
      dirs.push(p);
    }
  }
  return dirs.filter((d) => fs.statSync(d).isDirectory());
}

if (!fs.existsSync(nodeModules)) {
  process.exit(0);
}

let changed = 0;

for (const f of ['settings.gradle.kts', 'build.gradle.kts']) {
  const file = path.join(nodeModules, 'react-native', f);
  if (fs.existsSync(file)) {
    changed += writeIfDifferent(
      file,
      stub(`react-native's build-from-source ${f}`),
    );
  }
}

for (const dir of packageDirs()) {
  const hasSettings = ['settings.gradle', 'settings.gradle.kts'].some((f) =>
    fs.existsSync(path.join(dir, f)),
  );
  const hasAndroidBuild = ['build.gradle', 'build.gradle.kts'].some((f) =>
    fs.existsSync(path.join(dir, 'android', f)),
  );
  if (!hasSettings && hasAndroidBuild) {
    changed += writeIfDifferent(
      path.join(dir, 'settings.gradle'),
      stub('nothing; added file marks the package root as the build root'),
    );
  }
}

console.log(`fix-gradle-scan: ${changed} file(s) updated`);
