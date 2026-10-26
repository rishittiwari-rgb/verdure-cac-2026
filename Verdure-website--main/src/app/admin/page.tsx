import type { Metadata } from "next";
import StaffConsole from "./StaffConsole";
import "./staff.css";

export const metadata: Metadata = { title: "Staff console", robots: { index: false, follow: false } };
export default function AdminPage() {
  return <main id="main-content" className="staff-shell"><StaffConsole /></main>;
}
