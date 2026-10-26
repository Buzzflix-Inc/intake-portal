toggleModeBtn.addEventListener("click", () => {
  mode = mode === "signin" ? "signup" : "signin";
  if (mode === "signup") {
    authTitle.textContent = "Create account";
    authSub.textContent = "Set up access to the intake portal.";
    authSubmitBtn.textContent = "Create account";
    toggleLabel.textContent = "Already have an account?";
    toggleModeBtn.textContent = "Sign in";
  } else {
    authTitle.textContent = "Sign in";
    authSub.textContent = "Access your documents, timesheets and paystubs.";
    authSubmitBtn.textContent = "Sign in";
    toggleLabel.textContent = "Don't have an account?";
    toggleModeBtn.textContent = "Create one";
  }
  authMsg.innerHTML = "";
});

// Invite links (?signup=1&email=...) open straight on "Create account" with the email filled in.
(function () {
  try {
    const q = new URLSearchParams(location.search);
    if (!q.has("signup")) return;
    if (mode === "signin") toggleModeBtn.click();
    const em = q.get("email");
    if (em) { const f = document.getElementById("email"); if (f) f.value = em; }
    history.replaceState(null, "", location.pathname + location.hash);
  } catch (_) {}
})();

authForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = document.getElementById("email").value.trim();
  const password = document.getElementById("password").value;
  authSubmitBtn.disabled = true;
  authMsg.innerHTML = "";

  const { error } =
    mode === "signup"
      ? await client.auth.signUp({ email, password, options: { emailRedirectTo: location.origin + location.pathname } })
      : await client.auth.signInWithPassword({ email, password });

  authSubmitBtn.disabled = false;

  if (error) {
    authMsg.innerHTML = `<div class="msg error">${error.message}</div>`;
    return;
  }
  if (mode === "signup") {
    authMsg.innerHTML = `<div class="msg ok">Account created. Check your email to confirm, then sign in.</div>`;
    return;
  }
  await showApp();
});

document.getElementById("signOutBtn").addEventListener("click", async () => {
  if (reviewChannel) {
    client.removeChannel(reviewChannel);
    reviewChannel = null;
  }
  await client.auth.signOut();
  appView.classList.add("hidden");
  authView.classList.remove("hidden");
  authForm.reset();
});
