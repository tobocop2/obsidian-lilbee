const GH = "https://raw.githubusercontent.com/tobocop2/obsidian-lilbee/gh-pages/demos/";
const groups = [
  {
    id: "what-it-is",
    heading: "What it is",
    reels: [
      { id: "what-is-lilbee", name: "what_is_lilbee", title: "What is lilbee", desc: "Add lilbee's own README to your library and watch it ingest, then ask “what is lilbee in one sentence?” and get a cited answer straight from the README. The citation opens it at the source." },
      { id: "first-start", name: "first_start", title: "First run: install to first cited answer", desc: "Brand-new to lilbee, on a fresh vault. Install it from the community plugin store, walk the setup wizard (pick a chat model and an embedder, run the first sync), then ask a question and get a cited answer from your own notes, with a click-through to the source. The whole onboarding in one take." },
      { id: "ask", name: "add", title: "Ask &amp; cite your documents", desc: "Add a PDF from the command palette, watch the Task Center index it, then ask a question and get a cited answer. Click the citation and the source preview opens at the exact page." },
    ],
  },
  {
    id: "feed-it-anything",
    heading: "Feed it anything",
    reels: [
      { id: "scanned-pdf", name: "vision", title: "Scanned PDFs, read by OCR", desc: "A scanned, image-only PDF read by a local vision model. The Task Center streams the OCR page by page, then a cited answer reads the support number and publisher straight off the scanned cover, a detail only OCR could surface." },
      { id: "crawl", name: "crawl", title: "Crawl the web into your vault", desc: "Crawl a Wikipedia page into your vault and ask it a question, then jump from the citation straight to the cited section of the rendered source." },
    ],
  },
  {
    id: "models-managed-for-you",
    heading: "Models, managed for you",
    reels: [
      { id: "catalog", name: "catalog", title: "Model catalog", desc: "Browse the model catalog without leaving Obsidian: Chat, Embed, Vision, and Rerank tabs, each pulled live from Hugging Face Hub. Models that won't run on your hardware are flagged before you pull." },
      { id: "download", name: "download_model", title: "Download and use a model", desc: "Search the catalog for a small chat model, watch the download stream start to finish in the Task Center, then activate it, switch to Chat mode, and use it, the full pull-and-use loop without leaving Obsidian." },
      { id: "models", name: "models", title: "The model rail, role by role", desc: "The chat rail carries four roles, each its own model: chat writes the answers, embedding indexes your notes, vision reads scanned PDFs, reranking sharpens the results. Hover each pill to see what it does, then flip between Search (answers from your vault, cited) and Chat (the model directly, no retrieval)." },
    ],
  },
  {
    id: "bring-your-own-models",
    heading: "Bring your own models",
    reels: [
      { id: "ollama", name: "ollama", title: "Use your Ollama models for both roles", desc: "Already running Ollama? Point lilbee at it and pick one of its models for embedding and another for chat, straight from the catalog's Hosted tab, so it's clear Ollama powers both halves of the pipeline. Add the Crown Victoria manual, watch it index in the Task Center, then ask a question and get a cited answer served end to end by Ollama." },
      { id: "lmstudio", name: "lmstudio", title: "Use your LM Studio models for both roles", desc: "The same as the Ollama reel, with LM Studio's local server. Pick its embedder and chat model from the Hosted tab, index the manual, and get a cited answer powered end to end by LM Studio." },
      { id: "gemini", name: "gemini", title: "Bring your own frontier key", desc: "lilbee also drives hosted frontier models when you bring your own key. Open the catalog's Hosted tab, pick a free-tier Gemini model for chat, and keep embedding local. The answer comes from Gemini and still cites your own manual, with a click-through to the page." },
    ],
  },
  {
    id: "answer-quality",
    heading: "Answer quality",
    reels: [
      { id: "multipart", name: "multipart", title: "Multi-part questions, each fact cited", desc: "One prompt, two unrelated facts from different sections of a manual, a bulb part number and the engine's firing order. A local model answers both in a single reply and cites each one to the page it came from." },
      { id: "rerank", name: "rerank", title: "Reranking, before and after", desc: "The same question asked twice, with reranking off and then on, against eight short build notes. The note that holds the fix is written around the cause (voltage sag, cable gauge), not the question's keywords, so plain vector search ranks it just out of the top results and the model gives the wrong fix. Turn reranking on and a cross-encoder re-scores the candidates by true relevance, promotes that note into context, and the answer corrects itself. Both answers stay on screen, so you see the before and after." },
    ],
  },
  {
    id: "set-up-and-tune",
    heading: "Set up &amp; tune",
    reels: [
      { id: "settings", name: "settings", title: "Settings", desc: "50+ settings: search depth, reranking, sampling, parsers, the wiki. Sane defaults; tune the moment you want to." },
      { id: "tour", name: "tour", title: "Tour: the palette as an async control surface", desc: "Fire a crawl, a file add, and a model download back to back without waiting, watch all three run at once in the Task Center, then ask the just-crawled page a cited question." },
    ],
  },
];
const toc = document.getElementById("tutorial-toc");
const list = document.getElementById("demos");
for (const g of groups) {
  toc.insertAdjacentHTML("beforeend", '<li class="toc-group"><a href="#' + g.id + '">' + g.heading + "</a></li>");
  const groupHeading = document.createElement("h2");
  groupHeading.className = "tutorial-group";
  groupHeading.id = g.id;
  groupHeading.innerHTML = '<a href="#' + g.id + '">' + g.heading + "</a>";
  list.appendChild(groupHeading);
  for (const d of g.reels) {
    toc.insertAdjacentHTML("beforeend", '<li><a href="#' + d.id + '">' + d.title + "</a></li>");
    const sec = document.createElement("section");
    sec.className = "tutorial-section";
    sec.id = d.id;
    sec.innerHTML =
      '<h3><a href="#' + d.id + '">' + d.title + "</a></h3>" +
      "<p>" + d.desc + "</p>" +
      '<div class="tutorial-clip"><video src="' + GH + d.name + '.webm" controls loop muted autoplay playsinline preload="metadata"></video></div>';
    list.appendChild(sec);
  }
}
