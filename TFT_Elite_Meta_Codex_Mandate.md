# TFT Elite Meta — Codex Build Mandate

## Mission

Build a **finished, polished, Windows-local TFT analytics application** that the user can install and use immediately on day one.

The app analyzes **real ranked TFT games from elite players** using the official Riot API, builds composition and meta statistics from those games, and presents them in a **high-quality desktop dashboard** inspired by the visual density and UX quality of Mobalytics.

This is a **small local product**, not an enterprise platform. Keep the implementation focused, professional, performant, maintainable, and compact. Do not turn it into a 40-step architecture exercise.

---

## Non-negotiable product outcome

The final user experience must be:

1. Install through a proper Windows installer.
2. Launch from a normal app shortcut/button.
3. No terminal, Node, Python, dependency installation, or source-code interaction for normal use.
4. The launcher starts the local server, verifies the configured port is available, chooses another high free port if needed, and opens the app automatically in the default browser.
5. Default preferred port: `18473`.
6. If the app/server is already running, launching again should open the existing instance instead of spawning nonsense.
7. The app exposes a polished **Close Server** control, and closing the launcher must also provide a clean shutdown path.
8. The app is **desktop-only**. Do not spend scope on mobile responsiveness beyond avoiding catastrophic breakage.
9. Spanish is the default language.
10. A beautiful EN/ES control in the top UI switches the entire app language, including UI strings and Riot metadata where official localized data exists.
11. The app must be usable with real data before Codex declares the project complete.

---

# Data source and acquisition

Use the **official Riot TFT API** and official/static Riot metadata/assets where appropriate.

Do not make a scraped third-party website the core dependency.

## Regions

Analyze these regions:

- EUW
- NA
- KR
- BR
- LAN
- LAS

The primary view combines all regions into one global bucket.

The UI must also allow cheap filtering by individual region.

## Player/game sampling

For every refresh:

1. Start from the **top 200 Challenger players per region**.
2. Analyze only **ranked TFT** games.
3. Include only games from:
   - the **current patch**, and
   - the **last 5 days**.
4. Target **2,000 valid player-game observations per region**.
5. If the top 200 do not provide enough valid observations, continue downward through the highest available competitive ladder population until the target can reasonably be filled.
6. Multiple sampled players in the same Riot match count as **separate observations**, because each player's final board is meaningful independently.
7. The implementation must deduplicate API retrieval work where possible while preserving those separate player-board observations.

Target nominal global sample: approximately **12,000 observations**.

The acquisition pipeline must respect Riot rate limits, cache aggressively, avoid unnecessary repeated calls, and be robust against intermittent failures.

---

# API key UX

The user does not currently have a Riot API key.

The app must include a polished local Settings flow where the user can paste/update the Riot API key.

Requirements:

- Never hardcode or commit the key.
- Store it only locally using an appropriate safe local mechanism.
- During development, Codex must **ask the user for a real Riot key at the point when real integration testing becomes necessary**.
- Codex must not pretend mocks are sufficient for final acceptance.
- If Riot rejects an expired/invalid key during normal use, present a clean popup/modal to paste a replacement and resume the interrupted refresh.
- Do not force the user to edit `.env` files manually in normal operation.

---

# Refresh behavior

Data updates happen **only when the user presses Update**.

No automatic periodic refresh is required.

While refreshing:

- Keep the previous completed dataset fully visible and usable.
- Show polished real-time progress:
  - region state,
  - progress per region,
  - players scanned,
  - observations collected,
  - API/retry status where useful,
  - current stage of processing.
- Avoid freezing the UI.

The ingestion pipeline must implement strong retry/backoff/rate-limit handling and checkpoint/recovery behavior.

If a refresh cannot fully complete, do **not** use a dumb fixed percentage threshold to decide whether it is publishable.

Instead, implement an adaptive, documented **data sufficiency / stability assessment**, considering such things as:

- ranking stability as more observations arrive,
- diversity of compositions/traits,
- regional coverage,
- obvious sampling bias,
- whether additional batches materially change the conclusions.

A degraded snapshot may be published only when the collected data are still reasonably informative. The UI must clearly disclose incomplete coverage.

---

# Current patch / future sets

The app must automatically detect the **current TFT patch and set**.

Do not hardcode the current set's champions, traits, items, augments, or other gameplay entities into the domain logic.

Build adapters/metadata handling so that future sets and patch changes can be incorporated automatically as far as Riot data allows.

The architecture must be ready for future first-class categories comparable to Augments without requiring a rewrite of the app.

---

# Composition detection

A composition is grouped primarily by its **dominant active synergies/traits**.

