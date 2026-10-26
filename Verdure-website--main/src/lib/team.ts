/**
 * The five builders — real names, real roles, the approved lines. Shown on
 * the story page; nothing here may be invented or extended.
 */

export interface TeamMember
{
  name: string;
  role: string;
  line: string;
}

export let TEAM: TeamMember[] = [
  {
    name: "Rishit Tiwari",
    role: "Co-Founder & CEO",
    line: "Keeps the whole team pointed at one thing: getting people to actually go outside.",
  },
  {
    name: "Lalith Satheesh",
    role: "Co-Founder & CTO",
    line: "Builds the app itself: the map, the check-in flow, and the systems behind daily quests.",
  },
  {
    name: "Adithya Prabhu",
    role: "Chief Marketing Officer",
    line: "Runs how people first hear about Verdure, from campus groups to socials.",
  },
  {
    name: "Advaith Prabhu",
    role: "Chief Financial Officer",
    line: "Handles the money side, from what the app costs to what partners chip in.",
  },
  {
    name: "Vishvak Gurram",
    role: "Chief Product Officer",
    line: "Decides what ships next and how the daily loop should actually feel.",
  },
];

export let initialsOf = function (name: string)
{
  let parts = name.split(" ");
  let first = parts.length > 0 ? parts[0].charAt(0) : "";
  let last = parts.length > 1 ? parts[parts.length - 1].charAt(0) : "";
  return first + last;
};
