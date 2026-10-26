/**
 * Interests — the one place that knows what the app's interest labels mean.
 *
 * THE BUG THIS FILE FIXES (CAC 2026, 1.1 cause 1). The app stores interests as
 * PlaceCategory labels — "Parks", "Trails", "Gardens", "Playgrounds",
 * "Waterfront", "Sports", "Scenic", "Community" — while the ranker only knew a
 * lower-case vocabulary ("outdoors", "fitness", "volunteering", …). Every
 * lookup missed, the interest term was 0 for every event, and "For You" was
 * ordered by distance and timing alone: random sports events for someone who
 * picked Community, career workshops for someone who picked Parks + Trails.
 *
 * Both rankers and the reasons builder now go through `normalizeInterests`, so
 * a label the app saves is a term the server understands, and the reason line
 * can still name the user's own pick ("Because you like Parks").
 *
 * THE SECOND BUG (1.1 cause 4): bare words. "park" matched "Mitchell Park
 * Library", "garden" matched "Greenhouse Community Room", "volunteer" in a
 * description matched every Homework Help session run by volunteers, "game"
 * made board-game afternoons sports. Matching here is precise:
 *   • titles are matched against multi-word phrases and specific words only;
 *   • descriptions are matched against a STRICTER list (a description that
 *     mentions volunteers is not a volunteering event; "volunteers needed" is);
 *   • venue, branch and organizer names are stripped from the text first;
 *   • the frozen classifier's SPECIFIC categories (Cleanup, Volunteer, Sports,
 *     Festival, Market) count as a direct match; its catch-alls (Workshop,
 *     Social, Meetup) never do.
 *
 * Nothing here filters. A non-matching event scores 0 on the interest term and
 * is still ranked (see ranking.ts, "rank, never filter").
 */

import type { RankableEvent } from "./ranking.js";
import { CATEGORY_PATTERNS, TOPIC_TO_INTEREST, type TopicTag } from "./ingest/annotate.js";

/** The app's PlaceCategory raw values (Models.swift) → server interest terms, most specific first. */
export const APP_LABEL_TO_TERMS: Record<string, readonly string[]> = {
  parks: ["outdoors"],
  trails: ["hiking", "outdoors"],
  gardens: ["gardening", "outdoors"],
  playgrounds: ["family", "outdoors"],
  waterfront: ["waterfront", "outdoors"],
  sports: ["fitness"],
  scenic: ["scenic", "outdoors"],
  community: ["community", "volunteering"],
  // Not a PlaceCategory in the current build; kept so a build that adds the option needs no server change.
  volunteering: ["volunteering"],
};

/** Every term the server understands. Lower-case; an unknown raw value is ignored, never guessed. */
export const SERVER_INTEREST_TERMS: readonly string[] = [
  "outdoors", "hiking", "gardening", "waterfront", "scenic", "fitness", "volunteering", "community",
  "family", "arts", "music", "food", "tech", "learning",
];

/** Plain-English names for terms, used only when the user's raw value was a term rather than an app label. */
export const TERM_PRETTY: Record<string, string> = {
  outdoors: "the outdoors", hiking: "hiking", gardening: "gardening", waterfront: "the waterfront", scenic: "scenic spots",
  fitness: "fitness", volunteering: "volunteering", community: "your community", family: "family activities",
  arts: "arts", music: "music", food: "food", tech: "tech", learning: "learning",
};

export interface NormalizedInterest {
  /** What the user actually picked, as stored ("Parks"); the reasons line uses this verbatim. */
  label: string;
  /** Server terms the pick means, most specific first. */
  terms: string[];
}

/**
 * Map stored interests onto server terms. App labels expand; terms pass through;
 * anything else is dropped. Order and duplicates of the input are preserved
 * (first occurrence wins) so reasons name the pick the user made first.
 */
export function normalizeInterests(raw: readonly unknown[] | undefined): NormalizedInterest[] {
  const out: NormalizedInterest[] = [];
  const seen = new Set<string>();
  for (const value of raw ?? []) {
    if (typeof value !== "string") continue;
    const label = value.trim();
    const key = label.toLowerCase();
    if (!label || seen.has(key)) continue;
    seen.add(key);
    const terms = APP_LABEL_TO_TERMS[key] ?? (SERVER_INTEREST_TERMS.includes(key) ? [key] : []);
    if (terms.length) out.push({ label, terms: [...terms] });
  }
  return out;
}

