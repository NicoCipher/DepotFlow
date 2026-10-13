# DepotFlow UI Quality

DepotFlow is an operational tool, not a marketing website.

The interface should feel deliberately designed around a drinks wholesaler's daily work.

## Avoid

- decorative gradients
- neon/rainbow palettes
- glowing/radial background effects
- dot-grid decoration
- glassmorphism/liquid glass
- excessive shadows
- excessive rounded cards
- bento-grid layouts used for decoration
- emojis as primary UI icons
- decorative terminal/code imagery
- sparkle icons
- unnecessary animation
- hover-only affordances
- generic SaaS dashboard patterns
- artificial marketing copy
- UI elements added merely to make a screen feel full

## Prefer

- restrained neutral surfaces
- one primary brand/accent colour
- strong contrast
- clear typography
- real drink/product imagery
- information hierarchy based on shop tasks
- large touch targets
- simple separators rather than card-everything layouts
- clear active/disabled/out-of-stock states
- meaningful empty/loading/error states
- visible feedback after actions
- natural Nigerian naira formatting
- designs that work first at mobile width

## Important

Do not ban a component, font or icon library merely because it is commonly used by AI-generated applications.

Use a familiar convention when it improves usability.

Every design choice must answer:

"What does this help the shop owner do?"

## Product differentiation principle

**Less work. Fewer mistakes. More control.**

Win on the small, repeated details of daily work rather than simply copying another product or collecting more features. Our interface should reduce the work needed to finish a real depot task, avoid costly errors, and make records easy to verify.

- **Less work:** Show the next action immediately. Keep routine actions one obvious choice away, use useful defaults, and do not request information already known.
- **Fewer mistakes:** Distinguish *money actually received* from *sales including unpaid amounts*; distinguish customer empties owed from physical empties on hand. Make outcomes and exceptional situations explicit. Do not obscure a failed or uncertain save.
- **More control:** Operators can review and correct before committing, resume paused work, open real records, and verify what changed.
- **No feature theater:** Do not add decorative numbers, fake recent activity, unnecessary charts, persuasive copy, or placeholder data to fill space.
- **Truth before visual polish:** Never invent counts, rates, profit, cash-on-hand, or financial trends without verified data and definitions.
- **Fast to act:** Prioritize time to the first real action as well as total page-loading time, especially on poor connections.

## Usability acceptance checks

For each important workflow, test whether a first-time operator can complete it without instructions, the number of actions and time required, where they hesitate, and whether the saved result is correct.

For Home specifically:

- Record a Sale is immediately recognisable; a paused sale is easy to resume when one exists.
- Money collected, total sales value, and money owed have distinct, plain meanings.
- Receive Stock, Record Payment, Count Stock, and customer empties are reachable without opening a hidden menu.
- Every issue links to an action or relevant record; zero and no-issue states are accurate.
- At 320/375px, 768px, 1024px, and 1440px, there is no sideways scrolling, clipped amount, tiny link, or excessive unused space.
- Keyboard focus, contrast, touch targets, reduced-motion behaviour, and text zoom remain usable.
- No existing stock, sales, money, empties or permissions logic is altered for a cosmetic redesign.
