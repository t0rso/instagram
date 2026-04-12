(function () {
  "use strict";

  const screens = {
    landing: document.getElementById("screen-landing"),
    upload: document.getElementById("screen-upload"),
    results: document.getElementById("screen-results"),
  };

  const inputFollowers = document.getElementById("input-followers");
  const inputFollowing = document.getElementById("input-following");
  const followersEmpty = document.getElementById("followers-empty");
  const followersFilled = document.getElementById("followers-filled");
  const followingEmpty = document.getElementById("following-empty");
  const followingFilled = document.getElementById("following-filled");
  const followersFileName = document.getElementById("followers-file-name");
  const followingFileName = document.getElementById("following-file-name");
  const uploadError = document.getElementById("upload-error");
  const btnAnalyze = document.getElementById("btn-analyze");
  const resultsList = document.getElementById("results-list");
  const resultsSummary = document.getElementById("results-summary");
  const statFollowers = document.getElementById("stat-followers-count");
  const statFollowing = document.getElementById("stat-following-count");
  const statNotBack = document.getElementById("stat-not-back-count");
  const toast = document.getElementById("toast");

  let toastTimer = null;

  function showScreen(name) {
    Object.entries(screens).forEach(([key, el]) => {
      if (!el) return;
      el.hidden = key !== name;
    });
  }

  function setUploadError(message) {
    if (!message) {
      uploadError.hidden = true;
      uploadError.textContent = "";
      return;
    }
    uploadError.hidden = false;
    uploadError.textContent = message;
  }

  function updateAnalyzeState() {
    const ok =
      inputFollowers.files &&
      inputFollowers.files.length > 0 &&
      inputFollowing.files &&
      inputFollowing.files.length > 0;
    btnAnalyze.disabled = !ok;
  }

  function syncFollowersUI() {
    const row = inputFollowers && inputFollowers.closest(".upload-item");
    const f = inputFollowers.files && inputFollowers.files[0];
    if (f) {
      if (followersEmpty) followersEmpty.hidden = true;
      if (followersFilled) followersFilled.hidden = false;
      if (followersFileName) followersFileName.textContent = f.name;
      if (row) row.classList.add("upload-item--has-file");
    } else {
      if (followersEmpty) followersEmpty.hidden = false;
      if (followersFilled) followersFilled.hidden = true;
      if (followersFileName) followersFileName.textContent = "";
      if (row) row.classList.remove("upload-item--has-file");
    }
  }

  function syncFollowingUI() {
    const row = inputFollowing && inputFollowing.closest(".upload-item");
    const f = inputFollowing.files && inputFollowing.files[0];
    if (f) {
      if (followingEmpty) followingEmpty.hidden = true;
      if (followingFilled) followingFilled.hidden = false;
      if (followingFileName) followingFileName.textContent = f.name;
      if (row) row.classList.add("upload-item--has-file");
    } else {
      if (followingEmpty) followingEmpty.hidden = false;
      if (followingFilled) followingFilled.hidden = true;
      if (followingFileName) followingFileName.textContent = "";
      if (row) row.classList.remove("upload-item--has-file");
    }
  }

  function syncUploadPickers() {
    syncFollowersUI();
    syncFollowingUI();
  }

  function readFileAsText(file) {
    return new Promise(function (resolve, reject) {
      const reader = new FileReader();
      reader.onload = function () {
        resolve(String(reader.result || ""));
      };
      reader.onerror = function () {
        reject(new Error("Could not read the file."));
      };
      reader.readAsText(file, "UTF-8");
    });
  }

  function parseFollowersJson(text) {
    let data;
    try {
      data = JSON.parse(text);
    } catch (e) {
      throw new Error("Followers file is not valid JSON.");
    }
    if (!Array.isArray(data)) {
      throw new Error(
        "Followers file has an unexpected format. Expected a JSON array."
      );
    }
    const usernames = [];
    for (let i = 0; i < data.length; i++) {
      const item = data[i];
      const list = item && item.string_list_data;
      if (!Array.isArray(list) || list.length === 0) continue;
      const v = list[0] && list[0].value;
      if (typeof v === "string" && v.trim()) {
        usernames.push(v.trim());
      }
    }
    return usernames;
  }

  function parseFollowingJson(text) {
    let data;
    try {
      data = JSON.parse(text);
    } catch (e) {
      throw new Error("Following file is not valid JSON.");
    }
    const rel = data && data.relationships_following;
    if (!Array.isArray(rel)) {
      throw new Error(
        "Following file has an unexpected format. Missing relationships_following array."
      );
    }
    const usernames = [];
    for (let i = 0; i < rel.length; i++) {
      const item = rel[i];
      const t = item && item.title;
      if (typeof t === "string" && t.trim()) {
        usernames.push(t.trim());
      }
    }
    return usernames;
  }

  function buildNotFollowingBack(followerUsernames, followingUsernames) {
    const followerSet = new Set();
    followerUsernames.forEach(function (u) {
      followerSet.add(u.toLowerCase());
    });
    const seen = new Set();
    const out = [];
    followingUsernames.forEach(function (u) {
      const key = u.toLowerCase();
      if (followerSet.has(key)) return;
      if (seen.has(key)) return;
      seen.add(key);
      out.push(u);
    });
    out.sort(function (a, b) {
      return a.toLowerCase().localeCompare(b.toLowerCase(), "en");
    });
    return out;
  }

  function showToast(message) {
    toast.textContent = message;
    toast.hidden = false;
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      toast.hidden = true;
      toast.textContent = "";
      toastTimer = null;
    }, 2000);
  }

  function copyUsername(username) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(username).then(function () {
        showToast("Copied");
      });
    }
    return new Promise(function (resolve, reject) {
      const ta = document.createElement("textarea");
      ta.value = username;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      document.body.appendChild(ta);
      ta.select();
      try {
        const ok = document.execCommand("copy");
        document.body.removeChild(ta);
        if (ok) {
          showToast("Copied");
          resolve();
        } else {
          reject(new Error("copy failed"));
        }
      } catch (e) {
        document.body.removeChild(ta);
        reject(e);
      }
    });
  }

  function formatCount(n) {
    return typeof n === "number" && !isNaN(n) ? String(n) : "—";
  }

  function renderResults(usernames, followerCount, followingCount) {
    resultsList.innerHTML = "";
    const notBackCount = usernames.length;

    if (statFollowers) statFollowers.textContent = formatCount(followerCount);
    if (statFollowing) statFollowing.textContent = formatCount(followingCount);
    if (statNotBack) statNotBack.textContent = formatCount(notBackCount);

    if (usernames.length === 0) {
      resultsSummary.textContent =
        "Everyone you follow follows you back — or your lists are empty.";
      return;
    }
    resultsSummary.textContent =
      usernames.length === 1
        ? "1 account does not follow you back."
        : usernames.length + " accounts do not follow you back.";
    const frag = document.createDocumentFragment();
    usernames.forEach(function (name) {
      const li = document.createElement("li");
      li.className = "results-item";
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "results-button";
      btn.textContent = name;
      btn.setAttribute(
        "aria-label",
        "Copy username " + name + " to clipboard"
      );
      btn.addEventListener("click", function () {
        copyUsername(name).catch(function () {
          showToast("Could not copy");
        });
      });
      li.appendChild(btn);
      frag.appendChild(li);
    });
    resultsList.appendChild(frag);
  }

  document.getElementById("btn-have-files").addEventListener("click", function () {
    showScreen("upload");
    setUploadError("");
    syncUploadPickers();
  });

  document.getElementById("btn-upload-back").addEventListener("click", function () {
    showScreen("landing");
    setUploadError("");
  });

  document.getElementById("btn-results-back").addEventListener("click", function () {
    showScreen("upload");
    setUploadError("");
    syncUploadPickers();
  });

  document.getElementById("btn-remove-followers").addEventListener("click", function () {
    inputFollowers.value = "";
    setUploadError("");
    syncFollowersUI();
    updateAnalyzeState();
  });

  document.getElementById("btn-remove-following").addEventListener("click", function () {
    inputFollowing.value = "";
    setUploadError("");
    syncFollowingUI();
    updateAnalyzeState();
  });

  inputFollowers.addEventListener("change", function () {
    setUploadError("");
    syncFollowersUI();
    updateAnalyzeState();
  });

  inputFollowing.addEventListener("change", function () {
    setUploadError("");
    syncFollowingUI();
    updateAnalyzeState();
  });

  btnAnalyze.addEventListener("click", function () {
    const fFollowers = inputFollowers.files && inputFollowers.files[0];
    const fFollowing = inputFollowing.files && inputFollowing.files[0];
    if (!fFollowers || !fFollowing) return;

    setUploadError("");
    btnAnalyze.disabled = true;

    Promise.all([readFileAsText(fFollowers), readFileAsText(fFollowing)])
      .then(function (texts) {
        const followersList = parseFollowersJson(texts[0]);
        const followingList = parseFollowingJson(texts[1]);
        const notBack = buildNotFollowingBack(followersList, followingList);
        renderResults(
          notBack,
          followersList.length,
          followingList.length
        );
        showScreen("results");
      })
      .catch(function (err) {
        setUploadError(err.message || "Something went wrong. Try again.");
      })
      .finally(function () {
        updateAnalyzeState();
      });
  });

  showScreen("landing");
  syncUploadPickers();
  updateAnalyzeState();
})();