/** Flat, de-duplicated server terms for a stored interest list. */
export function interestTerms(raw: readonly unknown[] | undefined): string[] {
  const out: string[] = [];
  for (const n of normalizeInterests(raw)) for (const t of n.terms) if (!out.includes(t)) out.push(t);
  return out;
}

/** The user's own label behind a term ("Parks" for outdoors), or the term's plain name. */
export function labelForTerm(raw: readonly unknown[] | undefined, term: string): string {
  const owner = normalizeInterests(raw).find((n) => n.terms.includes(term));
  // An app label ("Community", "Parks") reads verbatim — even when it spells a term name; a stored server term reads as its plain name.
  if (owner && (owner.label.toLowerCase() in APP_LABEL_TO_TERMS || owner.label.toLowerCase() !== term)) return owner.label;
  return TERM_PRETTY[term] ?? term;
}

// ── Lexicon ─────────────────────────────────────────────────────────────────

/** Unicode word boundaries, as annotate.ts uses: "art" never matches "start" or "artística". */
const B_START = "(?<![\\p{L}\\p{N}_])";
const B_END = "(?![\\p{L}\\p{N}_])";
const compile = (phrases: readonly string[]): RegExp | null =>
  phrases.length ? new RegExp(`${B_START}(?:${phrases.join("|")})${B_END}`, "iu") : null;

interface Lexicon {
  /** Phrases that make a TITLE a direct match. Regex fragments; plurals spelled out. */
  title: readonly string[];
  /** A feed's own structured labels that are a direct match when the WHOLE tag equals one of these (lower-case). A library's umbrella "Health & Fitness" is not one. */
  tags?: readonly string[];
  /** Stricter phrases for the venue-stripped DESCRIPTION. */
  description: readonly string[];
  /** Frozen-classifier categories that are a direct match on their own. */
  categories: readonly string[];
  /** Categories that only LIFT the score (0.8): plausible but not evidence enough to claim the pick (a ticketed tribute concert is classified Festival). */
  liftCategories?: readonly string[];
  /** John's topic tags used for candidate RETRIEVAL only (a superset; the matcher decides). */
  topics: readonly TopicTag[];
}

const OUTDOOR_TITLE = [
  "hikes?", "hiking", "trails?", "trailheads?", "nature walks?", "bird walks?", "birding", "bird(?:ing)? (?:walk|outing|count)s?",
  "wildflowers?", "naturalists?", "open space", "preserves?", "wildlife", "stargazing", "star part(?:y|ies)", "campfires?",
  "outdoors?", "nature (?:walk|hike|center|preserve|play|photography|journaling|day|camp)s?", "guided walks?", "docent[- ]led walks?", "creek walks?", "kayak(?:ing)?", "paddl(?:e|ing)", "tide ?pools?",
  "baylands", "botanical", "community gardens?", "garden tours?", "native plants?", "arboretum", "junior rangers?", "park rangers?",
  "wetlands?", "marsh(?:es)?", "shoreline", "bay trail", "redwoods?", "forest (?:bathing|walk|hike)", "summit hike", "ridge (?:trail|hike)", "canyon hike",
  "state park", "county park", "regional park", "city park", "park cleanup", "park clean-up", "nature preserve", "habitat",
  "trail (?:work|day|run|crew)", "night hikes?", "full moon (?:hike|walk)", "moonlight (?:hike|walk)", "sunset (?:hike|walk)",
  "sunrise (?:hike|walk)", "fall colou?rs?", "mushroom (?:walk|hunt|foray)", "geocach(?:e|ing)", "orienteering", "stewardship",
  "restoration", "tree planting", "plantings?", "plant(?:ing)? (?:day|party)", "pollinators?", "butterfl(?:y|ies)", "owls?", "monarch butterfl(?:y|ies)",
  "tidepooling", "bioblitz", "wildflower walks?", "bike (?:ride|tour)s?", "group rides?", "picnics?", "camp(?:ing|out)",
];
const OUTDOOR_DESC = [
  "guided (?:hike|walk|nature walk)s?", "(?:easy|moderate|strenuous) (?:hike|walk)", "miles? of trail", "on the trail", "trailhead",
  "hiking boots", "bring (?:water|binoculars|a water bottle|sturdy shoes|sunscreen)", "meet at the (?:trailhead|parking lot|kiosk|visitor center)",
  "open space preserve", "nature preserve", "wildlife refuge", "birding", "bird watching", "native plants?", "habitat restoration",
  "remove invasive", "invasive (?:plants?|species)", "plant(?:ing)? native", "community garden", "kayaks? (?:are )?provided", "paddle",
  "tide ?pools?", "stargazing", "telescopes? (?:will be )?(?:provided|available|set up)", "rain or shine", "outdoor (?:event|program|class|workshop|activity|adventure)",
  "outdoors", "in the park\\b", "at the park\\b", "park ranger", "junior ranger", "naturalist", "wildflowers?", "wetlands?", "shoreline", "bay trail", "redwoods?",
];

