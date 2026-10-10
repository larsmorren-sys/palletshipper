# Warehouse League badge artwork

Created with the built-in image generation tool from the approved Warehouse League comparison-sheet concept. Transparent backgrounds are preserved. WebP encoding uses quality 90 without resizing the generated artwork.

Assets:

- `public/badges/warehouse-league-1.webp`: gold forklift, rank 1.
- `public/badges/warehouse-league-2.webp`: silver manual pallet jack, rank 2.
- `public/badges/warehouse-league-3.webp`: bronze wheelbarrow, rank 3.

The same artwork is displayed at 34px beside the account name, 52px in ranking notifications and 96px on the podium (72px on narrow screens). Other rankings keep their star.

## Generation prompt set

Each badge used the following prompt with the substitutions listed below, the approved comparison sheet as the referenced image, and `transparent_background: true`:

> Edit target: the reference comparison sheet. Extract and recreate ONLY the TOP ROW Warehouse League rank {rank} badge as one isolated production-ready app badge. Preserve that selected badge's design: circular chunky {metal} metallic rim, dark green inner field, {vehicle} centrally with bold recognizable forms, subtle laurel sprigs at sides, and small attached {metal} round rank medallion at bottom with exact digit '{rank}'. Use the TOP ROW circular badge, never the shield or hexagonal variants. Match the reference faithfully, clean polished game achievement art, sharp silhouette, strong vehicle readability at thumbnail size. SINGLE badge centered filling about 90 percent of a square canvas. Genuinely transparent background outside the badge, no background color or external cast shadow, no sheet, no captions, no title, no other badges. Keep all edges and bottom medallion visible. The only text is '{rank}'.

| rank | metal | vehicle |
| --- | --- | --- |
| 1 | gold | yellow and black forklift truck |
| 2 | silver | orange manual pallet jack with a tall loop handle and low long forks |
| 3 | bronze | green single-wheel wheelbarrow |
