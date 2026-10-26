import { onSchedule } from "firebase-functions/v2/scheduler";
import { prunePlaceGenerations, runPlaceIngest } from "./store.js";

// Separate from all event ingestion / classifier / ranking schedules. City data
// publishes Mondays; run Tuesday morning Pacific for the latest weekly data.
export const placeDataWeekly = onSchedule({ schedule: "0 6 * * 2", timeZone: "America/Los_Angeles",
  timeoutSeconds: 540, memory: "1GiB", maxInstances: 1 }, async () => {
  const result = await runPlaceIngest();
  await prunePlaceGenerations();
  if (result.errors.length) throw new Error(`Place ingestion failed visibly: ${result.errors.join("; ")}`);
  console.log("Place catalog published", { generation: result.runId, features: result.count });
});
