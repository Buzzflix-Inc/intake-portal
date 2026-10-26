// ---- Sign in with an emailed code (or the link in the same email), or a passkey. No passwords. ----
// New emails get an account automatically; what happens next (join or create a production) is in onboarding.js.
const authStepEmail = document.getElementById("authStepEmail");
const authStepCode = document.getElementById("authStepCode");
const authCodeMsg = document.getElementById("authCodeMsg");
let authEmail = "";
let authResendTimer = null;

function showAuthStep(which) {
  authStepEmail.classList.toggle("hidden", which !== "email");
  authStepCode.classList.toggle("hidden", which !== "code");
  if (which === "code") setTimeout(() => document.getElementById("authCode").focus(), 30);
  else setTimeout(() => document.getElementById("email").focus(), 30);
}

// Resend is allowed again after 60 seconds (Supabase's own limit per address).
function startResendCountdown() {
  const btn = document.getElementById("authResendBtn");
  let left = 60;
  clearInterval(authResendTimer);
  btn.disabled = true;
  btn.textContent = `Resend code (${left}s)`;
  authResendTimer = setInterval(() => {
    left--;
    if (left <= 0) { clearInterval(authResendTimer); btn.disabled = false; btn.textContent = "Resend code"; return; }
    btn.textContent = `Resend code (${left}s)`;
  }, 1000);
}

async function sendAuthCode(email) {
  return client.auth.signInWithOtp({
    email,
    options: { shouldCreateUser: true, emailRedirectTo: location.origin + location.pathname },
  });
}

// Invite links (?signup=1&email=...) open with the email filled in.
(function () {
  try {
    const q = new URLSearchParams(location.search);
    if (!q.has("signup") && !q.has("email")) return;
    const em = q.get("email");
    if (em) document.getElementById("email").value = em;
    history.replaceState(null, "", location.pathname + location.hash);
  } catch (_) {}
})();

authForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = document.getElementById("email").value.trim().toLowerCase();
  if (!email) return;
  authSubmitBtn.disabled = true;
  authMsg.innerHTML = "";
  const { error } = await sendAuthCode(email);
  authSubmitBtn.disabled = false;
  if (error) {
    authMsg.innerHTML = `<div class="msg error">${escHtml(error.message)}</div>`;
    return;
  }
  authEmail = email;
  document.getElementById("authSentTo").textContent = email;
  document.getElementById("authCode").value = "";
  authCodeMsg.innerHTML = "";
  showAuthStep("code");
  startResendCountdown();
});

document.getElementById("authCodeForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const input = document.getElementById("authCode");
  const token = input.value.replace(/\D/g, "");
  if (token.length < 6) { authCodeMsg.innerHTML = `<div class="msg error">Enter the code from the email.</div>`; return; }
  const btn = document.getElementById("authCodeBtn");
  btn.disabled = true;
  authCodeMsg.innerHTML = "";
  const { error } = await client.auth.verifyOtp({ email: authEmail, token, type: "email" });
  btn.disabled = false;
  if (error) {
    input.value = "";
    input.focus();
    authCodeMsg.innerHTML = `<div class="msg error">That code didn't work or has expired. Check the latest email, or resend.</div>`;
    return;
  }
  await showApp();
});
// Pasting or autofilling the whole code signs in straight away.
document.getElementById("authCode").addEventListener("input", (e) => {
  const v = e.target.value.replace(/\D/g, "");
  if (v.length === 6 && e.inputType !== "insertText") document.getElementById("authCodeForm").requestSubmit();
});

document.getElementById("authResendBtn").addEventListener("click", async () => {
  if (!authEmail) return;
  const { error } = await sendAuthCode(authEmail);
  authCodeMsg.innerHTML = error
    ? `<div class="msg error">${escHtml(error.message)}</div>`
    : `<div class="msg ok">Sent a new code. Use the newest email.</div>`;
  if (!error) startResendCountdown();
});
document.getElementById("authBackBtn").addEventListener("click", () => {
  clearInterval(authResendTimer);
  authMsg.innerHTML = "";
  showAuthStep("email");
});

document.getElementById("signOutBtn").addEventListener("click", signOutEverywhere);
async function signOutEverywhere() {
  if (typeof reviewChannel !== "undefined" && reviewChannel) {
    client.removeChannel(reviewChannel);
    reviewChannel = null;
  }
  await client.auth.signOut();
  location.reload();
}