const LEXICON: Record<string, Lexicon> = {
  outdoors: { title: OUTDOOR_TITLE, description: OUTDOOR_DESC, categories: ["Cleanup"], topics: ["outdoors"],
    tags: ["outdoors", "outdoor", "parks", "park", "hike", "hikes", "hiking", "nature", "trails", "trail", "birding", "gardening", "open space", "camping", "kayaking", "stewardship"] },
  hiking: {
    title: ["hikes?", "hiking", "trails?", "trailheads?", "nature walks?", "guided walks?", "docent[- ]led walks?", "rambles?", "backpacking",
      "bay trail", "summit hike", "ridge (?:trail|hike)", "trail (?:work|day|run|crew)", "night hikes?", "full moon (?:hike|walk)", "moonlight (?:hike|walk)",
      "sunset (?:hike|walk)", "sunrise (?:hike|walk)", "canyon hike", "creek walks?", "walking tours?", "history walks?", "nature preserve", "open space"],
    description: ["guided (?:hike|walk|nature walk)s?", "(?:easy|moderate|strenuous) (?:hike|walk)", "miles? of trail", "on the trail", "trailhead",
      "hiking boots", "sturdy shoes", "elevation gain", "round[- ]trip hike", "loop trail", "open space preserve"],
    categories: [], topics: ["outdoors"], tags: ["hike", "hikes", "hiking", "trails", "trail", "backpacking"],
  },
  gardening: {
    title: ["garden tours?", "community gardens?", "gardening", "gardeners?", "native plants?", "plant sales?", "compost(?:ing)?", "demonstration gardens?",
      "arboretum", "botanical", "pollinators?", "pollinator gardens?", "wildflowers?", "seed (?:swap|exchange|saving|starting)", "seed librar(?:y|ies)", "planting",
      "plant(?:ing)? (?:day|party)", "succulents?", "bonsai", "orchids?", "rose gardens?", "rose pruning", "vegetable gardens?", "rain gardens?", "habitat gardens?", "garden workdays?",
      "master gardeners?", "pruning", "propagation", "houseplants?", "herbs?", "worm bin", "vermicompost(?:ing)?"],
    description: ["community garden", "master gardeners?", "native plants?", "pollinator(?:s| garden)", "demonstration garden", "compost(?:ing)?", "plant sale",
      "seed (?:swap|exchange|library)", "how to (?:grow|plant|prune)", "grow your own", "garden(?:ing)? (?:tips|basics|workshop|class)", "drought[- ]tolerant"],
    categories: [], topics: ["outdoors"], tags: ["gardening", "garden", "gardens", "native plants", "composting"],
  },
  waterfront: {
    title: ["creeks?", "rivers?", "bay trail", "baylands", "bayshore", "bayfront", "san francisco bay", "the bay", "shoreline", "beach(?:es)?", "kayak(?:ing)?", "paddl(?:e|ing)", "marsh(?:es)?", "wetlands?", "slough",
      "lakes?", "tide ?pools?", "tidepooling", "estuar(?:y|ies)", "coastal cleanup", "beach cleanup", "creek cleanup",
      "sailing", "rowing", "fishing", "piers?", "waterfront", "watershed", "salt ponds?", "boardwalk", "harbou?r", "canoe(?:ing)?", "paddleboard(?:ing)?",
      "stand[- ]up paddle", "boat(?:ing)? tours?", "shorebirds?", "steelhead", "salmon (?:run|spawning|viewing)"],
    description: ["along the (?:creek|river|bay|shoreline|slough)", "kayaks? (?:are )?provided", "paddle", "tide ?pools?", "wetland", "marsh", "shoreline",
      "bay trail", "watershed", "water quality", "creek cleanup", "beach cleanup", "coastal cleanup", "life jackets?", "boat ramp"],
    categories: [], topics: ["outdoors"], tags: ["kayaking", "paddling", "boating", "fishing", "beach", "shoreline"],
  },
  scenic: {
    title: ["sunsets?", "sunrises?", "viewpoints?", "stargazing", "star part(?:y|ies)", "astronomy", "full moon", "moonlight", "photography walks?",
      "nature photography", "scenic", "overlooks?", "summit hike", "vistas?", "night hikes?", "fall colou?rs?", "meteor shower", "telescopes?", "observatory",
      "planetarium", "lookouts?", "panoram(?:a|ic)", "golden hour", "sky ?watch(?:ing)?", "eclipse", "perseids?", "geminids?", "orionids?", "leonids?"],
    description: ["views? of the (?:bay|valley|city|ocean|mountains|hills)", "panoramic", "stargazing", "telescopes?", "watch the sunset", "sunrise over",
      "full moon", "meteor shower", "night sky", "photograph(?:y|ers)", "golden hour", "scenic"],
    categories: [], topics: ["outdoors"], tags: ["stargazing", "astronomy", "photography", "sunset"],
  },
  fitness: {
    title: ["yoga", "tai chi", "qigong", "qi gong", "zumba", "pilates", "dance fitness", "5k", "10k", "fun runs?", "trail runs?", "run clubs?",
      "running clubs?", "boot ?camps?", "workouts?", "cycling", "bike rides?", "group rides?", "pickleball", "basketball", "soccer", "volleyball",
      "tennis", "badminton", "softball", "baseball", "swim(?:ming)?", "climbing", "martial arts", "karate", "taekwondo", "judo", "boxing", "kickboxing",
      "fitness class(?:es)?", "walking groups?", "walk with a doc", "skating", "sports?", "athletics?", "open gym", "aerobics", "barre", "stretching class(?:es)?",
      "strength training", "hiit", "crossfit", "jogging", "spin class", "table tennis", "ping pong", "ultimate frisbee", "disc golf", "cricket", "rugby",
      "lacrosse", "golf", "bowling", "fencing", "gymnastics", "cheer(?:leading)?", "wrestling", "track and field", "triathlon", "marathon", "half marathon",
      "dance class(?:es)?", "line dancing", "salsa (?:dancing|class|night)", "hula", "capoeira"],
    description: ["all fitness levels", "bring a (?:yoga )?mat", "wear (?:comfortable|athletic) (?:clothes|clothing|shoes)", "workout", "cardio",
      "strength training", "stretching", "pickup (?:game|basketball|soccer)", "drop[- ]in (?:game|basketball|soccer|volleyball)", "league play", "practice and drills"],
    categories: ["Sports"], topics: ["sports", "fitness"], tags: ["sports", "yoga", "tai chi", "running", "cycling", "fitness classes", "exercise", "athletics", "recreation"],
  },
  volunteering: {
    title: ["volunteers?", "volunteering", "volunteen", "service days?", "service projects?", "stewardship", "habitat restoration", "restoration",
      "cleanups?", "clean-ups?", "clean ups?", "tree planting", "food banks?", "food drives?", "donation drives?", "community service", "work ?days?",
      "give back", "docent training", "coastal cleanup", "beach cleanup", "creek cleanup", "park cleanup", "litter pick ?up", "weeding", "invasive removal",
      "plant(?:ing)? (?:day|party)", "mentors? (?:needed|wanted|orientation)", "tutors? (?:needed|wanted|orientation)", "blood drives?", "toy drives?",
      "coat drives?", "book drives?", "plantings?", "native plantings?", "meal (?:packing|prep)", "sandwich making", "care packages?", "letter writing", "friends of the (?:library|park)s?",
      "adopt[- ]a[- ](?:park|trail|creek|block|street|spot)", "day of service", "mlk day of service", "earth day", "arbor day", "coastal clean ?up day",
      "make a difference day", "teen advisory (?:group|board)"],
    description: ["volunteers? (?:are )?(?:needed|wanted|welcome)", "volunteer opportunit(?:y|ies)", "sign up to volunteer", "looking for volunteers",
      "volunteer hours", "community service hours", "service hours", "become a volunteer", "join us to volunteer", "help us (?:plant|restore|clean|remove|pull|weed|sort|pack)",
      "earn (?:volunteer|service) hours", "bring (?:work )?gloves", "tools (?:and gloves )?(?:are )?provided", "gloves (?:and tools )?(?:are )?provided",
      "habitat restoration", "remove invasive", "invasive (?:plants?|species)", "trash (?:bags|pickup|pick-up)", "litter", "stewardship", "give back to",
      "volunteer orientation", "volunteer training", "volunteer with us", "volunteer at", "make a difference in your community"],
    categories: ["Volunteer", "Cleanup"], topics: ["volunteer"], tags: ["volunteer", "volunteers", "volunteering", "volunteer opportunities", "community service", "stewardship", "service"],
  },
  community: {
    title: ["community meetings?", "neighbou?rhood", "town halls?", "block part(?:y|ies)", "potlucks?", "community days?", "community fairs?", "resource fairs?",
      "community festivals?", "community celebrations?", "neighbou?rs", "civic (?:engagement|meeting|forum|day|duty|center|centre|academy)", "city council", "public meetings?", "community events?", "cultural festivals?",
      "night markets?", "farmers'? markets?", "street fairs?", "parades?", "diwali", "lunar new year", "d[ií]a de los muertos", "day of the dead",
      "community gardens?", "meetups?", "mixers?", "meet your neighbou?rs", "open house", "community breakfast", "pancake breakfast", "community dinners?",
      "volunteers?", "volunteering", "cleanups?", "clean-ups?", "service days?", "food banks?", "food drives?", "community service", "give back", "fiesta",
      "festivals?", "celebrations?", "heritage (?:month|day|festival|celebration)", "pride", "juneteenth", "cinco de mayo", "holi", "eid", "hanukkah", "kwanzaa",
      "tree lighting", "winter wonderland", "trunk or treat", "fall festival", "harvest festival", "spring festival", "multicultural", "international festival",
      "community conversations?", "listening sessions?", "candidate forums?", "neighbou?rhood associations?", "civic engagement", "voter registration",
      "community resource", "coffee with a cop", "national night out", "community potluck", "community picnics?", "picnics?"],
    description: ["open to the (?:whole )?community", "meet your neighbou?rs", "neighbou?rhood (?:association|council|meeting)", "town hall", "city council",
      "community (?:meeting|forum|conversation|celebration|festival|fair|day|dinner|picnic|potluck|gathering)", "all are welcome", "everyone is welcome",
      "bring the whole family", "free and open to the public", "volunteers? (?:are )?(?:needed|wanted|welcome)", "volunteer opportunit(?:y|ies)",
      "food (?:trucks|vendors)", "live music and", "resource fair", "cultural (?:celebration|festival|performance)s?", "civic engagement", "public comment"],
    categories: ["Volunteer", "Cleanup", "Market"], liftCategories: ["Festival"], topics: ["community", "civic", "volunteer"],
    tags: ["volunteer", "volunteers", "volunteering", "community", "community event", "community events", "civic", "neighborhood", "festival", "festivals", "cultural", "culture & traditions"],
  },
  family: {
    title: ["storytimes?", "story times?", "toddlers?", "preschool(?:ers)?", "kids'?", "bab(?:y|ies)", "famil(?:y|ies)", "all ages",
      "playgrounds?", "junior rangers?", "family days?", "play ?dates?", "little ones", "tots?", "parents? and me", "mommy and me", "daddy and me",
      "lego", "puppets?", "sing[- ]along", "bubbles?", "nature play", "family (?:hike|walk|night|fun|festival|movie|bike ride)", "kid[- ]friendly"],
    description: ["for (?:children|kids|toddlers|preschoolers|families)", "ages? \\d+(?:\\s*(?:-|–|to)\\s*\\d+)?", "all ages", "caregivers?", "bring the (?:whole )?family",
      "kid[- ]friendly", "family[- ]friendly", "stroller", "little ones", "children must be accompanied"],
    categories: [], topics: ["kids", "family"], tags: ["playground", "playgrounds", "toddlers", "preschoolers", "babies", "storytime", "storytimes"],
  },
  arts: {
    title: ["arts?", "painting", "drawing", "galler(?:y|ies)", "exhibitions?", "crafts?", "ceramics", "pottery", "sculpture", "printmaking", "watercolou?r",
      "sketching", "collage", "theat(?:er|re)", "films?", "movies?", "screenings?", "dance performance", "poetry", "open mic", "knitting", "crochet", "quilting", "sewing"],
    description: ["art (?:supplies|materials) (?:are )?provided", "all supplies provided", "no experience necessary", "gallery", "exhibition", "artists?"],
    categories: [], topics: ["arts", "theater", "film"],
  },
  music: {
    title: ["music", "concerts?", "jazz", "choirs?", "orchestras?", "live bands?", "live music", "sing[- ]along", "ukulele", "guitar", "piano", "drum(?:ming)? circles?",
      "symphony", "recitals?", "open mic", "karaoke", "dj", "folk music", "bluegrass", "mariachi", "hip[- ]hop", "a cappella", "songwriting"],
    description: ["live music", "concert", "performance by", "band", "musicians?", "sing along"],
    categories: [], topics: ["music"],
  },
  food: {
    title: ["food", "cooking", "farmers'? markets?", "tastings?", "baking", "recipes?", "cuisine", "potlucks?", "food trucks?", "chef", "culinary", "bbq", "barbecue",
      "cook[- ]off", "bake sale", "tea party", "coffee", "chocolate", "brunch", "picnics?", "nutrition", "kitchen"],
    description: ["food (?:trucks|vendors|tasting|samples)", "cooking demo(?:nstration)?", "recipes?", "ingredients", "light refreshments", "snacks provided", "lunch provided"],
    categories: ["Market"], topics: ["food"],
  },
  tech: {
    title: ["coding", "robotics", "computers?", "makers?", "hackathons?", "technology", "tech", "programming", "python", "javascript", "scratch", "3d print(?:ing|ers?)",
      "arduino", "raspberry pi", "ai", "artificial intelligence", "machine learning", "cybersecurity", "web (?:design|development)", "app (?:design|development)",
      "game (?:design|development)", "minecraft", "stem", "steam", "engineering", "circuits?", "drones?", "vr", "virtual reality", "data science", "digital literacy"],
    description: ["learn to code", "coding", "programming", "robotics", "laptops? (?:are )?provided", "bring your (?:own )?laptop", "no coding experience", "stem"],
    categories: ["Hackathon"], topics: ["tech"],
  },
  learning: {
    title: ["workshops?", "class(?:es)?", "lectures?", "lessons?", "clinics?", "labs?", "learn", "seminars?", "tutoring", "courses?", "talks?", "author talks?",
      "book clubs?", "esl", "english conversation", "citizenship", "financial literacy", "resume", "job search", "career", "college (?:prep|application|night)", "study"],
    description: ["learn (?:how )?to", "hands[- ]on", "registration (?:is )?required", "beginners welcome", "no experience (?:necessary|needed|required)", "instructor", "workshop"],
    categories: ["Workshop"], topics: ["education", "workshop", "campus"],
  },
};

