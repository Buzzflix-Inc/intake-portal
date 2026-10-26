// ---- Toast notifications ----
function showToast(kind, label, fileName) {
  // kind: "approved" or "rejected"
  const container = document.getElementById("toastContainer");
  const toast = document.createElement("div");
  toast.className = `toast ${kind}`;

  const body = document.createElement("div");
  body.className = "toast-body";
  const title = document.createElement("div");
  title.className = `toast-title ${kind}`;
  title.textContent = kind === "approved" ? "Approved" : "Rejected";
  const msg = document.createElement("div");
  msg.className = "toast-msg";
  msg.textContent = `Your ${label} "${fileName}" was ${kind}.`;
  body.appendChild(title);
  body.appendChild(msg);

  const closeBtn = document.createElement("button");
  closeBtn.className = "toast-close";
  closeBtn.innerHTML = "&times;";
  closeBtn.addEventListener("click", () => toast.remove());

  toast.appendChild(body);
  toast.appendChild(closeBtn);
  container.appendChild(toast);
  // No auto-dismiss — stays until the user closes it.
}

let reviewChannel = null;

function subscribeToReviewUpdates(userId) {
  if (reviewChannel) {
    client.removeChannel(reviewChannel);
  }
  reviewChannel = client
    .channel(`review-updates-${userId}`)
    .on(
      "postgres_changes",
      { event: "UPDATE", schema: "public", table: "documents", filter: `user_id=eq.${userId}` },
      (payload) => handleReviewUpdate(payload, "documents", "document")
    )
    .on(
      "postgres_changes",
      { event: "UPDATE", schema: "public", table: "timesheets", filter: `user_id=eq.${userId}` },
      (payload) => handleReviewUpdate(payload, "timesheets", "timesheet")
    )
    .subscribe();
}

function handleReviewUpdate(payload, bucket, label) {
  const oldStatus = payload.old ? payload.old.status : null;
  const newStatus = payload.new.status;
  if (newStatus === oldStatus) return;
  if (newStatus !== "approved" && newStatus !== "rejected") return;

  const fileName = payload.new.file_path.split("/").pop();
  showToast(newStatus, label, fileName);

  // Keep the employee's own list in sync too
  loadList(bucket, bucket, true);
}
