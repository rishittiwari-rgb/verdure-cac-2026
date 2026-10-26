/**
 * The two plans shown on the website. Keep the price and benefits aligned
 * with Verdure/Verdure/Views/Paywall/PaywallView.swift and AppStore/LISTING.md.
 * Do not advertise roadmap benefits before they exist in the app.
 */

export interface Plan
{
  name: string;
  price: string;
  cadence: string;
  /** The annual price shown beside the monthly one, when a plan has one. */
  annual: string;
  tagline: string;
  features: string[];
  featured: boolean;
  note?: string;
}

export let PLANS: Plan[] = [
  {
    name: "Verdure Free",
    price: "$0.00",
    cadence: "",
    annual: "",
    tagline: "Forever free",
    features: [
      "Maps and public spaces",
      "Community events",
      "Daily Gem",
      "Basic gamification",
      "Points redeem for $5 to $10 gift cards",
      "Friend activity feed",
    ],
    featured: false,
  },
  {
    name: "Verdure+",
    price: "$4.99",
    cadence: "/mo",
    annual: "or $49.99/yr",
    tagline: "Everything in Free, plus:",
    features: [
      "Unlimited Adventure Planner (5 plans a month on Free)",
      "Early access to local partner perks",
      "$5 and $10 cash gift cards",
      "Advanced stats for your last 30 days",
      "Interest profiles and saved event filters",
      "Offline park and place packs",
    ],
    featured: true,
    note: "Packs last seven days. Background map imagery is not included. Online park guides and trail overviews are free.",
  },
];
