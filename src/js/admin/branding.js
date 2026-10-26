function darken(hex, amt) {
  let col = hex.replace("#", "");
  if (col.length === 3) col = col.split("").map((c) => c + c).join("");
  const num = parseInt(col, 16);
  let r = Math.max(Math.min(255, (num >> 16) + amt), 0);
  let g = Math.max(Math.min(255, ((num >> 8) & 0x00ff) + amt), 0);
  let b = Math.max(Math.min(255, (num & 0x0000ff) + amt), 0);
  return "#" + (0x1000000 + r * 0x10000 + g * 0x100 + b).toString(16).slice(1);
}

async function loadCompanyBranding() {
  // Scoped to the signed-in user's own company (via their profile),
  // rather than blindly grabbing "the" companies row — required once
  // more than one company can exist, and avoids a hard error from
  // .single() if there's ever more than one row visible.
  const { data: { user } } = await client.auth.getUser();
  let companyId = null;
  if (user) {
    const { data: myProfile } = await client
      .from("profiles")
      .select("company_id")
      .eq("user_id", user.id)
      .maybeSingle();
    companyId = myProfile && myProfile.company_id;
    if (!companyId) {
      const { data: mem } = await client.from("company_memberships").select("company_id").eq("user_id", user.id).order("created_at").limit(1).maybeSingle();
      companyId = mem && mem.company_id;
    }
  }

  let query = client.from("companies").select("*");
  query = companyId ? query.eq("id", companyId) : query.limit(1);
  const { data: company, error } = await query.maybeSingle();
  if (error || !company) {
    // Couldn't read the company: show the employee's own company name from the picker data instead of a stale default.
    try { const { data: mine } = await client.rpc("my_companies"); const m = mine && (mine.find((c) => c.id === companyId) || mine[0]); if (m) document.getElementById("brandEyebrow").textContent = m.name || ""; } catch (_) {}
    return;
  }
  currentCompany = company;

  // Unset colours keep the stylesheet's defaults.
  if (company.primary_color) {
    document.documentElement.style.setProperty("--accent", company.primary_color);
    document.documentElement.style.setProperty("--accent-hover", darken(company.primary_color, -25));
  }
  if (company.accent_color) {
    document.documentElement.style.setProperty("--link", company.accent_color);
    document.documentElement.style.setProperty("--link-hover", darken(company.accent_color, -25));
  }

  document.getElementById("brandEyebrow").textContent = company.name || "";
  document.getElementById("brandTagline").textContent = company.tagline || "";

  const mark = document.getElementById("brandMark");
  const logoPreview = document.getElementById("companyLogoPreview");
  if (company.logo_path) {
    const { data: signed } = await client.storage.from("branding").createSignedUrl(company.logo_path, 60 * 60);
    if (signed) {
      mark.innerHTML = `<img src="${signed.signedUrl}" alt="logo" style="width:100%;height:100%;object-fit:cover;border-radius:8px;" />`;
      logoPreview.innerHTML = `<img src="${signed.signedUrl}" alt="logo" />`;
    }
  } else {
    mark.textContent = "HR";
    logoPreview.textContent = "HR";
  }

  if (isAdmin) {
    document.getElementById("companyNameInput").value = company.name || "";
    document.getElementById("companyTaglineInput").value = company.tagline || "";
    document.getElementById("companyPrimaryColorInput").value = company.primary_color || "#1a1a1a";
    document.getElementById("companyAccentColorInput").value = company.accent_color || "#b4550b";

    const opacityPct = company.background_opacity != null ? Math.round(Number(company.background_opacity) * 100) : 40;
    const posX = company.background_pos_x != null ? Number(company.background_pos_x) : 50;
    const posY = company.background_pos_y != null ? Number(company.background_pos_y) : 50;
    document.getElementById("bgOpacityInput").value = opacityPct;
    document.getElementById("bgOpacityValue").textContent = opacityPct;
    document.getElementById("bgPosXInput").value = posX;
    document.getElementById("bgPosYInput").value = posY;

    const previewBox = document.getElementById("bgPreviewBox");
    const previewOverlay = document.getElementById("bgPreviewOverlay");
    previewBox.style.backgroundPosition = `${posX}% ${posY}%`;
    previewOverlay.style.opacity = String(1 - opacityPct / 100);
    if (company.background_path) {
      const bgUrl = await brandingUrl(company.background_path);
      previewBox.style.backgroundImage = bgUrl ? `url("${bgUrl}")` : "none";
    } else {
      previewBox.style.backgroundImage = "none";
    }
  }

  await applyPageBackground(company);
}

