// Read-only release check for the same signed-out Firestore query as iOS.
// It does not ingest, alter rules, or write any documents.
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { initializeApp, deleteApp } from "firebase/app";
import { getFirestore, collection, query, where, orderBy, limit, getDocsFromServer, Timestamp, terminate } from "firebase/firestore";

const plist = fileURLToPath(new URL("../../Verdure/Verdure/GoogleService-Info.plist", import.meta.url));
const value = (field) => execFileSync("plutil", ["-extract", field, "raw", "-o", "-", plist],
  { encoding: "utf8" }).trim();
const app = initializeApp({ apiKey: value("API_KEY"), projectId: value("PROJECT_ID"),
  appId: value("GOOGLE_APP_ID") }, "public-feed-check");
const db = getFirestore(app);
const events = query(collection(db, "events"),
  where("hidden", "==", false), where("active", "==", true),
  where("broadcast", "==", true),
  where("date", ">=", Timestamp.fromMillis(Date.now() - 3_600_000)),
  orderBy("date"), limit(80));
let exitCode = 0;
try {
  const snapshot = await Promise.race([
    getDocsFromServer(events),
    new Promise((_, reject) => setTimeout(() => reject(new Error("Public feed read timed out")), 20_000)),
  ]);
  console.log(JSON.stringify({ projectId: app.options.projectId, readable: true,
    returnedDocuments: snapshot.size, note: "Zero documents is a supply gap, not a read failure." }));
} catch (error) {
  exitCode = 1;
  console.error(JSON.stringify({ projectId: app.options.projectId, readable: false,
    code: error.code ?? "unknown", message: error.message }));
} finally {
  await terminate(db);
  await deleteApp(app);
}
process.exit(exitCode);