const TITLE_RX: Record<string, RegExp | null> = Object.fromEntries(Object.entries(LEXICON).map(([k, v]) => [k, compile(v.title)]));
const STRONG_TAGS: Record<string, Set<string>> = Object.fromEntries(Object.entries(LEXICON).map(([k, v]) => [k, new Set((v.tags ?? []).map((t) => t.toLowerCase()))]));
const DESC_RX: Record<string, RegExp | null> = Object.fromEntries(Object.entries(LEXICON).map(([k, v]) => [k, compile(v.description)]));

/** Categories that count as a direct match for a term (exported for tests and the v2 category path). */
export const TERM_CATEGORIES: Record<string, readonly string[]> = Object.fromEntries(Object.entries(LEXICON).map(([k, v]) => [k, v.categories]));
/** Topic tags per term, for candidate retrieval. */
export const TERM_TOPICS: Record<string, readonly TopicTag[]> = Object.fromEntries(Object.entries(LEXICON).map(([k, v]) => [k, v.topics]));

/** Topic tags to retrieve for a set of terms (deduplicated, sorted for a stable cache key). */
export function retrievalTopics(terms: readonly string[]): TopicTag[] {
  const out = new Set<TopicTag>();
  for (const t of terms) for (const topic of TERM_TOPICS[t] ?? []) out.add(topic);
  return [...out].sort();
}

