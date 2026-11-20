---
name: atlas-parcel-diagram
description: Prepare a Turkish, mobile-readable educational parcel diagram for an Atlas carousel. Invoke for çekme mesafesi, parsel sınırı, yapı yaklaşma sınırı, or TAKS/KAKS when a diagram would clarify the relationship.
disable-model-invocation: true
---

# Atlas arsa şeması

Prepare one reviewable diagram for the requested slide. Use the topic in
`$ARGUMENTS`. Preserve the approved carousel copy and card order.

1. Read the draft and apply `fact-source-grounding` to labels and numbers.
   For a teaching example, use fictional geometry and print
   **Temsili şema · Ölçekli değildir** on the diagram. Keep actual parcel
   geometry, distances and development rights out of the teaching example.
   For a real parcel, request the missing official plan or imar document
   before drawing any parcel-specific boundary or dimension.
2. For a setback diagram, start from
   [assets/cekme-mesafesi.svg](assets/cekme-mesafesi.svg). Keep the parcel
   outline, road side and dashed building approach boundary distinguishable
   by line style and label. Explain their relationship in one sentence.
   For a TAKS/KAKS diagram, choose a footprint versus floor-area visual
   and use verified inputs or explicitly hypothetical numbers.
3. Match the approved Atlas palette from
   `src/lib/ai/image/templates/brand.ts`. Keep labels short and high
   contrast. Provide self-contained SVG with a title and description.
   Render a PNG preview locally with the existing
   `src/lib/ai/image/resvg-renderer.ts` when available. Inspect the preview
   at about 360 px wide for cropped labels, overlap and legibility.
4. Return the SVG, preview if rendered, suggested card and one-sentence
   caption for review. Apply `atlas-editorial-quality-gate` to the complete
   carousel before calling it ready. Keep this a manual pilot with the
   existing carousel pipeline and publishing approval flow.
