"use client";

import LegalContent from "@/components/layout/LegalContent";

/**
 * Terms of Use.
 *
 * Mirrors Verdure/Verdure/Models/Legal.swift (the copy that ships inside the
 * app). App Review 3.1.2 requires the subscription's terms to be linked from
 * the app; the app bundles them and links here for the web version. If the
 * subscription, rewards or moderation rules change, both change together.
 */
export default function TermsContent() {
  return (
    <LegalContent
      kicker="Terms of Use"
      title="The rules, in "
      accent="plain language."
      updated="August 28, 2026"
      intro="These terms cover the Verdure app and this website. They're short because the app is simple: get outside, show up, earn a little something for it."
    >
      <h2>Agreement</h2>
      <p>
        These Terms of Use are an agreement between you and Verdure (&ldquo;we&rdquo;,
        &ldquo;us&rdquo;). By creating an account, browsing as a guest, or
        subscribing, you agree to them. Apple&rsquo;s standard Licensed
        Application End User License Agreement also applies to the app; where the
        two conflict, Apple&rsquo;s terms govern the license and these Terms
        govern everything else.
      </p>

      <h2>Who can use Verdure</h2>
      <p>
        You must be at least 13 to create an account. If you are under 18, use
        Verdure with a parent or guardian&rsquo;s permission. You are responsible
        for keeping your sign-in details private and for everything done through
        your account.
      </p>

      <h2>Verdure+ subscription</h2>
      <p>
        Verdure+ is an optional auto-renewable subscription available as a
        1-month plan or a 1-year plan. The price and subscription length are
        shown in the app before you buy and are charged to your Apple ID at
        confirmation of purchase. The subscription renews automatically at the
        same price and length unless you turn off auto-renew at least 24 hours
        before the current period ends. You can manage or cancel it in your Apple
        ID account settings; cancelling stops future renewals but does not refund
        the current period, and refund requests are handled by Apple.
      </p>
      <p>
        Member benefits are those listed on the paywall in the version of the app
        you are using &mdash; nothing else is promised. If a benefit is withdrawn we
        will say so in the app before your next renewal.
      </p>

      <h2>Points and rewards</h2>
      <p>
        Points are earned by verified activity &mdash; checking in at events with
        your location and a proof photo, and collecting places you physically
        visit. Points have no cash value, cannot be bought, sold or transferred,
        and are not your property. Daily earning is capped, and cash gift-card
        redemptions are limited to a rolling twelve-month value per member and a
        monthly programme-wide budget; when either limit is reached the app tells
        you and redemption pauses. Partner perks are fulfilled by the partner on
        the partner&rsquo;s terms.
      </p>
      <p>
        We may withhold, reverse or cancel points and redemptions obtained
        through fraud, misrepresentation, automation or abuse, and may close
        accounts that do so. Rewards are delivered by email to the address on
        your account and may take several business days.
      </p>

      <h2>Your content and conduct</h2>
      <p>
        You own what you post. By posting you give us a licence to show it to
        other Verdure users as part of the service. Don&rsquo;t post anything
        unlawful, harassing, hateful, sexually explicit, dangerous, deceptive, or
        that you don&rsquo;t have the right to share.
      </p>
      <p>
        Every post, event and profile can be reported. Reports are reviewed by a
        person within 24 hours; content reported by several people is hidden
        immediately, and unreviewed reports lead to removal at the 24-hour mark.
        You can block any member. We may remove content or suspend accounts that
        break these rules. Questions about a moderation decision:{" "}
        <a href="mailto:support@verdure-app.com">support@verdure-app.com</a>.
      </p>

      <h2>Events and safety</h2>
      <p>
        Events are published by community organizers or gathered from public
        calendars and ticketing feeds. We don&rsquo;t run them and can&rsquo;t
        guarantee they take place as listed. Use your own judgement about where
        you go and who you meet, especially outdoors. Never trespass, and follow
        the rules of the venue or park.
      </p>

      <h2>Your account</h2>
      <p>
        You can delete your account at any time from Profile &rsaquo; Settings
        &rsaquo; Delete Account. Deletion permanently removes your profile, points,
        collection, posts, events, RSVPs, photos and any gift cards not yet sent;
        delivered gift cards are unaffected. We may close inactive or abusive
        accounts.
      </p>

      <h2>Disclaimers and liability</h2>
      <p>
        Verdure is provided &ldquo;as is&rdquo;. To the fullest extent permitted
        by law we disclaim warranties of any kind and are not liable for indirect,
        incidental or consequential damages, or for any loss arising from events,
        places or people you encounter through the app. Nothing here limits
        rights you have under consumer law that cannot be excluded.
      </p>

      <h2>Changes</h2>
      <p>
        We may update these Terms. If a change is material we will tell you in
        the app before it takes effect, and continuing to use Verdure afterwards
        means you accept it. The date at the top is the current version.
      </p>

      <h2>Contact</h2>
      <p>
        Verdure &mdash; <a href="mailto:support@verdure-app.com">support@verdure-app.com</a>.
        See also the <a href="/support">Support page</a> and the{" "}
        <a href="/privacy">Privacy Policy</a>.
      </p>
    </LegalContent>
  );
}