// ---- Portal background (applies to everyone at the company) ----
// Background images are signed for a week and the link is remembered in
// this browser, so the same URL is used every visit and the browser's
// own image cache can serve it instantly. (Each upload gets a new file
// name, so a changed background is never served stale.)
async function brandingUrl(path) {
  const key = "brandUrl:" + path;
  try {
    const c = JSON.parse(localStorage.getItem(key) || "null");
    if (c && c.exp > Date.now() + 86400000) return c.url;
  } catch (e) { /* storage unavailable */ }
  const { data } = await client.storage.from("branding").createSignedUrl(path, 60 * 60 * 24 * 7);
  if (!data) return null;
  try { localStorage.setItem(key, JSON.stringify({ url: data.signedUrl, exp: Date.now() + 7 * 86400000 })); } catch (e) { /* ignore */ }
  return data.signedUrl;
}

// Shrinks a photo to at most 1920px on its longest side as a JPEG before
// upload. A phone or camera original is several MB; this is a few hundred KB.
function compressImageToBlob(file, maxSide = 1920, quality = 0.82) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
      const w = Math.round(img.naturalWidth * scale), hgt = Math.round(img.naturalHeight * scale);
      const canvas = document.createElement("canvas");
      canvas.width = w; canvas.height = hgt;
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, w, hgt);
      ctx.drawImage(img, 0, 0, w, hgt);
      URL.revokeObjectURL(url);
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Couldn't process that image"))), "image/jpeg", quality);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("That file isn't a readable image")); };
    img.src = url;
  });
}

async function applyPageBackground(company) {
  const bgEl = document.getElementById("pageBg");
  const overlay = bgEl.querySelector(".bg-overlay");
  const opacity = company && company.background_opacity != null ? Number(company.background_opacity) : 0.4;
  const posX = company && company.background_pos_x != null ? Number(company.background_pos_x) : 50;
  const posY = company && company.background_pos_y != null ? Number(company.background_pos_y) : 50;

  bgEl.style.backgroundPosition = `${posX}% ${posY}%`;

  if (company && company.background_path) {
    const bgUrl = await brandingUrl(company.background_path);
    if (bgUrl) {
      // Fade the photo in once it has actually downloaded instead of
      // letting it paint in strips.
      const pre = new Image();
      pre.onload = () => {
        bgEl.style.backgroundImage = `url("${bgUrl}")`;
        overlay.style.opacity = String(1 - opacity);
      };
      pre.src = bgUrl;
      return;
    }
  }
  bgEl.style.backgroundImage = "none";
  overlay.style.opacity = "1";
}

// Live preview as the admin drags the sliders — no save needed to see the effect.
function syncBgPreview() {
  const opacityPct = Number(document.getElementById("bgOpacityInput").value);
  const posX = Number(document.getElementById("bgPosXInput").value);
  const posY = Number(document.getElementById("bgPosYInput").value);
  document.getElementById("bgOpacityValue").textContent = opacityPct;
  document.getElementById("bgPreviewBox").style.backgroundPosition = `${posX}% ${posY}%`;
  document.getElementById("bgPreviewOverlay").style.opacity = String(1 - opacityPct / 100);
}
["bgOpacityInput", "bgPosXInput", "bgPosYInput"].forEach((id) => {
  document.getElementById(id).addEventListener("input", syncBgPreview);
});

document.getElementById("companyBgFile").addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (!file) return;
  document.getElementById("bgPreviewBox").style.backgroundImage = `url("${URL.createObjectURL(file)}")`;
});