Example:

`Onda Espacial 5 · Bastión 4`

Two boards are considered the same base composition when they share the same dominant primary synergy with the same active level and the same dominant secondary synergy with the same active level.

## Determining trait dominance

Do **not** rank traits only by the number of units contributing to them.

Trait relevance must consider a sensible combination of:

- achieved/active trait tier,
- number of units contributing to the trait,
- item investment on the champions contributing to that trait.

Example:

A board with Vanguard 4 where only one Vanguard has items should not automatically classify Vanguard as the main trait if the real board identity is Sniper 2 and both Snipers are fully itemized.

Codex has freedom to implement a statistically sensible, testable formula for dominant-trait selection.

Document the method clearly.

---

# Composition variants

Within a base composition:

- The **main/default variant** is the exact champion lineup that occurs most frequently.
- Other exact champion lineups appear underneath as collapsed variants ordered by frequency.
- Star levels do **not** create different variants.

Everything is collapsed by default and expandable for deeper inspection.

---

# Champion presentation inside a comp

Show official champion portraits.

Order champions inside composition detail by **average number of equipped items**, descending.

The intent is that carries and primary tanks naturally rise to the front without hardcoding roles.

For each champion show:

- official portrait,
- most common final star level prominently on/near the portrait,
- full star distribution in detailed breakdown,
- average equipped-item count,
- top 10 most prevalent final equipped items,
- item prevalence percentages,
- sample size and useful derived metrics.

Star distribution example:

`1★ 4% · 2★ 89% · 3★ 7%`

Show exactly what the player had equipped **at the end of the game**, including any item types Riot reports.

---

# Items

Items must be highly visual.

Use official item imagery/assets where permitted/available.

Every item icon must have a polished hover tooltip with useful information such as:

- item name,
- description/effect,
- prevalence,
- sample size,
- relevant placement / win metrics,
- context-specific percentages.

The composition champion breakdown shows the **10 most prevalent items per champion**, ordered from most common to least common.

---

# Augments

Augments do **not** split a composition into separate compositions.

Within every comp, provide a large collapsed Augments section ordered primarily by prevalence.

Each augment should expose:

- icon,
- name,
- prevalence,
- sample size,
- average placement,
- Top 4 rate,
- win rate,
- useful tooltip detail.

Also create a dedicated **Augments** tab.

In that tab, rank augments using the same prevalence-vs-performance weighting concept used for comps.

Expanding an augment must show which compositions use it best, with context metrics.

---

# Global score and slider

The main ranking uses a statistically sensible normalized score combining:

- prevalence / usage,
- performance / average lobby placement.

The user controls the tradeoff using a prominent slider.

Default:

**50% prevalence / 50% performance**

Changing the slider must recalculate ranking **in real time** without refetching Riot data.

At the prevalence-heavy end, the ranking should favor the established meta.

At the performance-heavy end, the user should be able to surface niche/high-performing strategies.

Do not impose an arbitrary minimum sample-size cutoff as the primary protection against tiny-sample outliers.

Instead, prevalence itself must influence the score naturally.

Always expose sample size so the user can judge statistical fragility.

The formula must be documented in a clear tooltip/help element.

---

# Home tab

Home is the primary current-meta dashboard.

Everything starts visually compact/collapsed.

Each composition summary should surface, cleanly:

- automatic composition name from dominant traits,
- dominant trait icons/levels,
- main champion portraits,
- modal star levels,
- meta score,
- prevalence,
- sample size,
- average placement,
- Top 4 rate,
- win rate,
- compact 1st–8th placement distribution.

Expanding reveals:

- exact variants,
- champion detail,
- items,
- star-level breakdowns,
- augments,
- supporting statistics,
- underlying source evidence.

Avoid information overload while keeping depth one click away.

---

# Search

Home includes fast local search/filtering.

Search must evaluate composition contents across:

- champions,
- items,
- traits/synergies,
- augments.

Results update immediately from local indexed data.

---

# History tab

Every successful/publishable refresh creates a persistent local snapshot.

Do **not** automatically delete historical snapshots.

The user controls retention.

History must provide:

1. Browseable prior snapshots.
2. Comparison with the previous refresh.
3. Trend summaries such as:
   - biggest ranking increases,
   - biggest ranking decreases,
   - prevalence gains/losses,
   - placement changes,
   - Top 4 changes,
   - win-rate changes,
   - newly appearing compositions,
   - compositions disappearing from the sample.
4. Elegant drill-down from a trend to the relevant comp and snapshot comparison.
5. A powerful **Delete History** control with explicit confirmation to prevent accidental destruction.

