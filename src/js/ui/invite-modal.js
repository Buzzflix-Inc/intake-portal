// ---- Invite crew pop-up, opened from the header (admins) or the Invites section ----
const inviteModal = document.getElementById("inviteModalOverlay");
let inviteModalReturn = null;
// { welcome: true } right after someone sets up a production: same form, friendlier heading.
function openInviteModal(opts) {
  const welcome = !!(opts && opts.welcome);
  document.getElementById("inviteModalTitle").textContent = welcome ? "Invite your crew" : "Invite crew";
  document.getElementById("inviteModalSub").textContent = welcome
    ? "Your production is ready. Invite people now, or later from the Invite crew button at the top. They'll get a sign-in link and fill in their own details."
    : "Just the basics. They'll fill in their own details (phone, address, ID…) the first time they sign in, and it auto-fills their forms.";
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
document.querySelectorAll("[data-invite-open]").forEach((b) => b.addEventListener("click", () => openInviteModal()));
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
