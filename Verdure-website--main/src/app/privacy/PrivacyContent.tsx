import LegalDocument from "@/components/LegalDocument";
import { PRIVACY_SECTIONS } from "@/lib/legal";

export default function PrivacyContent() {
  return <LegalDocument title="Privacy Policy" intro="What Verdure collects, why we use it, who processes it and how to make a privacy request." sections={PRIVACY_SECTIONS} />;
}