Design this as an actual useful trend-analysis screen, not a dump of old rows.

---

# Dedicated analytics tabs

In addition to Home and History, implement:

## Augments

Rank by weighted prevalence/performance.

Expand to show:
- best compositions,
- usage,
- sample size,
- placement,
- Top 4,
- win rate,
- placement distribution.

## Items

Rank items by weighted prevalence/performance.

Expand to show:
- best champions using the item,
- best compositions using the item,
- prevalence,
- sample size,
- placement,
- Top 4,
- win rate,
- placement distribution.

## Champions

Rank champions using the same weighting model.

Expand to show:
- best items,
- best comps,
- final star distributions,
- prevalence,
- sample size,
- placement,
- Top 4,
- win rate,
- placement distribution.

## Synergies

Rank traits/synergies with the same weighting model.

Expand to show:
- best active levels,
- champions,
- compositions,
- items,
- prevalence/performance statistics.

These tabs should derive from the same local observations and aggregation layer. Do not make unnecessary Riot requests just to populate different views.

---

# Evidence / traceability

Every major aggregated entity must allow elegant drill-down into the **real observations behind the number**.

Examples:

From a comp/champion/item/augment, the user must be able to inspect the source games/boards that contributed to its statistics.

Expose useful evidence such as:

- player identity,
- region,
- placement,
- game date/time,
- final board,
- star levels,
- items,
- augments,
- relevant traits,
- Riot match identifier where available.

This must be a polished UI/UX flow, not a raw debug table.

---

# Visual design

The app is personal-use and should closely emulate the **visual language and UX quality of Mobalytics**:

- dark premium gaming dashboard,
- dense but legible information,
- compact cards/rows,
- strong hierarchy,
- elegant navigation,
- excellent iconography,
- polished hover/focus states,
- tasteful gold/accent treatment,
- rich tooltips,
- clear expandable detail,
- high information density without visual chaos.

Do not copy Mobalytics logos, trademarks, proprietary branding, or protected artwork.

Use Riot-provided/allowed game imagery where appropriate.

Codex has broad design freedom, but the finished result must feel intentionally designed, not like a generic admin template.

No silly UI defects, overlapping controls, broken tooltips, misaligned icons, accidental horizontal scroll, unreadable text, or obvious unfinished states.

---

# Performance

Design for excellent local responsiveness from day one.

Requirements:

- avoid repeated expensive recomputation,
- cache API responses appropriately,
- persist normalized observations locally,
- precompute/recompute aggregates efficiently,
- index local search/filter fields,
- keep slider re-ranking local and fast,
- virtualize or paginate genuinely large evidence lists if necessary,
- avoid memory leaks and runaway background work,
- never block the main UI with heavy processing.

Use SQLite or another sensible embedded/local database if appropriate.

Codex may choose the stack.

---

# Architecture

Codex has freedom to choose technologies, but the design must remain professional and compact.

Prefer clear boundaries similar to:

`Riot ingestion -> normalization/domain -> aggregation/scoring -> persistence -> local API/service -> UI`

Requirements:

- separation of concerns,
- small focused modules,
- typed contracts where useful,
- centralized configuration,
- reusable UI components,
- explicit domain models,
- no giant god classes/files,
- no duplicated scoring logic across tabs,
- no current-set business logic buried in UI components,
- migrations/versioning for persisted local schema,
- easy extension for future set mechanics/categories.

Use established design patterns only where they reduce real complexity.

Do not create abstractions merely to look sophisticated.

---

# Testing

Testing is mandatory but must be **lean and high-value**.

Cover the critical logic:

- score normalization/weighting,
- composition grouping,
- dominant-trait selection,
- variants,
- champion item ranking,
- star distributions,
- Riot response normalization,
- current patch/set filtering,
- aggregation correctness,
- snapshot persistence/history diffs,
- retry/backoff/rate-limit behavior,
- degraded-data sufficiency/stability logic,
- key invalidation/replacement,
- at least one or two critical end-to-end/smoke flows.

Do not bloat the repository with pointless tests.

No testing getters for sport.

Final completion requires tests passing **and** a successful real-data run using the user's Riot key.

---

# Windows packaging

Produce a proper Windows installer.

The installed product must include everything required to run.

Normal user operation must not require separately installing:

- Node,
- Python,
- database servers,
- CLI tools,
- package managers.

Installer expectations:

- clean installation,
- app shortcut,
- reliable launcher,
- clean uninstall,
- persistent local user data stored in an appropriate user-data location,
- uninstall behavior should not unexpectedly destroy user history without a clear policy/choice.

---

# Local server / ports

