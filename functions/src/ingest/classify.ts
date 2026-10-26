/**
 * Deterministic classification and enrichment for the frozen San José feeds.
 * Source tags from BiblioCommons and Localist are structured metadata, not
 * just words in a description. Unknowns stay explicit for review.
 */

import type { EventCategory, NormalizedEvent } from "./types.js";

export type CostKind = "free" | "paid" | "unknown";
export type AgeSuitability = "all" | "children" | "teens" | "adults" | "unknown";

export interface EnrichedEvent extends NormalizedEvent {
  categories: string[];
  classificationConfidence: number;
  qualityScore: number;
  inferredCost: CostKind;
  ageSuitability: AgeSuitability;
  endInferred: boolean;
}

type CategoryRule = { category: EventCategory; pattern: RegExp };
const SPORTS_ACTIVITY = /\b(?:sports?|hike|hiking|trail walk|nature walk|birding|marathon|race|running|yoga|exercise|fitness class|cycling|soccer|basketball|volleyball|baseball|football|tennis|pickleball|kayak(?:ing)?|swim(?:ming)?)\b/i;
// "Race" in a library's civil-rights notice and "long running game" in a
// tabletop description are not athletics. Accept those words in a title only.
const SPORTS_DESCRIPTION = /\b(?:sports?|hike|hiking|trail walk|nature walk|birding|marathon|yoga|exercise|fitness class|cycling|soccer|basketball|volleyball|baseball|football|tennis|pickleball|kayak(?:ing)?|swim(?:ming)?)\b/i;
const VOLUNTEER_TITLE = /\b(?:volunteer(?:ing)?|stewardship|restoration|service day|give back|food drive|trail maintenance|habitat restoration|broom removal)\b/i;
const VOLUNTEER_INVITATION = /\b(?:volunteer(?:ing)? opportunities?|volunteers? needed|join (?:us|our) (?:volunteer|stewardship)|sign up to volunteer|become (?:a|an) (?:volunteer|adult literacy tutor)|new to volunteering|earn(?:ing)? volunteer service hours)\b/i;
const RULES: CategoryRule[] = [
  { category: "Program", pattern: /\b(?:internships?|apprenticeships?|fellowships?)\b/i },
  { category: "Cleanup", pattern: /\b(?:clean[ -]?up|litter|trash pick|creek clean|beach clean)\b/i },
  { category: "Volunteer", pattern: /\b(?:volunteer(?:ing)?|stewardship|restoration|service day|give back|food drive|trail maintenance|habitat restoration|broom removal)\b/i },
  { category: "Hackathon", pattern: /\b(?:hackathon|hack night|code jam|devfest)\b/i },
  { category: "Workshop", pattern: /\b(?:workshops?|classes?|clinics?|bootcamps?|intro(?:duction)? to|learn to|hands[ -]?on|makers?|labs?|training|story\s?times?|coding|3d printing|seminars?|lectures?|webinars?|homework help|tutoring?|tech help|computer help|digital help|STEM|STEAM|LEGO|knitting|crochet(?:ing)?|sewing|arts? (?:&|and) crafts?|jewelry making|reading buddies|read to (?:a )?dog|citizenship interview practice|resume (?:refresh|help)|career advic[ei]|info(?:rmation)? sessions?)\b/i },
  { category: "Market", pattern: /\b(?:farmers? market|flea market|craft fair|bazaar|swap meet|book sale)\b/i },
  { category: "Festival", pattern: /\b(?:festivals?|concerts?|live music|comedy show|theat(?:er|re)|orchestra|symphony|parade|film screening|exhibits?|exhibitions?|performances?)\b/i },
  { category: "Sports", pattern: SPORTS_ACTIVITY },
  { category: "Meetup", pattern: /\b(?:meetups?|meet up|mixer|networking|club meeting|book club|quiz club|advisory group|public meeting|trustees meeting|board meeting|committee meeting|recovery meeting|coffee chat|community gathering)\b/i },
  { category: "Social", pattern: /\b(?:board games?|bingo|trivia|scavenger hunt|coloring|colouring)\b/i },
];

