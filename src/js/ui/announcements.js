// ---- Announcements: admins post to the production or chosen departments, heads to their own ----
// Posting fans out to everyone's notification bell (post_announcement in the database).
const announceModal = document.getElementById("announceModalOverlay");
let announceModalReturn = null;

function canAnnounce() { return isAdmin || myHeadDepartments.length > 0; }

function renderAnnounceAudience() {
  const aud = document.getElementById("announceAudience");
  const grid = document.getElementById("announceDepts");
  const depts = isAdmin ? Object.keys(DEPARTMENTS) : myHeadDepartments;
  if (isAdmin) {
    aud.innerHTML = `
      <label class="checkbox-label"><input type="radio" name="announceTo" value="all" checked /> Everyone at the production</label>
      <label class="checkbox-label"><input type="radio" name="announceTo" value="depts" /> Only certain departments</label>`;
  } else {
    aud.innerHTML = depts.length > 1
      ? `<p class="desc">Pick which of your departments this goes to.</p>`
      : `<p class="desc">Goes to everyone in ${escHtml(depts[0])}.</p>`;
  }
  grid.innerHTML = depts.map((d) =>
    `<label class="checkbox-label"><input type="checkbox" value="${escHtml(d)}"${isAdmin ? "" : " checked"} /> ${escHtml(d)}</label>`
  ).join("");
  grid.classList.toggle("hidden", isAdmin || depts.length < 2);
}

function openAnnounceModal() {
  if (!canAnnounce()) return;
  announceModalReturn = document.activeElement;
  document.getElementById("announceTitleInput").value = "";
  document.getElementById("announceBodyInput").value = "";
  document.getElementById("announceMsg").innerHTML = "";
  renderAnnounceAudience();
  announceModal.classList.remove("hidden");
  document.body.classList.add("modal-open");
  setTimeout(() => document.getElementById("announceTitleInput").focus(), 30);
}
function closeAnnounceModal() {
  if (announceModal.classList.contains("hidden")) return;
  announceModal.classList.add("hidden");
  document.body.classList.remove("modal-open");
  if (announceModalReturn && announceModalReturn !== document.body && announceModalReturn.focus && !announceModalReturn.closest("#ntPanel")) announceModalReturn.focus();
  else if (announceModal.contains(document.activeElement)) document.activeElement.blur();
}

document.querySelectorAll("[data-announce-open]").forEach((b) => b.addEventListener("click", () => {
  setNotificationPanel(false);
  openAnnounceModal();
}));
document.getElementById("announceModalClose").addEventListener("click", closeAnnounceModal);
document.getElementById("announceCancelBtn").addEventListener("click", closeAnnounceModal);
announceModal.addEventListener("click", (e) => { if (e.target === announceModal) closeAnnounceModal(); });
document.getElementById("announceAudience").addEventListener("change", (e) => {
  if (e.target.name === "announceTo") document.getElementById("announceDepts").classList.toggle("hidden", e.target.value !== "depts");
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !e.defaultPrevented) closeAnnounceModal();
});

document.getElementById("announceSendBtn").addEventListener("click", async () => {
  const msgEl = document.getElementById("announceMsg");
  const btn = document.getElementById("announceSendBtn");
  const title = document.getElementById("announceTitleInput").value.trim();
  const body = document.getElementById("announceBodyInput").value.trim();
  const toAll = isAdmin && (document.querySelector('input[name="announceTo"]:checked') || {}).value === "all";
  const depts = [...document.querySelectorAll("#announceDepts input:checked")].map((c) => c.value);
  if (!title) { msgEl.innerHTML = `<div class="msg error">Add a title.</div>`; return; }
  if (!toAll && !depts.length) { msgEl.innerHTML = `<div class="msg error">Pick at least one department.</div>`; return; }

  btn.disabled = true;
  const { error } = await client.rpc("post_announcement", { p_title: title, p_body: body, p_departments: toAll ? null : depts });
  btn.disabled = false;
  if (error) { msgEl.innerHTML = `<div class="msg error">Couldn't post: ${escHtml(error.message)}</div>`; return; }
  closeAnnounceModal();
  showToast("approved", "Announcement posted", toAll ? "Sent to everyone at the production." : `Sent to ${depts.join(", ")}.`);
  loadAnnouncements();
});

function announceAudienceLabel(a) {
  return a.departments && a.departments.length ? a.departments.join(", ") : "Everyone";
}

// Manage Crew lists every announcement; Department Review lists the head's own.
async function loadAnnouncements() {
  if (!currentCompany || !canAnnounce()) return;
  const { data, error } = await client
    .from("announcements")
    .select("id, author_id, author_name, title, body, departments, recipient_count, created_at")
    .eq("company_id", currentCompany.id)
    .order("created_at", { ascending: false })
    .limit(100);
  const rows = data || [];
  if (isAdmin) renderAnnouncementList("admin", rows, error);
  if (myHeadDepartments.length) renderAnnouncementList("dept", rows.filter((a) => a.author_id === currentUserId), error);
}

function renderAnnouncementList(prefix, rows, error) {
  const listEl = document.getElementById(prefix + "AnnounceList");
  const msgEl = document.getElementById(prefix + "AnnounceMsg");
  msgEl.innerHTML = error ? `<div class="msg error">${escHtml(error.message)}</div>` : "";
  document.getElementById(prefix + "AnnounceEmpty").classList.toggle("hidden", rows.length > 0);
  listEl.innerHTML = "";
  rows.forEach((a) => {
    const li = document.createElement("li");
    const when = new Date(a.created_at).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
    const by = prefix === "admin" && a.author_id !== currentUserId && a.author_name ? ` · by ${escHtml(a.author_name)}` : "";
    li.innerHTML = `<span class="info">
      <span class="name">${escHtml(a.title)}</span>
      <span class="email">${escHtml(announceAudienceLabel(a))} · ${a.recipient_count} ${a.recipient_count === 1 ? "person" : "people"} · ${when}${by}</span>
      ${a.body ? `<span class="an-body">${escHtml(a.body)}</span>` : ""}
    </span>`;
    const right = document.createElement("span");
    right.className = "actions";
    const rm = document.createElement("button");
    rm.className = "remove-link";
    rm.textContent = "Delete";
    rm.addEventListener("click", async () => {
      if (!window.confirm("Delete this announcement? It's removed from everyone's notifications.")) return;
      rm.disabled = true;
      const { error: delErr } = await client.from("announcements").delete().eq("id", a.id);
      msgEl.innerHTML = delErr ? `<div class="msg error">Couldn't delete: ${escHtml(delErr.message)}</div>` : "";
      loadAnnouncements();
    });
    right.appendChild(rm);
    li.appendChild(right);
    listEl.appendChild(li);
  });
}
