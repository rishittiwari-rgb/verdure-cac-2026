/**
 * PlateCredit — the attribution for the background photograph.
 *
 * CC BY-SA 4.0 wants the credit to travel with the image, and the image is
 * the ground under every route, so this renders last in the root layout
 * rather than inside any one page. That is also the only spot that covers
 * the routes with no footer: login, signup, account, the 404.
 *
 * It is a normal block in the flow on purpose. A fixed chip floats over
 * whatever body copy happens to be at the bottom of the viewport, which
 * looked broken on both the homepage and the story page.
 */

let CREDIT_HREF = "https://commons.wikimedia.org/wiki/File:Foggy_view_east_from_Lion%27s_Head.jpg";
let LICENSE_HREF = "https://creativecommons.org/licenses/by-sa/4.0/";

export default function PlateCredit()
{
  return (
    <p className="vd-bg-credit">
      Background photograph{" "}
      <a href={CREDIT_HREF} target="_blank" rel="noopener noreferrer">
        Foggy view east from Lion&rsquo;s Head
      </a>{" "}
      by Juliancolton, licensed{" "}
      <a href={LICENSE_HREF} target="_blank" rel="noopener noreferrer">
        CC BY-SA 4.0
      </a>
    </p>
  );
}
