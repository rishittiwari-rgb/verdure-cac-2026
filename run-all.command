#!/bin/bash
# Verdure — one double-click brings the whole local stack up for a demo or a test run (macOS).
#
#   build the backend  →  start the emulators with the saved data  →  (re)load the data  →
#   regenerate + build the app  →  launch it on the simulator, Events tab, status bar 9:41.
#
# CAC 2026 (1.0 / 1.7). The emulators run with --import ../emulator-data --export-on-exit, so a
# restart never wipes the data again: whatever is in the emulators when this window is closed is
# what comes back next time. The Mac is kept awake for the whole run (caffeinate).
#
# Usage:   double-click, or   ./run-all.command [--no-reload] [--no-app] [--reload-only]
#   --no-reload   skip the data reload (use what ../emulator-data already holds)
#   --no-app      do not build or launch the simulator app
#   --reload-only reload the data into the running emulators and exit
#
# Layout it expects (Rishit's Mac): this file at the repo root, the helper folder one level up:
#   ../emulator-data        the emulator export (created on first run)
#   ../park-capture.json.gz optional: a permission-checked park capture for parks-local.mjs
#   tools/bin/java          Java 21 (Java 8 breaks the emulators); falls back to a registered or
#                           Homebrew JDK 21, then to a JDK 21 already on PATH
set -euo pipefail
cd "$(dirname "$0")"
ROOT="$(pwd)"
DATA_DIR="$ROOT/../emulator-data"
LOG_DIR="$ROOT/../run-all-logs"; mkdir -p "$LOG_DIR"
SIMULATOR="${VERDURE_SIMULATOR:-9DFBD646-CD1E-42E7-8B0B-26BB91DAB488}"
BUNDLE_ID="com.verdure-app.verdure"
RELOAD=1; APP=1; RELOAD_ONLY=0
for a in "$@"; do case "$a" in --no-reload) RELOAD=0;; --no-app) APP=0;; --reload-only) RELOAD_ONLY=1;; esac; done

say_step() { printf '\n\033[1;32m== %s\033[0m\n' "$*"; }
fail() { printf '\n\033[1;31m!! %s\033[0m\n' "$*"; exit 1; }

# ── Java 21 first on PATH ─────────────────────────────────────────────────────
. "$ROOT/functions/scripts/java21.sh"
if JAVA21_BIN="$(java21_bin "$ROOT/tools/bin" "$ROOT/tools/jdk/Contents/Home/bin" "$(/usr/libexec/java_home -v 21 2>/dev/null)/bin" \
     /opt/homebrew/opt/openjdk@21/bin /usr/local/opt/openjdk@21/bin)"; then
  export PATH="$JAVA21_BIN:$PATH"
fi
java -version 2>&1 | head -1 | grep -q '"21' || fail "Java 21 is required first on PATH (found: $(java -version 2>&1 | head -1)). Put it in tools/bin."

# ── Keep the Mac awake for the whole run ──────────────────────────────────────
caffeinate -dims -w $$ &

# ── Emulator config: Auth 9099, Functions 5002, Firestore 8899, Storage 9199 ─
export FIRESTORE_EMULATOR_HOST=127.0.0.1:8899 FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 GCLOUD_PROJECT=connectify-19dd8 FUNCTIONS_EMULATOR=true
node functions/scripts/sprint-emulators.mjs --config-only

emulators_up() { (echo > /dev/tcp/127.0.0.1/8899) >/dev/null 2>&1; }

if [ "$RELOAD_ONLY" -eq 0 ]; then
  say_step "Backend: install + build"
  (cd functions && npm install --no-audit --no-fund >"$LOG_DIR/npm-install.log" 2>&1 && npm run build)

  if emulators_up; then
    echo "Emulators already running on 8899 — reusing them."
  else
    say_step "Emulators: start with --import $DATA_DIR --export-on-exit"
    mkdir -p "$DATA_DIR"
    IMPORT_ARGS=()
    [ -f "$DATA_DIR/firebase-export-metadata.json" ] && IMPORT_ARGS=(--import "$DATA_DIR")
    npx firebase-tools@13 emulators:start --only auth,functions,firestore,storage --project connectify-19dd8 \
      --config .sprint-firebase.json "${IMPORT_ARGS[@]}" --export-on-exit "$DATA_DIR" >"$LOG_DIR/emulators.log" 2>&1 &
    EMU_PID=$!
    for _ in $(seq 1 90); do emulators_up && break; sleep 1; done
    emulators_up || fail "The emulators did not come up in 90 s — see $LOG_DIR/emulators.log"
    sleep 5   # Functions finish loading after Firestore opens its port
    echo "Emulators up (pid $EMU_PID). Closing this window exports the data back to $DATA_DIR."
  fi
