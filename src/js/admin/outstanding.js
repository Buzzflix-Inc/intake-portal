// ---- Outstanding items & reminders ----
async function loadOutstanding() {
  const listEl = document.getElementById("outList"), emptyEl = document.getElementById("outEmpty");
  if (!listEl) return;
  listEl.innerHTML = "";
  const [inv, docs, recs, profs] = await Promise.all([
    client.from("company_invites").select("email, full_name, requested_documents").eq("used", true),
    client.from("documents").select("user_id, doc_type, status"),
    client.from("esign_records").select("user_id, type, status"),
    client.from("profiles").select("user_id, email"),
  ]);
  const uid = new Map((profs.data || []).map((p) => [String(p.email || "").toLowerCase(), p.user_id]));
  const rows = [];
  for (const i of inv.data || []) {
    const id = uid.get(String(i.email || "").toLowerCase());
    if (!id) continue;
    const got = new Set((docs.data || []).filter((d) => d.user_id === id && d.status !== "rejected" && d.doc_type).map((d) => d.doc_type));
    const missing = realDocs(i.requested_documents).filter((d) => !got.has(d));
    const unsigned = (recs.data || []).filter((r) => r.user_id === id && r.status === "awaiting_signature").map((r) => (r.type === "safety" ? "Safety acknowledgment" : "Deal memo"));
    const rejected = (docs.data || []).filter((d) => d.user_id === id && d.status === "rejected").length;
    if (missing.length || unsigned.length) rows.push({ i, missing, unsigned, rejected });
  }
  emptyEl.classList.toggle("hidden", rows.length > 0);
  rows.forEach(({ i, missing, unsigned, rejected }) => {
    const li = document.createElement("li");
    const items = [...missing.map((m) => "Upload: " + m), ...unsigned.map((u) => "Sign: " + u)];
    const left = document.createElement("span"); left.className = "info";
    left.innerHTML = `<span class="name">${escHtml(i.full_name || i.email)}</span><span class="email">${escHtml(items.join(" · "))}${rejected ? ` · ${rejected} rejected upload${rejected === 1 ? "" : "s"}` : ""}</span>`;
    const right = document.createElement("span"); right.className = "actions";
    const msg = `Hi ${i.full_name || ""},\n\nA quick reminder: we still need the following from you on the HR Intake Portal:\n${items.map((x) => "- " + x).join("\n")}\n\nYou can finish these at ${PORTAL_URL}\n\nThanks!`;
    const copy = document.createElement("button"); copy.className = "preview-link"; copy.textContent = "Copy reminder";
    copy.addEventListener("click", () => {
      const done = () => { copy.textContent = "Copied"; setTimeout(() => { copy.textContent = "Copy reminder"; }, 1600); };
      try { navigator.clipboard.writeText(msg).then(done, () => window.prompt("Copy this reminder:", msg)); } catch (_) { window.prompt("Copy this reminder:", msg); }
    });
    const mail = document.createElement("a"); mail.className = "preview-link"; mail.textContent = "Email";
    mail.href = `mailto:${encodeURIComponent(i.email)}?subject=${encodeURIComponent("Reminder: items needed on the HR Intake Portal")}&body=${encodeURIComponent(msg)}`;
    right.appendChild(copy); right.appendChild(mail);
    li.appendChild(left); li.appendChild(right); listEl.appendChild(li);
  });
}
document.getElementById("outRefreshBtn").addEventListener("click", loadOutstanding);
