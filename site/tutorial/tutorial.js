const GH = "https://raw.githubusercontent.com/tobocop2/obsidian-lilbee/gh-pages/demos/";
const groups = [
  {
    id: "what-it-is",
    heading: "What it is",
    reels: [
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
      { id: "crawl-site", name: "crawl_site", title: "Crawl a whole site", desc: "Crawl a whole article and every page it links to, one link deep, into an empty vault. Hundreds of pages stream into the explorer as they index, then one multi-part question that only makes sense across the whole site gets a single cited answer, with reranking pulling the best chunks from across the crawl and each fact a click from its source page." },
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
    id: "every-gpu",
    heading: "Every GPU in the machine",
    reels: [
      { id: "what-is-lilbee", name: "what_is_lilbee", title: "What is lilbee", desc: "Add the plugin's own source code to your library on an Apple M1 Pro and watch the Task Center embed it beside the live GPU placement view, then ask “what is lilbee for Obsidian?” and get a cited answer. The citation opens the README at the source." },
      { id: "gpu-placement", name: "gpu-placement", title: "A 235B model split across three A100s", desc: "The same story on server hardware: right-click a source folder into lilbee on a three-A100 box, watch every file embed across all three GPUs with the placement matrix live, then ask how the split works and get a grounded, cited answer from a 235B model spread over all three cards." },
      { id: "gpu-placement-manual", name: "gpu-placement-manual", title: "Manual placement, previewed before it loads", desc: "Draw the layout yourself: pin each role to the cards you choose, step the embedder up to one replica per GPU, preview the fit, and apply it live while the fleet rebuilds. Ask for a layout that can't fit and the editor names the exact shortfall instead of failing at load time." },
      { id: "bigmodel", name: "bigmodel", title: "235 billion parameters, thinking out loud", desc: "One grounded question to a 235B model split across three A100s: the reasoning streams live, the answer lands in three cited bullets, and the thinking scrolls on the record before the cited source opens." },
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
