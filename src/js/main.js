// ---- Session bootstrap ----

async function showApp() {
  authView.classList.add("hidden");
  appView.classList.remove("hidden");

  const { data: { user } } = await client.auth.getUser();
  appView.classList.add("hidden");
  await requireMfa(user);
  appView.classList.remove("hidden");
  currentUserId = user.id;
  currentUserEmail = user.email;
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

  loadList("documents", "documents", true);
  loadList("timesheets", "timesheets", true);
  loadList("paystubs", "paystubs", false);

  subscribeToReviewUpdates(user.id);
}

client.auth.getSession().then(({ data: { session } }) => {
  if (session) showApp();
});
