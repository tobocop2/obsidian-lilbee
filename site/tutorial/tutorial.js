const GH = "https://raw.githubusercontent.com/tobocop2/obsidian-lilbee/gh-pages/demos/";
const demos = [
  { id: "what-is-lilbee", name: "what_is_lilbee", title: "What is lilbee", desc: "Add lilbee's own README to your library and watch it ingest, then ask “what is lilbee in one sentence?” and get a cited answer straight from the README. The citation opens it at the source." },
  { id: "ask", name: "add", title: "Ask &amp; cite your documents", desc: "Add a PDF from the command palette, watch the Task Center index it, then ask a question and get a cited answer. Click the citation and the source preview opens at the exact page." },
  { id: "crawl", name: "crawl", title: "Crawl the web into your vault", desc: "Crawl a Wikipedia page into your vault and ask it a question, then jump from the citation straight to the cited section of the rendered source." },
  { id: "scanned-pdf", name: "vision", title: "Scanned PDFs, read by OCR", desc: "A scanned, image-only PDF read by a local vision model. The Task Center streams the OCR page by page, then a cited answer reads the support number and publisher straight off the scanned cover, a detail only OCR could surface." },
  { id: "catalog", name: "catalog", title: "Model catalog", desc: "Browse the model catalog without leaving Obsidian: Chat, Embed, Vision, and Rerank tabs, each pulled live from Hugging Face Hub. Models that won't run on your hardware are flagged before you pull." },
  { id: "download", name: "download_model", title: "Download and use a model", desc: "Search the catalog for a small chat model, watch the download stream start to finish in the Task Center, then activate it, switch to Chat mode, and use it, the full pull-and-use loop without leaving Obsidian." },
  { id: "settings", name: "settings", title: "Settings", desc: "50+ settings: search depth, reranking, sampling, parsers, the wiki. Sane defaults; tune the moment you want to." },
  { id: "tour", name: "tour", title: "Tour: the palette as an async control surface", desc: "Fire a crawl, a file add, and a model download back to back without waiting, watch all three run at once in the Task Center, then ask the just-crawled page a cited question." },
];
const toc = document.getElementById("tutorial-toc");
const list = document.getElementById("demos");
for (const d of demos) {
  toc.insertAdjacentHTML("beforeend", '<li><a href="#' + d.id + '">' + d.title + "</a></li>");
  const sec = document.createElement("section");
  sec.className = "tutorial-section";
  sec.id = d.id;
  sec.innerHTML =
    "<h2>" + d.title + "</h2>" +
    "<p>" + d.desc + "</p>" +
    '<div class="tutorial-clip"><video src="' + GH + d.name + '.webm" controls loop muted autoplay playsinline preload="metadata"></video></div>';
  list.appendChild(sec);
}
