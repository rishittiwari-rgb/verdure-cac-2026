"use client";

import LegalContent from "@/components/layout/LegalContent";

/**
 * Privacy Policy.
 *
 * Written to match exactly what the app does today — every claim here is
 * backed by Verdure/Verdure/PrivacyInfo.xcprivacy and the Firestore rules.
 * If data handling changes, this page changes in the same commit.
 */
export default function PrivacyContent() {
  return (
    <LegalContent
      kicker="Privacy"
      title="What we collect, and "
      accent="what we don't."
      updated="September 27, 2026"
      intro="Verdure is built around getting outside, not around harvesting data. We don't track you, we don't run ads, and we don't sell anything about you. Here is exactly what the app stores and why."
    >
      <div className="callout">
        <p>
          <strong>The short version:</strong> we collect your account details,
          your location when you check in, and the photos you choose to attach
          as proof of attendance. We use them to run the app — points,
          collections, and rewards. Nothing is sold, and nothing is used for
          advertising or tracking.
        </p>
      </div>

      <h2>Who we are</h2>
      <p>
        Verdure (&ldquo;we&rdquo;, &ldquo;us&rdquo;) provides the Verdure mobile
        app. This policy covers the app and this website. If you have questions,
        see the <a href="/support">Support page</a> for how to reach us.
      </p>

      <h2>What we collect</h2>

      <h3>Account information</h3>
      <p>
        When you create an account we store your <strong>email address</strong>{" "}
        and a <strong>display name</strong>. We store your birth year to apply age safeguards. If you opt into student recommendations, we also store student status and any school you provide. Authentication is handled by
        Firebase Authentication; we never see or store your password. You can
        also browse as a guest without creating an account.
      </p>
      <p>
        You can optionally save children&apos;s ages in your household,
        accessibility preferences, usual transport, and typical distance. We
        use these private account settings for event recommendations and
        warnings. You can change or clear them in the app at any time.
      </p>

      <h3>Location</h3>
      <p>
        With your permission, we use your <strong>precise location</strong> to:
      </p>
      <ul>
        <li>show parks, trails and events near you;</li>
        <li>
          check whether you are close enough to a place to collect it; and
        </li>
        <li>
          verify that you are actually at an event when you check in, so that
          points mean something.
        </li>
      </ul>
      <p>
        When you check in, the coordinates at that moment are sent to our server
        to validate the check-in and are kept as an attendance record. We do not
        collect location in the background, and we never build a movement
        history or location profile. You can decline or revoke location access
        in iOS Settings at any time; the app still works, but check-in and
        collection need it to confirm you were there.
      </p>

      <h3>Proof-of-attendance photos</h3>
      <p>
        Checking in to an event requires a photo. The photo you choose is stored
        against your own account and is used only to verify that check-in. We
        access only the images you explicitly pick — never your photo library as
        a whole.
      </p>

      <h3>Things you post</h3>
      <p>
        Community posts you write are stored and shown to other Verdure users,
        along with your display name and initials. Don&rsquo;t post anything you
        wouldn&rsquo;t want other people in your area to read.
      </p>

      <h3>Subscription status</h3>
      <p>
        If you subscribe to Verdure+, we store whether your subscription is
        active so we can unlock member benefits. Payment is handled entirely by
        Apple — <strong>we never receive your card or payment details</strong>.
      </p>

      <h3>Game state</h3>
      <p>
        Your points, collected places, attended events, streak and badges are
        stored so your progress follows your account across devices.
      </p>

      <h3>Recommendations</h3>
      <p>
        We store your interests, saved and viewed events, and any more or less
        feedback with your account to order recommendations. Negative feedback
        fades over time.
      </p>

      <h2>What we do not do</h2>
      <ul>
        <li>
          <strong>No tracking.</strong> We don&rsquo;t track you across other
          apps or websites, and the app contains no advertising or analytics
          SDKs.
        </li>
        <li>
          <strong>No selling or sharing for ads.</strong> We do not sell your
          personal information or share it with data brokers.
        </li>
        <li>
          <strong>No background location.</strong> Location is only read while
          you are using the app.
        </li>
        <li>
          <strong>No contacts, health, or browsing data.</strong> We never ask
          for them.
        </li>
      </ul>

      <h2>Who processes data for us</h2>
      <p>
        We use <strong>Google Firebase</strong> (Authentication, Firestore,
        Cloud Functions, Cloud Storage) to run accounts, store game state, and
        hold proof photos. Apple processes subscription payments. Public place
        and event information is retrieved from open data sources such as
        OpenStreetMap, the National Park Service, and Recreation.gov — those are
        lookups for content, and your personal data is not sent to them.
      </p>

      <h2>How long we keep it</h2>
      <p>
        Account and game data is kept while your account exists. Proof-of-
        attendance photos and their attendance records are kept while they may
        need to be verified, and are deleted when the account is deleted.
      </p>

      <h2>Your choices and rights</h2>
      <ul>
        <li>
          <strong>Location:</strong> grant or revoke in iOS Settings → Privacy &
          Security → Location Services → Verdure.
        </li>
        <li>
          <strong>Photos:</strong> Verdure only receives the specific images you
          select.
        </li>
        <li>
          <strong>Notifications:</strong> turn off in the app&rsquo;s settings or
          in iOS Settings.
        </li>
        <li>
          <strong>Access or deletion:</strong> you can request a copy of your
          data or ask us to delete your account and everything attached to it —
          see <a href="/support">Support</a>. We&rsquo;ll action deletion
          requests within 30 days.
        </li>
      </ul>
      <p>
        Depending on where you live (for example the EEA/UK under GDPR, or
        California under the CCPA), you may have additional rights to access,
        correct, port, or delete your information, and to object to certain
        processing. We honour these requests regardless of where you are.
      </p>

      <h2>Children</h2>
      <p>
        Verdure is not directed to children under 13, and we don&rsquo;t
        knowingly collect their information. If you believe a child has created
        an account, contact us and we will remove it.
      </p>

      <h2>Security</h2>
      <p>
        Data is transmitted over encrypted connections and stored with
        access rules that restrict each account to its own data. Points,
        check-ins and redemptions are validated on our servers rather than
        trusted from the app.
      </p>

      <h2>Changes</h2>
      <p>
        If we change how we handle data, we&rsquo;ll update this page and move
        the &ldquo;last updated&rdquo; date. Material changes will be surfaced
        in the app.
      </p>
    </LegalContent>
  );
}
