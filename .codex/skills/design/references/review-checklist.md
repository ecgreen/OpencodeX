# OpencodeX Interface Review Checklist

## Before editing

- Identify the primary user task and the single primary action.
- Inventory every persistent, hover, context-menu, keyboard, and command-palette action.
- Confirm whether the change is presentation-only or changes product behavior.
- Locate shared primitives and tokens before adding CSS or components.
- Identify loading, empty, populated, long-content, error, destructive, and unavailable states.
- Confirm transcript scrolling and Git comparison behavior are outside the change unless explicitly requested.

## Visual review

- Primary content remains dominant at 980×680.
- Hierarchy is clear in grayscale and without relying on color.
- Text uses Geist Sans; technical data uses Geist Mono.
- Accent appears only for selection, focus, or the primary action.
- Cards have one obvious click target and no persistent destructive control.
- Buttons use the shared hierarchy and consistent target sizes.
- Spacing follows the 4px grid; radii and shadows use tokens.
- Dark and light themes preserve equivalent hierarchy and contrast.

## Interaction review

- Every hover-revealed action appears on `:focus-within` and has a keyboard path.
- Focus is visible and restored after dialogs, menus, or route transitions.
- Tooltips explain icon-only controls and include shortcuts when useful.
- Motion is interruptible, does not block input, and causes no content jump.
- Reduced motion removes translation, scaling, shimmer, and nonessential animation.
- Destructive actions require deliberate disclosure and confirmation where data loss is possible.

## Geometry and reliability

- Route roots match the stage content box.
- Full-bleed surfaces create no document scrollbar.
- Active leaf panels have nonzero remaining height and one intentional scrolling owner.
- Text truncation exposes the full value through a tooltip or accessible label.
- Narrow, standard, and wide sizes retain primary actions and readable content.

## Evidence and approval

- Capture 980×680, 1440×960, and 1920×1080 in dark and light themes.
- Cover default and reduced motion.
- Record navigation, sidebar collapse, hover/focus disclosure, session opening, and composer focus.
- Run screenshots and video only inside the capped isolated repository harness.
- Compare against the approved vertical slice, not an unrelated branch.
- Stop before broader rollout until the user explicitly approves the evidence.
