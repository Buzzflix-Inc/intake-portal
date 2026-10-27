// ---- Admin: Overview on My Portal (crew onboarding progress) ----
// Admins land here: where the crew are in onboarding, with a link through to Employees.
const STAGE_OF = {
  uploaded: "Uploading documents",
  approved: "Documents to approve",
  signed: "Forms to sign",
  countersigned: "Forms to countersign",
};

async function loadAdminOverview() {
  if (!isAdmin) return;
  const [progress, invites] = await Promise.all([
    client.rpc("crew_onboarding"),
    client.from("company_invites").select("email, full_name, used"),
  ]);
  const nameByEmail = new Map((invites.data || []).map((i) => [i.email, i.full_name || i.email]));
  const firstInvite = (invites.data || [])[0];
  if (firstInvite) document.getElementById("overviewTitle").innerHTML = `Latest invite: ${firstInvite.full_name}`;
  const who = (uid) => { const em = String(profileMap.get(uid) || "").toLowerCase(); return nameByEmail.get(em) || em || "Someone"; };
  renderCrewProgress(progress.data || [], invites.data || [], who);
}

function renderCrewProgress(rows, invites, who) {
  const crew = rows.filter((r) => (r.steps || []).length > 1);
  const notJoined = invites.filter((i) => !i.used);
  const done = crew.filter((r) => r.steps.every((s) => s.done));
  const going = crew.filter((r) => !r.steps.every((s) => s.done));
  const total = crew.length + notJoined.length;
  const body = document.getElementById("crewProgressBody");
  if (!total) {
    body.innerHTML = `<p class="empty" style="text-align:left;padding:0;">No crew yet. <button type="button" class="ob-link" data-invite-open>Invite your crew</button> to start onboarding.</p>`;
    body.querySelector("[data-invite-open]").addEventListener("click", () => openInviteModal());
    return;
  }

  // Where everyone is: the first step they haven't done yet.
  const stages = new Map([["Invited, not signed in", notJoined.length]]);
  Object.values(STAGE_OF).forEach((s) => stages.set(s, 0));
  going.forEach((r) => { const s = STAGE_OF[r.steps.find((x) => !x.done).key]; stages.set(s, (stages.get(s) || 0) + 1); });
  stages.set("Fully onboarded", done.length);
  const pct = (n) => (total ? (n / total) * 100 : 0);

  going.sort((a, b) => a.steps.filter((s) => s.done).length / a.steps.length - b.steps.filter((s) => s.done).length / b.steps.length);
  body.innerHTML = `
    <div class="cp-head"><b>${done.length} of ${total}</b> crew fully onboarded</div>
    <div class="cp-bar" role="img" aria-label="${done.length} fully onboarded, ${going.length} in progress, ${notJoined.length} not signed in">
      <i class="cp-done" style="width:${pct(done.length)}%"></i><i class="cp-going" style="width:${pct(going.length)}%"></i>
    </div>
    <div class="cp-legend"><span><i class="cp-done"></i>Fully onboarded ${done.length}</span><span><i class="cp-going"></i>In progress ${going.length}</span><span><i></i>Not signed in ${notJoined.length}</span></div>
    <ul class="cp-stages">${[...stages].map(([label, n]) => `<li class="${n ? "" : "zero"}"><span>${escHtml(label)}</span><b>${n}</b></li>`).join("")}</ul>
    ${going.length ? `<h3 class="cp-sub">In progress</h3><ul class="file-list cp-people">${going.slice(0, 6).map((r) => `<li><span class="info"><span class="name">${escHtml(who(r.user_id))}</span>${onboardingBarHtml(r.steps)}</span></li>`).join("")}</ul>` : ""}
    <button type="button" class="btn-secondary" id="cpSeeAll" data-nobusy>See everyone in Employees</button>`;
  body.querySelector("#cpSeeAll").addEventListener("click", () => openNotificationView("admin:employees"));
}

document.getElementById("pvOverviewLink").addEventListener("click", loadAdminOverview);
tabPortalBtn.addEventListener("click", () => { if (isAdmin) loadAdminOverview(); });