fi

if [ "$RELOAD" -eq 1 ]; then
  say_step "Data: today's public events (the real ingestion pipeline, live public feeds)"
  node functions/scripts/refresh-public-corpus-local.mjs "$LOG_DIR/corpus-refresh.json" | tail -3
  say_step "Data: park guides and trails"
  if [ -f "$ROOT/../park-capture.json.gz" ]; then node functions/scripts/parks-local.mjs "$ROOT/../park-capture.json.gz" | tail -3
  else node functions/scripts/parks-local.mjs --live | tail -3; fi
  say_step "Data: outdoor and volunteer sources found by discovery (replays the recorded fixtures; no network)"
  node functions/scripts/migrate-sources.mjs >"$LOG_DIR/migrate-sources.log" 2>&1 || echo "  (sources already seeded)"
  node functions/scripts/activate-discovered-local.mjs "$LOG_DIR/discovered-sources.json" >"$LOG_DIR/discovered-sources.log" 2>&1 \
    && tail -1 "$LOG_DIR/discovered-sources.log" || echo "  discovered sources failed — see $LOG_DIR/discovered-sources.log"
  say_step "Data: native test fixtures (programs, rewards, stories, offline packs)"
  node functions/scripts/offline-native-fixture.mjs >"$LOG_DIR/fixtures.log" 2>&1 || true
  node functions/scripts/program-native-fixture.mjs >>"$LOG_DIR/fixtures.log" 2>&1 || true
  node functions/scripts/rewards-native-fixture.mjs >>"$LOG_DIR/fixtures.log" 2>&1 || true
  node functions/scripts/seed-stories-native.mjs >>"$LOG_DIR/fixtures.log" 2>&1 || true
  say_step "Data: the demo account (Demo Judge, three friends, RSVPs, collected places) and the For You demo accounts"
  node functions/scripts/demo-investor-local.mjs >"$LOG_DIR/demo-account.log" 2>&1 && tail -1 "$LOG_DIR/demo-account.log" || echo "  demo account seeding failed — see $LOG_DIR/demo-account.log"
  node functions/scripts/foryou-interests-e2e.mjs --keep >"$LOG_DIR/foryou-accounts.log" 2>&1 && echo "  For You demo accounts kept" || echo "  For You accounts failed — see $LOG_DIR/foryou-accounts.log"
  say_step "Data: counts"
  # From functions/: an inline module resolves firebase-admin from the working directory.
  (cd functions && node --input-type=module -e '
    import { initializeApp } from "firebase-admin/app"; import { getFirestore } from "firebase-admin/firestore";
    initializeApp({ projectId: "connectify-19dd8" }); const db = getFirestore();
    const events = (await db.collection("events").count().get()).data().count;
    const sources = (await db.collection("sources").where("status", "==", "active").count().get()).data().count;
    const parks = (await db.doc("parkCatalog/current").get()).data()?.counts ?? {};
    console.log(`  events: ${events}  active sources: ${sources}  parks: ${JSON.stringify(parks)}`);') || echo "  counts failed"
  say_step "Data: export now (so a crash before the window closes loses nothing)"
  npx firebase-tools@13 emulators:export "$DATA_DIR" --project connectify-19dd8 --force >"$LOG_DIR/export.log" 2>&1 && echo "  exported to $DATA_DIR"
fi
[ "$RELOAD_ONLY" -eq 1 ] && exit 0

if [ "$APP" -eq 1 ]; then
  say_step "App: xcodegen + Debug build for the simulator"
  # A fresh clone has neither gitignored Firebase file. The local emulators accept placeholder
  # values, so create both from their templates; a real GoogleService-Info.plist is only needed
  # to run against the live project. Existing files are never touched. The Firebase SDK aborts
  # at launch unless the API key is 39 characters starting with "A" and the app id is well-formed,
  # so the placeholders keep those shapes (they are not keys and open nothing).
  if [ ! -f Verdure/Secrets.xcconfig ]; then
    cp Verdure/Secrets.xcconfig.template Verdure/Secrets.xcconfig
    echo "  Verdure/Secrets.xcconfig created from the template (placeholders; the emulators do not need keys)"
  fi
  if [ ! -f Verdure/Verdure/GoogleService-Info.plist ]; then
    sed -e 's/YOUR_FIREBASE_API_KEY/A_local_emulator_placeholder_key_000000/' -e 's/YOUR_GCM_SENDER_ID/000000000000/' \
        -e 's/YOUR_PROJECT_ID/connectify-19dd8/' -e 's/YOUR_STORAGE_BUCKET/connectify-19dd8.appspot.com/' \
        -e 's#YOUR_GOOGLE_APP_ID#1:000000000000:ios:0000000000000000#' \
        Verdure/Verdure/GoogleService-Info.plist.template > Verdure/Verdure/GoogleService-Info.plist
    echo "  Verdure/Verdure/GoogleService-Info.plist created from the template (emulator placeholders)"
  fi
  # The default simulator id is the one on the Mac this was verified on. On any other Mac, use
  # the newest available iPhone (Pro preferred), or set VERDURE_SIMULATOR=<udid>.
  if ! xcrun simctl list devices available | grep -q "$SIMULATOR"; then
    PICK="$(xcrun simctl list devices available | grep -E '^ +iPhone [0-9]+ Pro \(' | tail -1)"
    [ -n "$PICK" ] || PICK="$(xcrun simctl list devices available | grep -E '^ +iPhone' | tail -1)"
    SIMULATOR="$(printf '%s' "$PICK" | sed -E 's/.*\(([0-9A-F-]{36})\).*/\1/')"
    [ -n "$SIMULATOR" ] || fail "No iPhone simulator is installed (Xcode → Settings → Components), or set VERDURE_SIMULATOR=<udid>"
    echo "  simulator: ${PICK# }"
  fi
  (cd Verdure && xcodegen generate >"$LOG_DIR/xcodegen.log" 2>&1)
  xcrun simctl boot "$SIMULATOR" >/dev/null 2>&1 || true
  # GPS at the seeded launch area (SJSU). The simulator keeps the last position a UI test set:
  # after an offline test that is Minneapolis, and Places, the Map and distances showed it.
  xcrun simctl location "$SIMULATOR" set 37.3352,-121.8811 >/dev/null 2>&1 || true
  open -a Simulator
  xcrun simctl status_bar "$SIMULATOR" override --time "9:41" --batteryState charged --batteryLevel 100 --cellularBars 4 --wifiBars 3 >/dev/null 2>&1 || true
  (cd Verdure && xcodebuild -project Verdure.xcodeproj -scheme Verdure -configuration Debug -destination "id=$SIMULATOR" \
     -derivedDataPath "$ROOT/../DerivedData" build >"$LOG_DIR/xcodebuild.log" 2>&1) || fail "xcodebuild failed — see $LOG_DIR/xcodebuild.log"
  APP_PATH="$(find "$ROOT/../DerivedData/Build/Products/Debug-iphonesimulator" -maxdepth 1 -name 'Verdure.app' | head -1)"
  [ -n "$APP_PATH" ] || fail "Verdure.app not found after the build"
  say_step "App: install and launch on the Events tab against the local emulators"
  xcrun simctl install "$SIMULATOR" "$APP_PATH"
  # Grant notifications up front so no permission sheet interrupts the recording.
  xcrun simctl privacy "$SIMULATOR" grant notifications "$BUNDLE_ID" >/dev/null 2>&1 || true
  xcrun simctl privacy "$SIMULATOR" grant location "$BUNDLE_ID" >/dev/null 2>&1 || true
  xcrun simctl launch "$SIMULATOR" "$BUNDLE_ID" -QAUseFirestoreEmulator YES -QAEmulatorHost 127.0.0.1 -QATab events >/dev/null
  echo "  launched $BUNDLE_ID on $SIMULATOR"
fi

say_step "Ready. Leave this window open while recording; closing it stops the emulators and exports the data."
wait
