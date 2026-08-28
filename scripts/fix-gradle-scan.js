/**
 * Neutralizes the Gradle build files that ship inside node_modules so editor
 * Gradle integrations (VS Code's "Gradle for Java", Android Studio's scan) do
 * not try to configure them as standalone builds and fail.
 *
 * The VS Code extension picks build roots like this (RootProjectsStore):
 *   roots = { dirs containing settings.gradle[.kts] }
 *         + { dirs containing build.gradle[.kts] with no such ancestor dir }
 * and it scans the whole workspace whenever the opened folder is not itself a
 * Gradle project — node_modules included. So:
 *
 * - node_modules/settings.gradle: an empty settings file makes node_modules the
 *   build root for everything under it, so no library's android/build.gradle is
 *   configured standalone any more (react-native-webrtc's fails there because
 *   com.android.library is only on the classpath in the app build, which pulls
 *   these in as subprojects via autolinking and never reads a settings file at
 *   that level). One marker covers nested node_modules too.
 * - react-native ships its repo-root settings.gradle.kts/build.gradle.kts (the
 *   "build from source" entry point), whose project paths do not exist inside
 *   the npm package; a dir with a settings file is a root regardless of its
 *   ancestors, so those two must be stubbed individually. The app build uses
 *   prebuilt artifacts and never reads them (android/settings.gradle only
 *   includes @react-native/gradle-plugin, which configures fine and is left
 *   alone).
 *
 * Runs from npm postinstall; idempotent.
 */
const fs = require('fs');
const path = require('path');

const nodeModules = path.join(__dirname, '..', 'node_modules');

const marker = (why) =>
  '// Written by scripts/fix-gradle-scan.js (npm postinstall) so editor Gradle\n' +
  `// scanners do not configure this directory as a standalone build.\n// ${why}\n`;

function writeIfDifferent(file, content) {
  if (fs.existsSync(file) && fs.readFileSync(file, 'utf8') === content) {
    return 0;
  }
  fs.writeFileSync(file, content);
  return 1;
}

if (!fs.existsSync(nodeModules)) {
  process.exit(0);
}

let changed = 0;

changed += writeIfDifferent(
  path.join(nodeModules, 'settings.gradle'),
  marker('Empty build root for every package below this directory.'),
);

for (const f of ['settings.gradle.kts', 'build.gradle.kts']) {
  const file = path.join(nodeModules, 'react-native', f);
  if (fs.existsSync(file)) {
    changed += writeIfDifferent(
      file,
      marker(`Replaces react-native's build-from-source ${f}.`),
    );
  }
}

console.log(`fix-gradle-scan: ${changed} file(s) updated`);
