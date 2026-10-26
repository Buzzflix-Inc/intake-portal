// ---- Crew departments & roles (used by the invite form) ----
const DEPARTMENTS = {
  "Production": ["Executive Producer", "Producer", "Line Producer", "Production Manager", "Production Coordinator", "Production Secretary", "Production Assistant", "Script Supervisor"],
  "Accounting": ["Production Accountant", "1st Assistant Accountant", "2nd Assistant Accountant", "Payroll Accountant", "Accounting Clerk", "Accounting Coordinator", "Accounting Assistant"],
  "Direction": ["Director", "1st Assistant Director", "2nd Assistant Director", "2nd 2nd Assistant Director"],
  "Camera": ["Director of Photography", "Camera Operator", "1st Assistant Camera (Focus Puller)", "2nd Assistant Camera (Clapper Loader)", "DIT (Digital Imaging Technician)", "Steadicam Operator", "Drone Operator"],
  "Grip & Electric": ["Gaffer", "Best Boy Electric", "Electrician", "Key Grip", "Best Boy Grip", "Grip", "Dolly Grip"],
  "Sound": ["Production Sound Mixer", "Boom Operator", "Sound Utility"],
  "Art Department": ["Production Designer", "Art Director", "Set Decorator", "Set Dresser", "Props Master", "Props Assistant", "Construction Coordinator", "Scenic Painter"],
  "Costume & Wardrobe": ["Costume Designer", "Costume Supervisor", "Wardrobe Stylist", "Set Costumer"],
  "Hair & Makeup": ["Key Makeup Artist", "Makeup Artist", "SFX Makeup Artist", "Key Hair Stylist", "Hair Stylist"],
  "Locations": ["Location Manager", "Assistant Location Manager", "Location Scout"],
  "Transportation": ["Transportation Coordinator", "Driver", "Picture Car Coordinator"],
  "Catering & Craft Service": ["Caterer", "Craft Service"],
  "Post-Production": ["Editor", "Assistant Editor", "VFX Supervisor", "Colorist", "Sound Editor", "Composer"],
  "Social Media": ["Social Media Manager", "Social Media Coordinator", "Content Creator", "Community Manager", "Photographer (Stills)", "EPK / BTS Videographer", "Publicist"],
  "Talent": ["Actor", "Stunt Coordinator", "Stunt Performer", "Background Performer"]
};

function populateInviteDeptAndRole() {
  const deptSel = document.getElementById("inviteDeptSelect");
  const roleSel = document.getElementById("inviteCrewRoleSelect");
  if (!deptSel || !roleSel) return;

  if (!deptSel.dataset.filled) {
    Object.keys(DEPARTMENTS).forEach((dept) => {
      const opt = document.createElement("option");
      opt.value = dept;
      opt.textContent = dept;
      deptSel.appendChild(opt);
    });
    deptSel.dataset.filled = "1";
    deptSel.addEventListener("change", fillCrewRoleOptions);
  }
  fillCrewRoleOptions();
}

function fillCrewRoleOptions() {
  const deptSel = document.getElementById("inviteDeptSelect");
  const roleSel = document.getElementById("inviteCrewRoleSelect");
  roleSel.innerHTML = "";
  (DEPARTMENTS[deptSel.value] || []).forEach((role) => {
    const opt = document.createElement("option");
    opt.value = role;
    opt.textContent = role;
    roleSel.appendChild(opt);
  });
}
populateInviteDeptAndRole();