document.getElementById("saveBgBtn").addEventListener("click", async () => {
  const msgEl = document.getElementById("bgMsg");
  const file = document.getElementById("companyBgFile").files[0];
  const background_opacity = Number(document.getElementById("bgOpacityInput").value) / 100;
  const background_pos_x = Number(document.getElementById("bgPosXInput").value);
  const background_pos_y = Number(document.getElementById("bgPosYInput").value);

  const updates = { background_opacity, background_pos_x, background_pos_y };

  const oldPath = currentCompany.background_path || null;
  if (file) {
    msgEl.innerHTML = `<div class="msg">Optimizing and uploading…</div>`;
    let blob;
    try { blob = await compressImageToBlob(file); }
    catch (err) { msgEl.innerHTML = `<div class="msg error">${escHtml(err.message)}</div>`; return; }
    const path = `${currentCompany.id}/background-${Date.now()}.jpg`;
    const { error: uploadError } = await client.storage.from("branding").upload(path, blob, {
      contentType: "image/jpeg", cacheControl: "31536000",
    });
    if (uploadError) {
      msgEl.innerHTML = `<div class="msg error">Upload failed: ${uploadError.message}</div>`;
      return;
    }
    updates.background_path = path;
  }

  const { error } = await client.from("companies").update(updates).eq("id", currentCompany.id);
  if (error) {
    msgEl.innerHTML = `<div class="msg error">${error.message}</div>`;
    return;
  }
  // Clear out the previous image so old uploads don't pile up.
  if (updates.background_path && oldPath && oldPath !== updates.background_path) {
    client.storage.from("branding").remove([oldPath]).catch(() => {});
  }
  msgEl.innerHTML = `<div class="msg ok">Background saved.</div>`;
  document.getElementById("companyBgFile").value = "";
  loadCompanyBranding();
});

document.getElementById("removeBgBtn").addEventListener("click", async () => {
  const msgEl = document.getElementById("bgMsg");
  const { error } = await client.from("companies").update({ background_path: null }).eq("id", currentCompany.id);
  if (error) {
    msgEl.innerHTML = `<div class="msg error">${error.message}</div>`;
    return;
  }
  msgEl.innerHTML = `<div class="msg ok">Background removed.</div>`;
  loadCompanyBranding();
});

document.getElementById("saveCompanySettingsBtn").addEventListener("click", async () => {
  const msgEl = document.getElementById("companySettingsMsg");
  const name = document.getElementById("companyNameInput").value.trim();
  const tagline = document.getElementById("companyTaglineInput").value.trim();
  const primary_color = document.getElementById("companyPrimaryColorInput").value;
  const accent_color = document.getElementById("companyAccentColorInput").value;

  const { error } = await client
    .from("companies")
    .update({ name, tagline, primary_color, accent_color })
    .eq("id", currentCompany.id);

  if (error) {
    msgEl.innerHTML = `<div class="msg error">${error.message}</div>`;
    return;
  }
  msgEl.innerHTML = `<div class="msg ok">Saved.</div>`;
  loadCompanyBranding();
});

document.getElementById("uploadLogoBtn").addEventListener("click", async () => {
  const msgEl = document.getElementById("companyLogoMsg");
  const file = document.getElementById("companyLogoFile").files[0];
  if (!file) {
    msgEl.innerHTML = `<div class="msg error">Choose an image first.</div>`;
    return;
  }
  const ext = file.name.split(".").pop();
  const path = `${currentCompany.id}/logo.${ext}`;
  const { error: uploadError } = await client.storage.from("branding").upload(path, file, { upsert: true });
  if (uploadError) {
    msgEl.innerHTML = `<div class="msg error">Upload failed: ${uploadError.message}</div>`;
    return;
  }
  const { error: updateError } = await client.from("companies").update({ logo_path: path }).eq("id", currentCompany.id);
  if (updateError) {
    msgEl.innerHTML = `<div class="msg error">${updateError.message}</div>`;
    return;
  }
  msgEl.innerHTML = `<div class="msg ok">Logo updated.</div>`;
  document.getElementById("companyLogoFile").value = "";
  loadCompanyBranding();
});
