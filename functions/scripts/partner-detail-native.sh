#!/bin/zsh
# Fresh native UI proof with a stream of simulated GPS fixes, not physical GPS.
set -u
root="$(cd "$(dirname "$0")/../.." && pwd)"
simulator="${VERDURE_QA_SIMULATOR:-D55D802A-6C43-4FD0-8E2F-65952BF28EB7}"
result="${VERDURE_QA_RESULT:-/tmp/verdure-partner-detail-$(date +%s).xcresult}"
partner_test_pid=""
cleanup() {
  xcrun simctl location "$simulator" clear
  FIRESTORE_EMULATOR_HOST=127.0.0.1:8899 FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 node "$root/functions/scripts/rewards-native-fixture.mjs" --clean
}
interrupted() {
  if [ -n "$partner_test_pid" ]; then kill "$partner_test_pid" 2>/dev/null; fi
  exit 130
}
trap cleanup EXIT
trap interrupted INT TERM
FIRESTORE_EMULATOR_HOST=127.0.0.1:8899 FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 node "$root/functions/scripts/rewards-native-fixture.mjs" || exit $?
xcrun simctl privacy "$simulator" grant location com.verdure-app.verdure || exit $?
cd "$root/Verdure" || exit $?
xcodebuild -quiet -project Verdure.xcodeproj -scheme Verdure -destination "platform=iOS Simulator,id=$simulator" \
  -only-testing:VerdureUITests/PartnerSurfaceTests/testLiveStaffWithdrawalDismissesOpenMapOffer \
  "$@" \
  -resultBundlePath "$result" test &
partner_test_pid=$!
while kill -0 "$partner_test_pid" 2>/dev/null; do
  xcrun simctl location "$simulator" set 33.2,-114.1
  sleep 5
done
wait "$partner_test_pid"
partner_test_result=$?
exit "$partner_test_result"
