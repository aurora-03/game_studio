# Material catalog and workflow kits

The workspace displays compact material cover cards. Opening a card reveals its name, structured design fields, description, bound files, and `@` references. Both the canvas and the game board use the same material data. Editing remains automatic-save; opening details does not move nodes or replace an existing graph.

## Actual covers in references

`src/materials.ts` resolves a cover from the node's ordered `assetIds` (and legacy `assetId`) against the current project's live asset inventory. The first bound image is displayed in the autocomplete menu, selected reference chip, material card, and director reference picker. Audio or document-only materials use a semantic icon. Missing/deleted files never reuse a cached image, arbitrary node URL, or another project's file. Renaming a material keeps its stable node reference; same-name materials retain separate node and asset IDs.

Covers are presentation of the actual uploaded file. Selecting `@` continues to store the exact node ID and UTF-16 text range; image thumbnails do not replace reference metadata or fabricate a generated image. The generation path still receives the structured node design and actual file references.

## Asset categories

The asset library combines project, material category, file type, and text search. Material categories are Characters, Scenes, Props, Audio, References, and Unassigned. Category membership is derived from actual node bindings in the asset's owning project. A file reused by two character nodes appears once; a file shared by a character and scene appears in both category filters but still once in the combined grid. Counts explain this overlap. Archive/trash projects are excluded. Search covers the filename, project, bound material titles, descriptions, and specification values.

New uploads without a binding are Unassigned. Binding or removing a file immediately changes its categories when project state refreshes. File type remains separate from semantic role: a character may use a text design document or audio reference, and an audio material may also have an uploaded artwork cover.

## Prepared workflows

Every published workflow includes a creative brief, four distinct material directions, one output acceptance checklist, and five connections into the output. English is the default; Chinese creation uses the corresponding authored material kit. References are intentionally supplied by the creator rather than represented by invented uploads.

- **Neon Courier:** capped speed ramp, safe obstacles, landing-reset double jump, distance score and energy cells.
- **Orbit Guard:** auto fire, controlled enemy waves, three lives, contact invulnerability, and offscreen cleanup.
- **Mosslight Trail:** measured platform gaps, five stars, a three-star gate, coyote time and buffered jump.
- **Color Memory:** six pairs, symbols plus colors, delayed mismatch locking, keyboard input, and restart timer cleanup. This matches the published memory demo.
- **Pocket Harvest:** three explicit crop costs/yields/times, plot upgrades, achievable milestones and no repeated harvest.
- **Adventure Starter:** editable explorer, reachable three-token map, return-to-camp victory, avoidable hazard and full reset.

The workflow library first shows the material kit. Clicking a material opens its detailed direction, while creating the workflow copies its localized design into real editable project nodes. The additive workflow command and measured tidy action use spacing appropriate for compact cards. Existing user node positions, files, games, and versions remain intact.

## Verification

`node --test tests/materials/catalog.test.js tests/materials/templates.test.js` checks actual cover ordering and replacement, deleted/legacy bindings, same-name identity, cross-project isolation, category deduplication and combined search, six complete English/Chinese kits, real generation-context inclusion, localized creation, and preservation of supplied user graphs. These checks use actual data structures and do not claim that a fixture image is AI generated. Browser verification of the integrated production bundle is performed separately before publishing.
