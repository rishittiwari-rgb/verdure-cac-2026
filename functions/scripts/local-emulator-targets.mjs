// Never let a regression script fall through to production or an arbitrary host.
function endpoint(value, fallback) {
  const address = value || fallback;
  const match = /^(127\.0\.0\.1|localhost):(\d+)$/.exec(address);
  if (!match || Number(match[2]) < 1 || Number(match[2]) > 65535) throw new Error("Regression targets must be local emulator host:port values");
  return { address, host: match[1], port: Number(match[2]), url: `http://${address}` };
}
const auth = endpoint(process.env.FIREBASE_AUTH_EMULATOR_HOST, "127.0.0.1:9099");
const firestore = endpoint(process.env.FIRESTORE_EMULATOR_HOST, "127.0.0.1:8899");
const storage = endpoint(process.env.FIREBASE_STORAGE_EMULATOR_HOST, "127.0.0.1:9199");
const functions = endpoint(`127.0.0.1:${process.env.FUNCTIONS_EMULATOR_PORT || "5001"}`);
process.env.FIREBASE_AUTH_EMULATOR_HOST = auth.address;
process.env.FIRESTORE_EMULATOR_HOST = firestore.address;
process.env.FIREBASE_STORAGE_EMULATOR_HOST = storage.address;
export const EMULATORS = { auth, firestore, storage, functions };
