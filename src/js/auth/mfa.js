// ---- Two-step sign-in (authenticator app) required for admins and super admins ----
// Also hands out backup codes: right after setting up an authenticator, and once for anyone who
// has an authenticator but no codes yet. A backup code removes a lost authenticator so a new one
// can be set up.
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
  let { data: fl } = await client.auth.mfa.listFactors();
  const verified = ((fl && fl.totp) || []).filter((f) => f.status === "verified");
  if (!privileged && !verified.length) return true; // regular crew: no second step

  const gate = document.createElement("div");
  gate.id = "mfaGate";
  document.body.appendChild(gate);
  const out = async () => { gate.remove(); await client.auth.signOut(); location.reload(); };
  const card = (inner) => { gate.innerHTML = `<div class="mfa-card">${inner}</div>`; gate.querySelectorAll("[data-so]").forEach((so) => so.addEventListener("click", out)); };

  return new Promise((resolve) => {
    const finish = () => { gate.remove(); resolve(true); };

    // Show freshly generated backup codes; continue once they confirm they've saved them.
    const showCodes = async (intro) => {
      const { data: codes, error } = await client.rpc("generate_recovery_codes");
      if (error || !codes || !codes.length) { finish(); return; }
      card(`<h2>Save your backup codes</h2>
        <p>${intro} Each code works once. If you lose your phone, sign in with your email and use a code to set up a new authenticator.</p>
        <ol class="mfa-codes">${codes.map((c) => `<li><code>${escHtml(c)}</code></li>`).join("")}</ol>
        <div class="mfa-row mfa-save"><button type="button" class="btn-secondary" id="mfaCopy" data-nobusy>Copy</button><button type="button" class="btn-secondary" id="mfaPdf" data-nobusy>Download PDF</button></div>
        <label class="checkbox-label mfa-ack"><input type="checkbox" id="mfaAck" /> I've saved these somewhere safe</label>
        <button class="btn-primary" id="mfaDone" data-nobusy disabled>Continue</button>`);
      const ack = gate.querySelector("#mfaAck"), done = gate.querySelector("#mfaDone");
      ack.addEventListener("change", () => { done.disabled = !ack.checked; });
      done.addEventListener("click", finish);
      gate.querySelector("#mfaCopy").addEventListener("click", async (e) => {
        const text = `HR Intake Portal backup codes for ${currentUserEmail || user.email}\n\n` + codes.join("\n");
        try { await navigator.clipboard.writeText(text); e.target.textContent = "Copied!"; setTimeout(() => { e.target.textContent = "Copy"; }, 1600); }
        catch (_) { window.prompt("Copy your backup codes:", codes.join("  ")); }
      });
      gate.querySelector("#mfaPdf").addEventListener("click", () => downloadBackupCodesPdf(codes, currentUserEmail || user.email));
    };

    const recover = () => {
      card(`<h2>Use a backup code</h2><p>Enter one of the backup codes you saved when you set up two-step sign-in. It removes your old authenticator so you can set up a new one.</p>
        <input id="mfaRecovery" autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="11" placeholder="XXXXX-XXXXX" />
        <div id="mfaMsg"></div>
        <div class="mfa-row"><button class="btn-secondary" id="mfaGo">Use code</button><button type="button" class="remove-link" id="mfaBack">Back</button></div>`);
      const input = gate.querySelector("#mfaRecovery"), go = gate.querySelector("#mfaGo"), msg = gate.querySelector("#mfaMsg");
      input.focus();
      gate.querySelector("#mfaBack").addEventListener("click", () => challenge(verified[0].id));
      const submit = async () => {
        go.disabled = true;
        const { data: ok, error } = await client.rpc("use_recovery_code", { p_code: input.value });
        if (error || !ok) { go.disabled = false; input.select(); msg.innerHTML = `<div class="msg error">${escHtml(error ? error.message : "That code didn't work. Check it, or try another one.")}</div>`; return; }
        await client.auth.refreshSession();
        ({ data: fl } = await client.auth.mfa.listFactors());
        enroll("Your old authenticator was removed. Set up a new one now.");
      };
      go.addEventListener("click", submit);
      input.addEventListener("keydown", (e) => { if (e.key === "Enter") submit(); });
    };

    const challenge = (factorId) => {
      card(`<h2>Enter your code</h2><p>Open your authenticator app and type the 6-digit code for the HR Intake Portal.</p>
        <input id="mfaCode" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="000000" />
        <div id="mfaMsg"></div>
        <div class="mfa-row"><button class="btn-secondary" id="mfaGo">Verify</button><button type="button" class="remove-link" data-so>Sign out</button></div>
        <p class="mfa-alt"><button type="button" class="remove-link" id="mfaLost">Lost your phone? Use a backup code</button></p>`);
      const input = gate.querySelector("#mfaCode"), go = gate.querySelector("#mfaGo"), msg = gate.querySelector("#mfaMsg");
      input.focus();
      gate.querySelector("#mfaLost").addEventListener("click", recover);
      const submit = async () => {
        const code = input.value.trim();
        if (!/^\d{6}$/.test(code)) { msg.innerHTML = `<div class="msg error">Enter the 6-digit code.</div>`; return; }
        go.disabled = true;
        const { data: ch, error: e1 } = await client.auth.mfa.challenge({ factorId });
        if (e1) { go.disabled = false; msg.innerHTML = `<div class="msg error">${escHtml(e1.message)}</div>`; return; }
        const { error: e2 } = await client.auth.mfa.verify({ factorId, challengeId: ch.id, code });
        if (e2) { go.disabled = false; input.value = ""; input.focus(); msg.innerHTML = `<div class="msg error">That code didn't work. Check the time on your phone and try the next code.</div>`; return; }
        // Accounts set up before backup codes existed get a set now.
        const { data: left } = await client.rpc("recovery_codes_left");
        if (!left) showCodes("You don't have backup codes yet."); else finish();
      };
      go.addEventListener("click", submit);
      input.addEventListener("keydown", (e) => { if (e.key === "Enter") submit(); });
    };

    const enroll = async (lead) => {
      // Clear any half-finished setup first
      for (const f of ((fl && fl.all) || []).filter((x) => x.factor_type === "totp" && x.status !== "verified")) {
        try { await client.auth.mfa.unenroll({ factorId: f.id }); } catch (_) {}
      }
      const { data: en, error: e0 } = await client.auth.mfa.enroll({ factorType: "totp", friendlyName: "HR Intake Portal " + Date.now().toString(36) });
      if (e0) { card(`<h2>Set up two-step sign-in</h2><div class="msg error">${escHtml(e0.message)}</div><button type="button" class="remove-link" data-so>Sign out</button>`); return; }
      card(`<h2>Set up two-step sign-in</h2>
        <p>${lead || "Admin accounts need a second step."} Scan this with an authenticator app (Google Authenticator, Microsoft Authenticator, 1Password, Authy), then enter the 6-digit code it shows.</p>
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
        showCodes("Two-step sign-in is on.");
      };
      go.addEventListener("click", submit);
      input.addEventListener("keydown", (e) => { if (e.key === "Enter") submit(); });
    };
    if (verified.length) challenge(verified[0].id); else enroll();
  });
}

async function downloadBackupCodesPdf(codes, email) {
  const JsPDF = await ensureJsPdf();
  const doc = new JsPDF({ unit: "pt", format: "letter" });
  doc.setFont("helvetica", "bold"); doc.setFontSize(18);
  doc.text("HR Intake Portal: backup codes", 54, 72);
  doc.setFont("helvetica", "normal"); doc.setFontSize(11);
  doc.text(`Account: ${email}`, 54, 98);
  doc.text(`Created: ${new Date().toLocaleString()}`, 54, 114);
  doc.text(doc.splitTextToSize("Each code works once. If you lose your authenticator app, sign in with your email, choose \"Use a backup code\", and enter one of these. It removes the old authenticator so you can set up a new one. Keep this page somewhere safe, such as a password manager or a locked drawer.", 500), 54, 142);
  doc.setFont("courier", "bold"); doc.setFontSize(15);
  codes.forEach((c, i) => doc.text(`${String(i + 1).padStart(2, " ")}.  ${c}`, 54 + (i % 2) * 250, 214 + Math.floor(i / 2) * 30));
  doc.save("hr-intake-backup-codes.pdf");
}
