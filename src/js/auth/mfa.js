// ---- Two-step sign-in (authenticator app) required for admins and super admins ----
async function requireMfa(user) {
  // Only people who can reach admin screens need it.
  let privileged = false;
  try {
    const { data: r } = await client.from("user_roles").select("role").eq("user_id", user.id).maybeSingle();
    if (r && r.role === "admin") privileged = true;
    if (!privileged) {
      const { data: sa } = await client.from("superadmins").select("user_id").eq("user_id", user.id).maybeSingle();
      privileged = !!sa;
    }
  } catch (_) {}
  const { data: lvl } = await client.auth.mfa.getAuthenticatorAssuranceLevel();
  if (lvl && lvl.currentLevel === "aal2") return true;
  const { data: fl } = await client.auth.mfa.listFactors();
  const verified = ((fl && fl.totp) || []).filter((f) => f.status === "verified");
  if (!privileged && !verified.length) return true; // regular crew: no second step

  const gate = document.createElement("div");
  gate.id = "mfaGate";
  document.body.appendChild(gate);
  const out = async () => { gate.remove(); await client.auth.signOut(); location.reload(); };
  const card = (inner) => { gate.innerHTML = `<div class="mfa-card">${inner}</div>`; const so = gate.querySelector("[data-so]"); if (so) so.addEventListener("click", out); };

  return new Promise((resolve) => {
    const finish = () => { gate.remove(); resolve(true); };
    const challenge = (factorId) => {
      card(`<h2>Enter your code</h2><p>Open your authenticator app and type the 6-digit code for the HR Intake Portal.</p>
        <input id="mfaCode" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="000000" />
        <div id="mfaMsg"></div>
        <div class="mfa-row"><button class="btn-secondary" id="mfaGo">Verify</button><button type="button" class="remove-link" data-so>Sign out</button></div>`);
      const input = gate.querySelector("#mfaCode"), go = gate.querySelector("#mfaGo"), msg = gate.querySelector("#mfaMsg");
      input.focus();
      const submit = async () => {
        const code = input.value.trim();
        if (!/^\d{6}$/.test(code)) { msg.innerHTML = `<div class="msg error">Enter the 6-digit code.</div>`; return; }
        go.disabled = true;
        const { data: ch, error: e1 } = await client.auth.mfa.challenge({ factorId });
        if (e1) { go.disabled = false; msg.innerHTML = `<div class="msg error">${escHtml(e1.message)}</div>`; return; }
        const { error: e2 } = await client.auth.mfa.verify({ factorId, challengeId: ch.id, code });
        if (e2) { go.disabled = false; input.value = ""; input.focus(); msg.innerHTML = `<div class="msg error">That code didn't work. Check the time on your phone and try the next code.</div>`; return; }
        finish();
      };
      go.addEventListener("click", submit);
      input.addEventListener("keydown", (e) => { if (e.key === "Enter") submit(); });
    };
    const enroll = async () => {
      // Clear any half-finished setup first
      for (const f of ((fl && fl.all) || []).filter((x) => x.factor_type === "totp" && x.status !== "verified")) {
        try { await client.auth.mfa.unenroll({ factorId: f.id }); } catch (_) {}
      }
      const { data: en, error: e0 } = await client.auth.mfa.enroll({ factorType: "totp", friendlyName: "HR Intake Portal " + Date.now().toString(36) });
      if (e0) { card(`<h2>Set up two-step sign-in</h2><div class="msg error">${escHtml(e0.message)}</div><button type="button" class="remove-link" data-so>Sign out</button>`); return; }
      card(`<h2>Set up two-step sign-in</h2>
        <p>Admin accounts need a second step. Scan this with an authenticator app (Google Authenticator, Microsoft Authenticator, 1Password, Authy), then enter the 6-digit code it shows.</p>
        <div class="mfa-qr"><img alt="QR code" id="mfaQr" /></div>
        <p style="margin-bottom:6px;">Can't scan? Type this key into the app:</p>
        <code>${escHtml(en.totp.secret)}</code>
        <input id="mfaCode" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="000000" />
        <div id="mfaMsg"></div>
        <div class="mfa-row"><button class="btn-secondary" id="mfaGo">Turn on</button><button type="button" class="remove-link" data-so>Sign out</button></div>`);
      // Set via the DOM (not markup): the SVG contains quotes that break an HTML attribute.
      (() => {
        let q = String(en.totp.qr_code || "");
        if (/^data:image\/svg\+xml/i.test(q) && !/;base64,/i.test(q)) q = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(q.replace(/^data:image\/svg\+xml[^,<]*,/i, ""));
        gate.querySelector("#mfaQr").src = q;
      })();
      const input = gate.querySelector("#mfaCode"), go = gate.querySelector("#mfaGo"), msg = gate.querySelector("#mfaMsg");
      const submit = async () => {
        const code = input.value.trim();
        if (!/^\d{6}$/.test(code)) { msg.innerHTML = `<div class="msg error">Enter the 6-digit code.</div>`; return; }
        go.disabled = true;
        const { data: ch, error: e1 } = await client.auth.mfa.challenge({ factorId: en.id });
        if (e1) { go.disabled = false; msg.innerHTML = `<div class="msg error">${escHtml(e1.message)}</div>`; return; }
        const { error: e2 } = await client.auth.mfa.verify({ factorId: en.id, challengeId: ch.id, code });
        if (e2) { go.disabled = false; input.value = ""; msg.innerHTML = `<div class="msg error">That code didn't match. Try the next one.</div>`; return; }
        finish();
      };
      go.addEventListener("click", submit);
      input.addEventListener("keydown", (e) => { if (e.key === "Enter") submit(); });
    };
    if (verified.length) challenge(verified[0].id); else enroll();
  });
}