/** Feed event-type fields are a stronger signal than incidental description words. */
const STRUCTURED_RULES: CategoryRule[] = [
  { category: "Program", pattern: /\b(?:internships?|apprenticeships?|fellowships?)\b/i },
  { category: "Workshop", pattern: /\b(?:storytimes?|learning|classes?|workshops?|seminars?|lectures?|webinars?|training|STEAM|STEM|crafts? & hobbies|learn english|computer help|technology & innovation|arts, crafts, & how-to|life skills)\b/i },
  { category: "Festival", pattern: /\b(?:performances?|concerts?|exhibits?|exhibitions?|dance|music)\b/i },
  { category: "Sports", pattern: /\b(?:hikes?|outdoor recreation|athletics)\b/i },
  { category: "Meetup", pattern: /\b(?:clubs?|social events and gatherings|community meetings?|governance meetings?|support groups?|conference\/symposium|religious\/spiritual)\b/i },
  { category: "Volunteer", pattern: /\b(?:volunteer opportunities|community service)\b/i },
  // These types describe social recreation/resources, never athletics.
  { category: "Social", pattern: /\b(?:games? & family entertainment|games? & gaming|gaming|community resources)\b/i },
];

const FAMILY = /\b(?:family|families|children|kids?|toddler|preschool|baby|babies|story\s?time|all ages)\b/i;
const YOUTH = /\b(?:teens?|youth|students?|high school|middle school)\b/i;
const ADULT = /\b(?:adults? only|ages? 18\+|21\+)\b/i;
const OUTDOORS = /\b(?:outdoors?|hike|trail|nature walk|birding|wildflower|preserve|park walk|creek)\b/i;
const INDOORS = /\b(?:indoors?|library|museum|gallery|classroom|auditorium)\b/i;
const OPPORTUNITY = /\b(?:volunteer|internship|career|job search|resume|service day|stewardship|workshop|class|clinic|training|bootcamp)\b/i;

/** Category priors reflect what a feed can actually guarantee. */
function sourcePrior(rec: NormalizedEvent): { category: EventCategory; confidence: number } {
  // Generic library tags such as "Health & Fitness" and "Entertainment &
  // Recreation" can make a snack pickup or tabletop game look like sport.
  // The upstream free-text classifier also matches "sport" inside words such
  // as "transport". Require an actual activity before retaining that prior.
  if (rec.category === "Sports" && ["bibliocommons", "libcal", "localist", "livewhale"].includes(rec.source) &&
      !SPORTS_ACTIVITY.test(rec.title) && !/\b(?:hikes?|outdoor recreation|athletics)\b/i.test(rec.tags.join(" "))) {
    return { category: "Social", confidence: 0.55 };
  }
  // A class or help desk may be run by volunteers while its attendees are
  // learners. Do not carry the source's volunteer prior into the public
  // Opportunities category without an invitation for attendees to serve.
  if (rec.category === "Volunteer" && ["bibliocommons", "libcal", "localist", "livewhale"].includes(rec.source) &&
      !VOLUNTEER_TITLE.test(rec.title) &&
      !/\b(?:volunteer opportunities|community service)\b/i.test(rec.tags.join(" ")) &&
      !VOLUNTEER_INVITATION.test(rec.description)) {
    return { category: "Social", confidence: 0.55 };
  }
  switch (rec.source) {
  case "midpen": return { category: "Sports", confidence: 0.78 };
  case "legistar": return { category: "Meetup", confidence: 0.88 };
  case "ticketmaster": return { category: rec.category, confidence: 0.72 };
  case "bibliocommons":
  case "libcal": return { category: rec.category, confidence: 0.56 };
  case "localist":
  case "livewhale": return { category: rec.category, confidence: 0.58 };
  default: return { category: rec.category, confidence: 0.55 };
  }
}

function inferCost(rec: NormalizedEvent): CostKind {
  if (rec.priceMin !== undefined) return rec.priceMin <= 0 ? "free" : "paid";
  if (rec.isFree === true) return "free";
  if (rec.isFree === false) return "paid";
  if (/\bfree\b|no cost|no admission fee/i.test(`${rec.title} ${rec.description}`)) return "free";
  if (/\$\s?\d|ticket(?:s)? required|admission fee|registration fee/i.test(`${rec.title} ${rec.description}`)) return "paid";
  if (["bibliocommons", "libcal", "midpen", "legistar"].includes(rec.source)) return "free";
  return "unknown";
}

