// ---- Passkeys (Face ID, Touch ID, Windows Hello, security keys) ----
// The browser side uses @simplewebauthn/browser, loaded on first use; the checks happen in the
// "passkey" Edge Function. Signing in with a passkey replaces the emailed code, not the authenticator
// app: admins still enter their 6-digit authenticator code afterwards.
const passkeySupported = () => !!(window.PublicKeyCredential && navigator.credentials);

function loadWebAuthnLib() {
  if (window.SimpleWebAuthnBrowser) return Promise.resolve(window.SimpleWebAuthnBrowser);
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://cdn.jsdelivr.net/npm/@simplewebauthn/browser@13.3.0/dist/bundle/index.umd.min.js";
    s.onload = () => resolve(window.SimpleWebAuthnBrowser);
    s.onerror = () => reject(new Error("Couldn't load the passkey helper. Check your connection."));
    document.head.appendChild(s);
  });
}

async function passkeyCall(action, extra) {
  const { data, error } = await client.functions.invoke("passkey", { body: { action, ...(extra || {}) } });
  if (error) {
    let msg = error.message;
    try { const b = await error.context.json(); if (b && b.error) msg = b.error; } catch (_) {}
    throw new Error(msg);
  }
  if (data && data.error) throw new Error(data.error);
  return data;
}

// The browser throws NotAllowedError when the person cancels: treat that as "no", not an error.
const passkeyCancelled = (e) => e && (e.name === "NotAllowedError" || e.name === "AbortError");

function passkeyDeviceName() {
  const ua = navigator.userAgent;
  const os = /iPhone|iPad/.test(ua) ? "iPhone/iPad" : /Android/.test(ua) ? "Android" : /Mac/.test(ua) ? "Mac" : /Windows/.test(ua) ? "Windows" : "This device";
  const br = /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "";
  return br ? `${os} · ${br}` : os;
}

// Register a passkey for the signed-in person. Resolves true when saved, false if they cancelled.
async function registerPasskey() {
  const lib = await loadWebAuthnLib();
  const { options, challengeId } = await passkeyCall("register-options");
  let response;
  try { response = await lib.startRegistration({ optionsJSON: options }); }
  catch (e) { if (passkeyCancelled(e)) return false; throw e; }
  await passkeyCall("register-verify", { challengeId, response, deviceName: passkeyDeviceName() });
  return true;
}

async function signInWithPasskey() {
  const lib = await loadWebAuthnLib();
  const { options, challengeId } = await passkeyCall("login-options");
  let response;
  try { response = await lib.startAuthentication({ optionsJSON: options }); }
  catch (e) { if (passkeyCancelled(e)) return false; throw e; }
  const { tokenHash } = await passkeyCall("login-verify", { challengeId, response });
  const { error } = await client.auth.verifyOtp({ token_hash: tokenHash, type: "email" });
  if (error) throw error;
  return true;
}

(function () {
  if (!passkeySupported()) return;
  const btn = document.getElementById("passkeySignInBtn");
  btn.classList.remove("hidden");
  document.getElementById("passkeyOr").classList.remove("hidden");
  btn.addEventListener("click", async () => {
    authMsg.innerHTML = "";
    btn.disabled = true;
    try {
      if (await signInWithPasskey()) await showApp();
    } catch (e) {
      authMsg.innerHTML = `<div class="msg error">${escHtml(e.message || String(e))}</div>`;
    } finally {
      btn.disabled = false;
    }
  });
})();
