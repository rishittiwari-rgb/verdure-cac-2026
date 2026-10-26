import { onCall } from "firebase-functions/v2/https";
import { requireAdmin } from "./common.js";
import { auditStaffRead } from "./staff-audit.js";
export const staffSession = onCall(async (req) => {
  const uid = await requireAdmin(req.auth);
  await auditStaffRead(uid, "staff:session", `users/${uid}`, { admin: true });
  return { uid, admin: true };
});