Preferred port: `18473`.

At launch:

1. Check whether it is actually available.
2. If occupied, choose another safe high port automatically.
3. Clearly track the actual port internally.
4. Open the correct localhost URL in the default browser.
5. Never fail merely because the preferred port is occupied.

Avoid colliding with the user's many other local projects/services.

---

# Repository governance

Before implementation, establish the following project-control files at the repository root:

## `INIT.md`

Stable mission, scope, architecture guardrails, product principles, and non-negotiable acceptance requirements.

It should remain concise and durable.

## `AGENTS.md`

Rules for any coding agent working in the repository:

- read `INIT.md` and `CURRENT.md` before doing work,
- obey scope boundaries,
- preserve architecture,
- do not expose secrets,
- do not replace real integration with mocks for final acceptance,
- keep repository clean,
- prefer focused changes,
- test relevant behavior,
- document meaningful architectural decisions,
- avoid unnecessary dependencies,
- avoid generated cruft,
- never claim completion without evidence.

## `CURRENT.md`

This is the live handoff/resume document.

Keep it continuously updated with:

- current phase,
- completed work,
- next concrete actions,
- known issues,
- blockers,
- user decisions,
- current branch/commit/checkpoint where useful,
- real-data integration status,
- tests/validation status.

`CURRENT.md` must be good enough that a fresh agent can continue the project without asking the user to repeat context.

Update it at every meaningful milestone.

---

# User interruption policy

Work autonomously.

Do **not** bother the user during normal implementation with:

- low-value progress updates,
- permission to do obvious next steps,
- architecture trivia,
- routine implementation choices,
- dependency choices,
- minor visual decisions,
- repeated confirmations.

Interrupt the user only when genuinely useful:

1. A real secret/credential is required — especially the Riot API key for real integration.
2. A true blocker cannot be resolved locally.
3. A major irreversible product decision is required and was not already specified.
4. A meaningful visual/product approval point would materially benefit from the user's judgment.
5. There is a genuinely exciting user-visible milestone worth showing, such as the first real-data dashboard working end-to-end.

When asking the user something, ask **one concise question at a time** and explain why the input is necessary.

Do not create artificial approval gates.

---

# Development execution

Codex should execute the build end-to-end, not merely produce a plan.

Recommended high-level order:

1. Inspect the repo/environment.
2. Create `INIT.md`, `AGENTS.md`, and `CURRENT.md`.
3. Choose the simplest maintainable local architecture.
4. Implement domain models and ingestion boundaries.
5. Implement local persistence and metadata handling.
6. Build Riot API integration with rate-limit/retry/checkpoint logic.
7. Build real aggregation/scoring.
8. Build the polished desktop UI.
9. Implement Home/History/Augments/Items/Champions/Synergies.
10. Implement evidence drill-down.
11. Implement localization.
12. Implement Windows launcher/installer.
13. Add lean critical tests.
14. Ask the user for the Riot API key when real integration validation becomes necessary.
15. Run a real refresh against current Riot data.
16. Fix all material correctness, visual, performance, and UX defects found.
17. Produce installer and final verification evidence.
18. Update `CURRENT.md` to a clean final state.

This is guidance, not a requirement to narrate 18 stages to the user.

---

# Final acceptance gate

Do **not** declare the project finished until all of the following are true:

- Windows installation succeeds cleanly.
- App launches without terminal interaction.
- Local server starts reliably on a verified free port.
- Browser opens automatically.
- Spanish default works.
- EN/ES switch works.
- Riot key can be entered in-app.
- Invalid/expired key replacement UX works.
- A real Riot API refresh has completed.
- Current patch + last-5-days filtering works.
- Multi-region sampling works.
- Real compositions are generated from real boards.
- Composition grouping is sensible.
- Slider ranking works instantly.
- Home is polished and compact.
- Variants/champions/items/augments expand correctly.
- Official/relevant portraits/icons render correctly.
- Tooltips are polished and informative.
- History snapshots persist.
- Trend comparison works.
- Augments tab works.
- Items tab works.
- Champions tab works.
- Synergies tab works.
- Region filtering works.
- Search across champions/items/traits/augments works.
- Evidence drill-down reaches real source observations.
- Retry/rate-limit behavior is robust.
- App remains usable while refreshing.
- Performance is good with the expected dataset.
- Critical automated tests pass.
- No secrets exist in the repo.
- Installer is produced.
- No obvious visual/UX defects remain.
- `INIT.md`, `AGENTS.md`, and `CURRENT.md` are complete and accurate.

The result must be a **finished local product**, not a prototype awaiting another development round.

