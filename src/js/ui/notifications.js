// ---- Toast notifications ----
// kind: "approved", "rejected" or "info" (colours the stripe and title).
function showToast(kind, title, message) {
  const container = document.getElementById("toastContainer");
  const toast = document.createElement("div");
  toast.className = `toast ${kind}`;

  const body = document.createElement("div");
  body.className = "toast-body";
  const titleEl = document.createElement("div");
  titleEl.className = `toast-title ${kind}`;
  titleEl.textContent = title;
  const msg = document.createElement("div");
  msg.className = "toast-msg";
  msg.textContent = message;
  body.appendChild(titleEl);
  body.appendChild(msg);

  const closeBtn = document.createElement("button");
  closeBtn.className = "toast-close";
  closeBtn.innerHTML = "&times;";
  closeBtn.addEventListener("click", () => toast.remove());

  toast.appendChild(body);
  toast.appendChild(closeBtn);
  container.appendChild(toast);
  // Toasts for the bell fade on their own; it keeps the notification anyway.
  setTimeout(() => toast.remove(), 8000);
}

let reviewChannel = null;
let notificationChannel = null;

function subscribeToReviewUpdates(userId) {
  if (reviewChannel) {
    client.removeChannel(reviewChannel);
  }
  if (notificationChannel) {
    client.removeChannel(notificationChannel);
  }
  reviewChannel = client
    .channel(`review-updates-${userId}`)
    .on(
      "postgres_changes",
      { event: "UPDATE", schema: "public", table: "documents", filter: `user_id=eq.${userId}` },
      (payload) => handleReviewUpdate(payload, "documents")
    )
    .on(
      "postgres_changes",
      { event: "UPDATE", schema: "public", table: "timesheets", filter: `user_id=eq.${userId}` },
      (payload) => handleReviewUpdate(payload, "timesheets")
    )
    .subscribe();
  // New notifications (the bell): written by the database for reviews, deals, paystubs and announcements.
  // Their own channel, so a table missing from the realtime publication above can't stop them.
  notificationChannel = client
    .channel(`notifications-${userId}`)
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${userId}` },
      (payload) => handleNewNotification(payload.new)
    )
    .subscribe();
}

function handleReviewUpdate(payload, bucket) {
  const oldStatus = payload.old ? payload.old.status : null;
  if (payload.new.status === oldStatus) return;
  // Keep the employee's own list in sync; the toast comes from the notification.
  loadList(bucket, bucket, true);
}

// ---- Notification bell ----
let ntItems = [];
const ntBellBtn = document.getElementById("ntBellBtn");
const ntPanel = document.getElementById("ntPanel");

const NT_ICON = {
  announcement: '<path d="M3 11v2a1 1 0 0 0 1 1h2l5 4V6L6 10H4a1 1 0 0 0-1 1zM15.5 8.5a5 5 0 0 1 0 7"/>',
  ok: '<circle cx="12" cy="12" r="9"/><path d="M8 12l3 3 5-6"/>',
  bad: '<circle cx="12" cy="12" r="9"/><path d="M9 9l6 6M15 9l-6 6"/>',
  pen: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  cash: '<rect x="3" y="6" width="18" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/>',
};
function ntTone(kind) {
  if (kind === "announcement") return "announcement";
  if (/rejected|returned/.test(kind)) return "bad";
  if (/approved|countersigned|onboarded/.test(kind)) return "ok";
  if (kind === "paystub") return "cash";
  if (/^timesheet/.test(kind)) return "clock";
  return "pen";
}

function ntAgo(iso) {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

async function loadNotifications() {
  if (!currentCompany) return;
  const { data, error } = await client
    .from("notifications")
    .select("id, kind, title, body, view, read_at, created_at")
    .eq("company_id", currentCompany.id)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) return;
  ntItems = data || [];
  renderNotifications();
}

function renderNotifications() {
  const unread = ntItems.filter((n) => !n.read_at).length;
  const countEl = document.getElementById("ntCount");
  countEl.textContent = unread > 9 ? "9+" : String(unread);
  countEl.classList.toggle("hidden", !unread);
  ntBellBtn.setAttribute("aria-label", unread ? `Notifications, ${unread} unread` : "Notifications");
  document.getElementById("ntMarkAllBtn").classList.toggle("hidden", !unread);
  document.getElementById("ntEmpty").classList.toggle("hidden", ntItems.length > 0);

  document.getElementById("ntList").innerHTML = ntItems.map((n) => {
    const tone = ntTone(n.kind);
    const long = n.kind === "announcement" && n.body.length > 140;
    return `<li class="nt-item${n.read_at ? "" : " unread"}${long ? " clamp" : ""}" data-id="${n.id}">
      <span class="nt-icon nt-${tone}"><svg viewBox="0 0 24 24" aria-hidden="true">${NT_ICON[tone]}</svg></span>
      <button type="button" class="nt-main">
        <span class="nt-title">${n.kind === "announcement" ? '<span class="nt-tag">Announcement</span>' : ""}${escHtml(n.title)}</span>
        ${n.body ? `<span class="nt-body">${escHtml(n.body)}</span>` : ""}
        <span class="nt-time">${ntAgo(n.created_at)}${long ? ' · <span class="nt-more">Show more</span>' : ""}</span>
      </button>
    </li>`;
  }).join("");
}

function handleNewNotification(n) {
  if (!currentCompany || n.company_id !== currentCompany.id) return;
  if (ntItems.some((x) => x.id === n.id)) return;
  ntItems.unshift(n);
  renderNotifications();
  const tone = ntTone(n.kind);
  showToast(tone === "bad" ? "rejected" : tone === "ok" ? "approved" : "info", n.title, n.body.length > 160 ? n.body.slice(0, 157) + "…" : n.body);
  // Lists that the change affects.
  if (n.view === "portal:deals" && typeof loadMyDeals === "function") loadMyDeals();
  if (n.view === "portal:pay") loadList("paystubs", "paystubs", false);
  if (/^document_/.test(n.kind)) loadList("documents", "documents", true);
  if (/^timesheet_(approved|rejected)$/.test(n.kind)) loadList("timesheets", "timesheets", true);
  if (n.view === "dept" && typeof loadDeptTimesheets === "function") loadDeptTimesheets();
  if (n.view === "admin:countersign" && typeof loadPendingCountersignatures === "function") loadPendingCountersignatures();
  if (n.view === "admin:timesheets") loadAdminList("timesheets", "timesheets");
  if (n.view === "admin:employees" && isAdmin) { loadEmployees(); loadOutstanding(); }
  if (isAdmin && typeof loadAdminOverview === "function") loadAdminOverview();
}

async function markNotificationsRead(ids) {
  const now = new Date().toISOString();
  ntItems.forEach((n) => { if (!n.read_at && (!ids || ids.includes(n.id))) n.read_at = now; });
  renderNotifications();
  await client.rpc("mark_notifications_read", { p_ids: ids || null });
}

// Where clicking a notification goes.
function openNotificationView(view) {
  if (!view) return;
  const [tab, sub] = view.split(":");
  if (tab === "portal") { switchTab("portal"); if (sub) showPortalView(sub); }
  else if (tab === "dept" && !tabDeptBtn.classList.contains("hidden")) { switchTab("dept"); loadDeptTimesheets(); }
  else if (tab === "admin" && isAdmin) {
    switchTab("admin");
    const target = { countersign: "countersignList", timesheets: "adminTimesheetsList", documents: "adminDocumentsList", employees: "employeesList", invites: "pendingInvitesList", outstanding: "outList" }[sub];
    if (target) expandPanelOf(document.getElementById(target));
  } else return;
  window.scrollTo({ top: 0 });
}

function setNotificationPanel(open) {
  ntPanel.classList.toggle("hidden", !open);
  ntBellBtn.setAttribute("aria-expanded", String(open));
  if (open) {
    renderNotifications();   // refresh the "5m ago" times
    loadNotifications();
  }
}

ntBellBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  setNotificationPanel(ntPanel.classList.contains("hidden"));
});
document.getElementById("ntMarkAllBtn").addEventListener("click", () => markNotificationsRead(null));
document.getElementById("ntList").addEventListener("click", (e) => {
  const li = e.target.closest(".nt-item");
  if (!li) return;
  const n = ntItems.find((x) => x.id === li.dataset.id);
  if (!n) return;
  if (!n.read_at) markNotificationsRead([n.id]);
  // Long announcements open up in place; everything else takes you to where it happened.
  if (li.classList.contains("clamp")) { li.classList.remove("clamp"); li.querySelector(".nt-more").remove(); return; }
  if (n.view) { setNotificationPanel(false); openNotificationView(n.view); }
});
document.addEventListener("click", (e) => {
  if (!ntPanel.classList.contains("hidden") && !e.target.closest("#ntWrap")) setNotificationPanel(false);
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !e.defaultPrevented && !ntPanel.classList.contains("hidden")) {
    setNotificationPanel(false);
    ntBellBtn.focus();
  }
});
