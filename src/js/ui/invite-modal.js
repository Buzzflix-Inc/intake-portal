// ---- Invite crew pop-up, opened from the header (admins) or the Invites section ----
const inviteModal = document.getElementById("inviteModalOverlay");
let inviteModalReturn = null;
function openInviteModal() {
  inviteModalReturn = document.activeElement;
  document.getElementById("inviteMsg").innerHTML = "";
  inviteModal.classList.remove("hidden");
  document.body.classList.add("modal-open");
  setTimeout(() => document.getElementById("inviteNameInput").focus(), 30);
}
function closeInviteModal() {
  if (inviteModal.classList.contains("hidden")) return;
  inviteModal.classList.add("hidden");
  document.body.classList.remove("modal-open");
  if (inviteModalReturn && inviteModalReturn !== document.body && inviteModalReturn.focus) inviteModalReturn.focus();
  else if (inviteModal.contains(document.activeElement)) document.activeElement.blur();
}
// Close it and jump to Admin Review › Invites, where the new invite can be copied or emailed.
function showInvitesList() {
  closeInviteModal();
  switchTab("admin");
  expandPanelOf(document.getElementById("pendingInvitesList"));
}
document.querySelectorAll("[data-invite-open]").forEach((b) => b.addEventListener("click", openInviteModal));
document.getElementById("inviteModalClose").addEventListener("click", closeInviteModal);
document.getElementById("inviteCancelBtn").addEventListener("click", closeInviteModal);
inviteModal.addEventListener("click", (e) => {
  if (e.target === inviteModal) closeInviteModal();
  if (e.target.closest("[data-show-invites]")) showInvitesList();
});
document.addEventListener("keydown", (e) => {
  // A dropdown picker inside the form handles Escape first and marks it handled.
  if (e.key === "Escape" && !e.defaultPrevented) closeInviteModal();
});
