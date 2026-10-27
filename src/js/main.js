// ---- Session bootstrap ----

async function showApp() {
  authView.classList.add("hidden");
  appView.classList.add("hidden");

  const { data: { user } } = await client.auth.getUser();
  if (!user) { authView.classList.remove("hidden"); return; }
  currentUserId = user.id;
  currentUserEmail = user.email;

  // First-time steps (onboarding.js): Terms, then create or join a production.
  await requireTerms(user);
  const [{ data: mine }, { data: isSuper }] = await Promise.all([client.rpc("my_companies"), client.rpc("is_superadmin")]);
  if (!(mine || []).length && !isSuper) { showCreateOrJoin(); return; }

  await requireMfa(user);

  // An admin whose own production isn't set up yet carries on with the setup.
  const active = (mine || []).find((c) => c.active);
  if (active && active.role === "admin") {
    const { data: co } = await client.from("companies").select("id, setup_done").eq("id", active.id).maybeSingle();
    if (co && !co.setup_done) { runSetupWizard(co.id); return; }
  }
  await offerPasskeyOnce(user);
  obHide();
  appView.classList.remove("hidden");
  loadMyCompanies();

  const { data: roleRow } = await client
    .from("user_roles")
    .select("role")
    .eq("user_id", user.id)
    .single();

  isAdmin = roleRow && roleRow.role === "admin";

  // Branding and the background photo first, so the page looks right
  // while everything else is still loading.
  await loadCompanyBranding();

  if (isAdmin) {
    tabAdminBtn.classList.remove("hidden");
    document.getElementById("inviteCrewBtn").classList.remove("hidden");
    await loadProfileMap();
    populateEmployeeSelect();
    populateDeptHeadForm();
    await loadDepartmentHeads();
    await loadTemplates();
    await loadApprovalChain();
    loadAdminList("documents", "documents");
    loadAdminList("timesheets", "timesheets");
    loadAdminPaystubs();
    loadPendingInvites();
    loadEmployees();
    loadOutstanding();
    loadPendingCountersignatures();
  }

  await loadMyRequestedDocuments();
  loadMyDeals();

  loadSuperadminStatus();
  buildPeriodOptions();
  await loadMyHeadDepartments();
  if (myHeadDepartments.length) loadDeptTimesheets();
  document.getElementById("ntComposeBtn").classList.toggle("hidden", !canAnnounce());
  loadAnnouncements();
  loadNotifications();

  loadList("documents", "documents", true);
  loadList("timesheets", "timesheets", true);
  loadList("paystubs", "paystubs", false);

  subscribeToReviewUpdates(user.id);

  if (isAdmin) renderGettingStarted();
  // Straight after setting up a production: offer to invite the crew.
  let afterSetup = false;
  try { afterSetup = sessionStorage.getItem("intake_after_setup") === "1"; sessionStorage.removeItem("intake_after_setup"); } catch (_) {}
  if (afterSetup && isAdmin) openInviteModal({ welcome: true });
}

client.auth.getSession().then(({ data: { session } }) => {
  if (session) showApp();
});
