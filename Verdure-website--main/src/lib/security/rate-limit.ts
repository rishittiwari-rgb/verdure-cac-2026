// Fixed-window rate limiter, held in process memory.
//
// Honest about what this is: on Vercel each serverless instance keeps its own
// map, so a determined attacker spread across enough cold starts gets more
// than `limit` attempts. It stops the thing that actually happens to a public
// form — one script hammering one endpoint from one address — and it costs no
// infrastructure. When the waitlist starts taking real abuse, swap the two
// functions here for Upstash Redis or Vercel KV and every call site keeps
// working unchanged.

type Bucket = {
  count: number;
  resetAt: number;
  // Kept so eviction can tell a bucket that is actively blocking somebody
  // from one that is merely occupying space. See evict().
  limit: number;
  // Creation order, as a monotonic counter rather than a timestamp.
  //
  // Two reasons it is not Date.now(). Window lengths differ per namespace
  // (waitlist 10min, login 15min, identity 1min) so resetAt compares clocks
  // that started at different times; and a flood mints thousands of buckets
  // inside a single millisecond, so wall-clock ties en masse and the sort falls
  // back to insertion order — which is the exact failure this replaced. A
  // counter cannot tie.
  seq: number;
};

let BUCKETS = new Map<string, Bucket>();

// Incremented once per bucket creation. Number.MAX_SAFE_INTEGER at a sustained
// million creations a second is ~285 years, so wraparound is not a case.
let SEQ = 0;

// A ceiling so a flood of distinct keys cannot grow the map without bound.
let MAX_BUCKETS = 10_000;

export type RateLimitResult = {
  ok: boolean;
  retryAfterSeconds: number;
};

// Reclaim space when the map hits its ceiling.
//
// The ONLY buckets worth keeping are the ones currently refusing somebody:
// a bucket below its limit permits the next request anyway, so losing it
// changes nothing, while losing a bucket at its limit hands an attacker the
// reset they were trying to buy.
//
// Two earlier versions of this got it wrong in instructive ways. BUCKETS.clear()
// dropped every counter, making "reach the ceiling" a complete bypass. Evicting
// the oldest entries was worse than it sounds: with a shared window length,
// oldest means longest-established, so a flood of fresh keys evicted exactly
// the limits that had been earned — measured, and it failed the test.
//
// Sorting by CONSUMED FRACTION was the third attempt, and it was wrong in a way
// the test could not see. It ordered a flood of count=1 buckets (fraction 0.2)
// below an established bucket, which is right — but only because that flood is
// cheap. Flood with SATURATED keys instead (5 hits each, fraction 1.0) and every
// entry ties at 1.0, Array.sort is stable, and a tie among equals is broken by
// insertion order: the longest-established bucket goes first. That is precisely
// the victim. Measured — a fully-consumed bucket was evicted, and a 40/60
// identity budget came back with a fresh 60, the reset this whole function
// exists to deny. The committed regression missed it because both of its floods
// used count=1 keys, so the tie case was never exercised.
//
// Age alone does not fix it either, and it fails in a way worth recording: with
// newest-first, an attacker floods 10k junk keys FIRST, so the pile of stale
// buckets is older than the victim's, and the victim is then the newest thing in
// the map and evicted by the next round. Tested, and it failed exactly there.
//
// The question eviction is actually answering is: how much does dropping this
// bucket GIVE BACK? Resetting a bucket hands the attacker precisely `count`
// fresh attempts and nothing else. So evict the smallest count first. That is
// the cheapest thing to lose by definition, and it holds in every shape the
// other policies broke on:
//
//   flood of count=1 keys   count 1   evicted first, as before
//   saturated flood keys    count 5   evicted before anything better established
//   a blocked waitlist IP   count 5   ties with the flood, broken by seq below
//   a 40/60 identity budget count 40  kept last, though its FRACTION is lowest
//
// That last row is the one consumed-fraction got backwards: 40/60 = 0.67 sorts
// below a saturated 5/5 = 1.0, so fraction sheds the identity budget first and
// returns a full 60 — while count correctly sees that it is holding back four
// times more than any flood key is.
//
// seq DESCENDING breaks ties, so between two buckets that would give back the
// same amount the newer one goes. A flood's keys are new; an earned limit is
// not. And it cannot be turned around on its owner, because evict() only runs
// from the create path (see rateLimit below): every key an attacker mints to
// drive eviction is itself newer than the bucket they are trying to reset.
function evict(now: number): void
{
  let expired: string[] = [];

  BUCKETS.forEach(function (bucket, key)
  {
    if (bucket.resetAt <= now)
    {
      // Index assignment rather than concat: concat rebuilt the whole array on
      // every hit, so a sweep that found all 10,000 entries expired copied ~50
      // million elements to collect 10,000 keys.
      expired[expired.length] = key;
    }
  });

  expired.forEach(function (key)
  {
    BUCKETS.delete(key);
  });

  if (BUCKETS.size < MAX_BUCKETS)
  {
    return;
  }

  // Everything is live. Cheapest-to-lose first: fewest attempts handed back,
  // and among equals the most recent arrival.
  let byCost = Array.from(BUCKETS.entries())
    .slice()
    .sort(function (a, b)
    {
      if (a[1].count !== b[1].count)
      {
        return a[1].count - b[1].count;
      }

      // seq is unique per bucket, so this decides every remaining tie and the
      // result never depends on the sort being stable.
      return b[1].seq - a[1].seq;
    });

  byCost.slice(0, Math.ceil(MAX_BUCKETS / 10)).forEach(function (entry)
  {
    BUCKETS.delete(entry[0]);
  });
}

export function rateLimit(
  key: string,
  limit: number,
  windowMs: number
): RateLimitResult
{
  let now = Date.now();
  let bucket = BUCKETS.get(key);

  if (!bucket || bucket.resetAt <= now)
  {
    // This used to be BUCKETS.clear() at the cap, which turned the memory
    // guard into a weapon: anyone able to mint distinct keys — trivial from a
    // single machine holding an IPv6 /64 — could push the map to the ceiling
    // and wipe EVERY counter on the instance, including the ones that were
    // actively throttling them. Reaching the cap was the attacker's goal, not
    // an accident to absorb.
    //
    // Now expired entries go first, and only if that frees nothing do we drop
    // by consumed fraction — see evict(). A flood of fresh keys therefore
    // evicts other fresh keys rather than resetting established limits.
    if (BUCKETS.size >= MAX_BUCKETS)
    {
      evict(now);
    }

    SEQ = SEQ + 1;
    BUCKETS.set(key, { count: 1, resetAt: now + windowMs, limit, seq: SEQ });
    return { ok: true, retryAfterSeconds: 0 };
  }

  if (bucket.count >= limit)
  {
    return {
      ok: false,
      retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)),
    };
  }

  // seq carries over deliberately. Reassigning it on every hit would make the
  // most heavily used bucket look like the newest arrival, and eviction would
  // then shed exactly the limits doing the most work.
  BUCKETS.set(key, {
    count: bucket.count + 1,
    resetAt: bucket.resetAt,
    limit,
    seq: bucket.seq,
  });
  return { ok: true, retryAfterSeconds: 0 };
}
