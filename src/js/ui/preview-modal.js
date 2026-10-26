// ---- Preview modal ----
const previewModal = document.getElementById("previewModal");
const previewContent = document.getElementById("previewContent");

function openPreview(url, fileName) {
  document.getElementById("previewFileName").textContent = fileName;
  previewContent.innerHTML = "";

  const ext = fileName.split(".").pop().toLowerCase();
  const imageExts = ["png", "jpg", "jpeg", "gif", "webp"];

  if (ext === "pdf") {
    const iframe = document.createElement("iframe");
    iframe.src = url;
    previewContent.appendChild(iframe);
  } else if (imageExts.includes(ext)) {
    const img = document.createElement("img");
    img.src = url;
    previewContent.appendChild(img);
  } else {
    const p = document.createElement("p");
    p.className = "preview-unsupported";
    p.textContent = "Preview isn't available for this file type — use Download instead.";
    previewContent.appendChild(p);
  }

  previewModal.classList.remove("hidden");
}

function closePreview() {
  previewModal.classList.add("hidden");
  previewContent.innerHTML = "";
}

document.getElementById("previewCloseBtn").addEventListener("click", closePreview);
previewModal.addEventListener("click", (e) => {
  if (e.target === previewModal) closePreview();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closePreview();
});
