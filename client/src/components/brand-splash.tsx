import { useEffect, useRef, useState } from "react";

/**
 * The brand splash that plays over the sign-in page on every load.
 *
 * The Dokuma mark is already a tile composition — four half-discs on a 2x2
 * grid, each turned a quarter further than the last. Rather than fading the
 * logo PNG in, this rebuilds that grid as four SVG paths so the tiles can be
 * dealt in one at a time, each rotating into its final quarter-turn. The
 * wordmark then wipes in beside them and the whole thing lifts away.
 *
 * Timing (ms from mount), tuned so the mark has assembled before the words
 * arrive and the reader is never waiting on an idle screen:
 *
 *   0-720    four tiles drop in, 110ms apart, rotating into place
 *   620      "DOKUMA" wipes in left-to-right
 *   900      "DIGITAL CONSULTANCY" fades up under it
 *   1250     hairline rule draws across
 *   1650     the whole overlay lifts and fades out
 *   2050     unmounted; the sign-in form is interactive
 *
 * Under `prefers-reduced-motion` every movement collapses to a plain opacity
 * fade on a much shorter clock — the brand still registers, nothing travels.
 */

/** Total life of the overlay, in ms, from mount to unmount. */
const DURATION_MS = 2050;
const DURATION_REDUCED_MS = 1100;

export function BrandSplash() {
  // Start from the live media query rather than a state update after paint,
  // so a reduced-motion visitor never sees one frame of the full animation.
  const reducedMotion = useRef(
    typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  ).current;

  const [done, setDone] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(
      () => setDone(true),
      reducedMotion ? DURATION_REDUCED_MS : DURATION_MS,
    );
    return () => window.clearTimeout(timer);
  }, [reducedMotion]);

  // While the splash is up the page beneath must not scroll — on a phone the
  // sign-in form is tall enough to move behind the overlay otherwise.
  useEffect(() => {
    if (done) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [done]);

  if (done) return null;

  return (
    <div
      // aria-hidden + a real title on the page itself: a screen reader should
      // land on "Welcome back", not narrate a decorative animation.
      aria-hidden="true"
      data-reduced={reducedMotion ? "true" : undefined}
      className="dokuma-splash fixed inset-0 z-[100] flex items-center justify-center bg-navy"
    >
      {/* The same diamond mesh that runs behind the sidebar and brand panel,
          so the splash reads as the product rather than a separate screen. */}
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.05]"
        style={{
          backgroundImage:
            "repeating-linear-gradient(45deg, white 0, white 1px, transparent 1px, transparent 22px), repeating-linear-gradient(-45deg, white 0, white 1px, transparent 1px, transparent 22px)",
        }}
      />
      {/* Two soft lights, matching the brand panel's treatment. */}
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.10]"
        style={{
          backgroundImage:
            "radial-gradient(circle at 22% 18%, white 0, transparent 45%), radial-gradient(circle at 88% 82%, white 0, transparent 42%)",
        }}
      />

      <div className="dokuma-splash__stage relative flex flex-col items-center px-6">
        <TileMark />

        <div className="mt-8 overflow-hidden sm:mt-10">
          <h1 className="dokuma-splash__word font-serif text-[clamp(2rem,9vw,4.25rem)] font-semibold leading-none tracking-tight text-white">
            Dokuma
          </h1>
        </div>

        <p className="dokuma-splash__tagline mt-3 text-[clamp(0.7rem,2.4vw,0.95rem)] font-medium uppercase tracking-[0.42em] text-white/60 sm:mt-4">
          Digital&nbsp;Consultancy
        </p>

        <div className="dokuma-splash__rule mt-7 h-px w-[min(22rem,70vw)] bg-gradient-to-r from-transparent via-teal to-transparent sm:mt-9" />
      </div>
    </div>
  );
}

/**
 * The mark, rebuilt from primitives.
 *
 * Each cell of the 2x2 grid holds a half-disc: a semicircle whose flat edge
 * sits on one side of the cell. Turning that one shape by 0/90/180/270 degrees
 * reproduces the logo exactly, which is what lets the tiles animate — they
 * spin the last quarter-turn into their final orientation as they land.
 *
 * Drawn at 100x100 in two colours: the brand blue for the two tiles that are
 * blue in the asset, and a lighter steel/teal wash for the others, so the
 * grid has depth against the navy backdrop.
 */
function TileMark() {
  // A 2x2 grid of 44-unit cells with an 12-unit gutter, so the half-discs read
  // as four separate tiles the way they do in the asset — packed edge to edge
  // they merge into one silhouette instead.
  //
  // `rotate` is the final orientation of the half-disc in that cell. The
  // asset's arrangement, read clockwise from top-left: the flat edge faces
  // right, down, up, left respectively.
  const CELL = 44;
  const GAP = 12;
  const STEP = CELL + GAP;

  // The base shape is a dome: flat edge across the cell's middle, bulge below.
  // Rotating it gives 0deg = bulge down, 90deg = bulge right, 180deg = bulge
  // up, 270deg = bulge left.
  //
  // The asset's four tiles, read top-left, top-right, bottom-left,
  // bottom-right: bulge left, bulge down, bulge up, bulge right. Diagonally
  // opposite tiles mirror each other, which is what gives the mark its
  // pinwheel turn.
  const tiles = [
    { col: 0, row: 0, rotate: 270, tone: "#1E48D4" }, // bulges left
    { col: 1, row: 0, rotate: 0, tone: "#4FD1C5" }, // bulges down
    { col: 0, row: 1, rotate: 180, tone: "#4FD1C5" }, // bulges up
    { col: 1, row: 1, rotate: 90, tone: "#1E48D4" }, // bulges right
  ];

  const size = CELL * 2 + GAP;

  return (
    <svg
      viewBox={`0 0 ${size} ${size}`}
      className="h-[clamp(4.5rem,16vw,7.5rem)] w-[clamp(4.5rem,16vw,7.5rem)]"
      role="presentation"
    >
      {tiles.map((tile, index) => {
        // The cell's position is baked into the path's own coordinates rather
        // than applied as a transform. Both the drop-in and the quarter-turn
        // are CSS `transform`s, and a CSS transform on an element replaces its
        // `transform` presentation attribute outright — so positioning the
        // cell that way would be overwritten the moment either animation ran,
        // stacking all four tiles on top of each other.
        const x = tile.col * STEP;
        const y = tile.row * STEP;
        const r = CELL / 2;
        const cx = x + r;
        const cy = y + r;

        return (
          <g
            key={index}
            className="dokuma-splash__tile"
            // Each tile waits its turn. The stagger is what makes the mark
            // read as being dealt out rather than simply appearing.
            style={{ animationDelay: `${index * 110}ms` }}
          >
            <g
              className="dokuma-splash__tile-inner"
              style={{
                // Absolute viewBox units, which is what `transform-box:
                // view-box` (set in globals.css) makes these mean.
                transformOrigin: `${cx}px ${cy}px`,
                transform: `rotate(${tile.rotate}deg)`,
              }}
            >
              {/* Half-disc inscribed in the cell: flat edge across the cell's
                  middle, bulge hanging below it. The radius is half the cell,
                  so the shape stays inside its own cell and the gutter between
                  tiles stays open — a full-cell wedge would touch its
                  neighbours and the four would merge into one square. */}
              <path
                d={`M${x} ${cy} A${r} ${r} 0 0 0 ${x + CELL} ${cy} Z`}
                fill={tile.tone}
              />
            </g>
          </g>
        );
      })}
    </svg>
  );
}