/** Categories to retrieve for a set of terms (deduplicated, sorted). */
export function retrievalCategories(terms: readonly string[]): string[] {
  const out = new Set<string>();
  for (const t of terms) for (const c of [...(LEXICON[t]?.categories ?? []), ...(LEXICON[t]?.liftCategories ?? [])]) out.add(c);
  return [...out].sort();
}

// ── Text preparation ────────────────────────────────────────────────────────

/**
 * Remove venue, branch and organizer names so "Mitchell Park Library" cannot
 * make a storytime outdoorsy and "Greenhouse Community Room" cannot make a
 * craft class a gardening event. Capitalised runs ending in a venue noun are
 * removed from the original-case text; the event's own organizer and location
 * strings are removed verbatim.
 */
const VENUE_RUN = /(?:[A-Z][\p{L}\p{N}'’.&-]*\s+){0,4}(?:Library|Libraries|Branch|Room|Rooms|Center|Centre|Hall|Auditorium|Theater|Theatre|Campus|School|College|University|Plaza|Building|Lobby|Lounge|Area|Wing|Floor|Gallery|Pavilion|Clubhouse|Church|Temple|Mosque|Synagogue|Office|Station|Studio)\b(?:\s*·\s*[^.\n]{0,60})?/gu;
const ADDRESS = /\b\d{2,6}\s+(?:[NSEW]\.?\s+)?[A-Z][\p{L}'’.-]*(?:\s+[A-Z][\p{L}'’.-]*){0,3}\s+(?:St|Street|Ave|Avenue|Blvd|Boulevard|Rd|Road|Dr|Drive|Way|Ln|Lane|Ct|Court|Pl|Place|Pkwy|Parkway|Hwy|Highway)\b\.?(?:,?\s*(?:Suite|Ste|#)\s*\w+)?/gu;

/** SJPL listings are bilingual: "biblioteca Rose Garden", "sucursal Educational Park" name the branch too. */
const SPANISH_BRANCH = /\b(?:biblioteca|sucursal)\s+(?:de\s+)?[A-Z][\p{L}\p{N}'’.-]*(?:\s+[A-Z][\p{L}\p{N}'’.-]*){0,3}/gu;

export function stripVenueNames(text: string, ev: Pick<RankableEvent, "organizer" | "locationName">): string {
  let out = String(text ?? "");
  for (const name of [ev.locationName, ev.organizer]) {
    const n = String(name ?? "").trim();
    if (n.length >= 3) out = out.split(n).join(" ");
  }
  return out.replace(ADDRESS, " ").replace(SPANISH_BRANCH, " ").replace(VENUE_RUN, " ").replace(/\s+/g, " ").trim();
}

// ── Matching ────────────────────────────────────────────────────────────────

export type MatchVia = "title" | "category" | "tag" | "description";

export interface InterestMatch {
  /** The user's pick that matched, verbatim ("Parks"). */
  label: string;
  /** The server term that matched. */
  term: string;
  /** 1.0 for a title phrase, a specific category or an allow-listed feed tag: DIRECT. 0.8 for a stricter description phrase or a phrase inside a feed tag: a lift, never a direct match. */
  strength: 1 | 0.8;
  via: MatchVia;
  /** True when the term is the pick's primary meaning (hiking for Trails, waterfront for Waterfront), so those lead the pick's shared outdoors matches. */
  primary: boolean;
}

/** Topic tags John's TITLE patterns find — the one reliable use of his keywords (descriptions are where the noise is). */
export function titleTopics(title: string): TopicTag[] {
  const t = String(title ?? "").toLowerCase();
  const out: TopicTag[] = [];
  for (const [cat, pattern] of Object.entries(CATEGORY_PATTERNS)) if (pattern.test(t)) out.push(cat as TopicTag);
  return out;
}

/** Does the title's own topic point at an interest the user did NOT pick? (Used to refuse description-only matches on off-topic listings.) */
function titleContradicts(ev: RankableEvent, terms: readonly string[]): boolean {
  const topics = titleTopics(ev.title ?? "").filter((t) => t !== "other" && t !== "community" && t !== "campus" && t !== "workshop" && t !== "education");
  if (!topics.length) return false;
  const wanted = new Set(terms.flatMap((t) => TERM_TOPICS[t] ?? []));
  const wantedInterests = new Set(terms);
  return topics.every((topic) => !wanted.has(topic) && !(TOPIC_TO_INTEREST[topic] ?? []).some((i) => wantedInterests.has(i)));
}

/** A lecture about drag story time is not a storytime; a seminar on reservoir stress is not a day at the lake. */
const ACADEMIC_TALK = /(?<![\p{L}\p{N}_])(?:lectures?|seminars?|colloquium|colloquia|webinars?|symposium|symposia|dissertation|thesis defen[cs]e|panel discussion|keynote|guest speaker|book talk|author talk)(?![\p{L}\p{N}_])/iu;
/** Terms where the activity itself is what the user wants, so a talk about it does not count. */
const ACTIVITY_TERMS: ReadonlySet<string> = new Set(["outdoors", "hiking", "gardening", "waterfront", "scenic", "fitness", "volunteering", "community", "family"]);

/**
 * Sources discovery activates automatically (no human looked at a single listing). The frozen
 * classifier's category is trusted on its own for the reviewed config sources, but on these a
 * category match must be corroborated by the title, an allow-listed tag or the description:
 * allcove's "glitter jars" craft session came through classified Cleanup and would otherwise
 * have read "Because you like Parks".
 */
export const DISCOVERED_SOURCES: ReadonlySet<string> = new Set(["wordpress-tec", "jsonld", "rss-ics", "ics"]);

/** One match per interest term, strongest first; empty when nothing matches. Pure. */
export function matchInterests(ev: RankableEvent, rawInterests: readonly unknown[] | undefined): InterestMatch[] {
  const normalized = normalizeInterests(rawInterests);
  if (!normalized.length) return [];
  const title = String(ev.title ?? "");
  const titleClean = stripVenueNames(title, ev);
  const tags = (ev.tags ?? []).filter((t): t is string => typeof t === "string" && !/^(library|google-events)$/i.test(t));
  const tagsLower = tags.map((t) => t.trim().toLowerCase());
  const tagText = tags.join(" · ");
  const descClean = stripVenueNames(String(ev.description ?? ""), ev);
  const cat = ev.category ?? "";
  const allTerms = normalized.flatMap((n) => n.terms);
  const out: InterestMatch[] = [];
  const seenTerms = new Set<string>();
  for (const n of normalized) {
    n.terms.forEach((term, index) => {
      if (seenTerms.has(term)) return;
      seenTerms.add(term);
      const lex = LEXICON[term];
      if (!lex) return;
      const primary = index === 0;
      const talk = ACTIVITY_TERMS.has(term) && ACADEMIC_TALK.test(title);
      if (lex.categories.includes(cat)) {
        const corroborated = !DISCOVERED_SOURCES.has(String(ev.source ?? "")) ||
          (!talk && TITLE_RX[term]?.test(titleClean)) || tagsLower.some((t) => STRONG_TAGS[term]?.has(t)) || (DESC_RX[term]?.test(descClean) ?? false);
        if (corroborated) { out.push({ label: n.label, term, strength: 1, via: "category", primary }); return; }
        // Uncorroborated category on a discovered source: a lift only, never the pick's reason.
        out.push({ label: n.label, term, strength: 0.8, via: "category", primary }); return;
      }
      if (!talk && TITLE_RX[term]?.test(titleClean)) { out.push({ label: n.label, term, strength: 1, via: "title", primary }); return; }
      if (tagsLower.some((t) => STRONG_TAGS[term]?.has(t))) { out.push({ label: n.label, term, strength: 1, via: "tag", primary }); return; }
      // A lift-only category, a phrase inside a feed's umbrella label ("Health & Fitness") or in the description lifts the score; none is evidence enough to claim the pick.
      if ((lex.liftCategories ?? []).includes(cat)) { out.push({ label: n.label, term, strength: 0.8, via: "category", primary }); return; }
      if (TITLE_RX[term]?.test(tagText)) { out.push({ label: n.label, term, strength: 0.8, via: "tag", primary }); return; }
      if (DESC_RX[term]?.test(descClean) && !titleContradicts(ev, allTerms)) out.push({ label: n.label, term, strength: 0.8, via: "description", primary });
    });
  }
  return out.sort((a, b) => b.strength - a.strength || Number(b.primary) - Number(a.primary));
}

/** The stated-interest component: 1 direct (title phrase, specific category, allow-listed tag), 0.8 lift only, 0 none. */
export function interestMatchStrength(ev: RankableEvent, rawInterests: readonly unknown[] | undefined): number {
  return matchInterests(ev, rawInterests)[0]?.strength ?? 0;
}

/** Threshold at which an event counts as "matching the user's interests" for tiering, reasons and the exploration slot: only DIRECT evidence reaches it. */
export const DIRECT_MATCH_MIN = 0.9;

/** The strongest DIRECT match, or undefined: what tiering, reasons and the exploration slot are built on. */
export function directMatch(ev: RankableEvent, rawInterests: readonly unknown[] | undefined): InterestMatch | undefined {
  return matchInterests(ev, rawInterests).find((m) => m.strength >= DIRECT_MATCH_MIN);
}

/** Legacy export shape kept for ranking v2 and existing tests: term → direct-match categories (specific categories only). */
export const INTEREST_TO_CATEGORY: Record<string, string[]> = Object.fromEntries(Object.entries(TERM_CATEGORIES).map(([k, v]) => [k, [...v]]));
