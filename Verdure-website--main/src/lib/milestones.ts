/**
 * The honest roadmap — four milestones, no dates, no inflated promises.
 * Single source for the landing Roadmap beat and the /roadmap page.
 */

export interface Milestone
{
  status: string;
  filled: boolean;
  title: string;
  body: string;
}

export let MILESTONES: Milestone[] = [
  {
    status: "First up",
    filled: true,
    title: "Closed beta",
    body: "A small group of founding explorers proves the daily loop in the real world.",
  },
  {
    status: "Planned",
    filled: false,
    title: "Community boards, local partners",
    body: "Events, pickup games, and the first partner rewards go live.",
  },
  {
    status: "Planned",
    filled: false,
    title: "Public launch",
    body: "Doors open. Waitlist walks in first.",
  },
  {
    status: "Later",
    filled: false,
    title: "New cities",
    body: "The trail extends wherever people want their neighborhood back.",
  },
];
