/**
 * models demo: the chat view's model rail surfaces all four roles — Chat,
 * Embed, Vision, Rerank — each as a labelled pill with its own picker. This
 * tape opens the chat view and hovers each pill (and the Search/Chat mode
 * toggle) so their tooltips surface, explaining what every role does and the
 * difference between the two answer modes.
 *
 * Nothing is changed on the server; it's a pure read of the rail, so it runs
 * fast and is safe to re-record any time.
 */
import { beat, hoverSelector, storyboard } from "../src/lib.ts";

// Pills and mode buttons carry an aria-label tooltip; match on its prefix.
const pill = (ariaPrefix: string) => `[aria-label^="${ariaPrefix}"]`;

export default storyboard("models", {
  window: [1400, 900],
  layout: "file-explorer-and-chat",
  preloadChatModel: true,
  clearChat: true,
  beats: [
    beat("Hover the Chat pill", hoverSelector(pill("Chat model")), {
      holdMs: 2000,
      caption: "The model rail surfaces all four roles. Chat writes the answers.",
    }),
    beat("Hover the Embed pill", hoverSelector(pill("Embedding model")), {
      holdMs: 2000,
      caption: "Embed indexes your notes so search can find them.",
    }),
    beat("Hover the Vision pill", hoverSelector(pill("Vision model")), {
      holdMs: 2000,
      caption: "Vision reads scanned, image-only PDFs. Optional — off until you pick one.",
    }),
    beat("Hover the Rerank pill", hoverSelector(pill("Reranker")), {
      holdMs: 2000,
      caption: "Rerank reorders search hits for sharper relevance. Also optional.",
    }),
    beat("Hover the Search mode", hoverSelector(pill("Search your vault")), {
      holdMs: 2000,
      caption: "Search answers from your vault and cites the sources.",
    }),
    beat("Hover the Chat mode", hoverSelector(pill("Chat with the model")), {
      holdMs: 2200,
      caption: "Chat talks to the model directly — no retrieval.",
    }),
  ],
});
