"use client";

import LegalContent from "@/components/layout/LegalContent";

/**
 * Support page — doubles as the App Store "Support URL", which Apple requires
 * to be a reachable page with a way to contact us. Answers are limited to
 * behaviour that actually exists in the shipping app.
 */
const CONTACT_EMAIL = "support@verdure-app.com";

export default function SupportContent() {
  return (
    <LegalContent
      kicker="Support"
      title="Stuck on something? "
      accent="Let's sort it."
      updated="July 27, 2026"
      intro="Answers to the questions that come up most, and a direct line to us if yours isn't here."
    >
      <div className="callout">
        <p>
          <strong>Contact us:</strong>{" "}
          <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>
          <br />
          We aim to reply within two business days. Telling us your device, iOS
          version, and what you expected to happen gets things fixed fastest.
        </p>
      </div>

      <h2>Check-ins</h2>

      <h3>The check-in button won&rsquo;t unlock</h3>
      <p>
        Checking in needs two things: you have to be{" "}
        <strong>within about 500 feet of the venue</strong>, and you have to
        attach a <strong>photo as proof of attendance</strong>. If you&rsquo;re
        further away, the app shows how far off you are instead of letting you
        check in. That gate is deliberate — it&rsquo;s what keeps points
        meaningful for everyone.
      </p>

      <h3>It says it&rsquo;s waiting for a GPS fix</h3>
      <p>
        Give it a moment outdoors with a clear view of the sky. If it
        persists, check that Location Services are enabled for Verdure in iOS
        Settings → Privacy &amp; Security → Location Services.
      </p>

      <h3>I checked in but my points haven&rsquo;t appeared</h3>
      <p>
        Check-ins work offline: they&rsquo;re saved on your device and finish
        automatically the next time you have a connection. Open the app while
        online and they&rsquo;ll go through. Nothing is lost in the meantime.
      </p>

      <h2>Points and rewards</h2>

      <h3>How do I earn points?</h3>
      <p>
        Attending community events is the main way — events award between 75 and
        250 points depending on the type. Collecting places you visit adds
        smaller amounts (5–50 points based on rarity).
      </p>

      <h3>How do I redeem a gift card?</h3>
      <p>
        Open <strong>Profile → Rewards</strong>, pick a reward you can afford,
        and confirm. Your redemption is recorded immediately and the code is
        delivered to your account email address.
      </p>

      <h3>What are limited-time drops?</h3>
      <p>
        Seasonal rewards that are only redeemable inside a set window. Verdure+
        members can redeem them up to a week before they open to everyone.
      </p>

      <h2>Verdure+</h2>

      <h3>What&rsquo;s included?</h3>
      <ul>
        <li>Premium Rewards — the Gold and Platinum tiers ($25 and $50 cards)</li>
        <li>Early access to limited-time seasonal drops</li>
        <li>A member badge on your player card</li>
      </ul>
      <p>
        Verdure is fully usable for free. A subscription is never required to
        earn points or redeem the standard rewards.
      </p>

      <h3>Managing or cancelling</h3>
      <p>
        Subscriptions are billed by Apple and managed in iOS Settings → tap your
        name → Subscriptions. Cancelling there stops future renewals; your
        benefits continue until the end of the paid period. If you reinstall the
        app, tap <strong>Restore Purchases</strong> on the Verdure+ screen.
      </p>

      <h3>Refunds</h3>
      <p>
        Purchases go through Apple, so refunds are handled by Apple at{" "}
        <a
          href="https://reportaproblem.apple.com"
          target="_blank"
          rel="noopener noreferrer"
        >
          reportaproblem.apple.com
        </a>
        . If something in the app didn&rsquo;t work as described, email us too —
        we want to know.
      </p>

      <h2>Account and data</h2>

      <h3>Deleting my account</h3>
      <p>
        Email <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a> from your
        account address and we&rsquo;ll delete your account and its data,
        including any proof photos, within 30 days.
      </p>

      <h3>What data does the app collect?</h3>
      <p>
        The short answer is: your account details, your location at check-in,
        and the photos you attach. No tracking, no ads, nothing sold. The{" "}
        <a href="/privacy">Privacy Policy</a> has the full detail.
      </p>

      <h2>Places and events</h2>

      <h3>A place near me is missing or wrong</h3>
      <p>
        Places come from open data (OpenStreetMap, the National Park Service and
        Recreation.gov). Corrections made in OpenStreetMap flow through to
        Verdure. Tell us and we&rsquo;ll take a look.
      </p>

      <h3>Why do some places show &ldquo;typical hours&rdquo;?</h3>
      <p>
        When a source publishes real opening hours we show them. When it
        doesn&rsquo;t, we label the row &ldquo;typical hours&rdquo; rather than
        invent specifics — check before making a trip.
      </p>
    </LegalContent>
  );
}
