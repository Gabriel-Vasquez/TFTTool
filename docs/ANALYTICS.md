# Analytics method

## Observation and prevalence

One observation is one sampled player's final board in one ranked match. Two sampled players in the same match remain separate observations. Entity prevalence is the share of boards containing that entity; duplicate copies on one board count once, so prevalence stays between 0% and 100%.

## Composition identity

TFTTool groups final boards by recurring, item-invested three-champion cores. The number of target archetypes scales with the current champion roster and is bounded between 12 and 32. Initial cores are selected from frequent distinct board signatures, then observations are assigned iteratively using a deterministic similarity score: 58% core coverage, 32% wider board overlap, and 10% active-trait agreement. Empty or duplicate clusters are removed. This keeps flex-unit and star-level variations under one recognizable archetype while retaining exact champion lineups as expandable variants.

The three representative champions are the units with the strongest combination of board presence and average equipped items inside that archetype. Champion and item prevalence are board-based, so duplicate copies or duplicate item identifiers on one final board count once.

Champion builds use a separate slot-frequency pipeline. Individual-item prevalence still counts an item at most once per champion board, while representative slots, two-item combinations, and full loadouts retain real multiplicity. Consequently, a supported build can display two or three copies of the same item without inflating the global Items ranking. The composition-scoped champion detail can re-rank individual items and representative slots between prevalence and observed placement performance. The default remains 100% prevalence; performance is the average placement of that archetype's boards where the champion carried that item or copy-specific slot, normalized only against the other eligible items shown for the same champion and archetype.

The most frequent exact lineup is the archetype's flagship. The first expanded row shows that reference once; every other displayed variant is expressed only as champions removed from and added to the flagship, avoiding repeated full-team lists.

## Set transitions

All snapshot creation, supported data-pack migration, and bundled-seed rebuilding call the same `analyzeCurrentSet` boundary. It selects the newest detected set and patch before invoking the unchanged clustering and aggregation pipeline. Observations from an older set can remain in history, but they cannot leak into the new set's archetype derivation. This makes future set changes automatically re-run the successful model against only the new set instead of carrying forward old archetype identities.

Trait labels use the active breakpoint from current-set static metadata, such as `Replicador 2`, rather than Riot's ordinal tier index. When static metadata is unavailable, TFTTool deterministically derives the observed minimum unit count for each active tier and never displays an ordinal as a breakpoint.

## Meta score

Prevalence is min-max normalized across the currently displayed comparison set. Raw average placement is independently min-max normalized and inverted, so a lower placement is better. The UI score is exactly:

`normalized prevalence × established-meta weight + normalized raw-placement performance × performance weight`

The two weights always sum to 100%. The default is 50/50, and the exact current split is displayed beside the slider. Re-ranking is immediate and local; moving the slider does not call Riot or recompute the snapshot.

## Team Interactions

Interaction analysis version 1 is derived during the same deterministic snapshot aggregation as archetypes. Participants are deduplicated by match and player identifier, then grouped by real shared `matchId`. No board is compared with a board from another lobby. When several players use the same archetype in one lobby, their placements are averaged first, so an archetype pair contributes exactly one statistical observation from that lobby instead of every possible participant pair.

For archetypes A and B, the raw head-to-head value is B's mean placement minus A's mean placement in each shared lobby. The model subtracts the expected A/B difference from each archetype's region-specific baseline placement. The remaining opponent-specific placement delta is averaged by lobby and shrunk toward zero by `n / (n + 16)`. Positive values mean A performed better than its normal strength would predict against B. The reciprocal B/A result is generated from the same pair aggregate with the exact opposite sign. At least eight shared lobbies are required for a matchup to enter Best/Worst summaries; the complete expansion still retains every opponent and identifies unsupported rows. This keeps global tier strength, multi-copy lobbies, region mix, and small samples from masquerading as matchup effects.

Counter Items are also opponent-conditioned. Each item is counted once per participant board even when two copies are equipped. For each holder archetype, region, and item, TFTTool builds its normal placement/Top 4/win baseline. A board facing target archetype B is compared with a leave-one-out version of that same contextual baseline; sparse regional contexts fall back to the holder-archetype/item baseline. Multiple holders of the same item in one lobby are averaged before aggregation, so that lobby contributes once for the item/B relationship. Placement uplift is shrunk by `n / (n + 20)`, and at least 12 shared lobbies plus 12 contextual boards are required. The result therefore measures how an item performed specifically when facing B relative to how that item normally performed on comparable holder archetypes, not global item popularity or a duplicate slot count.

Given identical observations, assignments, analysis versions, and configuration, matchup ordering, best/worst threes, and Counter Item ordering are stable. Riot Update, current-set reanalysis, bundled-seed migration, region filtering, and `.tftpack` import all invoke the same local pipeline; no AI or network request is part of interaction computation.

## Removed augment analytics

Augment navigation, ranking, and composition-level augment presentation are intentionally absent. Existing observation payloads remain untouched, including historical augment identifiers, so updates do not destroy source evidence or invalidate stored snapshots.

## Snapshot sufficiency

Publication considers observation volume, regional coverage, minimum-to-maximum regional sample balance, composition diversity, and top-composition concentration. An incomplete snapshot is never allowed to silently replace the previous completed dataset; when a degraded but informative snapshot is permitted, its reasons are displayed in the UI.

## Riot acquisition and recovery

The sampler treats Challenger and Grandmaster as the primary pool and admits Master only after the primary pool cannot fill the regional target. Every new observation records its tier and collection-time LP. When enlarging a still-current legacy snapshot, stored PUUIDs may be revalidated against the current Challenger/Grandmaster ladders; confirmed rows are marked as ladder-backfilled, while unconfirmed and Master rows are not used to pre-fill the primary pool. A fetched match is cached once per processed tier boundary and contributes a separate observation for every eligible participant in that match. Europe, Asia, and Americas routing groups run concurrently because [Riot enforces application limits per region](https://developer.riotgames.com/docs/portal); platforms sharing one routing cluster remain sequential. Retry timing follows Riot's `Retry-After` response, transient network failures use bounded exponential backoff, and regional progress is checkpointed every five scanned players.

After the first complete 4,000-per-region baseline, refreshes are incremental. The latest current-patch observations that are still inside the five-day window are reused; a bounded top-ladder scan asks Riot for match IDs after the newest retained game (with a one-minute overlap), and match details are requested only for IDs absent from the sample. New boards are merged and each region is trimmed to its newest 4,000 observations. A completed regional checkpoint remains resumable during the same refresh.