function inferAge(text: string, audiences: string[] = []): AgeSuitability {
  const audience = audiences.join(" ");
  if (/\ball ages\b|everyone|general public/i.test(audience)) return "all";
  const children = FAMILY.test(audience) || /preschool|pre-school|pre-teens?|tweens?/i.test(audience);
  const teens = /\bteens?\b/i.test(audience.replace(/pre[ -]teens?/gi, ""));
  const adults = /\badults?|seniors?\b/i.test(audience);
  // Mixed bands are not an assertion that every age is eligible.
  if ((adults && (children || teens)) || (children && teens)) return "unknown";
  if (children) return "children";
  if (teens) return "teens";
  if (adults) return "adults";
  if (ADULT.test(text)) return "adults";
  if (/\ball ages\b|everyone welcome|open to all/i.test(text)) return "all";
  if (YOUTH.test(text)) return "teens";
  if (FAMILY.test(text)) return "children";
  return "unknown";
}

/** One pure operation used identically by fresh ingest and corpus backfill. */
export function enrichEvent(rec: NormalizedEvent): EnrichedEvent {
  const title = rec.title;
  const structured = (rec.eventTypes?.length ? rec.eventTypes : rec.tags).join(" ");
  const text = `${title} ${rec.description}`;
  const allText = `${title} ${structured} ${rec.tags.join(" ")} ${(rec.audiences ?? []).join(" ")} ${rec.description}`;
  const prior = sourcePrior(rec);
  const scores = new Map<EventCategory, number>([[prior.category, prior.confidence]]);
  for (const rule of STRUCTURED_RULES) {
    if (rule.pattern.test(structured)) {
      const structuredConfidence = rule.category === "Workshop" ? 0.9 : 0.86;
      scores.set(rule.category, Math.max(structuredConfidence, scores.get(rule.category) ?? 0));
    }
  }
  for (const rule of RULES) {
    let confidence = 0;
    if (rule.pattern.test(title)) confidence = rule.category === "Program" ? 0.96 : 0.94;
    else if (rule.pattern.test(structured)) confidence = 0.88;
    else if ((rule.category === "Sports" ? SPORTS_DESCRIPTION : rule.pattern).test(rec.description)) {
      // A volunteer leading a class does not make the class a volunteer
      // opportunity. Description-only volunteering needs an invitation to act.
      confidence = rule.category === "Volunteer" &&
        !VOLUNTEER_INVITATION.test(rec.description)
        ? 0 : 0.68;
    }
    if (confidence) scores.set(rule.category, Math.max(confidence, scores.get(rule.category) ?? 0));
  }
  // Midpen's volunteer projects often mention an interpretive hike too. The
  // work to be done defines the primary purpose; retain Outdoors as a label.
  if (rec.source === "midpen" && rec.category === "Volunteer") {
    scores.set("Volunteer", Math.max(0.97, scores.get("Volunteer") ?? 0));
  }
  if (/\bstory\s?time\b/i.test(`${title} ${structured}`)) {
    scores.set("Workshop", Math.max(0.97, scores.get("Workshop") ?? 0));
  }
  const ranked = [...scores].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const primary = ranked[0]?.[0] ?? rec.category;
  const confidence = ranked[0]?.[1] ?? 0.4;
  const labels = new Set<string>(ranked.filter(([, score]) => score >= 0.67).map(([category]) => category));
  labels.add(primary);
  if (rec.source === "midpen" || OUTDOORS.test(allText)) labels.add("Outdoors");
  if (FAMILY.test(allText)) labels.add("Family");
  if (YOUTH.test(allText)) labels.add("Youth");
  if (INDOORS.test(allText)) labels.add("Indoor");
  if (OPPORTUNITY.test(allText) || labels.has("Volunteer") || labels.has("Program")) labels.add("Opportunity");
  const cost = inferCost(rec);
  if (cost === "free") labels.add("Free");
  const age = inferAge(`${structured} ${text}`, rec.audiences);
  const endInferred = !rec.end;
  const end = rec.end ?? new Date(rec.start.getTime() + (rec.time === "All day" ? 24 : 2) * 3_600_000);
  const quality = Math.min(1,
    (rec.imageURL ? 0.2 : 0) +
    (rec.description.length >= 80 ? 0.2 : rec.description.length > 0 ? 0.1 : 0) +
    (rec.latitude != null && rec.longitude != null ? 0.25 : 0) +
    (!endInferred ? 0.1 : 0.05) +
    (confidence >= 0.65 ? 0.15 : 0) +
    (rec.website ? 0.1 : 0));
  return { ...rec, end, endInferred, category: primary,
    categories: [...labels], classificationConfidence: confidence,
    qualityScore: Math.round(quality * 100) / 100,
    inferredCost: cost, ageSuitability: age };
}
